import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { academicYears, classes } from "./academic";
import { organizations, schools } from "./organization";

/**
 * FEES — Phase 4.
 *
 * This file holds the domain's four layers, built across two migrations:
 * 0010 brings the CONFIGURATION layer (heads, structures, lines, late-fee
 * rules — what a school charges and how it splits), 0011 brings the
 * RESOLUTION / BILLING / COLLECTION layers (assignments, concessions,
 * installments, payments, allocations, refunds, the ledger, the receipt
 * sequence).
 *
 * The domain's shape (DOMAIN.md §5): billing and collection are DECOUPLED.
 * `fee_installments` is what is owed; `fee_payments` is what arrived;
 * `payment_allocations` joins them many-to-many. Structures are templates —
 * revising one in October must not alter anything already assigned or
 * generated, which is why the resolved layers snapshot every amount they
 * need.
 *
 * Every table carries BOTH `organizationId` and `schoolId` for `scopeWhere`
 * (hard rule 1, the S2.4 lesson); the per-student layers additionally carry
 * `studentId` and `academicYearId`, because a dues list is a year-scoped
 * read.
 *
 * HARD RULE 4: money is `numeric(10,2)` in the DB and STRING in code. Drizzle
 * reads numeric columns back as strings; the contracts keep them strings; no
 * float ever touches an amount.
 */

// ---------------------------------------------------------------------------
// The configuration layer — 0010
// ---------------------------------------------------------------------------

export const feeHeadCategoryEnum = pgEnum("fee_head_category", [
  "regular", // standard recurring — tuition, activity
  "one_time", // admission fee, registration fee
  "optional", // transport, hostel — opt-in, priced outside the structure
  "fine", // late fee, damage fine
  "refundable", // security deposit — RESERVED, not built (plan deferral)
]);

/**
 * A kind of fee a school charges — "Tuition Fee", "Transport", "Lab Fee".
 * Fully custom per school; the only taxonomy the schema imposes is the
 * category, which drives behaviour (only `optional` heads are subscribable;
 * `refundable` is reserved for the deposits era).
 *
 * Deactivation, never delete (hard rule 2): structures, assignments, and
 * installments point at a head forever, and a ledger row keeps its
 * `fee_head_id` for the accountants' grouping long after the head is gone.
 */
export const feeHeads = pgTable(
  "fee_heads",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    name: varchar({ length: 150 }).notNull(),
    // "TF", "TR", "LAB" — printed on receipts where 150 characters will not fit.
    shortCode: varchar({ length: 20 }),
    description: varchar({ length: 255 }),

    category: feeHeadCategoryEnum().notNull().default("regular"),

    // GST applicability — flags only in v1 (plan deferral: no tax reporting).
    isTaxable: boolean().notNull().default(false),
    taxPercentage: numeric({ precision: 5, scale: 2 }),

    isActive: boolean().notNull().default(true),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // A school's fee heads are a vocabulary — the same name twice is a
    // data-entry accident the accountant would pay for at reconciliation.
    uniqueIndex("fee_heads_school_name_uq").on(t.schoolId, t.name),
    index("fee_heads_school_idx").on(t.schoolId),
    index("fee_heads_org_idx").on(t.organizationId),
  ],
);

export const feeInstallmentModeEnum = pgEnum("fee_installment_mode", [
  "upfront", // all at once at year start
  "term_wise", // one batch per term — the recommended default
  "monthly", // one installment per month
]);

/**
 * The class-level fee TEMPLATE for one academic year: which heads apply to a
 * class, for how much, and how the year's payments split.
 *
 * NOT a scope node (hard rule 12 names school/class/section only) — a
 * structure's authority rides on the school-scoped `fee_structure:*` grant.
 *
 * Deactivation, never delete: an assignment snapshots FROM a structure, and
 * the snapshot's FK must keep resolving (hard rule 2).
 */
export const feeStructures = pgTable(
  "fee_structures",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    classId: uuid()
      .notNull()
      .references(() => classes.id),

    // "Class 6 Fee Structure 2025-26"
    name: varchar({ length: 150 }).notNull(),

    // The default cadence lines inherit when they do not name their own.
    installmentMode: feeInstallmentModeEnum().notNull().default("term_wise"),

    isActive: boolean().notNull().default(true),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // ONE structure per class per year — the resolver's disambiguation rule as
    // much as a tidiness rule. Two structures for the same class+year would
    // make "assign the class fee" ambiguous; the service relies on this
    // index finding at most one row.
    uniqueIndex("fee_structures_class_year_uq").on(
      t.schoolId,
      t.academicYearId,
      t.classId,
    ),
    index("fee_structures_school_year_idx").on(t.schoolId, t.academicYearId),
    index("fee_structures_org_idx").on(t.organizationId),
  ],
);

export const feeInstallmentFrequencyEnum = pgEnum("fee_installment_frequency", [
  "inherit", // follow the structure's installment_mode
  "monthly",
  "quarterly",
  "half_yearly",
  "annual", // full amount once, in the first applicable installment
  "term_wise",
]);

/**
 * One fee head's entry inside a structure: the annual amount and how that
 * amount splits across the year.
 *
 * `installment_frequency = 'inherit'` (the default) defers to the
 * structure's mode; the RESOLUTION happens at generation time (F4), never at
 * read time — a line's meaning for an already-generated installment is
 * frozen into the installment row, so a later mode change touches only
 * future generation runs.
 */
export const feeStructureLines = pgTable(
  "fee_structure_lines",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    feeStructureId: uuid()
      .notNull()
      .references(() => feeStructures.id),
    feeHeadId: uuid()
      .notNull()
      .references(() => feeHeads.id),

    // CHECKed >= 0, not > 0: a head can ride in a structure at zero (e.g. a
    // waived-for-this-class activity fee) without forbidding the row.
    annualAmount: numeric({ precision: 10, scale: 2 }).notNull(),

    installmentFrequency: feeInstallmentFrequencyEnum()
      .notNull()
      .default("inherit"),

    // Which months of the year this head applies to — tuition 1–12, an
    // admission fee 4–4. The generator slices monthly amounts through this
    // range; term-wise and coarser frequencies use it only as a gate.
    applicableFromMonth: smallint().notNull().default(1),
    applicableToMonth: smallint().notNull().default(12),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One entry per head per structure — the annual amount is per head, so a
    // second row for the same head would double-charge it at generation.
    uniqueIndex("fee_structure_lines_structure_head_uq").on(
      t.feeStructureId,
      t.feeHeadId,
    ),
    index("fee_structure_lines_structure_idx").on(t.feeStructureId),
    index("fee_structure_lines_org_idx").on(t.organizationId),

    check(
      "fee_structure_lines_amount_non_negative",
      sql`"annual_amount" >= 0`,
    ),
    check(
      "fee_structure_lines_month_range",
      sql`("applicable_from_month" BETWEEN 1 AND 12)
          AND ("applicable_to_month" BETWEEN 1 AND 12)`,
    ),
    check(
      "fee_structure_lines_month_order",
      sql`"applicable_from_month" <= "applicable_to_month"`,
    ),
  ],
);

export const lateFeeCalculationTypeEnum = pgEnum("late_fee_calculation_type", [
  "flat", // fixed amount after the due date
  "percentage", // % of the overdue amount, charged once
  "per_day", // accrues daily until paid
]);

/**
 * WHEN A LATE PAYMENT COSTS EXTRA — per school, optionally narrowed to one
 * structure (a NULL `feeStructureId` row is the school-wide rule; the
 * structure-named one wins for its class).
 *
 * Late fee is COMPUTED LIVE for display and FROZEN into the payment when
 * charged (DOMAIN.md §5) — a rule change must never reach into a past
 * receipt, which is why `fee_payments.late_fee_amount` is a snapshot and
 * this table is only ever the calculator's input.
 *
 * `max_late_fee` is the cap (NULL = uncapped); `per_day` rules need it more
 * than the others — an uncapped per-day fee against a never-paying student
 * grows without bound and becomes a news story.
 */
export const lateFeeRules = pgTable(
  "late_fee_rules",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    // NULL = applies school-wide.
    feeStructureId: uuid().references(() => feeStructures.id),

    gracePeriodDays: smallint().notNull().default(0),
    calculationType: lateFeeCalculationTypeEnum().notNull(),
    // The amount (flat / per_day) or percentage (percentage).
    value: numeric({ precision: 8, scale: 2 }).notNull(),
    maxLateFee: numeric({ precision: 10, scale: 2 }),

    isActive: boolean().notNull().default(true),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The query that always runs: "this school's active rules" — the partial
    // index keeps the inactive history out of it.
    index("late_fee_rules_school_active_idx")
      .on(t.schoolId)
      .where(sql`is_active = TRUE`),
    index("late_fee_rules_structure_idx").on(t.feeStructureId),
    index("late_fee_rules_org_idx").on(t.organizationId),

    check("late_fee_rules_value_positive", sql`"value" > 0`),
    check(
      "late_fee_rules_date_order",
      sql`"effective_to" IS NULL OR "effective_to" >= "effective_from"`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Configuration-layer relations
// ---------------------------------------------------------------------------

export const feeHeadRelations = relations(feeHeads, ({ one }) => ({
  organization: one(organizations, {
    fields: [feeHeads.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [feeHeads.schoolId],
    references: [schools.id],
  }),
}));

export const feeStructureRelations = relations(feeStructures, ({ one }) => ({
  organization: one(organizations, {
    fields: [feeStructures.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [feeStructures.schoolId],
    references: [schools.id],
  }),
  academicYear: one(academicYears, {
    fields: [feeStructures.academicYearId],
    references: [academicYears.id],
  }),
  class: one(classes, {
    fields: [feeStructures.classId],
    references: [classes.id],
  }),
}));

export const feeStructureLineRelations = relations(
  feeStructureLines,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [feeStructureLines.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [feeStructureLines.schoolId],
      references: [schools.id],
    }),
    feeStructure: one(feeStructures, {
      fields: [feeStructureLines.feeStructureId],
      references: [feeStructures.id],
    }),
    feeHead: one(feeHeads, {
      fields: [feeStructureLines.feeHeadId],
      references: [feeHeads.id],
    }),
  }),
);

export const lateFeeRuleRelations = relations(lateFeeRules, ({ one }) => ({
  organization: one(organizations, {
    fields: [lateFeeRules.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [lateFeeRules.schoolId],
    references: [schools.id],
  }),
  feeStructure: one(feeStructures, {
    fields: [lateFeeRules.feeStructureId],
    references: [feeStructures.id],
  }),
}));
