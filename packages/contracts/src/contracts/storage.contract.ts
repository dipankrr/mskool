import { storagePurposeEnum } from "@repo/db/schema";
import { z } from "zod";

/**
 * STORAGE (ADR-063) — the shapes every file upload and image read share.
 *
 * Uploads go straight to the bucket: a domain endpoint hands out an upload
 * link (`UploadTicket`), the client PUTs the bytes there, and
 * `storage.complete` checks and processes them. Reads never carry an object
 * id for the client to turn into a URL: they carry an `ImageRef` with a
 * ready-made link.
 */

export const STORAGE_PURPOSES = storagePurposeEnum.enumValues;
export const storagePurposeSchema = z.enum(STORAGE_PURPOSES);
export type StoragePurpose = z.infer<typeof storagePurposeSchema>;

/** What a client may claim it is uploading. The server checks the bytes. */
export const UPLOAD_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const uploadContentTypeSchema = z.enum(UPLOAD_CONTENT_TYPES);

/** The largest upload any purpose accepts. Each purpose has its own, lower cap. */
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

/** What the client says about one file before it uploads it. */
export const uploadRequestSchema = z.object({
  contentType: uploadContentTypeSchema,
  sizeBytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

/**
 * One upload link. The client PUTs the file to `url` with exactly `headers`
 * (they are part of the signature) before `expiresAt`, then calls
 * `storage.complete` with `objectId`.
 */
export const uploadTicketSchema = z.object({
  objectId: z.uuid(),
  url: z.string(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  // ISO time; a plain string so it reads the same on every client.
  expiresAt: z.string(),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const completeUploadsInput = z.object({
  objectIds: z.array(z.uuid()).min(1).max(50),
});

/**
 * A stored image, ready to show. `url` works as is: a signed link for private
 * files (valid at least six hours from when it was handed out) or a plain
 * link for public ones. Cache by `id`, never by `url` — the link changes, the
 * file never does.
 */
export const imageRefSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  thumbUrl: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type ImageRef = z.infer<typeof imageRefSchema>;

/** One file `storage.complete` processed, or why it refused it. */
export const completedUploadSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), objectId: z.uuid(), image: imageRefSchema }),
  z.object({ ok: z.literal(false), objectId: z.uuid(), reason: z.string() }),
]);
export type CompletedUpload = z.infer<typeof completedUploadSchema>;
