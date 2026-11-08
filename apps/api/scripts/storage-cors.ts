/**
 * Sets both buckets' CORS rule (ADR-063): the web app uploads straight to the
 * bucket from the browser, which the browser allows only for origins the
 * bucket lists. The origins are CORS_ORIGIN's (comma-separated), the same
 * allowlist the API uses. Mobile apps need none of this.
 *
 *   pnpm storage:cors
 *
 * Run it once per environment, and again whenever CORS_ORIGIN changes.
 */
import { getObjectStore } from "@repo/services";

async function main() {
  const origins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) throw new Error("CORS_ORIGIN is empty; set the web app's origins first.");

  const store = getObjectStore();
  for (const bucket of ["private", "public"] as const) {
    await store.setCors(bucket, origins);
    console.log(`${bucket} bucket: uploads and reads allowed from ${origins.join(", ")}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
