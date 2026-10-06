/**
 * One-shot migration: static site media → the object store (ADR-042).
 *
 * Reads the webp files from apps/web/public/sites/ujjwal (kept on disk as
 * seed input, purged from git), uploads each as a PUBLIC object through
 * storageService.putObject, and rewrites every `/sites/ujjwal/...` URL in
 * the Ujjwal site content to `/api/public/storage/{id}`. Re-runnable: each
 * run mints fresh objects and replaces the content wholesale; the previous
 * generation's public objects are deleted first so the store does not grow
 * orphaned generations forever.
 *
 * Files whose decoded bytes exceed the service cap are skipped loudly —
 * none should, the conversion step caps gallery images well below it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { publicSiteContentSchema } from "@repo/contracts";
import { db } from "@repo/db";
import { orgPublicSites, organizations, storageObjects } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";
import { storageService } from "@repo/services";
import { UJJWAL_SITE_CONTENT } from "./ujjwal-site-content";

const MEDIA_DIR = path.resolve("../../apps/web/public/sites/ujjwal");
const STATIC_PREFIX = "/sites/ujjwal/";

/** All static URLs the content references (they all start with the prefix). */
function collectStaticUrls(content: unknown): string[] {
  const urls = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      if (node.startsWith(STATIC_PREFIX)) urls.add(node);
      return;
    }
    if (Array.isArray(node)) node.forEach(walk);
    if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(content);
  return [...urls];
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to migrate with NODE_ENV=production.");
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, "ujjwal"),
  });
  if (!org) throw new Error("Ujjwal org not found — run pnpm db:seed:site first.");

  const site = await db.query.orgPublicSites.findFirst({
    where: eq(orgPublicSites.organizationId, org.id),
  });
  if (!site) throw new Error("Ujjwal site row not found — run pnpm db:seed:site first.");

  const urls = collectStaticUrls(UJJWAL_SITE_CONTENT);
  console.log(`Migrating ${urls.length} media files into the object store…`);

  // Delete the previous generation of public objects BEFORE uploading, so a
  // re-run replaces rather than accumulates. Only visibility=public rows of
  // this org are touched — student photos and ID-card assets are private.
  const stale = await db
    .delete(storageObjects)
    .where(and(eq(storageObjects.organizationId, org.id), eq(storageObjects.visibility, "public")))
    .returning({ id: storageObjects.id });
  console.log(`  - deleted ${stale.length} stale public objects`);

  const urlMap = new Map<string, string>();
  for (const staticUrl of urls) {
    const rel = staticUrl.slice(STATIC_PREFIX.length);
    const ext = path.extname(rel).toLowerCase();
    const contentType = ext === ".png" ? "image/png" : "image/webp";
    const bytes = await readFile(path.join(MEDIA_DIR, rel));

    const meta = await storageService.putObject({
      organizationId: org.id,
      contentType,
      bytes,
      visibility: "public",
    });
    urlMap.set(staticUrl, `/api/public/storage/${meta.id}`);
    console.log(`  + ${rel} -> ${urlMap.get(staticUrl)} (${Math.round(bytes.length / 1024)} KB)`);
  }

  // Rewrite every static URL in the content with its object URL.
  const rewritten = JSON.parse(JSON.stringify(UJJWAL_SITE_CONTENT)) as Record<string, unknown>;
  const replaceUrls = (node: unknown): unknown => {
    if (typeof node === "string") {
      return urlMap.get(node) ?? node;
    }
    if (Array.isArray(node)) return node.map(replaceUrls);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, replaceUrls(v)]));
    }
    return node;
  };
  const migrated = replaceUrls(rewritten);

  const parsed = publicSiteContentSchema.safeParse(migrated);
  if (!parsed.success) {
    console.error("Migrated content failed contract validation:", parsed.error.issues.slice(0, 5));
    process.exit(1);
  }

  // PublicSiteService replaces draft AND published wholesale — the site stays
  // live with the static URLs only until this single update lands.
  await db
    .update(orgPublicSites)
    .set({
      draftContent: parsed.data,
      publishedContent: parsed.data,
      publishedAt: new Date(),
    })
    .where(eq(orgPublicSites.organizationId, org.id));

  console.log(`\nDone. ${urlMap.size} URLs rewritten to /api/public/storage/{id}.`);
  console.log("You can now remove apps/web/public/sites from the repo and disk seeds' git tracking.\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

