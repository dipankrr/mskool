import type { ImageRef } from "@repo/contracts";
import type { StorageVariant } from "@repo/db/schema";
import { env } from "../env";
import { getObjectStore, type Bucket } from "./object-store";

/**
 * READ LINKS (ADR-063). Whoever calls this has already authorised the record
 * the file belongs to; building the link is the only thing left.
 *
 * Private links are signed at the start of the current six-hour window and
 * stay valid for twelve hours, so every response in one window hands out the
 * same link (the browser caches it) and a link always has at least six hours
 * left. Signing is local maths; no request goes to the bucket.
 */

export const LINK_WINDOW_MS = 6 * 60 * 60 * 1000;
export const LINK_VALID_SECONDS = 12 * 60 * 60;

export function signingWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / LINK_WINDOW_MS) * LINK_WINDOW_MS);
}

export async function fileUrl(bucket: Bucket, path: string, now = new Date()): Promise<string> {
  if (bucket === "public") {
    if (!env.PUBLIC_FILES_BASE_URL) {
      throw new Error(
        "PUBLIC_FILES_BASE_URL is not set, so public files have no address (ADR-063).",
      );
    }
    return `${env.PUBLIC_FILES_BASE_URL.replace(/\/+$/, "")}/${path}`;
  }
  return getObjectStore().presignGet(bucket, path, {
    signingDate: signingWindowStart(now),
    expiresInSeconds: LINK_VALID_SECONDS,
  });
}

/** The fields of a stored row an image reference is built from. */
export interface ImageSource {
  id: string;
  visibility: Bucket;
  variants: StorageVariant[];
  width: number | null;
  height: number | null;
}

export async function buildImageRef(row: ImageSource, now = new Date()): Promise<ImageRef> {
  const display = row.variants.find((v) => v.name === "display") ?? row.variants[0];
  if (!display) throw new Error(`Stored file ${row.id} has no versions.`);
  const thumb = row.variants.find((v) => v.name === "thumb");
  return {
    id: row.id,
    url: await fileUrl(row.visibility, display.path, now),
    thumbUrl: thumb ? await fileUrl(row.visibility, thumb.path, now) : null,
    width: row.width,
    height: row.height,
  };
}
