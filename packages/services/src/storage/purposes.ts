import type { StoragePurpose } from "@repo/contracts";
import type { Bucket } from "./object-store";

/**
 * THE PURPOSE REGISTRY (ADR-063) — the one place each kind of file's rules
 * live: which bucket, how big an upload may be, which versions are stored and
 * how each is encoded. Who may upload for which record is NOT here: each
 * domain hands out upload links from its own endpoint, behind its own
 * permission gate, and only then calls the storage service.
 */

/**
 * How a version is encoded.
 * - `photo`: always lossy WebP at `quality` (camera photos, handwriting).
 * - `auto`: PNG sources (diagrams, screenshots, logos) become lossless WebP so
 *   lines and text stay sharp; anything else is lossy WebP at `quality`.
 * - `png`: always lossless PNG (a QR code must never be blurred).
 */
export type Encoding =
  { kind: "photo"; quality: number } | { kind: "auto"; quality: number } | { kind: "png" };

export interface VariantRule {
  name: "display" | "thumb";
  /** Longest edges; the image is shrunk to fit inside, never enlarged. */
  maxWidth: number;
  maxHeight: number;
  encoding: Encoding;
}

export interface PurposeRules {
  bucket: Bucket;
  /** The largest upload accepted, before processing. */
  maxUploadBytes: number;
  /** The first entry is always `display`, the version records point at. */
  variants: [VariantRule, ...VariantRule[]];
}

const MB = 1024 * 1024;

const thumb: VariantRule = {
  name: "thumb",
  maxWidth: 320,
  maxHeight: 320,
  encoding: { kind: "photo", quality: 75 },
};

const portrait: PurposeRules = {
  bucket: "private",
  maxUploadBytes: 5 * MB,
  variants: [
    { name: "display", maxWidth: 600, maxHeight: 800, encoding: { kind: "photo", quality: 80 } },
  ],
};

export const PURPOSES: Record<StoragePurpose, PurposeRules> = {
  student_photo: portrait,
  staff_photo: portrait,
  id_card_asset: {
    bucket: "private",
    maxUploadBytes: 8 * MB,
    variants: [
      { name: "display", maxWidth: 2000, maxHeight: 2000, encoding: { kind: "auto", quality: 85 } },
    ],
  },
  fee_print_logo: {
    bucket: "private",
    maxUploadBytes: 5 * MB,
    variants: [
      { name: "display", maxWidth: 800, maxHeight: 800, encoding: { kind: "auto", quality: 85 } },
    ],
  },
  fee_upi_qr: {
    bucket: "private",
    maxUploadBytes: 2 * MB,
    variants: [{ name: "display", maxWidth: 1200, maxHeight: 1200, encoding: { kind: "png" } }],
  },
  site_media: {
    bucket: "public",
    maxUploadBytes: 8 * MB,
    variants: [
      { name: "display", maxWidth: 2000, maxHeight: 2000, encoding: { kind: "auto", quality: 80 } },
    ],
  },
  homework_teacher_file: {
    bucket: "private",
    maxUploadBytes: 8 * MB,
    variants: [
      { name: "display", maxWidth: 2000, maxHeight: 2000, encoding: { kind: "auto", quality: 82 } },
      thumb,
    ],
  },
  homework_student_file: {
    bucket: "private",
    maxUploadBytes: 8 * MB,
    variants: [
      {
        name: "display",
        maxWidth: 2000,
        maxHeight: 2000,
        encoding: { kind: "photo", quality: 82 },
      },
      thumb,
    ],
  },
};

/** `{orgId}/{purpose}/{objectId}/` — every stored version of one file. */
export function objectPrefix(organizationId: string, purpose: StoragePurpose, objectId: string) {
  return `${organizationId}/${purpose}/${objectId}/`;
}

/** Where the raw upload waits until `complete` processes it. */
export function uploadKey(objectId: string) {
  return `tmp/${objectId}`;
}
