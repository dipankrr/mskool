import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * The tenant. An Organization is a Trust or Society that owns one or more
 * schools — NOT the school itself (ADR-001). Everything else in the system
 * hangs off this, directly or through `schools`.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid().primaryKey().defaultRandom(),

    name: varchar({ length: 255 }).notNull(),
    // The registered legal entity — "Saraswati Educational Trust". Appears on
    // legal documents, which is why it is distinct from the display name.
    legalName: varchar({ length: 255 }).notNull(),
    // URL-safe tenant identifier. Immutable once issued: it may appear in
    // subdomains and external integrations.
    slug: varchar({ length: 100 }).notNull(),

    registrationNumber: varchar({ length: 100 }),
    panNumber: varchar({ length: 10 }),

    email: varchar({ length: 255 }),
    phone: varchar({ length: 20 }),
    addressLine1: varchar({ length: 255 }),
    addressLine2: varchar({ length: 255 }),
    city: varchar({ length: 100 }),
    state: varchar({ length: 100 }),
    pincode: varchar({ length: 10 }),

    // Never hard-deleted (hard rule 2) — deactivation is a status change, so
    // that historical records keep resolving.
    isActive: boolean().notNull().default(true),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

export const boardTypeEnum = pgEnum("board_type", [
  "cbse",
  "icse",
  "state",
  "ib",
  "unaffiliated",
]);

/**
 * A school is a BRANCH under an organization, not a tenant. `schoolId` is the
 * tenancy key on nearly every operational table (hard rule 1).
 *
 * Creating a school MUST also insert its scope_nodes row in the same
 * transaction (hard rule 12) — see SchoolService.
 */
export const schools = pgTable(
  "schools",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),

    name: varchar({ length: 255 }).notNull(),
    // Snapshotted onto certificates and TCs at generation time, never
    // live-joined — a rename must not rewrite documents already issued.
    legalName: varchar({ length: 255 }).notNull(),
    code: varchar({ length: 50 }).notNull(),

    board: boardTypeEnum().notNull().default("cbse"),
    affiliationNumber: varchar({ length: 100 }),
    // Government school code — required for UDISE+ reporting.
    udiseCode: varchar({ length: 20 }),

    email: varchar({ length: 255 }),
    phone: varchar({ length: 20 }),
    addressLine1: varchar({ length: 255 }),
    addressLine2: varchar({ length: 255 }),
    city: varchar({ length: 100 }),
    state: varchar({ length: 100 }),
    pincode: varchar({ length: 10 }),

    principalName: varchar({ length: 255 }),
    establishedOn: date(),
    logoUrl: text(),

    isActive: boolean().notNull().default(true),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // School codes are unique per org, not globally — two trusts may both
    // have a "MAIN" branch.
    uniqueIndex("schools_org_code_uq").on(t.organizationId, t.code),
    index("schools_org_idx").on(t.organizationId),
  ],
);

export const organizationRelations = relations(organizations, ({ many }) => ({
  schools: many(schools),
}));

export const schoolRelations = relations(schools, ({ one }) => ({
  organization: one(organizations, {
    fields: [schools.organizationId],
    references: [organizations.id],
  }),
}));
