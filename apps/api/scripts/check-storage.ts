/**
 * THE STORAGE CHECK (ADR-063) — proves every bucket operation the app uses
 * against the buckets the env points at. Run it against the dev buckets
 * before trusting a provider, and again before switching provider (R2, S3,
 * Backblaze B2):
 *
 *   pnpm check:storage
 *
 * It writes only under `check/{run}/` in each bucket and deletes what it
 * wrote. Each line prints PASS or FAIL; the exit code is non-zero on any
 * FAIL. Lines marked INFO record provider behaviour the app does not rely on
 * (the server re-checks sizes itself).
 */
import { randomUUID } from "node:crypto";
import { getObjectStore } from "@repo/services";

const run = `check/${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
const body = Buffer.from(`mskool storage check ${run}`);
let failures = 0;

async function step(name: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    console.log(`PASS  ${name}${note ? ` (${note})` : ""}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const store = getObjectStore();
  console.log(`Storage check, writing under ${run}/\n`);

  for (const bucket of ["private", "public"] as const) {
    const key = `${run}/${bucket}.txt`;
    await step(`${bucket}: put`, () =>
      store.put(bucket, key, body, { contentType: "text/plain", cacheControl: "no-store" }),
    );
    await step(`${bucket}: head`, async () => {
      const head = await store.head(bucket, key);
      expect(head?.sizeBytes === body.length, `size ${head?.sizeBytes}`);
    });
    await step(`${bucket}: get`, async () => {
      expect((await store.get(bucket, key))?.equals(body), "bytes differ");
    });
    await step(`${bucket}: head of a missing key is null`, async () => {
      expect((await store.head(bucket, `${run}/missing`)) === null, "not null");
    });
    await step(`${bucket}: copy`, async () => {
      await store.copy(bucket, key, `${key}.copy`);
      expect((await store.get(bucket, `${key}.copy`))?.equals(body), "copy differs");
    });
    await step(`${bucket}: list by prefix`, async () => {
      const page = await store.list(bucket, { prefix: `${run}/` });
      const keys = page.objects.map((o) => o.key);
      expect(keys.includes(key) && keys.includes(`${key}.copy`), `listed ${keys.join(", ")}`);
    });
  }

  // Presigned upload: the client's path into the bucket.
  const uploadKey = `${run}/upload.bin`;
  await step("presigned PUT with the signed type and length", async () => {
    const link = await store.presignPut("private", uploadKey, {
      contentType: "image/png",
      contentLength: body.length,
      expiresInSeconds: 600,
    });
    const res = await fetch(link.url, { method: "PUT", headers: link.headers, body });
    expect(res.ok, `HTTP ${res.status}: ${await res.text()}`);
    expect((await store.head("private", uploadKey))?.sizeBytes === body.length, "not stored");
  });
  await step("presigned PUT with a different type is refused", async () => {
    const link = await store.presignPut("private", `${run}/wrong-type.bin`, {
      contentType: "image/png",
      contentLength: body.length,
      expiresInSeconds: 600,
    });
    const res = await fetch(link.url, {
      method: "PUT",
      headers: { "Content-Type": "text/html" },
      body,
    });
    expect(!res.ok, `HTTP ${res.status}: accepted`);
  });
  await step("INFO presigned PUT with a bigger body than signed", async () => {
    const link = await store.presignPut("private", `${run}/too-big.bin`, {
      contentType: "image/png",
      contentLength: body.length,
      expiresInSeconds: 600,
    });
    const res = await fetch(link.url, {
      method: "PUT",
      headers: link.headers,
      body: Buffer.concat([body, body]),
    });
    return res.ok
      ? "the provider does NOT enforce the signed length; complete() checks size itself"
      : `the provider refuses it (HTTP ${res.status})`;
  });

  // Presigned download, signed hours in the past like a six-hour window.
  await step("presigned GET signed at the window start works", async () => {
    const signingDate = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const url = await store.presignGet("private", uploadKey, {
      signingDate,
      expiresInSeconds: 12 * 60 * 60,
    });
    const res = await fetch(url);
    // Read the body once: it is the error text or the file.
    const got = Buffer.from(await res.arrayBuffer());
    expect(res.ok, `HTTP ${res.status}: ${got.toString()}`);
    expect(got.equals(body), "bytes differ");
  });
  await step("presigned GET past its expiry is refused", async () => {
    const url = await store.presignGet("private", uploadKey, {
      signingDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
      expiresInSeconds: 60 * 60,
    });
    const res = await fetch(url);
    expect(!res.ok, `HTTP ${res.status}: still served`);
  });
  await step("the private bucket refuses unsigned reads", async () => {
    const signed = new URL(
      await store.presignGet("private", uploadKey, {
        signingDate: new Date(),
        expiresInSeconds: 600,
      }),
    );
    const res = await fetch(`${signed.origin}${signed.pathname}`);
    expect(!res.ok, `HTTP ${res.status}: served without a signature`);
  });

  // Public files are read with no signature at PUBLIC_FILES_BASE_URL.
  await step(
    "the public bucket serves files at PUBLIC_FILES_BASE_URL with no signature",
    async () => {
      const base = process.env.PUBLIC_FILES_BASE_URL?.replace(/\/+$/, "");
      expect(base, "PUBLIC_FILES_BASE_URL is not set");
      const res = await fetch(`${base}/${run}/public.txt`);
      const got = Buffer.from(await res.arrayBuffer());
      expect(res.ok, `HTTP ${res.status}: ${got.toString()}`);
      expect(got.equals(body), "bytes differ");
    },
  );

  // Batch delete, including a key that does not exist.
  await step("delete in one batch, a missing key included", async () => {
    for (const bucket of ["private", "public"] as const) {
      const page = await store.list(bucket, { prefix: `${run}/` });
      await store.delete(bucket, [...page.objects.map((o) => o.key), `${run}/never-existed`]);
      const after = await store.list(bucket, { prefix: `${run}/` });
      expect(after.objects.length === 0, `${bucket} still has ${after.objects.length}`);
    }
  });

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
