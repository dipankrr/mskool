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
import { organizations, schools } from "./organization";
import { students } from "./people";

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
 * `category` (reference SQL table 13) separates the co-scholastic pipeline
 * (ADR on exams; DOMAIN.md "separate pipeline, grades only"). It is a
 * CREATION-TIME seed only: the result flags it used to carry live on
 * `class_subject_mappings` (ADR-031), so `category` must never be derived
 * from at read time — Class 1 Maths is scholastic yet excluded from totals.
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

export const teacherAssignmentRoleEnum = pgEnum("teacher_assignment_role", [
  "class_teacher",
  "subject_teacher",
  "co_teacher",
  "activity_teacher",
]);

/**
 * WHICH SUBJECTS A CLASS TAKES IN A GIVEN YEAR — the template layer.
 *
 * `subjects` is the school-wide catalogue; THIS table is "Class 6 studies
 * Mathematics in 2025-26". One row per (year, class, subject) — the is_elective
 * flag is what says "not every student is auto-assigned this one", and the
 * auto-generation of `student_subject_enrollments` starts from here
 * (reference SQL table 16).
 *
 * NOT a scope node (hard rule 12 names school/class/section only), so no
 * scope_nodes row and no transaction. The unique (year, class, subject) triple
 * is what prevents "Physics twice for Class 6" — the same name collision the
 * subjects table handles at school level, one level down.
 *
 * `subject_group_id` from the reference (CBSE/ICSE grouping) is deliberately
 * absent — `subject_groups` does not exist yet and grouping is an
 * exams-phase need (see this plan's S2 header). The FK would be a second
 * ALTER like the reference itself performs.
 *
 * The RESULT FLAGS live here, not on `subjects` (ADR-031): they answer
 * "does THIS class's Maths count THIS year?", which differs per class and per
 * year, so they live on the per-(year, class, subject) row. The reference
 * SQL's `exam_subject_schedules` override ("inherited from subject but can be
 * overridden per schedule") is deliberately superseded — an exam that
 * disagrees with its term's sibling would leave the annual rollup without a
 * defined answer. The exam chain reads THIS row, and only this row.
 */
export const classSubjectMappings = pgTable(
  "class_subject_mappings",
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
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id),

    // false = excluded from totals and pass calculation for every student
    // taking this subject in this class this year. NOT the best-5/elective
    // counting rule (per-student, an exams-phase aggregation policy) and NOT
    // per-student exemption (`student_subject_results.is_exempted`).
    countsTowardResult: boolean().notNull().default(true),
    // true = no numeric marks; a grade is entered directly (Art, PE).
    // Two INDEPENDENT booleans — all four combinations are legitimate
    // (Class 1 Maths: numeric but excluded; Art: counted but graded-only) —
    // so never collapse them into a mode enum.
    isGradedOnly: boolean().notNull().default(false),

    // true = NOT auto-assigned to every student; the class-count list that
    // matters for the template is "core subjects every child takes".
    isElective: boolean().notNull().default(false),
    // Display order on the report card — "0" first, ascending.
    sequenceNumber: smallint().notNull().default(0),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("class_subject_mappings_year_class_subject_uq").on(
      t.academicYearId,
      t.classId,
      t.subjectId,
    ),
    index("class_subject_mappings_class_year_idx").on(t.classId, t.academicYearId),
    index("class_subject_mappings_school_idx").on(t.schoolId),
    index("class_subject_mappings_org_idx").on(t.organizationId),
  ],
);

/**
 * WHO TEACHES WHAT, WHERE, WHEN — the delivery layer. The fact
 * `checkSubjectAccess` (ADR-012) reads when marks arrive.
 *
 * A NEW row every time a teacher's assignment changes — ending or replacing
 * one closes the old row (`effectiveTo` = the handover day) and inserts the
 * successor. That makes `subjectId` nullable-with-a-role-rule rather than
 * optional: a Class Teacher or Co-Teacher has no subject, a Subject Teacher
 * must have exactly one. Enforced by `sta_subject_matches_role` below, so a
 * row that breaks the rule is rejected by the database, not by the app's
 * good intentions.
 *
 * ADR-012's boundary, worth restating where the table lives: this is the
 * TIMETABLE fact. What a person may DO is `role_assignments`. `checkSubjectAccess`
 * reads both — the authorization question is "does a live assignment row say
 * the caller teaches this section/subject?"; it never GRANTS from here.
 */
export const sectionTeacherAssignments = pgTable(
  "section_teacher_assignments",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    // Section implies the year (a section IS year-scoped), yet the year is
    // kept denormalised like every academic table — a query for "who taught
    // 6-A last term" should not have to join through the section.
    sectionId: uuid()
      .notNull()
      .references(() => sections.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),

    // text, not uuid — better-auth owns the user table (hard rule 10).
    userId: text()
      .notNull()
      .references(() => user.id),

    role: teacherAssignmentRoleEnum().notNull(),
    // Populated iff role = 'subject_teacher' — see the CHECK constraint.
    subjectId: uuid().references(() => subjects.id),

    // NULL = currently active. A date-range model, not a status flag: "who
    // taught this in September" is answerable without ever touching the past.
    effectiveFrom: date().notNull().default(sql`CURRENT_DATE`),
    effectiveTo: date(),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // The subject/role pairing is a structural invariant, not a preference:
    // a subject-scoped teacher WITH no subject would be denied every subject;
    // a class teacher WITH one would be offered a scope she cannot fill.
    check(
      "sta_subject_matches_role",
      sql`(${t.role} = 'subject_teacher' AND ${t.subjectId} IS NOT NULL)
          OR (${t.role} <> 'subject_teacher' AND ${t.subjectId} IS NULL)`,
    ),
    index("section_teacher_assignments_section_idx").on(t.sectionId),
    index("section_teacher_assignments_user_idx").on(t.userId),
    index("section_teacher_assignments_school_idx").on(t.schoolId),
    index("section_teacher_assignments_org_idx").on(t.organizationId),
    // "Who is teaching here right now?" — the hot query, served by a small
    // index of only the open rows (reference table 11).
    index("section_teacher_assignments_active_idx")
      .on(t.sectionId)
      .where(sql`${t.effectiveTo} IS NULL`),
  ],
);

export const termResultModeEnum = pgEnum("term_result_mode", [
  "cumulative",
  "terminal",
]);

/**
 * The enrollment's life cycle (reference table 21, lowercased to house style).
 * ADMITTED — accepted, section not yet assigned (sectionId is nullable
 * precisely for this state); SECTION_ASSIGNED — section set, not yet
 * attending; ACTIVE — attending classes; TRANSFERRED_OUT — left mid-year with
 * a TC; WITHDRAWN — left without one; PASSED_OUT — completed the year. The
 * status machine itself is the service's concern (S5.2); the enum only makes
 * the states unrepresentable-as-typo.
 */
export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "admitted",
  "section_assigned",
  "active",
  "transferred_out",
  "withdrawn",
  "passed_out",
]);

/**
 * Set at year end after the final result (the exam chain's
 * `student_final_results → promotion_status → next year's enrollment`). NULL
 * until decided — a NOT NULL default would claim an answer nobody gave.
 */
export const promotionStatusEnum = pgEnum("promotion_status", [
  "pending",
  "promoted",
  "detained",
  "compartment",
  "promoted_with_improvement",
]);

/**
 * A subdivision of an academic year — "Term 1", "Term 2", or a single "Full
 * Year" row when a school does not split. Every year gets at least one term;
 * that invariant lives at the application layer (the reference SQL's own
 * note), because a database version would make a year impossible to create
 * before its terms.
 *
 * The exam computation chain reads `result_mode` (DOMAIN.md): cumulative
 * terms roll up into the annual result, terminal terms stand alone.
 *
 * A term's dates must sit INSIDE its parent year's dates. That is a
 * cross-table rule, which no CHECK constraint can express, so it lives in
 * hand-written migration SQL as a trigger (`terms_dates_within_year_trg`)
 * beside the academic_years EXCLUDE block — marked there like the EXCLUDEs,
 * because drizzle-kit cannot see it either. `pnpm db:verify` proves it still
 * bites after any migration change.
 */
export const terms = pgTable(
  "terms",
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

    // "Term 1", "First Term", "Full Year". Unique per YEAR with the sequence
    // below — every year of every school restarts at Term 1, so neither key
    // is per-school.
    name: varchar({ length: 100 }).notNull(),
    sequenceNumber: smallint().notNull(),

    startDate: date().notNull(),
    endDate: date().notNull(),

    // How this term contributes to the annual result.
    resultMode: termResultModeEnum().notNull().default("cumulative"),
    // Percentage weight toward the annual result (reference: DECIMAL(5,2)).
    // All terms of a year summing to 100 is a SOFT invariant no single-row
    // constraint can express: a CHECK that demanded it would make adding the
    // second term impossible. The term UI owns the sum; the row-level bound
    // is the terms_weightage_range CHECK below.
    weightage: numeric({ precision: 5, scale: 2 })
      .notNull()
      .default("100.00"),

    createdBy: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("terms_year_sequence_uq").on(t.academicYearId, t.sequenceNumber),
    index("terms_year_idx").on(t.academicYearId),
    index("terms_school_idx").on(t.schoolId),
    index("terms_org_idx").on(t.organizationId),
    check("terms_end_after_start", sql`"end_date" >= "start_date"`),
    check("terms_weightage_range", sql`"weightage" > 0 AND "weightage" <= 100`),
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
    terms: many(terms),
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

export const classSubjectMappingRelations = relations(
  classSubjectMappings,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [classSubjectMappings.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [classSubjectMappings.schoolId],
      references: [schools.id],
    }),
    academicYear: one(academicYears, {
      fields: [classSubjectMappings.academicYearId],
      references: [academicYears.id],
    }),
    class: one(classes, {
      fields: [classSubjectMappings.classId],
      references: [classes.id],
    }),
    subject: one(subjects, {
      fields: [classSubjectMappings.subjectId],
      references: [subjects.id],
    }),
  }),
);

export const sectionTeacherAssignmentRelations = relations(
  sectionTeacherAssignments,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [sectionTeacherAssignments.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [sectionTeacherAssignments.schoolId],
      references: [schools.id],
    }),
    section: one(sections, {
      fields: [sectionTeacherAssignments.sectionId],
      references: [sections.id],
    }),
    academicYear: one(academicYears, {
      fields: [sectionTeacherAssignments.academicYearId],
      references: [academicYears.id],
    }),
    user: one(user, {
      fields: [sectionTeacherAssignments.userId],
      references: [user.id],
    }),
    subject: one(subjects, {
      fields: [sectionTeacherAssignments.subjectId],
      references: [subjects.id],
    }),
  }),
);

export const termRelations = relations(terms, ({ one }) => ({
  organization: one(organizations, {
    fields: [terms.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [terms.schoolId],
    references: [schools.id],
  }),
  academicYear: one(academicYears, {
    fields: [terms.academicYearId],
    references: [academicYears.id],
  }),
}));

/**
 * STUDENT ENROLLMENTS — the year anchor (reference table 21). ONE row per
 * student per academic year; attendance, fees, and results all hang off it.
 *
 * **Hard rule 6 lives here.** Never mutated year-over-year: promotion inserts
 * a NEW row for the new year and the old row's `promotionStatus` records what
 * happened. The unique index below is the structural half of that rule — a
 * second row for the same (student, year) is unrepresentable — and the
 * service half (only inserts and status transitions, never rewrites of the
 * year/class/section identity) lands in S5.2.
 *
 * `sectionId` is NULLABLE deliberately: the ADMITTED state exists because
 * admissions open before sections are finalized. The unique index is on
 * (student, year) without the school — a student row belongs to exactly one
 * school by its own `school_id`, so the reference's third key is redundant
 * here; the cross-tenant parent-smuggling hole this table inherits (the FKs
 * on class/year/section do not mention school_id) is closed in the service by
 * the parent re-read, per the section-service pattern.
 *
 * NOT in the scope tree — no `scope_nodes` row (hard rule 12 names
 * school/class/section only). Carries the denormalised `organizationId` +
 * `schoolId` for `scopeWhere` like every academic table.
 */
export const studentEnrollments = pgTable(
  "student_enrollments",
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
    classId: uuid()
      .notNull()
      .references(() => classes.id),
    // Nullable until the section is assigned (the admitted state).
    sectionId: uuid().references(() => sections.id),

    // Assigned within the section; nullable until then.
    rollNumber: varchar({ length: 20 }),
    // Labels on the enrollment, which can differ from the section's defaults.
    stream: varchar({ length: 50 }),
    house: varchar({ length: 50 }),

    // Admissions open before the year does, so this is NOT CHECKed inside the
    // year's range — a constraint there would make early admission
    // unrepresentable.
    enrollmentDate: date().notNull().default(sql`CURRENT_DATE`),
    enrollmentStatus: enrollmentStatusEnum()
      .notNull()
      .default("admitted"),

    promotionStatus: promotionStatusEnum(),
    // TRUE while waiting for a supplementary result before the next year's
    // enrollment (the promotion flow reads it).
    promotionPending: boolean().notNull().default(false),

    // TRUE when this row came from an org/school bulk action (the promotion
    // rollover), not an individual admission.
    createdFromTemplate: boolean().notNull().default(false),

    createdBy: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // The year anchor, made unrepresentable: one enrollment per student per
    // year. A student row belongs to exactly one school (its own school_id),
    // so the reference's school_id in this triple is redundant.
    uniqueIndex("student_enrollments_student_year_uq").on(
      t.studentId,
      t.academicYearId,
    ),
    index("student_enrollments_school_year_idx").on(t.schoolId, t.academicYearId),
    index("student_enrollments_student_idx").on(t.studentId),
    index("student_enrollments_section_idx").on(t.sectionId),
    index("student_enrollments_class_year_idx").on(t.classId, t.academicYearId),
    index("student_enrollments_school_idx").on(t.schoolId),
    index("student_enrollments_org_idx").on(t.organizationId),
  ],
);

export const studentEnrollmentRelations = relations(
  studentEnrollments,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [studentEnrollments.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [studentEnrollments.schoolId],
      references: [schools.id],
    }),
    student: one(students, {
      fields: [studentEnrollments.studentId],
      references: [students.id],
    }),
    academicYear: one(academicYears, {
      fields: [studentEnrollments.academicYearId],
      references: [academicYears.id],
    }),
    class: one(classes, {
      fields: [studentEnrollments.classId],
      references: [classes.id],
    }),
    section: one(sections, {
      fields: [studentEnrollments.sectionId],
      references: [sections.id],
    }),
  }),
);
