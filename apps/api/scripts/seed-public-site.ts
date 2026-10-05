/**
 * Seed the Ujjwal Kids World public site — `pnpm db:seed:site`.
 *
 * Creates (or reuses) the `ujjwal` organization and upserts its
 * org_public_sites row with the ported content
 * (docs/reference/ujjwal-content-inventory.md), publishing it immediately so
 * `{slug}.mskool.in` (and dev's `?org=ujjwal`) serves the real site.
 *
 * Same composition-root rules as seed.ts (ADR-020): createOrganization via
 * @repo/services so the default permission matrix is copied; validate the
 * content against the contract before writing, because a bad seed must fail
 * here, not on a school's homepage.
 *
 * Re-runnable: existing org and site rows are reused; the content itself is
 * re-published from this file on every run (the seed file is the source of
 * truth for the demo, mirroring how the editor would publish a draft).
 */
import { publicSiteContentSchema } from "@repo/contracts";
import { db } from "@repo/db";
import { orgPublicSites, organizations } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { organizationService } from "@repo/services";
import { UJJWAL_SITE_CONTENT } from "./ujjwal-site-content";

const ORG_SLUG = "ujjwal";
const ORG_NAME = "Ujjwal Kids World";
const PRESET = "ujjwal-kids";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed with NODE_ENV=production.");
  }

  console.log("\nSeeding public site…\n");

  // Contract gate first: never write content the renderer would reject.
  const parsed = publicSiteContentSchema.safeParse(UJJWAL_SITE_CONTENT);
  if (!parsed.success) {
    console.error("Site content failed contract validation:", parsed.error.issues.slice(0, 10));
    process.exit(1);
  }

  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.slug, ORG_SLUG),
  });

  const organization =
    existing ??
    (await organizationService.createOrganization({
      name: ORG_NAME,
      legalName: "Ujjwal Kids World",
      slug: ORG_SLUG,
      email: "ujjwalkidsworld@gmail.com",
      phone: "+919382927687",
      addressLine1: "Gangarampur",
      city: "Gangarampur",
      state: "West Bengal",
    }));

  console.log(`  = organization ${ORG_SLUG} (${organization.id})`);

  const content = parsed.data;
  const existingSite = await db.query.orgPublicSites.findFirst({
    where: eq(orgPublicSites.organizationId, organization.id),
  });

  if (existingSite) {
    await db
      .update(orgPublicSites)
      .set({
        preset: PRESET,
        draftContent: content,
        publishedContent: content,
        publishedAt: new Date(),
        isActive: true,
      })
      .where(eq(orgPublicSites.organizationId, organization.id));
    console.log("  ~ site content re-published");
  } else {
    await db.insert(orgPublicSites).values({
      organizationId: organization.id,
      preset: PRESET,
      draftContent: content,
      publishedContent: content,
      publishedAt: new Date(),
    });
    console.log("  + site created and published");
  }

  console.log(`\nDone. Dev URL: http://localhost:3000/?org=${ORG_SLUG}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
