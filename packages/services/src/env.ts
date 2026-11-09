import { createEnv } from "@repo/env";
import { z } from "zod";

// An empty value (a blank line copied from .env.example) means "not set".
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

// The ONLY file in this package allowed to touch process.env directly.
export const env = createEnv({
  /**
   * ADR-063: the S3-compatible buckets that hold file bytes (R2 today; S3 or
   * Backblaze B2 by changing these values and copying the bytes). All are
   * optional so the API boots without them; the first storage call fails
   * with a named error until they are set. One private and one public bucket
   * per environment, and a token scoped to those two buckets.
   */
  STORAGE_ENDPOINT: unsetIfEmpty(z.url()),
  // R2 wants "auto"; S3 and B2 want the bucket's real region.
  STORAGE_REGION: z.string().min(1).default("auto"),
  STORAGE_ACCESS_KEY_ID: unsetIfEmpty(z.string().min(1)),
  STORAGE_SECRET_ACCESS_KEY: unsetIfEmpty(z.string().min(1)),
  STORAGE_PRIVATE_BUCKET: unsetIfEmpty(z.string().min(1)),
  STORAGE_PUBLIC_BUCKET: unsetIfEmpty(z.string().min(1)),
  // Some providers need path-style URLs (bucket in the path, not the host).
  STORAGE_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  // Where the public bucket is served from (its custom domain), no trailing slash.
  PUBLIC_FILES_BASE_URL: unsetIfEmpty(z.url()),
  // The staff web app's address, no trailing slash. ID cards printed from the phone
  // put a QR of `<this>/students/<id>` on the card, the same as the web prints.
  // Unset: the QR slot prints empty.
  WEB_APP_URL: unsetIfEmpty(z.url()),
});
