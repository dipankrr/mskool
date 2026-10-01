import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations, schools } from "./organization";

/**
 * ID CARDS — per-school student ID card templates (slice 2a, ADR-038 era).
 *
 * A template is a structured JSON document the CLIENT renders against
 * server-resolved card data: an orientation, an optional full-card background
 * image (a storage object id), and an array of positioned ELEMENTS (text with
 * a binding into the card payload, photo, QR, logo). Geometry is PERCENT OF
 * CARD, so any arrangement is representable and print output is independent of
 * screen size. The zod vocabulary for canvas/elements lives in
 * `@repo/contracts` (id_card.contract.ts); the columns here are jsonb because
 * the DB stores what the contract validated — the same split as the exam
 * snapshot (ADR-032).
 *
 * Rows are the ADOPTED templates a school owns. The STARTER designs are code
 * constants in apps/web (a gallery); "adopt" clones a constant into one of
 * these rows via `id_card:manage`, and the 2b visual designer edits these
 * rows. Nothing here is a scope node (hard rule 12 does not apply — templates
 * hang off a school that already has its node), but both tenancy columns are
 * carried for `scopeWhere` like every academic table.
 */

export const idCardOrientationEnum = pgEnum("id_card_orientation", [
  "landscape", // CR80 86×54mm — the default
  "portrait", // CR80 54×86mm
]);

export const idCardTemplateStatusEnum = pgEnum("id_card_template_status", [
  "active",
  "inactive",
]);

export const idCardTemplates = pgTable(
  "id_card_templates",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    name: varchar({ length: 150 }).notNull(),

    orientation: idCardOrientationEnum().notNull().default("landscape"),
    // `{ backgroundAssetId: uuid | null }` — validated by the contract, not by
    // the DB. A jsonb FK is not enforceable here; the renderer treats a
    // missing object as "no background" rather than an error.
    canvas: jsonb().notNull(),
    // The element array — text/photo/qr/logo, percent geometry. Validated by
    // `idCardElementSchema` at every write.
    elements: jsonb().notNull(),

    // The card's BACK side (nullable = single-sided). Same jsonb contract
    // validation as the front; the pair is written together and shares the
    // front's orientation and card size — a card is one piece of stock.
    backCanvas: jsonb(),
    backElements: jsonb(),

    // One default per school (the partial unique index below): the picker's
    // pre-selected row.
    isDefault: boolean().notNull().default(false),

    // 2b's publish-to-gallery: an unpublished template is private to its
    // school; publishing is a separate act with its own timestamp. The column
    // ships now so 2b is purely UI.
    isPublished: boolean().notNull().default(false),
    publishedAt: timestamp({ withTimezone: true }),

    // Hard rule 2 — templates are closed, never deleted (print history may
    // reference their design).
    status: idCardTemplateStatusEnum().notNull().default("active"),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // A school's template names are a vocabulary — adopting a starter twice
    // under the same name is a clone accident the office would pay for.
    uniqueIndex("id_card_templates_school_name_uq").on(t.schoolId, t.name),
    // Exactly one default per school, enforced in the DB — the service's
    // clear-then-set transaction can race two callers, the index cannot.
    uniqueIndex("id_card_templates_school_default_uq")
      .on(t.schoolId)
      .where(sql`is_default`),
    index("id_card_templates_org_idx").on(t.organizationId),
    index("id_card_templates_school_idx").on(t.schoolId),
  ],
);

export const idCardTemplateRelations = relations(idCardTemplates, ({ one }) => ({
  school: one(schools, {
    fields: [idCardTemplates.schoolId],
    references: [schools.id],
  }),
}));
