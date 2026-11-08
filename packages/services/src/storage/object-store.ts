import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";

/**
 * THE OBJECT STORE (ADR-063) — the only code that talks to a bucket.
 *
 * One interface, one S3 implementation that works against R2, S3 and
 * Backblaze B2, plus an in-memory one for unit tests. Callers name the
 * bucket by visibility ("private" / "public"); which real bucket that is
 * comes from env. Only operations all three providers support are used:
 * presigned PUT and GET (no POST policies), no ACLs, tagging or versioning.
 */

export type Bucket = "private" | "public";

export interface StoredObjectHead {
  sizeBytes: number;
  contentType: string | null;
}

export interface ListedObject {
  key: string;
  sizeBytes: number;
  lastModified: Date;
}

export interface ObjectStore {
  put(
    bucket: Bucket,
    key: string,
    body: Buffer,
    opts: { contentType: string; cacheControl: string },
  ): Promise<void>;
  /** The bytes, or null when the key does not exist. */
  get(bucket: Bucket, key: string): Promise<Buffer | null>;
  head(bucket: Bucket, key: string): Promise<StoredObjectHead | null>;
  /** Deletes the keys; a key that does not exist is not an error. */
  delete(bucket: Bucket, keys: string[]): Promise<void>;
  copy(bucket: Bucket, fromKey: string, toKey: string): Promise<void>;
  list(
    bucket: Bucket,
    opts: { prefix?: string; cursor?: string },
  ): Promise<{ objects: ListedObject[]; cursor: string | null }>;
  /** A link the client PUTs one file to. `headers` are signed and must be sent as is. */
  presignPut(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; contentLength: number; expiresInSeconds: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** A download link valid from `signingDate` for `expiresInSeconds`. */
  presignGet(
    bucket: Bucket,
    key: string,
    opts: { signingDate: Date; expiresInSeconds: number },
  ): Promise<string>;
}

/** Thrown on first use when the bucket settings are missing. */
export class StorageNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Object storage is not configured: set ${missing.join(", ")} (ADR-063).`);
    this.name = "StorageNotConfiguredError";
  }
}

// S3's DeleteObjects takes at most 1,000 keys per request.
const DELETE_BATCH = 1000;

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly buckets: Record<Bucket, string>,
  ) {}

  async put(
    bucket: Bucket,
    key: string,
    body: Buffer,
    opts: { contentType: string; cacheControl: string },
  ) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl,
      }),
    );
  }

  async get(bucket: Bucket, key: string) {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
      );
      if (!out.Body) return null;
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async head(bucket: Bucket, key: string) {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
      );
      return { sizeBytes: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async delete(bucket: Bucket, keys: string[]) {
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH);
      const out = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.buckets[bucket],
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      const failed = (out.Errors ?? []).filter((e) => e.Code !== "NoSuchKey");
      if (failed.length > 0) {
        const first = failed[0];
        throw new Error(
          `Could not delete ${failed.length} file(s) from storage (first: ${first?.Key}: ${first?.Code}).`,
        );
      }
    }
  }

  async copy(bucket: Bucket, fromKey: string, toKey: string) {
    const name = this.buckets[bucket];
    await this.client.send(
      new CopyObjectCommand({
        Bucket: name,
        Key: toKey,
        CopySource: `${name}/${fromKey.split("/").map(encodeURIComponent).join("/")}`,
      }),
    );
  }

  async list(bucket: Bucket, opts: { prefix?: string; cursor?: string }) {
    const out = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.buckets[bucket],
        Prefix: opts.prefix,
        ContinuationToken: opts.cursor,
        MaxKeys: 1000,
      }),
    );
    return {
      objects: (out.Contents ?? []).map((o) => ({
        key: o.Key ?? "",
        sizeBytes: o.Size ?? 0,
        lastModified: o.LastModified ?? new Date(0),
      })),
      cursor: out.IsTruncated ? (out.NextContinuationToken ?? null) : null,
    };
  }

  async presignPut(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; contentLength: number; expiresInSeconds: number },
  ) {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        ContentType: opts.contentType,
        ContentLength: opts.contentLength,
      }),
      {
        expiresIn: opts.expiresInSeconds,
        // Signed so a link for one file cannot carry another type or size.
        // The client's HTTP stack sets Content-Length from the body itself.
        signableHeaders: new Set(["content-type", "content-length"]),
      },
    );
    return { url, headers: { "Content-Type": opts.contentType } };
  }

  async presignGet(
    bucket: Bucket,
    key: string,
    opts: { signingDate: Date; expiresInSeconds: number },
  ) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
      { expiresIn: opts.expiresInSeconds, signingDate: opts.signingDate },
    );
  }
}

function isMissing(error: unknown) {
  if (error instanceof NoSuchKey || error instanceof NotFound) return true;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

/** In-memory store for unit tests. Links are fake and only identify the key. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<
    string,
    { body: Buffer; contentType: string; cacheControl: string; lastModified: Date }
  >();

  private id(bucket: Bucket, key: string) {
    return `${bucket}:${key}`;
  }

  async put(
    bucket: Bucket,
    key: string,
    body: Buffer,
    opts: { contentType: string; cacheControl: string },
  ) {
    this.objects.set(this.id(bucket, key), { body, ...opts, lastModified: new Date() });
  }

  async get(bucket: Bucket, key: string) {
    return this.objects.get(this.id(bucket, key))?.body ?? null;
  }

  async head(bucket: Bucket, key: string) {
    const o = this.objects.get(this.id(bucket, key));
    return o ? { sizeBytes: o.body.length, contentType: o.contentType } : null;
  }

  async delete(bucket: Bucket, keys: string[]) {
    for (const key of keys) this.objects.delete(this.id(bucket, key));
  }

  async copy(bucket: Bucket, fromKey: string, toKey: string) {
    const o = this.objects.get(this.id(bucket, fromKey));
    if (!o) throw new Error(`No such key: ${fromKey}`);
    this.objects.set(this.id(bucket, toKey), { ...o, lastModified: new Date() });
  }

  async list(bucket: Bucket, opts: { prefix?: string; cursor?: string }) {
    const prefix = `${bucket}:${opts.prefix ?? ""}`;
    const objects = [...this.objects.entries()]
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, o]) => ({
        key: id.slice(bucket.length + 1),
        sizeBytes: o.body.length,
        lastModified: o.lastModified,
      }));
    return { objects, cursor: null };
  }

  async presignPut(
    bucket: Bucket,
    key: string,
    opts: { contentType: string; contentLength: number; expiresInSeconds: number },
  ) {
    return {
      url: `memory://${bucket}/${key}?put&expires=${opts.expiresInSeconds}`,
      headers: { "Content-Type": opts.contentType },
    };
  }

  async presignGet(
    bucket: Bucket,
    key: string,
    opts: { signingDate: Date; expiresInSeconds: number },
  ) {
    return `memory://${bucket}/${key}?signed=${opts.signingDate.toISOString()}&expires=${opts.expiresInSeconds}`;
  }
}

let store: ObjectStore | null = null;

/** The configured store, built on first use. */
export function getObjectStore(): ObjectStore {
  if (store) return store;

  const missing = (
    [
      ["STORAGE_ENDPOINT", env.STORAGE_ENDPOINT],
      ["STORAGE_ACCESS_KEY_ID", env.STORAGE_ACCESS_KEY_ID],
      ["STORAGE_SECRET_ACCESS_KEY", env.STORAGE_SECRET_ACCESS_KEY],
      ["STORAGE_PRIVATE_BUCKET", env.STORAGE_PRIVATE_BUCKET],
      ["STORAGE_PUBLIC_BUCKET", env.STORAGE_PUBLIC_BUCKET],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) throw new StorageNotConfiguredError(missing);

  const client = new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY!,
    },
    // The SDK's default CRC32 checksums are not accepted by every
    // S3-compatible provider (R2, B2). Send them only when an operation
    // requires one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  store = new S3ObjectStore(client, {
    private: env.STORAGE_PRIVATE_BUCKET!,
    public: env.STORAGE_PUBLIC_BUCKET!,
  });
  return store;
}

/** Tests swap in a MemoryObjectStore; null goes back to the configured one. */
export function setObjectStoreForTests(next: ObjectStore | null) {
  store = next;
}
