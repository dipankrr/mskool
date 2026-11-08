import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";

import { LINK_VALID_SECONDS, fileUrl, signingWindowStart } from "./links";
import { MemoryObjectStore, S3ObjectStore, setObjectStoreForTests } from "./object-store";

/**
 * READ AND UPLOAD LINKS (ADR-063). Signing is local maths, so the real S3
 * signer is exercised here with made-up credentials and no network.
 */

const signer = new S3ObjectStore(
  new S3Client({
    region: "auto",
    endpoint: "https://account.r2.cloudflarestorage.com",
    credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  }),
  { private: "mskool-test-private", public: "mskool-test-public" },
);

afterEach(() => setObjectStoreForTests(null));

describe("signingWindowStart", () => {
  it("floors to six-hour windows in UTC", () => {
    expect(signingWindowStart(new Date("2026-11-08T05:59:59Z")).toISOString()).toBe(
      "2026-11-08T00:00:00.000Z",
    );
    expect(signingWindowStart(new Date("2026-11-08T06:00:00Z")).toISOString()).toBe(
      "2026-11-08T06:00:00.000Z",
    );
    expect(signingWindowStart(new Date("2026-11-08T23:30:00Z")).toISOString()).toBe(
      "2026-11-08T18:00:00.000Z",
    );
  });
});

describe("private read links", () => {
  it("are identical within a window, so browsers cache them, and change in the next", async () => {
    setObjectStoreForTests(signer);
    const path = "org/student_photo/obj/display.webp";
    const a = await fileUrl("private", path, new Date("2026-11-08T06:05:00Z"));
    const b = await fileUrl("private", path, new Date("2026-11-08T11:55:00Z"));
    const c = await fileUrl("private", path, new Date("2026-11-08T12:01:00Z"));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it("are signed at the window start and valid for twelve hours", async () => {
    setObjectStoreForTests(signer);
    const url = new URL(
      await fileUrl(
        "private",
        "org/student_photo/obj/display.webp",
        new Date("2026-11-08T07:00:00Z"),
      ),
    );
    expect(url.host).toBe("mskool-test-private.account.r2.cloudflarestorage.com");
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261108T060000Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(LINK_VALID_SECONDS));
    // No checksum parameters a provider might reject.
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().includes("checksum"))).toBe(
      false,
    );
  });
});

describe("upload links", () => {
  it("sign the content type and length, so a link cannot carry another file", async () => {
    const link = await signer.presignPut("private", "tmp/obj", {
      contentType: "image/jpeg",
      contentLength: 123_456,
      expiresInSeconds: 600,
    });
    const signed = new URL(link.url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
    expect(signed).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
    expect(link.headers).toEqual({ "Content-Type": "image/jpeg" });
  });
});

describe("the in-memory store", () => {
  it("lists, copies and deletes like a bucket", async () => {
    const store = new MemoryObjectStore();
    const opts = { contentType: "image/webp", cacheControl: "private" };
    await store.put("private", "a/1", Buffer.from("one"), opts);
    await store.put("public", "a/2", Buffer.from("two"), opts);
    await store.copy("private", "a/1", "b/1");
    expect((await store.list("private", { prefix: "a/" })).objects.map((o) => o.key)).toEqual([
      "a/1",
    ]);
    expect((await store.get("private", "b/1"))?.toString()).toBe("one");
    await store.delete("private", ["a/1", "missing"]);
    expect(await store.head("private", "a/1")).toBeNull();
    expect(await store.head("public", "a/2")).toEqual({ sizeBytes: 3, contentType: "image/webp" });
  });
});
