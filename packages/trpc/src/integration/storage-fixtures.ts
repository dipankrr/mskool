import { MemoryObjectStore, setObjectStoreForTests } from "@repo/services";

/**
 * Integration tests run against real Postgres but an in-memory bucket, so they
 * need no storage credentials (ADR-063). The real bucket is proved separately
 * by the storage check script.
 */
export function useMemoryStore(): MemoryObjectStore {
  const store = new MemoryObjectStore();
  setObjectStoreForTests(store);
  return store;
}

/** A real 1×1 PNG: the storage service decodes and re-encodes every image. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
