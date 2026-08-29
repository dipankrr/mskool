import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { organizations, schools } from "./organization";

/**
 * ACADEMIC STRUCTURE — Phase 2 slice 1.
 *
 * Three tables, in dependency order: academic_years → classes → sections.
 *
 * Every table here carries BOTH `organizationId` and `schoolId`, even though
 * organizationId is reachable by joining through schools. That denormalisation
 * is not redundancy for its own sake — `scopeWhere()` requires an
 * organizationId column on the table it filters (see ScopeColumns), and hard
 * rule 1 means every query here goes through it. A join would move the tenancy
 * key out of the WHERE clause the compiler can see.
 */

export const academicYearStatusEnum = pgEnum("academic_year_status", [
  "upcoming",
  "active",
  "closing",
  "closed",
]);

/**
 * One row per school per year. The primary time scope for everything
 * time-bound: enrollment, attendance, fees, exams.
 *
 * Two constraints on this table cannot be expressed in Drizzle and live in
 * hand-written migration SQL (ADR-013): no overlapping date ranges per school
 * (`EXCLUDE USING gist`, needs the btree_gist extension), and at most one
 * current year per school (`EXCLUDE USING btree ... WHERE is_current`).
 * `pnpm db:verify` proves both actually reject the rows they target — do not
 * assume they survived a migration regeneration.
 *
 * NOT year-scoped by a parent: an academic year IS the year. It is the root of
 * the time dimension, and `sections` hang off it.
 */
export const academicYears = pgTable(
  "academic_years",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    // "2025-26". Display label, not parsed — schools in India name sessions
    // inconsistently and the dates below are the source of truth.
    name: varchar({ length: 20 }).notNull(),

    startDate: date().notNull(),
    endDate: date().notNull(),
    // Frozen at creation. `endDate` may be pushed out when a year is extended
    // (exams delayed, a monsoon closure); this preserves the original intent so
    // "was this year extended?" stays answerable.
    originalEndDate: date().notNull(),

    status: academicYearStatusEnum().notNull().default("upcoming"),
    // At most one per school — enforced by a partial exclusion constraint in
    // SQL, not here, because Drizzle cannot express a partial unique index as a
    // constraint the planner treats as exclusive.
    isCurrent: boolean().notNull().default(false),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Year names are unique per school, not per org — two branches of the same
    // trust both run a "2025-26".
    uniqueIndex("academic_years_school_name_uq").on(t.schoolId, t.name),
    index("academic_years_school_idx").on(t.schoolId),
    index("academic_years_org_idx").on(t.organizationId),

    // An inverted range is ALREADY refused today, but only as a side effect:
    // the no-overlap EXCLUDE constraint builds a daterange(), and daterange()
    // throws when lower > upper. That error names neither this table nor this
    // rule — it reads "range lower bound must be less than or equal to range
    // upper bound", which sends you looking at Postgres internals rather than
    // at the row you just tried to insert. Worse, it is incidental: narrow or
    // rewrite that constraint later and the guard silently disappears.
    //
    // Stated here it is a rule in its own right, and unlike the EXCLUDE
    // constraints drizzle-kit CAN see a check() — so this one survives a
    // migration regeneration instead of needing to be re-pasted (ADR-013).
    check(
      "academic_years_end_after_start",
      sql`"end_date" >= "start_date"`,
    ),
  ],
);

/**
 * A grade level: "Class 6". Deliberately NOT year-scoped — Class 6 is the same
 * rung of the ladder every year, and making it year-scoped would mean
 * re-creating every class annually and re-pointing every fee structure and
 * subject mapping at the new rows.
 *
 * Sections are where the year lives (see below).
 *
 * HARD RULE 12: creating a class MUST insert its `scope_nodes` row in the same
 * transaction. Miss it and every request for that class 403s.
 */
export const classes = pgTable(
  "classes",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    // "Class 6", "Grade 6", "Standard VI" — schools disagree, so this is free
    // text rather than an enum.
    name: varchar({ length: 100 }).notNull(),
    // Sort key. "Class 10" must not sort before "Class 2", and Nursery/LKG/UKG
    // have no numeral at all, so ordering cannot be derived from the name.
    numericOrder: smallint().notNull(),
    description: varchar({ length: 255 }),

    // Never hard-deleted (hard rule 2): historical enrollments, fee structures
    // and results all point here.
    isActive: boolean().notNull().default(true),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("classes_school_order_uq").on(t.schoolId, t.numericOrder),
    uniqueIndex("classes_school_name_uq").on(t.schoolId, t.name),
    index("classes_school_idx").on(t.schoolId),
    index("classes_org_idx").on(t.organizationId),
  ],
);

export const sectionShiftEnum = pgEnum("section_shift", [
  "morning",
  "day",
  "evening",
]);

export const sectionStatusEnum = pgEnum("section_status", [
  "active",
  "inactive",
]);

/**
 * A year-scoped subdivision of a class: 6-A in 2025-26.
 *
 * A NEW row every academic year, even for the same letter (hard rule 6's
 * sibling reasoning): 6-A in 2025-26 and 6-A in 2026-27 hold different
 * children, different teachers and different results. Reusing one row would
 * make last year's attendance and this year's indistinguishable.
 *
 * This is the deepest level of the authorization tree — a subject teacher is
 * typically scoped here.
 *
 * HARD RULE 12: creating a section MUST insert its `scope_nodes` row in the
 * same transaction, carrying its classId as ancestry.
 */
export const sections = pgTable(
  "sections",
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

    // "A", "B", "Morning", "Day".
    name: varchar({ length: 50 }).notNull(),

    // Labels only — no downstream logic branches on these. They exist because
    // report cards and ID cards print them.
    shift: sectionShiftEnum(),
    stream: varchar({ length: 50 }),
    house: varchar({ length: 50 }),

    maxStudents: smallint(),
    roomNumber: varchar({ length: 20 }),

    status: sectionStatusEnum().notNull().default("active"),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Scoped by year AND class: "A" recurs in every class and every year.
    uniqueIndex("sections_year_class_name_uq").on(
      t.academicYearId,
      t.classId,
      t.name,
    ),
    index("sections_class_year_idx").on(t.classId, t.academicYearId),
    index("sections_school_idx").on(t.schoolId),
    index("sections_org_idx").on(t.organizationId),
  ],
);

export const subjectCategoryEnum = pgEnum("subject_category", [
  "scholastic",
  "coscholastic",
  "vocational",
  "language",
]);

/**
 * A subject as one school teaches it: "Mathematics" with the school's own code
 * and category. School-scoped, NOT year-scoped — Maths is the same subject
 * every year; what changes yearly lives on sections and enrollments.
 *
 * Columns follow reference SQL table 13: `category` separates the co-scholastic
 * pipeline (ADR on exams; DOMAIN.md "separate pipeline, grades only"),
 * `countsTowardResult = false` excludes a subject from totals, and
 * `isGradedOnly` marks subjects with no numeric marks at all.
 *
 * NOT in the scope tree — no `scope_nodes` row (hard rule 12 names
 * school/class/section only). A teacher's subject authority is a
 * `section_teacher_assignments` fact (ADR-012), checked by `checkSubjectAccess`,
 * not by `can()`. The board-code catalog (`system_subject_catalog`) and its FK
 * arrive with the exams phase; the reference itself adds that FK by later ALTER.
 */
export const subjects = pgTable(
  "subjects",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    // "Mathematics", "हिन्दी". Unique per school — two branches of one trust
    // both run "Mathematics", and inside one school the name is the label
    // teachers pick from.
    name: varchar({ length: 150 }).notNull(),
    // "Maths", "Phy" — printed on timetables and report cards.
    shortName: varchar({ length: 20 }),
    // The school's own code ("MATH101"). Board-assigned codes (CBSE 041)
    // arrive with the catalog; this stays the school's local handle.
    code: varchar({ length: 20 }),

    category: subjectCategoryEnum().notNull().default("scholastic"),

    // false = excluded from totals and pass calculation (co-scholastic areas,
    // activity subjects). DOMAIN.md's report-card maths branches on this.
    countsTowardResult: boolean().notNull().default(true),
    // true = no numeric marks; a grade is entered directly (Art, PE).
    isGradedOnly: boolean().notNull().default(false),

    // Never hard-deleted (hard rule 2): results, fee structures and teacher
    // assignments all point here.
    isActive: boolean().notNull().default(true),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("subjects_school_name_uq").on(t.schoolId, t.name),
    index("subjects_school_idx").on(t.schoolId),
    index("subjects_org_idx").on(t.organizationId),
  ],
);

export const academicYearRelations = relations(
  academicYears,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [academicYears.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [academicYears.schoolId],
      references: [schools.id],
    }),
    sections: many(sections),
  }),
);

export const classRelations = relations(classes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [classes.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [classes.schoolId],
    references: [schools.id],
  }),
  sections: many(sections),
}));

export const sectionRelations = relations(sections, ({ one }) => ({
  organization: one(organizations, {
    fields: [sections.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [sections.schoolId],
    references: [schools.id],
  }),
  academicYear: one(academicYears, {
    fields: [sections.academicYearId],
    references: [academicYears.id],
  }),
  class: one(classes, {
    fields: [sections.classId],
    references: [classes.id],
  }),
}));

export const subjectRelations = relations(subjects, ({ one }) => ({
  organization: one(organizations, {
    fields: [subjects.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [subjects.schoolId],
    references: [schools.id],
  }),
}));
