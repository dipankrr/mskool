import type { DataScope } from "@repo/authz";
import { scopeWhere } from "@repo/authz";
import type {
  PublicSiteContent,
  PublicSiteContentInput,
  UploadRequest,
  UploadTicket,
} from "@repo/contracts";
import { db } from "@repo/db";
import { orgPublicSites, publicSiteMedia } from "@repo/db/schema";
import { organizations } from "@repo/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { refuse } from "./service-error";
import { storageService } from "./storage.service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * SITE IMAGES (ADR-063). Content keeps an uploaded image as the token
 * `storage:{objectId}`, never a URL, so moving to another bucket provider or
 * CDN changes no saved content. Reads swap each token for the file's public
 * link; saves swap our own public links back to tokens, so the editor can
 * keep working with plain URLs. Anything else (a pasted outside URL) is kept
 * as typed.
 */
const TOKEN = /^storage:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const OUR_LINK = /\/site_media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+$/i;

function mapStrings(node: unknown, fn: (value: string) => string): unknown {
  if (typeof node === "string") return fn(node);
  if (Array.isArray(node)) return node.map((child) => mapStrings(child, fn));
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, mapStrings(value, fn)]),
    );
  }
  return node;
}

/** Every file a content document uses, by its token. */
function mediaIds(content: unknown): string[] {
  const ids = new Set<string>();
  mapStrings(content, (value) => {
    const id = TOKEN.exec(value)?.[1];
    if (id) ids.add(id.toLowerCase());
    return value;
  });
  return [...ids];
}

/** Our own public links back to tokens, for saving. */
function toStoredContent<T>(content: T): T {
  return mapStrings(content, (value) => {
    if (!/^https?:\/\//.test(value)) return value;
    const id = OUR_LINK.exec(value)?.[1];
    return id ? `storage:${id.toLowerCase()}` : value;
  }) as T;
}

/** Tokens to public links, for reading. A file that is gone reads as empty. */
async function toDisplayContent<T>(organizationId: string, content: T): Promise<T> {
  const ids = mediaIds(content);
  if (ids.length === 0) return content;
  const refs = await storageService.imageRefs(organizationId, ids);
  return mapStrings(content, (value) => {
    const id = TOKEN.exec(value)?.[1];
    return id ? (refs.get(id.toLowerCase())?.url ?? "") : value;
  }) as T;
}

/**
 * Keeps `public_site_media` in step with what the draft and the published
 * site use (ADR-063): files either still uses stay; files neither uses are
 * let go for the storage sweeper.
 */
async function syncSiteMedia(
  tx: Tx,
  site: { id: string; organizationId: string; draftContent: unknown; publishedContent: unknown },
) {
  const used = new Set([...mediaIds(site.draftContent), ...mediaIds(site.publishedContent)]);
  const linked = await tx
    .select({ objectId: publicSiteMedia.objectId })
    .from(publicSiteMedia)
    .where(eq(publicSiteMedia.siteId, site.id));
  const dropped = linked.map((row) => row.objectId).filter((id) => !used.has(id));
  if (dropped.length === 0) return;
  await tx
    .delete(publicSiteMedia)
    .where(and(eq(publicSiteMedia.siteId, site.id), inArray(publicSiteMedia.objectId, dropped)));
  await storageService.markDeleted(tx, site.organizationId, dropped);
}

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
    if (!site) return null;
    return {
      ...site,
      draftContent: await toDisplayContent(organizationId, site.draftContent),
      publishedContent: await toDisplayContent(organizationId, site.publishedContent),
    };
  }

  /**
   * A link to PUT a site image to (ADR-063). The editor then calls
   * `imageReady` to have it checked and linked, and writes the returned link
   * into the draft.
   */
  async imageUpload(
    scope: DataScope,
    organizationId: string,
    file: UploadRequest,
    userId: string,
  ): Promise<UploadTicket> {
    const site = await this.getForOrg(scope, organizationId);
    if (!site) throw refuse("NOT_FOUND", "No site provisioned yet.");
    const [ticket] = await storageService.createUploads({
      organizationId,
      schoolId: null,
      purpose: "site_media",
      parentId: site.id,
      uploadedBy: userId,
      files: [file],
    });
    if (!ticket) throw new Error("No upload link was created.");
    return ticket;
  }

  /**
   * Checks an uploaded site image and links it to the site, answering its
   * public link for the draft. Saving a draft that no longer uses it lets it
   * go.
   */
  async imageReady(
    scope: DataScope,
    organizationId: string,
    objectId: string,
    userId: string,
  ): Promise<{ url: string }> {
    const [site] = await db
      .select({ id: orgPublicSites.id })
      .from(orgPublicSites)
      .where(
        and(
          eq(orgPublicSites.organizationId, organizationId),
          scopeWhere(scope, ORG_SCOPE_COLUMNS),
        ),
      )
      .limit(1);
    if (!site) throw refuse("NOT_FOUND", "No site provisioned yet.");

    await storageService.ensureReady(userId, [objectId]);
    await db.transaction(async (tx) => {
      await storageService.attach(tx, {
        organizationId,
        purpose: "site_media",
        parentId: site.id,
        userId,
        objectIds: [objectId],
      });
      await tx
        .insert(publicSiteMedia)
        .values({ siteId: site.id, objectId, organizationId })
        .onConflictDoNothing();
    });
    const ref = (await storageService.imageRefs(organizationId, [objectId])).get(objectId);
    if (!ref) throw refuse("NOT_FOUND", "That image isn't available. Upload it again.");
    return { url: ref.url };
  }

  /**
   * Links files a server-side seed stored for this site and re-syncs what the
   * site uses. Seeds and scripts only: files must have been stored with no
   * uploader.
   */
  async linkSeededMedia(organizationId: string, objectIds: string[]) {
    await db.transaction(async (tx) => {
      const [site] = await tx
        .select()
        .from(orgPublicSites)
        .where(eq(orgPublicSites.organizationId, organizationId))
        .limit(1);
      if (!site) throw new Error("No site to link media to.");
      await storageService.attach(tx, {
        organizationId,
        purpose: "site_media",
        parentId: site.id,
        userId: null,
        objectIds,
      });
      if (objectIds.length > 0) {
        await tx
          .insert(publicSiteMedia)
          .values(objectIds.map((objectId) => ({ siteId: site.id, objectId, organizationId })))
          .onConflictDoNothing();
      }
      await syncSiteMedia(tx, site);
    });
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
    presetVersion = 1,
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
        presetVersion,
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
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(orgPublicSites)
        .set({
          draftContent: toStoredContent(input.content),
          ...(input.preset ? { preset: input.preset } : {}),
        })
        .where(
          and(
            eq(orgPublicSites.organizationId, input.organizationId),
            scopeWhere(input.scope, ORG_SCOPE_COLUMNS),
          ),
        )
        .returning();
      if (updated) await syncSiteMedia(tx, updated);
      return updated ?? null;
    });
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
      if (published) await syncSiteMedia(tx, published);
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
        organizationId: orgPublicSites.organizationId,
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
      content: await toDisplayContent(
        site.organizationId,
        site.publishedContent as PublicSiteContent,
      ),
      publishedAt: site.publishedAt ? site.publishedAt.toISOString() : null,
    };
  }
}

export const publicSiteService = new PublicSiteService();
