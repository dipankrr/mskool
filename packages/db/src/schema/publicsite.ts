import { boolean, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organization";

/**
 * The public website of an organization, served at `{org-slug}.mskool.in`.
 * ADR-041: the tenant owns the site (ADR-001); a school is CONTENT inside it
 * (the campuses section), never a site of its own.
 *
 * Content shape (sections, blocks, theme) is defined and validated by
 * `@repo/contracts` (public_site.contract) — this column stays jsonb because
 * the schema dependency must flow db → contracts, never backwards.
 *
 * The draft/published split is the public-side analogue of hard rule 8: the
 * anonymous visitor reads `published_content` ONLY, and publish REPLACES it
 * wholesale from the draft, so a half-edited state is unrepresentable on the
 * public path.
 */
export const orgPublicSites = pgTable(
  "org_public_sites",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),

    // Which stock preset renders this site ("ujjwal-kids" is the first).
    // Presets are code-side defaults; the row carries the org's own content
    // and theme overrides.
    preset: varchar({ length: 50 }).notNull().default("ujjwal-kids"),

    // The template version stamped at creation. Template updates are offered
    // to existing rows opt-in (never automatic) by comparing this with the
    // catalog — a new sample section must never rewrite a school's words.
    presetVersion: integer().notNull().default(1),

    // What the staff editor edits. { theme, sections: [{key, content}] }.
    draftContent: jsonb().notNull(),
    // What `{slug}.mskool.in` serves. Null until the first publish — an
    // unpublished site is not reachable on the public host at all.
    publishedContent: jsonb(),
    publishedAt: timestamp({ withTimezone: true }),

    // Never hard-deleted (hard rule 2): taking a site down is
    // isActive=false, and the public host answers "site not found".
    isActive: boolean().notNull().default(true),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One site per organization — the subdomain namespace is the org slug.
    uniqueIndex("org_public_sites_org_uq").on(t.organizationId),
  ],
);
