import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { academicYears, classes, sections, studentEnrollments, terms } from "./academic";
import { organizations, schools } from "./organization";
import { students } from "./people";

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

    // Made by the app, for one-off charges. Never listed or chosen by staff.
    isSystem: boolean().notNull().default(false),

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
    uniqueIndex("fee_heads_one_system_uq")
      .on(t.schoolId)
      .where(sql`"is_system"`),
    index("fee_heads_school_idx").on(t.schoolId),
    index("fee_heads_org_idx").on(t.organizationId),
  ],
);

/**
 * A fee TEMPLATE for one academic year: which heads a class or some of its
 * sections pay, and each one's schedule. A class may have several, linked to
 * sections through `fee_structure_sections` (Class 11 Science and Commerce).
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

    isActive: boolean().notNull().default(true),

    // "Start billing": null until someone switches it on. Students present at
    // this moment are existing; anyone admitted later is billed automatically.
    billingStartedAt: timestamp({ withTimezone: true }),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Names only need to be unique among live structures, so a retired one
    // never blocks its replacement.
    uniqueIndex("fee_structures_class_year_name_uq")
      .on(t.schoolId, t.academicYearId, t.classId, t.name)
      .where(sql`is_active = TRUE`),
    index("fee_structures_school_year_idx").on(t.schoolId, t.academicYearId),
    index("fee_structures_org_idx").on(t.organizationId),
  ],
);

/** How often a fee line charges. A line's schedule holds one row per period. */
export const feeLineFrequencyEnum = pgEnum("fee_line_frequency", [
  "monthly",
  "quarterly",
  "half_yearly",
  "term_wise",
  "once",
]);

export const feeWhoPaysEnum = pgEnum("fee_who_pays", ["everyone", "new_students"]);

/**
 * One fee head's entry inside a structure: how often it charges and how much
 * per period. Its schedule rows (`fee_line_periods`) are what dues are made
 * from; a due already created keeps its own amount, so a later edit only
 * reaches dues not created yet.
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

    frequency: feeLineFrequencyEnum().notNull().default("monthly"),
    // Per period: 1000.00 a month. A schedule row can differ from this.
    // CHECKed >= 0, not > 0: a head can ride in a structure at zero.
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    whoPays: feeWhoPaysEnum().notNull().default("everyone"),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One entry per head per structure: a second row for the same head would
    // double-charge it at generation.
    uniqueIndex("fee_structure_lines_structure_head_uq").on(
      t.feeStructureId,
      t.feeHeadId,
    ),
    index("fee_structure_lines_structure_idx").on(t.feeStructureId),
    index("fee_structure_lines_org_idx").on(t.organizationId),

    check("fee_structure_lines_amount_non_negative", sql`"amount" >= 0`),
  ],
);

/**
 * THE SCHEDULE: what one fee line charges, one row per period. This is the
 * source of truth for a due's amount and date, so "December off", "1,200 from
 * October" and "Term 1 costs more than Term 2" are all just rows.
 *
 * `periodKey` names the period and becomes the due's identity: `2026-11`,
 * `q:2026-10`, `h:2026-04`, `term:<uuid>` or `once`. It stays stable when other
 * rows are added or removed, which a position number does not.
 *
 * Editing a row never touches a due already created (a created due never
 * changes); it only prices dues not created yet.
 */
export const feeLinePeriods = pgTable(
  "fee_line_periods",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    feeStructureLineId: uuid()
      .notNull()
      .references(() => feeStructureLines.id),

    periodKey: varchar({ length: 60 }).notNull(),
    label: varchar({ length: 100 }).notNull(),
    startDate: date().notNull(),
    endDate: date().notNull(),
    dueDate: date().notNull(),
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    termId: uuid().references(() => terms.id),

    // Someone changed this row by hand, so re-saving the line keeps it.
    amountEdited: boolean().notNull().default(false),
    dueDateEdited: boolean().notNull().default(false),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fee_line_periods_line_key_uq").on(t.feeStructureLineId, t.periodKey),
    index("fee_line_periods_school_idx").on(t.schoolId),
    index("fee_line_periods_org_idx").on(t.organizationId),

    check("fee_line_periods_amount_non_negative", sql`"amount" >= 0`),
    check("fee_line_periods_date_order", sql`"end_date" >= "start_date"`),
  ],
);

/**
 * Which sections a fee structure covers, when a class has more than one
 * structure (Class 11 Science and Commerce). A section belongs to at most one
 * structure. A structure with no rows here covers the whole class.
 */
export const feeStructureSections = pgTable(
  "fee_structure_sections",
  {
    feeStructureId: uuid()
      .notNull()
      .references(() => feeStructures.id),
    sectionId: uuid()
      .notNull()
      .references(() => sections.id),
  },
  (t) => [
    primaryKey({ columns: [t.feeStructureId, t.sectionId] }),
    uniqueIndex("fee_structure_sections_section_uq").on(t.sectionId),
  ],
);

/**
 * One school's fee choices for one session, asked once in setup: the months it
 * charges (new lines start from these) and the day a monthly fee falls due.
 * `dueDay` runs 1 to 31; a month shorter than that uses its last day, so 31
 * means "the last day of the month".
 */
export const feeSessionSettings = pgTable(
  "fee_session_settings",
  {
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),

    // `YYYY-MM` keys, in session order. Empty means every month of the session.
    chargedMonths: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    dueDay: smallint().notNull().default(1),

    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.schoolId, t.academicYearId] }),
    check("fee_session_settings_due_day", sql`"due_day" BETWEEN 1 AND 31`),
  ],
);

export const feeDuesRunStatusEnum = pgEnum("fee_dues_run_status", ["running", "done", "failed"]);

/**
 * A school-wide "create these dues now". It runs one student at a time, which
 * can outlast a phone's request, so it runs in the background and leaves its
 * result here. One at a time per session. Running it again is always safe,
 * because it only fills what is missing.
 */
export const feeDuesRuns = pgTable(
  "fee_dues_runs",
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
    classId: uuid().references(() => classes.id),
    through: date().notNull(),

    status: feeDuesRunStatusEnum().notNull().default("running"),
    studentCount: integer().notNull().default(0),
    studentsWithNewDues: integer().notNull().default(0),
    insertedCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),

    startedBy: text().references(() => user.id),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("fee_dues_runs_one_running_uq")
      .on(t.schoolId, t.academicYearId)
      .where(sql`"status" = 'running'`),
    index("fee_dues_runs_school_year_idx").on(t.schoolId, t.academicYearId, t.startedAt),
    index("fee_dues_runs_org_idx").on(t.organizationId),
  ],
);

export const lateFeeApplyPerEnum = pgEnum("late_fee_apply_per", ["fee", "month"]);

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
    // April's tuition and lab fee overdue: one late fee (month) or two (fee).
    applyPer: lateFeeApplyPerEnum().notNull().default("month"),

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

// ---------------------------------------------------------------------------
// The resolution layer — 0011
// ---------------------------------------------------------------------------

export const feeAssignmentStatusEnum = pgEnum("fee_assignment_status", [
  "active",
  "suspended",
  "cancelled",
]);

/**
 * THE RESOLVED FEE RECORD: one student's billing for one year. It names the
 * structure and the date billing starts from. A school revising a structure in
 * October must not alter dues already raised (DOMAIN.md §5): dues carry their
 * own amounts, and an edit only reaches dues not created yet.
 *
 * One per student per year (the unique index) — the year anchor's fee shadow,
 * hanging off the enrollment. Mid-session admissions generate installments
 * only from `fee_effective_from` (the admission date); a student who joins in
 * November never sees an April installment.
 */
export const studentFeeAssignments = pgTable(
  "student_fee_assignments",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentId: uuid()
      .notNull()
      .references(() => students.id),
    enrollmentId: uuid()
      .notNull()
      .references(() => studentEnrollments.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    feeStructureId: uuid()
      .notNull()
      .references(() => feeStructures.id),

    feeEffectiveFrom: date().notNull(),
    // The school's policy for mid-session joiners: the joining month is
    // charged IN FULL regardless of the day they arrived. Default TRUE —
    // charging a full month for 25 days is the common Indian-school rule.
    joiningMonthFullCharge: boolean().notNull().default(true),
    // Decided once at billing; drives lines that only new students pay.
    isNewStudent: boolean().notNull().default(false),

    status: feeAssignmentStatusEnum().notNull().default("active"),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // ONE fee reality per student per year. (school, student, year) — the
    // student already belongs to one school, but the S2.4 lesson says the
    // school column earns its place in the key anyway.
    uniqueIndex("student_fee_assignments_student_year_uq").on(
      t.schoolId,
      t.studentId,
      t.academicYearId,
    ),
    index("student_fee_assignments_student_idx").on(t.studentId),
    index("student_fee_assignments_school_year_idx").on(t.schoolId, t.academicYearId),
    index("student_fee_assignments_org_idx").on(t.organizationId),
  ],
);

export const feeConcessionTypeEnum = pgEnum("fee_concession_type", [
  "sibling_discount",
  "staff_ward",
  "merit_scholarship",
  "need_based",
  "rte_waiver",
  "management_discount",
  "other",
]);

export const feeConcessionCalculationEnum = pgEnum("fee_concession_calculation", [
  "flat",
  "percentage",
]);

export const feeConcessionStatusEnum = pgEnum("fee_concession_status", ["active", "void"]);

/**
 * A per-student discount on top of an assignment. It is a RULE applied to each
 * due it covers, written when added.
 *
 * `concession_amount` is what was actually applied across `covered_periods`
 * when it was created, percentage rounding DOWN, so the audit record states
 * exactly what the student got. A NULL `feeHeadId` applies to ALL heads; a
 * named head confines the concession to one line.
 */
export const feeConcessions = pgTable(
  "fee_concessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentFeeAssignmentId: uuid()
      .notNull()
      .references(() => studentFeeAssignments.id),
    // NULL = applies to all fee heads of the assignment.
    feeHeadId: uuid().references(() => feeHeads.id),

    concessionType: feeConcessionTypeEnum().notNull(),
    calculationType: feeConcessionCalculationEnum().notNull(),
    // The INPUT — a flat rupee amount, or a percentage 0–100.
    value: numeric({ precision: 10, scale: 2 }).notNull(),
    // The OUTPUT — the computed rupee amount, frozen for audit. The service
    // writes it; no code path may treat it as an input.
    concessionAmount: numeric({ precision: 10, scale: 2 }).notNull(),

    reason: varchar({ length: 500 }),
    // The concession APPROVAL WORKFLOW is a recorded deferral — these columns
    // record the fact, the flow comes later.
    approvedBy: text().references(() => user.id),
    approvedAt: timestamp({ withTimezone: true }),

    validFrom: date().notNull(),
    // NULL = full year.
    validTo: date(),

    // `<feeHeadId>:<periodKey>` for every period this concession covers, fixed
    // when it is created: what was already paid then stays out, so it can
    // never drift as months get paid or created.
    coveredPeriods: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: feeConcessionStatusEnum().notNull().default("active"),
    voidedAt: timestamp({ withTimezone: true }),
    voidedBy: text().references(() => user.id),
    voidReason: varchar({ length: 500 }),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fee_concessions_assignment_idx").on(t.studentFeeAssignmentId),
    index("fee_concessions_school_idx").on(t.schoolId),
    index("fee_concessions_org_idx").on(t.organizationId),

    check("fee_concessions_value_positive", sql`"value" > 0`),
    check("fee_concessions_amount_non_negative", sql`"concession_amount" >= 0`),
    check(
      "fee_concessions_percentage_range",
      sql`"calculation_type" <> 'percentage' OR "value" <= 100`,
    ),
    check(
      "fee_concessions_validity_order",
      sql`"valid_to" IS NULL OR "valid_to" >= "valid_from"`,
    ),
  ],
);

export const feeSubscriptionStatusEnum = pgEnum("fee_subscription_status", [
  "active",
  "cancelled",
  "suspended",
]);

/**
 * An opt-in service priced OUTSIDE the class structure — transport ("Route
 * 3 — Dum Dum"), hostel, canteen. Priced per student per service, not per
 * class, which is exactly why it cannot be a structure line: structures
 * address classes, subscriptions address students.
 *
 * Each active subscription contributes its own installments at generation
 * time (F4), through the same `student_id`+`academic_year_id` dues surface.
 */
export const studentOptionalFeeSubscriptions = pgTable(
  "student_optional_fee_subscriptions",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentId: uuid()
      .notNull()
      .references(() => students.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    // Must be an `optional`-category head — a service-layer invariant the
    // contract enforces, since an enum value check here would duplicate it.
    feeHeadId: uuid()
      .notNull()
      .references(() => feeHeads.id),

    // "Route 3 - Dum Dum", "Hostel Block A"
    serviceDetail: varchar({ length: 255 }),
    monthlyAmount: numeric({ precision: 10, scale: 2 }).notNull(),
    annualAmount: numeric({ precision: 10, scale: 2 }).notNull(),

    subscribedFrom: date().notNull(),
    // NULL = full year.
    subscribedTo: date(),

    status: feeSubscriptionStatusEnum().notNull().default("active"),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("student_optional_fee_subscriptions_student_year_idx").on(
      t.studentId,
      t.academicYearId,
    ),
    index("student_optional_fee_subscriptions_school_idx").on(t.schoolId),
    index("student_optional_fee_subscriptions_org_idx").on(t.organizationId),
    // One running subscription per service: a second would bill a month twice.
    uniqueIndex("student_optional_fee_subscriptions_one_active_uq")
      .on(t.studentId, t.academicYearId, t.feeHeadId)
      .where(sql`status = 'active'`),
  ],
);

// ---------------------------------------------------------------------------
// The billing layer — 0011
// ---------------------------------------------------------------------------

export const feeInstallmentPaymentStatusEnum = pgEnum(
  "fee_installment_payment_status",
  ["unpaid", "partial", "paid", "waived", "cancelled"],
);

/**
 * WHAT IS OWED — the billing layer proper. Generated by the F4 engine from
 * structure lines × the year's terms (or months); amounts SNAPSHOTTED at
 * generation, so a structure revision touches only not-yet-generated rows.
 *
 * `balance_amount` is GENERATED (`net_amount - paid_amount`): the database
 * computes it, so no code path can store a balance that disagrees with its
 * own numbers — the same trick as the summary's percentage. `paid_amount` is
 * maintained by the collection flow (F5) inside the payment transaction.
 *
 * The late-fee trio separates what the rules SAY is accruing
 * (`late_fee_applicable`, computed live for display) from what was actually
 * FROZEN into receipts (`late_fee_charged`) and what management forgave
 * (`late_fee_waived`) — a rule change reaches the first column only.
 *
 * `waived` is a MANAGEMENT ACT (`fee_waiver:approve`), not an arithmetic
 * outcome — the reference's distinction, kept.
 */
export const feeInstallments = pgTable(
  "fee_installments",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    // NULL only for a one-off charge on a student who has no fee record.
    studentFeeAssignmentId: uuid().references(() => studentFeeAssignments.id),
    studentId: uuid()
      .notNull()
      .references(() => students.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    feeHeadId: uuid()
      .notNull()
      .references(() => feeHeads.id),
    // Populated exactly when the generating frequency was term-wise.
    termId: uuid().references(() => terms.id),

    // The due's identity: the schedule row's key, or `one:<uuid>` for a one-off.
    periodKey: varchar({ length: 60 }).notNull(),
    // "April 2025 Tuition Fee"
    description: varchar({ length: 150 }),

    // Snapshotted at generation time — see the table comment. `amount` is the
    // head's share for the period; `concession_amount` the apportioned
    // discount; `net_amount` their difference.
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    concessionAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    // Given at the counter. Kept apart from concessions, which recompute.
    discountAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    netAmount: numeric({ precision: 10, scale: 2 }).notNull(),

    dueDate: date().notNull(),
    // The calendar month/year this installment is FOR — set exactly on
    // monthly-frequency rows, NULL otherwise.
    periodMonth: smallint(),
    periodYear: smallint(),

    paidAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    // GENERATED ALWAYS AS net_amount - paid_amount — see the table comment.
    balanceAmount: numeric({ precision: 10, scale: 2 }).generatedAlwaysAs(
      sql`"net_amount" - "paid_amount"`,
    ),
    paymentStatus: feeInstallmentPaymentStatusEnum().notNull().default("unpaid"),

    lateFeeApplicable: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    lateFeeCharged: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    lateFeeWaived: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    // One-off charges such as a dress or notebook never attract a late fee.
    lateFeeExempt: boolean().notNull().default(false),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // The generator's idempotency anchor: a re-run matches on this triple and
    // fills only what is missing. Keyed on the period, not a position, so
    // editing a schedule can neither skip nor duplicate a due.
    uniqueIndex("fee_installments_assignment_head_period_uq").on(
      t.studentFeeAssignmentId,
      t.feeHeadId,
      t.periodKey,
    ),
    // The accountant's due list: "every unpaid installment due by date X".
    index("fee_installments_school_due_date_idx").on(t.schoolId, t.dueDate),
    index("fee_installments_student_year_idx").on(t.studentId, t.academicYearId),
    // The open-dues scan; the partial keeps cleared history out of it.
    index("fee_installments_open_status_idx")
      .on(t.schoolId, t.paymentStatus)
      .where(sql`payment_status IN ('unpaid', 'partial')`),
    index("fee_installments_assignment_idx").on(t.studentFeeAssignmentId),
    index("fee_installments_org_idx").on(t.organizationId),

    check("fee_installments_amount_non_negative", sql`"amount" >= 0`),
    check(
      "fee_installments_net_matches_parts",
      sql`"net_amount" = "amount" - "concession_amount" - "discount_amount"`,
    ),
    // Backstop under the apportionment clamp: the maths caps each head's
    // concession TOTAL at its annual amount, but the database holds the line
    // even if a future code path forgets — dues can zero, never invert.
    check(
      "fee_installments_net_non_negative",
      sql`"net_amount" >= 0`,
    ),
    check(
      "fee_installments_concession_capped",
      sql`"concession_amount" + "discount_amount" <= "amount"`,
    ),
    check(
      "fee_installments_paid_capped",
      sql`"paid_amount" <= "net_amount" OR "payment_status" IN ('waived', 'cancelled')`,
    ),
    check(
      "fee_installments_month_shape",
      sql`"period_month" IS NULL OR "period_month" BETWEEN 1 AND 12`,
    ),
  ],
);

export const openingBalanceStatusEnum = pgEnum("opening_balance_status", [
  "unpaid",
  "partial",
  "paid",
  "waived",
  "cancelled",
]);

/**
 * DUES CARRIED FORWARD, tagged with the year they came FROM, or with no origin
 * when they predate the school's use of the app. Deliberately separate from the
 * current year's assignment —
 * last year's dues must stay auditable as last year's even while sitting on
 * this year's statement, and per-year fee structures must not absorb them.
 */
export const openingBalances = pgTable(
  "opening_balances",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentId: uuid()
      .notNull()
      .references(() => students.id),
    // The NEW year the balance is carried into.
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    // The year the dues came from. NULL means from before the school used the
    // app, so there is no session to point at.
    originAcademicYearId: uuid().references(() => academicYears.id),

    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    // "Carried forward from 2024-25"
    description: varchar({ length: 255 }),

    paidAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    // GENERATED ALWAYS AS amount - paid_amount.
    balanceAmount: numeric({ precision: 10, scale: 2 }).generatedAlwaysAs(
      sql`"amount" - "paid_amount"`,
    ),
    status: openingBalanceStatusEnum().notNull().default("unpaid"),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("opening_balances_student_year_origin_uq")
      .on(t.studentId, t.academicYearId, t.originAcademicYearId)
      .nullsNotDistinct(),
    index("opening_balances_student_year_idx").on(t.studentId, t.academicYearId),
    index("opening_balances_org_idx").on(t.organizationId),

    // A carried-forward balance is by definition something owed — zero or
    // negative means nothing to carry, and the carry-forward flow should not
    // have created the row.
    check("opening_balances_amount_positive", sql`"amount" > 0`),
  ],
);

// ---------------------------------------------------------------------------
// The collection layer — 0011
// ---------------------------------------------------------------------------

export const feePaymentModeEnum = pgEnum("fee_payment_mode", [
  "cash",
  "upi",
  "cheque",
  "neft_rtgs",
  "card",
  "dd", // demand draft
  "online_portal", // reserved for the gateway era (ADR-009) — not written yet
]);

export const feePaymentStatusEnum = pgEnum("fee_payment_status", [
  "pending", // UPI/cheque not yet confirmed
  "cleared", // confirmed money received
  "bounced", // cheque bounce
  "reversed", // UPI reversal / refund
  "cancelled",
]);

/**
 * WHAT ACTUALLY ARRIVED — decoupled from installments (DOMAIN.md §5): one
 * payment may cover several installments (a quarterly lump sum) or part of
 * one, joined through `payment_allocations`.
 *
 * `receipt_number` is sequential per school, immutable, never reused —
 * claimed from `receipt_number_sequences` under `SELECT … FOR UPDATE` inside
 * the payment transaction; the `uq_receipt` unique index is the backstop,
 * not the mechanism. `late_fee_amount` is FROZEN at payment time (a later
 * rule change cannot alter a past receipt); `total_amount` is GENERATED.
 *
 * Status is a LIFECYCLE moved only by named service operations (F5's
 * clear/bounce/reverse/cancel) — there is no free-form status PATCH anywhere.
 * A bounce is a real accounting event: a `Cheque_Bounce_Charge` ledger row
 * and re-opened installment balances.
 *
 * `client_reference` is the IDEMPOTENCY KEY (money-safety layer 7): a
 * double-click or a network retry on `recordPayment` must return the
 * original receipt, not write a second one. Unique per school where present;
 * the gateway's order id becomes the key in the portal era, which is why the
 * column lands now, not later.
 */
export const feePayments = pgTable(
  "fee_payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentId: uuid()
      .notNull()
      .references(() => students.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),

    receiptNumber: varchar({ length: 50 }).notNull(),

    // The principal collected; CHECKed > 0 — a zero payment is not a payment.
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    // Late fee frozen at payment time — immune to future rule changes.
    lateFeeAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    // Taken off at the counter; never cash, and undone if the payment fails.
    discountAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    // GENERATED ALWAYS AS amount + late_fee_amount.
    totalAmount: numeric({ precision: 10, scale: 2 }).generatedAlwaysAs(
      sql`"amount" + "late_fee_amount"`,
    ),

    paymentDate: date().notNull(),
    paymentMode: feePaymentModeEnum().notNull(),

    // Non-cash provenance: UPI ref, cheque number, NEFT UTR.
    transactionReference: varchar({ length: 150 }),
    bankName: varchar({ length: 100 }),
    // For post-dated cheques.
    chequeDate: date(),

    paymentStatus: feePaymentStatusEnum().notNull().default("cleared"),
    statusUpdatedAt: timestamp({ withTimezone: true }),
    statusUpdatedBy: text().references(() => user.id),
    // Bounce reason, reversal reason.
    statusReason: varchar({ length: 255 }),

    remarks: varchar({ length: 500 }),
    // The staff member who collected / entered it.
    collectedBy: text().references(() => user.id),

    // The idempotency key — see the table comment.
    clientReference: varchar({ length: 150 }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // The backstop under the FOR UPDATE claim — if the sequence mechanism is
    // ever bypassed, two same-numbered receipts cannot BOTH land.
    uniqueIndex("fee_payments_school_receipt_uq").on(t.schoolId, t.receiptNumber),
    // The idempotency backstop: one client_reference per school, only when
    // present (the column is nullable — counter collections may omit it).
    uniqueIndex("fee_payments_school_client_reference_uq")
      .on(t.schoolId, t.clientReference)
      .where(sql`client_reference IS NOT NULL`),
    index("fee_payments_student_year_idx").on(t.studentId, t.academicYearId),
    index("fee_payments_school_date_idx").on(t.schoolId, t.paymentDate),
    index("fee_payments_school_status_idx").on(t.schoolId, t.paymentStatus),
    index("fee_payments_org_idx").on(t.organizationId),

    check("fee_payments_amount_positive", sql`"amount" > 0`),
    check("fee_payments_late_fee_non_negative", sql`"late_fee_amount" >= 0`),
    check("fee_payments_discount_non_negative", sql`"discount_amount" >= 0`),
  ],
);

/**
 * THE JOIN between money received and debts owed — many-to-many by design.
 * One row per (payment, installment) pair; the pair's uniqueness is what lets
 * the collection flow read "this payment already touched that installment"
 * as a fact, not a query. Immutable after creation: a bounce re-opens
 * balances without rewriting the allocation history.
 */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    paymentId: uuid()
      .notNull()
      .references(() => feePayments.id),
    installmentId: uuid()
      .notNull()
      .references(() => feeInstallments.id),

    amountAllocated: numeric({ precision: 10, scale: 2 }).notNull(),
    // What this payment charged on this due, so a bounce undoes exactly that.
    lateFeeAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    lateFeeWaived: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
    discountAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_allocations_payment_installment_uq").on(
      t.paymentId,
      t.installmentId,
    ),
    index("payment_allocations_payment_idx").on(t.paymentId),
    index("payment_allocations_installment_idx").on(t.installmentId),
    index("payment_allocations_org_idx").on(t.organizationId),

    // Zero is valid when a discount covers the whole due.
    check("payment_allocations_amount_non_negative", sql`"amount_allocated" >= 0`),
  ],
);

export const feeRefundStatusEnum = pgEnum("fee_refund_status", [
  "pending",
  "processed",
  "failed",
]);

export const feeRefundModeEnum = pgEnum("fee_refund_mode", [
  "cash",
  "upi",
  "cheque",
  "neft_rtgs",
  "dd",
]);

/**
 * Money going back OUT, always referencing the ORIGINAL payment — never a
 * delete or overwrite of it (hard rules 2 and 3). Validated in F5 against
 * what that payment actually contributed: you cannot refund more than a
 * payment gave. The refund writes its own `Fee_Refund` ledger row and
 * re-opens the installment balances the payment had reduced.
 */
export const feeRefunds = pgTable(
  "fee_refunds",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentId: uuid()
      .notNull()
      .references(() => students.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    originalPaymentId: uuid()
      .notNull()
      .references(() => feePayments.id),

    refundAmount: numeric({ precision: 10, scale: 2 }).notNull(),
    refundDate: date().notNull(),
    refundMode: feeRefundModeEnum().notNull(),
    transactionReference: varchar({ length: 150 }),
    reason: varchar({ length: 500 }).notNull(),

    status: feeRefundStatusEnum().notNull().default("processed"),

    approvedBy: text().references(() => user.id),
    processedBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fee_refunds_payment_idx").on(t.originalPaymentId),
    index("fee_refunds_student_idx").on(t.studentId),
    index("fee_refunds_school_idx").on(t.schoolId),
    index("fee_refunds_org_idx").on(t.organizationId),

    check("fee_refunds_amount_positive", sql`"refund_amount" > 0`),
  ],
);

// ---------------------------------------------------------------------------
// The ledger — 0011
// ---------------------------------------------------------------------------

export const financialTransactionTypeEnum = pgEnum("financial_transaction_type", [
  "fee_payment",
  "fee_refund",
  "late_fee_charged",
  "concession_applied",
  "waiver_applied",
  "opening_balance",
  "opening_balance_payment",
  "advance_payment",
  "cheque_bounce_charge",
  // Offsets the credits of a pending payment cancelled before it cleared (ADR-049).
  "payment_cancelled",
  // Reserved for the deposits era (recorded deferral — not written yet).
  "security_deposit_received",
  "security_deposit_refunded",
]);

export const financialTransactionDirectionEnum = pgEnum(
  "financial_transaction_direction",
  ["credit", "debit"],
);

/**
 * THE UNIFIED, APPEND-ONLY LEDGER — hard rule 3's home. Every money movement
 * writes a row here; NOTHING ever updates or deletes one (corrections are new
 * offsetting rows, like double-entry bookkeeping). The table deliberately has
 * NO `updated_at` column: a ledger row's past is its only value.
 *
 * The immutability is not an application rule — it is a HAND-WRITTEN TRIGGER
 * in migration 0011 (`financial_transactions_append_only_trg`: BEFORE UPDATE
 * OR DELETE → RAISE EXCEPTION), because an application-only rule protects
 * nothing at 2am with psql open. `pnpm db:verify` proves the trigger bites.
 *
 * This is the single table accountants, Tally exporters and GST reporters
 * query — no union across payments, refunds and concessions. `reference_id` +
 * `reference_table` point back at the source row without a FK (the target
 * varies by row); `receipt_number` is denormalised for the receipt-first
 * lookup. `direction`: `credit` = money in, `debit` = money out / reduction.
 */
export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    // NULL is legitimate: some movements are not student-borne.
    studentId: uuid().references(() => students.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),

    transactionType: financialTransactionTypeEnum().notNull(),
    direction: financialTransactionDirectionEnum().notNull(),

    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    feeHeadId: uuid().references(() => feeHeads.id),
    // The source row (payment id, refund id, …) — no FK, the target varies.
    referenceId: uuid(),
    referenceTable: varchar({ length: 50 }),
    // Denormalised from the payment for quick receipt lookup.
    receiptNumber: varchar({ length: 50 }),

    description: varchar({ length: 500 }),
    transactionDate: date().notNull(),

    // GST flags only in v1 (recorded deferral: no tax reporting).
    isTaxable: boolean().notNull().default(false),
    taxAmount: numeric({ precision: 10, scale: 2 }).notNull().default("0"),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // NO updated_at — this table is append-only. See the table comment.
  },
  (t) => [
    index("financial_transactions_school_date_idx").on(t.schoolId, t.transactionDate),
    index("financial_transactions_student_year_idx").on(t.studentId, t.academicYearId),
    index("financial_transactions_school_type_idx").on(t.schoolId, t.transactionType),
    index("financial_transactions_org_idx").on(t.organizationId),
    index("financial_transactions_school_receipt_idx").on(t.schoolId, t.receiptNumber),

    check("financial_transactions_amount_positive", sql`"amount" > 0`),
  ],
);

/**
 * THE RECEIT COUNTER — one row per school per year, claimed with
 * `SELECT … FOR UPDATE` inside the payment transaction so two concurrent
 * cashiers serialize (the plan's money-safety layer 2). Formatted receipts
 * (`RCP-2030-00042`: prefix + year + zero-padded number); the `fee_payments`
 * unique index is the backstop, not the mechanism. Created lazily by the
 * first payment of a school-year — no seed-time row.
 */
export const receiptNumberSequences = pgTable(
  "receipt_number_sequences",
  {
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    lastNumber: integer().notNull().default(0),
    prefix: varchar({ length: 20 }).notNull().default("RCP"),

    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // The composite primary key IS the per-school-per-year counter identity.
    primaryKey({ columns: [t.schoolId, t.academicYearId] }),
  ],
);

// ---------------------------------------------------------------------------
// Resolution/billing/collection/ledger relations
// ---------------------------------------------------------------------------

export const studentFeeAssignmentRelations = relations(
  studentFeeAssignments,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [studentFeeAssignments.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [studentFeeAssignments.schoolId],
      references: [schools.id],
    }),
    student: one(students, {
      fields: [studentFeeAssignments.studentId],
      references: [students.id],
    }),
    enrollment: one(studentEnrollments, {
      fields: [studentFeeAssignments.enrollmentId],
      references: [studentEnrollments.id],
    }),
    academicYear: one(academicYears, {
      fields: [studentFeeAssignments.academicYearId],
      references: [academicYears.id],
    }),
    feeStructure: one(feeStructures, {
      fields: [studentFeeAssignments.feeStructureId],
      references: [feeStructures.id],
    }),
    concessions: many(feeConcessions),
    installments: many(feeInstallments),
  }),
);

export const feeConcessionRelations = relations(feeConcessions, ({ one }) => ({
  organization: one(organizations, {
    fields: [feeConcessions.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [feeConcessions.schoolId],
    references: [schools.id],
  }),
  assignment: one(studentFeeAssignments, {
    fields: [feeConcessions.studentFeeAssignmentId],
    references: [studentFeeAssignments.id],
  }),
  feeHead: one(feeHeads, {
    fields: [feeConcessions.feeHeadId],
    references: [feeHeads.id],
  }),
}));

export const studentOptionalFeeSubscriptionRelations = relations(
  studentOptionalFeeSubscriptions,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [studentOptionalFeeSubscriptions.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [studentOptionalFeeSubscriptions.schoolId],
      references: [schools.id],
    }),
    student: one(students, {
      fields: [studentOptionalFeeSubscriptions.studentId],
      references: [students.id],
    }),
    academicYear: one(academicYears, {
      fields: [studentOptionalFeeSubscriptions.academicYearId],
      references: [academicYears.id],
    }),
    feeHead: one(feeHeads, {
      fields: [studentOptionalFeeSubscriptions.feeHeadId],
      references: [feeHeads.id],
    }),
  }),
);

export const feeInstallmentRelations = relations(feeInstallments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [feeInstallments.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [feeInstallments.schoolId],
    references: [schools.id],
  }),
  assignment: one(studentFeeAssignments, {
    fields: [feeInstallments.studentFeeAssignmentId],
    references: [studentFeeAssignments.id],
  }),
  student: one(students, {
    fields: [feeInstallments.studentId],
    references: [students.id],
  }),
  academicYear: one(academicYears, {
    fields: [feeInstallments.academicYearId],
    references: [academicYears.id],
  }),
  feeHead: one(feeHeads, {
    fields: [feeInstallments.feeHeadId],
    references: [feeHeads.id],
  }),
  term: one(terms, {
    fields: [feeInstallments.termId],
    references: [terms.id],
  }),
  allocations: many(paymentAllocations),
}));

export const openingBalanceRelations = relations(openingBalances, ({ one }) => ({
  organization: one(organizations, {
    fields: [openingBalances.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [openingBalances.schoolId],
    references: [schools.id],
  }),
  student: one(students, {
    fields: [openingBalances.studentId],
    references: [students.id],
  }),
  academicYear: one(academicYears, {
    fields: [openingBalances.academicYearId],
    references: [academicYears.id],
  }),
  originAcademicYear: one(academicYears, {
    fields: [openingBalances.originAcademicYearId],
    references: [academicYears.id],
  }),
}));

export const feePaymentRelations = relations(feePayments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [feePayments.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [feePayments.schoolId],
    references: [schools.id],
  }),
  student: one(students, {
    fields: [feePayments.studentId],
    references: [students.id],
  }),
  academicYear: one(academicYears, {
    fields: [feePayments.academicYearId],
    references: [academicYears.id],
  }),
  allocations: many(paymentAllocations),
  refunds: many(feeRefunds),
}));

export const paymentAllocationRelations = relations(paymentAllocations, ({ one }) => ({
  organization: one(organizations, {
    fields: [paymentAllocations.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [paymentAllocations.schoolId],
    references: [schools.id],
  }),
  payment: one(feePayments, {
    fields: [paymentAllocations.paymentId],
    references: [feePayments.id],
  }),
  installment: one(feeInstallments, {
    fields: [paymentAllocations.installmentId],
    references: [feeInstallments.id],
  }),
}));

export const feeRefundRelations = relations(feeRefunds, ({ one }) => ({
  organization: one(organizations, {
    fields: [feeRefunds.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [feeRefunds.schoolId],
    references: [schools.id],
  }),
  student: one(students, {
    fields: [feeRefunds.studentId],
    references: [students.id],
  }),
  academicYear: one(academicYears, {
    fields: [feeRefunds.academicYearId],
    references: [academicYears.id],
  }),
  originalPayment: one(feePayments, {
    fields: [feeRefunds.originalPaymentId],
    references: [feePayments.id],
  }),
}));

export const financialTransactionRelations = relations(
  financialTransactions,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [financialTransactions.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [financialTransactions.schoolId],
      references: [schools.id],
    }),
    student: one(students, {
      fields: [financialTransactions.studentId],
      references: [students.id],
    }),
    academicYear: one(academicYears, {
      fields: [financialTransactions.academicYearId],
      references: [academicYears.id],
    }),
    feeHead: one(feeHeads, {
      fields: [financialTransactions.feeHeadId],
      references: [feeHeads.id],
    }),
  }),
);
