import type { DataScope } from "@repo/authz";
import { scopeWhere } from "@repo/authz";
import type { PublicSiteContent, PublicSiteContentInput } from "@repo/contracts";
import { db } from "@repo/db";
import { orgPublicSites } from "@repo/db/schema";
import { organizations } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * The site is ORG-level: the only scope column the table expresses is
 * organizationId. A scope narrowed below the org cannot address a site, and
 * scopeWhere() throws on it rather than silently widening — same contract as
 * SCHOOL_SCOPE_COLUMNS in organization.service.
 */
const ORG_SCOPE_COLUMNS = { organizationId: orgPublicSites.organizationId };

/**
 * PUBLIC SITES — the org's website at `{slug}.mskool.in` (ADR-041).
 *
 * Two readers, hard-separated:
 *  - the STAFF editor track takes a DataScope as a required argument (hard
 *    rule 1) and touches draft_content;
 *  - the PUBLIC track is anonymous and reads published_content ONLY, through
 *    `getPublishedBySlug`, which never returns anything but the published
 *    snapshot — and never joins toward staff/student/operational tables.
 *    An unknown slug and an unpublished/inactive one are the same null.
 */
export class PublicSiteService {
  // ── Staff editor track ───────────────────────────────────────────────────

  /** The org's site row for the editor; null if none provisioned yet. */
  async getForOrg(scope: DataScope, organizationId: string) {
    const [site] = await db
      .select()
      .from(orgPublicSites)
      .where(
        and(
          eq(orgPublicSites.organizationId, organizationId),
          scopeWhere(scope, ORG_SCOPE_COLUMNS),
        ),
      )
      .limit(1);
    return site ?? null;
  }

  /**
   * Provisions the org's site row if missing, returning the existing row
   * either way. Seeding and first-open of the editor both go through here,
   * so a missing row is never a 500 in the editor. The caller may supply the
   * initial draft (the editor's starter generator does); it must already
   * satisfy the content contract, because the draft read re-validates it.
   */
  async ensureForOrg(
    organizationId: string,
    preset = "ujjwal-kids",
    draftContent?: PublicSiteContentInput,
  ) {
    const existing = await db.query.orgPublicSites.findFirst({
      where: eq(orgPublicSites.organizationId, organizationId),
    });
    if (existing) return existing;

    const [created] = await db
      .insert(orgPublicSites)
      .values({
        organizationId,
        preset,
        draftContent: draftContent ?? { sections: [] },
      })
      .onConflictDoNothing({ target: orgPublicSites.organizationId })
      .returning();

    if (created) return created;
    return db.query.orgPublicSites.findFirst({
      where: eq(orgPublicSites.organizationId, organizationId),
    });
  }

  /** Replaces the draft wholesale. The draft is a working copy, not history. */
  async saveDraft(input: {
    scope: DataScope;
    organizationId: string;
    preset?: string;
    content: PublicSiteContentInput;
  }) {
    const [updated] = await db
      .update(orgPublicSites)
      .set({
        draftContent: input.content,
        ...(input.preset ? { preset: input.preset } : {}),
      })
      .where(
        and(
          eq(orgPublicSites.organizationId, input.organizationId),
          scopeWhere(input.scope, ORG_SCOPE_COLUMNS),
        ),
      )
      .returning();
    return updated ?? null;
  }

  /**
   * Draft → published, wholesale, in one transaction (ADR-041 §2). The
   * public side never sees a partial copy because the UPDATE is atomic;
   * there is no version history to corrupt and nothing to replay.
   */
  async publish(input: { scope: DataScope; organizationId: string }) {
    return db.transaction(async (tx) => {
      const [site] = await tx
        .select()
        .from(orgPublicSites)
        .where(eq(orgPublicSites.organizationId, input.organizationId))
        .limit(1);

      if (!site) throw new Error("No site to publish — save a draft first.");

      const [published] = await tx
        .update(orgPublicSites)
        .set({
          publishedContent: site.draftContent,
          publishedAt: new Date(),
          // A publish after an unpublish must go live again — unpublish only
          // flips the flag, so publish must flip it back.
          isActive: true,
        })
        .where(eq(orgPublicSites.organizationId, input.organizationId))
        .returning();
      return published;
    });
  }

  /** Unpublish = take the site off the public host without touching drafts. */
  async unpublish(input: { scope: DataScope; organizationId: string }) {
    const [updated] = await db
      .update(orgPublicSites)
      .set({ isActive: false })
      .where(eq(orgPublicSites.organizationId, input.organizationId))
      .returning();
    return updated ?? null;
  }

  // ── Public track (anonymous) ─────────────────────────────────────────────

  /**
   * The only door the public site has. Resolves the org by slug and returns
   * the published snapshot — null for unknown slug, unpublished site, or
   * inactive site, indistinguishably. The whitelisted projection is enforced
   * by the router's output schema; nothing else from the org row escapes.
   */
  async getPublishedBySlug(slug: string) {
    const row = await db
      .select({
        orgName: organizations.name,
        preset: orgPublicSites.preset,
        publishedContent: orgPublicSites.publishedContent,
        publishedAt: orgPublicSites.publishedAt,
        isActive: orgPublicSites.isActive,
      })
      .from(orgPublicSites)
      .innerJoin(organizations, eq(orgPublicSites.organizationId, organizations.id))
      .where(eq(organizations.slug, slug))
      .limit(1);

    const site = row[0];
    if (!site || !site.isActive || !site.publishedContent) return null;
    return {
      orgName: site.orgName,
      preset: site.preset,
      content: site.publishedContent as PublicSiteContent,
      publishedAt: site.publishedAt ? site.publishedAt.toISOString() : null,
    };
  }
}

export const publicSiteService = new PublicSiteService();
