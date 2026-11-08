import type { DataScope } from "@repo/authz";
import {
  UPLOAD_MAX_BYTES,
  type CompletedUpload,
  type ImageRef,
  type StoragePurpose,
  type UploadRequest,
  type UploadTicket,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  roleAssignments,
  storageObjects,
  studentPhotos,
  students,
  type StorageVariant,
} from "@repo/db/schema";
import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { requireSchoolId } from "./academic.service";
import { refuse } from "./service-error";
import { ImageRejectedError, processImage } from "./storage/image";
import { buildImageRef } from "./storage/links";
import { getObjectStore } from "./storage/object-store";
import { PURPOSES, objectPrefix, uploadKey } from "./storage/purposes";

/**
 * STORAGE (ADR-063) — files live in S3-compatible buckets; this service owns
 * their rows in `storage_objects` and every move between states.
 *
 * The upload flow: a domain endpoint, behind its own permission gate, calls
 * `createUploads` and hands the client a link to PUT the file to `tmp/{id}`.
 * The client calls `complete`, which checks the bytes, writes the purpose's
 * versions and marks the row `ready`. The domain's save then calls `attach`
 * inside its own transaction. Replacing or removing a file is `markDeleted`
 * in that same transaction; the storage sweeper removes the bytes later.
 *
 * Reads never expose object ids for a client to turn into URLs: callers that
 * have authorised a record ask for `imageRefs` and return ready-made links.
 *
 * Tenancy is structural (hard rule 1): every method takes the organizationId
 * (or the uploader, for `complete`) and filters by it.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

// An upload link is good for ten minutes; a cheap phone on a bad network
// sends a few hundred KB well inside that.
const UPLOAD_LINK_SECONDS = 10 * 60;
// Uploads handed out but not yet completed, per organisation. A rate limit
// on top of the endpoint's own.
const MAX_PENDING_PER_ORG = 300;
// Processed files never change (a replacement is a new id), so caches may
// keep them for a year.
const PRIVATE_CACHE = "private, max-age=31536000, immutable";
const PUBLIC_CACHE = "public, max-age=31536000, immutable";

export interface StoredFileMeta {
  id: string;
  organizationId: string;
  purpose: StoragePurpose;
  status: "pending" | "ready" | "deleted";
  contentType: string | null;
  sizeBytes: number;
}

const metaColumns = {
  id: storageObjects.id,
  organizationId: storageObjects.organizationId,
  purpose: storageObjects.purpose,
  status: storageObjects.status,
  contentType: storageObjects.contentType,
  sizeBytes: storageObjects.sizeBytes,
};

const imageColumns = {
  id: storageObjects.id,
  visibility: storageObjects.visibility,
  variants: storageObjects.variants,
  width: storageObjects.width,
  height: storageObjects.height,
};

// Processed bytes for server-side readers (fee PDFs embed the logo and QR).
// Files never change, so entries never go stale; the cap bounds memory.
// Keyed by organisation AND object, so a cached file is never handed to
// another organisation asking for the same id.
const BYTES_CACHE_LIMIT = 64;
const bytesCache = new Map<string, { contentType: string; data: Buffer }>();

export class StorageService {
  // ── Uploads ─────────────────────────────────────────────────────────────

  /**
   * Hands out upload links. The caller has already decided this user may
   * upload files of this purpose for `parentId` (null when the record does
   * not exist yet, such as a new homework). Refuses files over the purpose's
   * cap and organisations with too many uploads already in flight.
   */
  async createUploads(input: {
    organizationId: string;
    schoolId: string | null;
    purpose: StoragePurpose;
    parentId: string | null;
    uploadedBy: string;
    files: UploadRequest[];
  }): Promise<UploadTicket[]> {
    // Fails here, before any row is written, when the buckets are not configured.
    const store = getObjectStore();
    const rules = PURPOSES[input.purpose];
    for (const file of input.files) {
      if (file.sizeBytes > rules.maxUploadBytes) {
        throw refuse(
          "BAD_REQUEST",
          `That file is larger than ${Math.floor(rules.maxUploadBytes / (1024 * 1024))} MB. Choose a smaller one.`,
        );
      }
    }

    const [inFlight] = await db
      .select({ n: count() })
      .from(storageObjects)
      .where(
        and(
          eq(storageObjects.organizationId, input.organizationId),
          eq(storageObjects.status, "pending"),
          gt(storageObjects.createdAt, sql`now() - interval '1 day'`),
        ),
      );
    if ((inFlight?.n ?? 0) + input.files.length > MAX_PENDING_PER_ORG) {
      throw refuse(
        "CONFLICT",
        "Too many uploads are in progress. Wait for them to finish, then try again.",
      );
    }

    const ids = input.files.map(() => randomUUID());
    await db.insert(storageObjects).values(
      ids.map((id) => ({
        id,
        organizationId: input.organizationId,
        schoolId: input.schoolId,
        purpose: input.purpose,
        visibility: rules.bucket,
        status: "pending" as const,
        parentId: input.parentId,
        // Until `complete` writes the versions, the row points at the upload.
        path: uploadKey(id),
        uploadedBy: input.uploadedBy,
      })),
    );

    const expiresAt = new Date(Date.now() + UPLOAD_LINK_SECONDS * 1000).toISOString();
    return Promise.all(
      ids.map(async (id, i) => {
        const file = input.files[i]!;
        const link = await store.presignPut("private", uploadKey(id), {
          contentType: file.contentType,
          contentLength: file.sizeBytes,
          expiresInSeconds: UPLOAD_LINK_SECONDS,
        });
        return {
          objectId: id,
          url: link.url,
          method: "PUT" as const,
          headers: link.headers,
          expiresAt,
        };
      }),
    );
  }

  /**
   * Processes uploads the caller made. Each file is answered on its own, so
   * one bad page of a homework does not sink the others. Only the uploader
   * can complete an upload, and only once.
   */
  async complete(userId: string, objectIds: string[]): Promise<CompletedUpload[]> {
    const rows = await db
      .select({
        id: storageObjects.id,
        organizationId: storageObjects.organizationId,
        purpose: storageObjects.purpose,
        visibility: storageObjects.visibility,
        status: storageObjects.status,
      })
      .from(storageObjects)
      .where(and(inArray(storageObjects.id, objectIds), eq(storageObjects.uploadedBy, userId)));
    const byId = new Map(rows.map((r) => [r.id, r]));

    const results: CompletedUpload[] = [];
    for (const objectId of objectIds) {
      const row = byId.get(objectId);
      if (!row || row.status === "deleted") {
        results.push({
          ok: false,
          objectId,
          reason: "That upload was not found. Upload the file again.",
        });
        continue;
      }
      if (row.status === "ready") {
        // Completing twice is harmless: answer with the processed file.
        const [image] = await this.imageRefsFor([objectId]);
        if (image) results.push({ ok: true, objectId, image });
        continue;
      }
      results.push(await this.processUpload(row));
    }
    return results;
  }

  /**
   * Processes any of these files the caller uploaded but has not completed,
   * so a domain save can take ids straight from the client's PUT without a
   * separate `storage.complete` call. A refused file throws its reason;
   * files that are already ready, or someone else's, are left for `attach`
   * to judge.
   */
  async ensureReady(userId: string, objectIds: string[]): Promise<void> {
    const ids = [...new Set(objectIds)];
    if (ids.length === 0) return;
    const pending = await db
      .select({ id: storageObjects.id })
      .from(storageObjects)
      .where(
        and(
          inArray(storageObjects.id, ids),
          eq(storageObjects.uploadedBy, userId),
          eq(storageObjects.status, "pending"),
        ),
      );
    if (pending.length === 0) return;
    const results = await this.complete(
      userId,
      pending.map((row) => row.id),
    );
    const refused = results.find((result) => !result.ok);
    if (refused && !refused.ok) throw refuse("BAD_REQUEST", refused.reason);
  }

  private async processUpload(row: {
    id: string;
    organizationId: string;
    purpose: StoragePurpose;
    visibility: "private" | "public";
  }): Promise<CompletedUpload> {
    const store = getObjectStore();
    const rules = PURPOSES[row.purpose];
    const tmp = uploadKey(row.id);

    const reject = async (reason: string): Promise<CompletedUpload> => {
      await store.delete("private", [tmp]);
      await db
        .update(storageObjects)
        .set({ status: "deleted", deletedAt: sql`now()` })
        .where(and(eq(storageObjects.id, row.id), eq(storageObjects.status, "pending")));
      return { ok: false, objectId: row.id, reason };
    };

    // Size first, from the bucket's own record: an oversize file is refused
    // before a single byte of it is pulled into the API.
    const head = await store.head("private", tmp);
    if (!head) {
      return {
        ok: false,
        objectId: row.id,
        reason: "The file hasn't finished uploading. Try again.",
      };
    }
    if (head.sizeBytes === 0) return reject("That file is empty. Choose a photo and try again.");
    if (head.sizeBytes > rules.maxUploadBytes || head.sizeBytes > UPLOAD_MAX_BYTES) {
      return reject("That file is too large. Choose a smaller one.");
    }

    const bytes = await store.get("private", tmp);
    if (!bytes) {
      return {
        ok: false,
        objectId: row.id,
        reason: "The file hasn't finished uploading. Try again.",
      };
    }

    let written: StorageVariant[];
    try {
      written = await this.writeVariants(row, bytes);
    } catch (error) {
      if (error instanceof ImageRejectedError) return reject(error.message);
      throw error;
    }

    const display = written[0]!;
    const [ready] = await db
      .update(storageObjects)
      .set({
        status: "ready",
        path: display.path,
        variants: written,
        contentType: display.contentType,
        sizeBytes: written.reduce((sum, v) => sum + v.sizeBytes, 0),
        width: display.width,
        height: display.height,
        readyAt: sql`now()`,
      })
      .where(and(eq(storageObjects.id, row.id), eq(storageObjects.status, "pending")))
      .returning(imageColumns);
    await store.delete("private", [tmp]);

    if (!ready) {
      // Another request completed it first; answer with that result.
      const [image] = await this.imageRefsFor([row.id]);
      return image
        ? { ok: true, objectId: row.id, image }
        : {
            ok: false,
            objectId: row.id,
            reason: "That upload was not found. Upload the file again.",
          };
    }
    return { ok: true, objectId: row.id, image: await buildImageRef(ready) };
  }

  /** Encodes the purpose's versions and writes them under the object's prefix. */
  private async writeVariants(
    row: {
      id: string;
      organizationId: string;
      purpose: StoragePurpose;
      visibility: "private" | "public";
    },
    bytes: Buffer,
  ): Promise<StorageVariant[]> {
    const rules = PURPOSES[row.purpose];
    const processed = await processImage(bytes, rules.variants);
    const prefix = objectPrefix(row.organizationId, row.purpose, row.id);
    const store = getObjectStore();

    const written: StorageVariant[] = [];
    for (const v of processed) {
      const path = `${prefix}${v.name}.${v.extension}`;
      await store.put(rules.bucket, path, v.body, {
        contentType: v.contentType,
        cacheControl: rules.bucket === "public" ? PUBLIC_CACHE : PRIVATE_CACHE,
      });
      written.push({
        name: v.name,
        path,
        contentType: v.contentType,
        sizeBytes: v.body.length,
        width: v.width,
        height: v.height,
      });
    }
    return written;
  }

  /**
   * Stores bytes the server already has (seeds, scripts, tests). Same
   * processing as an upload; the row comes back `ready` and must still be
   * attached, or the sweeper removes it after a day.
   */
  async ingest(input: {
    organizationId: string;
    schoolId: string | null;
    purpose: StoragePurpose;
    parentId: string | null;
    uploadedBy: string | null;
    bytes: Buffer;
  }): Promise<{ id: string }> {
    const rules = PURPOSES[input.purpose];
    if (input.bytes.length === 0) {
      throw refuse("BAD_REQUEST", "That file is empty. Choose a photo and try again.");
    }
    if (input.bytes.length > rules.maxUploadBytes) {
      throw refuse("BAD_REQUEST", "That file is too large. Choose a smaller one.");
    }

    const [row] = await db
      .insert(storageObjects)
      .values({
        organizationId: input.organizationId,
        schoolId: input.schoolId,
        purpose: input.purpose,
        visibility: rules.bucket,
        status: "pending",
        parentId: input.parentId,
        path: "tmp/",
        uploadedBy: input.uploadedBy,
      })
      .returning({ id: storageObjects.id });
    if (!row) throw new Error("Failed to record the file.");

    let written: StorageVariant[];
    try {
      written = await this.writeVariants(
        {
          id: row.id,
          organizationId: input.organizationId,
          purpose: input.purpose,
          visibility: rules.bucket,
        },
        input.bytes,
      );
    } catch (error) {
      await db
        .update(storageObjects)
        .set({ status: "deleted", deletedAt: sql`now()` })
        .where(eq(storageObjects.id, row.id));
      if (error instanceof ImageRejectedError) throw refuse("BAD_REQUEST", error.message);
      throw error;
    }

    const display = written[0]!;
    await db
      .update(storageObjects)
      .set({
        status: "ready",
        path: display.path,
        variants: written,
        contentType: display.contentType,
        sizeBytes: written.reduce((sum, v) => sum + v.sizeBytes, 0),
        width: display.width,
        height: display.height,
        readyAt: sql`now()`,
      })
      .where(eq(storageObjects.id, row.id));
    return { id: row.id };
  }

  // ── Linking files to records ────────────────────────────────────────────

  /**
   * Links ready files to a record, inside the caller's transaction. A file
   * not yet attached must have been uploaded by `userId` for this parent (or
   * for no parent yet); a file already attached may only be re-linked to the
   * same parent, which is what re-saving a record does. Anything else is
   * refused, so nobody can link a file uploaded for someone else.
   */
  async attach(
    tx: Executor,
    input: {
      organizationId: string;
      purpose: StoragePurpose;
      parentId: string;
      /** Null only for server-side code (seeds, scripts), never a request. */
      userId: string | null;
      objectIds: string[];
    },
  ): Promise<void> {
    const ids = [...new Set(input.objectIds)];
    if (ids.length === 0) return;

    const linked = await tx
      .update(storageObjects)
      .set({
        parentId: input.parentId,
        attachedAt: sql`coalesce(${storageObjects.attachedAt}, now())`,
      })
      .where(
        and(
          inArray(storageObjects.id, ids),
          eq(storageObjects.organizationId, input.organizationId),
          eq(storageObjects.purpose, input.purpose),
          eq(storageObjects.status, "ready"),
          or(
            and(
              isNull(storageObjects.attachedAt),
              input.userId === null
                ? isNull(storageObjects.uploadedBy)
                : eq(storageObjects.uploadedBy, input.userId),
              or(isNull(storageObjects.parentId), eq(storageObjects.parentId, input.parentId)),
            ),
            and(isNotNull(storageObjects.attachedAt), eq(storageObjects.parentId, input.parentId)),
          ),
        ),
      )
      .returning({ id: storageObjects.id });

    if (linked.length !== ids.length) {
      throw refuse(
        "BAD_REQUEST",
        "One of the files can't be used here. Upload it again and retry.",
      );
    }
  }

  /**
   * Marks files no record should use any more (a replaced photo, a removed
   * page), inside the caller's transaction. The sweeper deletes the bytes
   * and the rows; the foreign keys stop it if a record still points at one.
   */
  async markDeleted(tx: Executor, organizationId: string, objectIds: string[]): Promise<void> {
    if (objectIds.length === 0) return;
    await tx
      .update(storageObjects)
      .set({ status: "deleted", deletedAt: sql`now()` })
      .where(
        and(
          inArray(storageObjects.id, objectIds),
          eq(storageObjects.organizationId, organizationId),
          ne(storageObjects.status, "deleted"),
        ),
      );
  }

  /**
   * Copies a file into another organisation as a new object (the ID-card
   * gallery's clone). The caller has proved the source may be copied; the
   * bytes are copied inside the bucket, never pulled into the API. The copy
   * comes back ready and unattached, uploaded by the copier, for the caller
   * to link.
   */
  async copyToOrg(input: {
    sourceObjectId: string;
    targetOrganizationId: string;
    targetSchoolId: string | null;
    uploadedBy: string;
  }): Promise<{ id: string }> {
    const [source] = await db
      .select()
      .from(storageObjects)
      .where(and(eq(storageObjects.id, input.sourceObjectId), eq(storageObjects.status, "ready")));
    if (!source) {
      throw refuse("NOT_FOUND", "An image this design uses no longer exists.");
    }

    const [row] = await db
      .insert(storageObjects)
      .values({
        organizationId: input.targetOrganizationId,
        schoolId: input.targetSchoolId,
        purpose: source.purpose,
        visibility: source.visibility,
        status: "pending",
        path: "tmp/",
        uploadedBy: input.uploadedBy,
      })
      .returning({ id: storageObjects.id });
    if (!row) throw new Error("Failed to record the copied file.");

    const store = getObjectStore();
    const prefix = objectPrefix(input.targetOrganizationId, source.purpose, row.id);
    const variants: StorageVariant[] = [];
    for (const v of source.variants) {
      const path = `${prefix}${v.path.slice(v.path.lastIndexOf("/") + 1)}`;
      await store.copy(source.visibility, v.path, path);
      variants.push({ ...v, path });
    }

    await db
      .update(storageObjects)
      .set({
        status: "ready",
        path: variants[0]?.path ?? source.path,
        variants,
        contentType: source.contentType,
        sizeBytes: source.sizeBytes,
        width: source.width,
        height: source.height,
        readyAt: sql`now()`,
      })
      .where(eq(storageObjects.id, row.id));
    return { id: row.id };
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  /** Metadata without bytes, scoped to the organisation. */
  async getMeta(organizationId: string, objectId: string): Promise<StoredFileMeta | null> {
    const [row] = await db
      .select(metaColumns)
      .from(storageObjects)
      .where(
        and(eq(storageObjects.id, objectId), eq(storageObjects.organizationId, organizationId)),
      );
    return row ?? null;
  }

  /**
   * The processed bytes, for server-side readers that embed an image (fee
   * PDFs). Scoped to the organisation and cached in memory.
   */
  async getBytes(
    organizationId: string,
    objectId: string,
  ): Promise<{ contentType: string; data: Buffer } | null> {
    const cacheKey = `${organizationId}:${objectId}`;
    const cached = bytesCache.get(cacheKey);
    if (cached) return cached;

    const [row] = await db
      .select({
        visibility: storageObjects.visibility,
        path: storageObjects.path,
        contentType: storageObjects.contentType,
      })
      .from(storageObjects)
      .where(
        and(
          eq(storageObjects.id, objectId),
          eq(storageObjects.organizationId, organizationId),
          eq(storageObjects.status, "ready"),
        ),
      );
    if (!row?.contentType) return null;

    const data = await getObjectStore().get(row.visibility, row.path);
    if (!data) return null;

    const entry = { contentType: row.contentType, data };
    if (bytesCache.size >= BYTES_CACHE_LIMIT) {
      const oldest = bytesCache.keys().next().value;
      if (oldest) bytesCache.delete(oldest);
    }
    bytesCache.set(cacheKey, entry);
    return entry;
  }

  /**
   * Ready-made image references for files the caller has ALREADY authorised
   * through the record that points at them. Scoped to the organisation; a
   * file that is not ready is simply absent from the map.
   */
  async imageRefs(
    organizationId: string,
    objectIds: (string | null | undefined)[],
  ): Promise<Map<string, ImageRef>> {
    const ids = [...new Set(objectIds.filter((id): id is string => Boolean(id)))];
    const refs = new Map<string, ImageRef>();
    if (ids.length === 0) return refs;

    const rows = await db
      .select(imageColumns)
      .from(storageObjects)
      .where(
        and(
          inArray(storageObjects.id, ids),
          eq(storageObjects.organizationId, organizationId),
          eq(storageObjects.status, "ready"),
        ),
      );
    const now = new Date();
    for (const row of rows) refs.set(row.id, await buildImageRef(row, now));
    return refs;
  }

  /** Unscoped by design: only for objects the caller itself just created or verified. */
  private async imageRefsFor(objectIds: string[]): Promise<ImageRef[]> {
    const rows = await db
      .select(imageColumns)
      .from(storageObjects)
      .where(and(inArray(storageObjects.id, objectIds), eq(storageObjects.status, "ready")));
    return Promise.all(rows.map((row) => buildImageRef(row)));
  }

  // ── The student photo (one live row per student) ────────────────────────

  /**
   * The student's current photo object id. Scoped through the STUDENT (hard
   * rule 1 — the filter rides the students table, not the photo row).
   */
  async getStudentPhotoObjectId(scope: DataScope, studentId: string): Promise<string | null> {
    const schoolId = requireSchoolId(scope);

    const [row] = await db
      .select({ objectId: studentPhotos.objectId })
      .from(studentPhotos)
      .innerJoin(students, eq(studentPhotos.studentId, students.id))
      .where(
        and(
          eq(studentPhotos.studentId, studentId),
          eq(students.organizationId, scope.organizationId),
          eq(students.schoolId, schoolId),
        ),
      );

    return row?.objectId ?? null;
  }
}

export const storageService = new StorageService();
