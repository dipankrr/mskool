import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import {
  academicYears,
  classSubjectMappings,
  classes,
  promotionStatusEnum,
  sections,
  subjects,
  terms,
} from "./academic";
import { organizations, schools } from "./organization";
import { students } from "./people";

/**
 * EXAMS — Phase 5 (ADR-032).
 *
 * The domain's five layers, built across three migrations: 0013 brings the
 * POLICY CONFIG layer (subject types, grading scales + bands, pass criteria
 * — what a school's results mean), 0014 brings the BLUEPRINT + ENTRY layers
 * (exams, schedules, components; eligibility, component results, revisions,
 * term assessments), and 0015 brings the COMPUTED CHAIN + PUBLICATION layers
 * (subject/term/final results, templates, published cards, per-class
 * publication records) plus the two ADR-013 triggers.
 *
 * The domain's shape (ADR-032): entered data is sacred (`student_component_
 * results` is the only human-written marks table), computed layers are
 * disposable math over it, and published cards are frozen JSONB photographs
 * (`published_report_cards`) — the only table the student portal reads
 * (hard rule 8). Post-publication corrections go through
 * `student_component_result_revisions` first (hard rule 7).
 *
 * Every table carries BOTH `organizationId` and `schoolId` for `scopeWhere`
 * (hard rule 1). Marks are `numeric(6,2)` — half-marks and, under negative
 * marking, negatives — STRING in code, never float (hard rule 4's cousin).
 *
 * Subject typing is board-neutral (ADR-032): `subject_types` is a
 * school-defined table that owns the result flags + the report-card widget;
 * the reference SQL's CBSE category/area enums do not exist here.
 */

// ---------------------------------------------------------------------------
// The policy config layer — 0013
//
// `subject_types` + `subject_assessment_mode` live in academic.ts beside the
// class-subject mapping that references them (an ESM import cycle would
// break the barrel otherwise — ADR-032 §1). They are still exam-domain
// tables: migration 0013 carries them.
// ---------------------------------------------------------------------------

export const gradingScaleModeEnum = pgEnum("grading_scale_mode", [
  // Marks fall into fixed percentage bands — 91-100 is A1 for everyone.
  "fixed_range",
  // Grades assigned by class position (top 5% get A1) — reserved for board
  // use; ADR-032 rejects it in v1 and the service refuses to create one.
  "percentile_rank",
]);

/**
 * A school's grading policy — "CBSE 8-point". Bands are PERCENTAGES
 * (contiguous 0–100, validated gap/overlap-free), so one scale grades
 * subjects with any max_marks.
 *
 * `isLocked` flips true on first use by a `student_subject_results` row
 * (ADR-013 trigger, migration 0015) — a scale a result has used can never
 * change, or history would silently restate. To change policy, create a new
 * scale. `isDefault` names the school's everyday scale (one per school,
 * partial unique below); per-component overrides stay possible on
 * `exam_components.gradingScaleId` (the ICSE case).
 */
export const gradingScales = pgTable(
  "grading_scales",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    name: varchar({ length: 100 }).notNull(),
    description: varchar({ length: 255 }),

    mode: gradingScaleModeEnum().notNull().default("fixed_range"),

    // The school's everyday scale — the one compute grades against unless a
    // component overrides. ONE per school (partial unique below).
    isDefault: boolean().notNull().default(false),

    isActive: boolean().notNull().default(true),
    // Set by the ADR-013 trigger on first use; after that, immutability is
    // the point. Service guards band/type edits on a locked scale too.
    isLocked: boolean().notNull().default(false),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("grading_scales_school_name_uq").on(t.schoolId, t.name),
    uniqueIndex("grading_scales_school_default_uq")
      .on(t.schoolId)
      .where(sql`is_default = true`),
    index("grading_scales_school_idx").on(t.schoolId),
    index("grading_scales_org_idx").on(t.organizationId),
  ],
);

/**
 * One band of a scale — "81–90 → A2 → 9.0 → Outstanding". Bounds are
 * PERCENTAGES of whatever max_marks the subject used (ADR-032 §5), and the
 * service validates that a scale's bands are contiguous 0–100 with no gaps
 * or overlaps — a percentage must always land in exactly one band.
 */
export const gradingScaleBands = pgTable(
  "grading_scale_bands",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    gradingScaleId: uuid()
      .notNull()
      .references(() => gradingScales.id),

    minMarks: numeric({ precision: 5, scale: 2 }).notNull(),
    maxMarks: numeric({ precision: 5, scale: 2 }).notNull(),
    gradeLabel: varchar({ length: 10 }).notNull(),
    // Null when a band is descriptive-only (never in a fixed_range school's
    // real scale — the GPA branch needs points on every counted band).
    gradePoint: numeric({ precision: 4, scale: 2 }),
    descriptor: varchar({ length: 100 }),

    sequenceNumber: smallint().notNull().default(0),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("grading_scale_bands_scale_label_uq").on(
      t.gradingScaleId,
      t.gradeLabel,
    ),
    index("grading_scale_bands_scale_idx").on(t.gradingScaleId),
    check(
      "grading_scale_bands_bounds",
      sql`min_marks >= 0 AND max_marks <= 100 AND max_marks >= min_marks`,
    ),
    check(
      "grading_scale_bands_point_range",
      sql`grade_point IS NULL OR (grade_point >= 0 AND grade_point <= 100)`,
    ),
  ],
);

/**
 * What "passing a year" means — the school default, overridable per class
 * (the class row wins; resolution is service-side). One row per school per
 * year (classId NULL) plus optional per-class rows per year; the partial
 * unique indexes name each rule exactly (Postgres treats NULLs as distinct
 * in a plain UNIQUE — the attendance_summary lesson).
 *
 * Grace marks RESCUE a failing subject up to the pass line — never past it
 * — within the per-subject and total caps. The compartment cap decides
 * "one re-exam chance" vs "repeat the year" (ADR-032 §10 evaluation order).
 */
export const passCriteria = pgTable(
  "pass_criteria",
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
    // NULL = the school-year default row; set = the class override.
    classId: uuid().references(() => classes.id),

    // NULL = every counted subject must pass.
    minSubjectsToPass: smallint(),
    mandatoryPassSubjectIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),

    graceMarksAllowed: boolean().notNull().default(false),
    maxGracePerSubject: numeric({ precision: 5, scale: 2 }),
    maxGraceTotal: numeric({ precision: 5, scale: 2 }),

    compartmentAllowed: boolean().notNull().default(false),
    maxSubjectsForCompartment: smallint(),

    minAttendancePct: numeric({ precision: 5, scale: 2 })
      .notNull()
      .default("75.00"),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // School default: one per school per year. Class override: one per
    // class per year. Two partial indexes, because NULLs are distinct.
    uniqueIndex("pass_criteria_school_year_default_uq")
      .on(t.schoolId, t.academicYearId)
      .where(sql`class_id IS NULL`),
    uniqueIndex("pass_criteria_school_year_class_uq")
      .on(t.schoolId, t.academicYearId, t.classId)
      .where(sql`class_id IS NOT NULL`),
    index("pass_criteria_school_year_idx").on(t.schoolId, t.academicYearId),
    index("pass_criteria_org_idx").on(t.organizationId),
    check(
      "pass_criteria_attendance_range",
      sql`min_attendance_pct >= 0 AND min_attendance_pct <= 100`,
    ),
    check(
      "pass_criteria_grace_caps_present",
      sql`NOT grace_marks_allowed OR (max_grace_per_subject IS NOT NULL AND max_grace_total IS NOT NULL)`,
    ),
    check(
      "pass_criteria_compartment_cap_present",
      sql`NOT compartment_allowed OR max_subjects_for_compartment IS NOT NULL`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// The exam blueprint layer — 0014
// ---------------------------------------------------------------------------

export const examTypeEnum = pgEnum("exam_type", [
  "regular", // the term's real examination
  "supplementary", // second chance; links back via linkedExamId
  "improvement", // rewrite-for-a-better-mark; links back via linkedExamId
  "mock", // practice — runs the full pipeline, never counts (see countsTowardTermResult)
]);

export const examStatusEnum = pgEnum("exam_status", [
  "draft", // being assembled
  "scheduled", // dates/venues fixed; eligibility computed
  "ongoing", // papers are happening
  "marks_entry", // entry grids open
  "under_verification", // entered; review/verify in progress
  "published", // every class's publication record exists; cards are live
  "locked", // terminal — even corrections are closed
]);

/**
 * One examination — "Term 1 Final, March 2027". Spans every class it
 * schedules; the operational unit (timetable, entry, verification) while
 * the TERM stays the reporting unit (ADR-032 §4).
 *
 * `weightageInTerm`: how much this exam counts toward its term's subject
 * scores; the SERVICE validates that counting exams (`countsTowardTermResult`)
 * of a term sum to 100. Mocks are exempt from the sum — they run the whole
 * pipeline and count for nothing. Strict coverage validation also lives in
 * the service: every counted subject of a class appears in every counting
 * exam (ADR-032 §4 — strict-first is additive-safe).
 *
 * The status machine is an explicit transition map with preconditions
 * (ADR-032 §4); transitions are a service decision, never a column edit.
 */
export const exams = pgTable(
  "exams",
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
    termId: uuid()
      .notNull()
      .references(() => terms.id),

    name: varchar({ length: 150 }).notNull(),
    examType: examTypeEnum().notNull().default("regular"),
    // Supplementary/improvement link back to the exam they redeem.
    linkedExamId: uuid().references((): AnyPgColumn => exams.id),
    supplementaryCappedAtPass: boolean().notNull().default(false),

    weightageInTerm: numeric({ precision: 5, scale: 2 })
      .notNull()
      .default("100.00"),
    countsTowardTermResult: boolean().notNull().default(true),

    allowsNegativeMarking: boolean().notNull().default(false),

    status: examStatusEnum().notNull().default("draft"),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("exams_school_term_name_uq").on(t.schoolId, t.termId, t.name),
    index("exams_term_idx").on(t.termId),
    index("exams_year_idx").on(t.academicYearId),
    index("exams_school_status_idx").on(t.schoolId, t.status),
    index("exams_org_idx").on(t.organizationId),
    check(
      "exams_weightage_range",
      sql`weightage_in_term > 0 AND weightage_in_term <= 100`,
    ),
  ],
);

/**
 * Which subject each class (or one section — NULL means all sections of the
 * class) writes, when, where. The marks-entry cohort per schedule is the
 * section's active enrollments; subject membership is resolved by the
 * compute resolver (ADR-032 §12 — v1: every counted mapping applies).
 *
 * NO `counts_towards_result`/`is_graded_only` columns here — ADR-031 moved
 * those to the class-subject mapping (now the subject type) and this phase
 * must not reintroduce a schedule-level override. `isLocked` flips when
 * marks entry opens; the service refuses structural edits after it.
 */
export const examSubjectSchedules = pgTable(
  "exam_subject_schedules",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    examId: uuid()
      .notNull()
      .references(() => exams.id),
    classId: uuid()
      .notNull()
      .references(() => classes.id),
    // NULL = every section of the class sits this paper.
    sectionId: uuid().references(() => sections.id),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id),

    examDate: date().notNull(),
    startTime: time().notNull(),
    durationMinutes: smallint().notNull(),
    venue: varchar({ length: 150 }),

    isLocked: boolean().notNull().default(false),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // NULL section again — partial indexes name each rule (the
    // attendance_summary lesson).
    uniqueIndex("exam_subject_schedules_class_subject_uq")
      .on(t.examId, t.classId, t.subjectId)
      .where(sql`section_id IS NULL`),
    uniqueIndex("exam_subject_schedules_section_subject_uq")
      .on(t.examId, t.classId, t.sectionId, t.subjectId)
      .where(sql`section_id IS NOT NULL`),
    index("exam_subject_schedules_exam_idx").on(t.examId),
    index("exam_subject_schedules_class_date_idx").on(t.classId, t.examDate),
    index("exam_subject_schedules_subject_idx").on(t.subjectId),
  ],
);

/**
 * A part of one subject's paper — "Theory (80, pass 27, must pass)",
 * "Internal (20)". `weightagePercentage` splits the subject's score within
 * THIS exam; the service validates the parts sum to 100. `isMandatoryPass`
 * is how "pass Theory separately from Practical" is expressed: failing a
 * mandatory component fails the subject regardless of the total.
 *
 * A graded-only exam-mode subject (its type's `isGradedOnly`) gets ONE
 * implicit "Overall" component — the grade lands in `gradeObtained`, and
 * the whole entry/verify/publish machinery works unchanged.
 */
export const examComponents = pgTable(
  "exam_components",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    scheduleId: uuid()
      .notNull()
      .references(() => examSubjectSchedules.id),

    name: varchar({ length: 100 }).notNull(),
    sequenceNumber: smallint().notNull().default(0),

    maxMarks: numeric({ precision: 6, scale: 2 }).notNull(),
    passMarks: numeric({ precision: 6, scale: 2 }).notNull(),
    weightagePercentage: numeric({ precision: 5, scale: 2 }).notNull(),

    isMandatoryPass: boolean().notNull().default(false),

    allowsNegativeMarking: boolean().notNull().default(false),
    negativeMarksPerWrong: numeric({ precision: 4, scale: 2 }),

    // Per-component scale override (the ICSE case); NULL = the school's
    // default scale. A used scale locks via the ADR-013 trigger.
    gradingScaleId: uuid().references(() => gradingScales.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("exam_components_schedule_name_uq").on(t.scheduleId, t.name),
    index("exam_components_schedule_idx").on(t.scheduleId),
    index("exam_components_scale_idx").on(t.gradingScaleId),
    check("exam_components_max_positive", sql`max_marks > 0`),
    check(
      "exam_components_pass_bounds",
      sql`pass_marks >= 0 AND pass_marks <= max_marks`,
    ),
    check(
      "exam_components_weightage_range",
      sql`weightage_percentage > 0 AND weightage_percentage <= 100`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// The entry layer — 0014
// ---------------------------------------------------------------------------

/**
 * Precomputed from `attendance_summary` against the resolved pass criteria.
 * ADVISORY ONLY (ADR-032 §9): it never blocks entry or publication — it
 * surfaces once on the readiness screen with a one-click allow, and the
 * decision + reason recorded here are the audit trail. Recomputed on exam
 * state transitions + manually; a missing row is computed on demand, never
 * treated as ineligible.
 */
export const examEligibility = pgTable(
  "exam_eligibility",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    examId: uuid()
      .notNull()
      .references(() => exams.id),
    studentId: uuid()
      .notNull()
      .references(() => students.id),

    attendancePercentage: numeric({ precision: 5, scale: 2 }).notNull(),
    minRequiredPct: numeric({ precision: 5, scale: 2 }).notNull(),
    isEligible: boolean().notNull(),

    // The override IS the normal path (schools are not that strict): the
    // principal's allow, with a reason, is the audit trail.
    isOverridden: boolean().notNull().default(false),
    overrideEligible: boolean(),
    overrideReason: varchar({ length: 500 }),
    overriddenBy: text().references(() => user.id),
    overriddenAt: timestamp({ withTimezone: true }),

    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("exam_eligibility_student_exam_uq").on(t.studentId, t.examId),
    index("exam_eligibility_exam_idx").on(t.examId),
    index("exam_eligibility_school_idx").on(t.schoolId),
    index("exam_eligibility_org_idx").on(t.organizationId),
  ],
);

export const componentResultStatusEnum = pgEnum("component_result_status", [
  "draft", // row exists, value not final — may be empty (partial entry is valid)
  "entered", // a value (or absent/exempt flag) is recorded
  "verified", // a marks:verify holder reviewed it
  "published", // frozen into the exam's publication
  "locked", // terminal
]);

export const componentExemptionTypeEnum = pgEnum("component_exemption_type", [
  "medical",
  "disability",
  "board_approved",
  "other",
]);

/**
 * THE GROUND TRUTH — the only table humans write marks into. One row per
 * student per component; rows are created lazily on first save (autosave
 * per cell). Absence is not zero; exemption is not absence; partial entry
 * is valid — the status-aware CHECK below says a non-draft row must carry
 * a mark, a grade, or an absent/exempt flag.
 *
 * After `published`, the ONLY write path is the revision service: a
 * `student_component_result_revisions` row first (hard rule 7), then the
 * update. The marks-≤-max trigger (ADR-013, migration 0015) backs the
 * service validation at the database.
 */
export const studentComponentResults = pgTable(
  "student_component_results",
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
    examId: uuid()
      .notNull()
      .references(() => exams.id),
    scheduleId: uuid()
      .notNull()
      .references(() => examSubjectSchedules.id),
    componentId: uuid()
      .notNull()
      .references(() => examComponents.id),

    marksObtained: numeric({ precision: 6, scale: 2 }),
    // Graded-only entries (and per-component graded overrides) land here.
    gradeObtained: varchar({ length: 10 }),

    isAbsent: boolean().notNull().default(false),
    isExempted: boolean().notNull().default(false),
    exemptionType: componentExemptionTypeEnum(),

    resultStatus: componentResultStatusEnum().notNull().default("draft"),

    // Reserved for the deferred CSV importer — a batch id groups one upload.
    importBatchId: uuid(),

    enteredBy: text().references(() => user.id),
    enteredAt: timestamp({ withTimezone: true }),
    verifiedBy: text().references(() => user.id),
    verifiedAt: timestamp({ withTimezone: true }),
    publishedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("student_component_results_student_exam_component_uq").on(
      t.studentId,
      t.examId,
      t.componentId,
    ),
    index("student_component_results_exam_status_idx").on(
      t.examId,
      t.resultStatus,
    ),
    index("student_component_results_schedule_idx").on(t.scheduleId),
    index("student_component_results_student_idx").on(t.studentId),
    index("student_component_results_org_idx").on(t.organizationId),
    check(
      // Draft rows may be empty (partial entry is valid); anything past
      // draft must carry a mark, a grade, or an absent/exempt flag.
      "student_component_results_value_present",
      sql`result_status = 'draft' OR is_absent OR is_exempted OR marks_obtained IS NOT NULL OR grade_obtained IS NOT NULL`,
    ),
    check(
      "student_component_results_exemption_typed",
      sql`NOT is_exempted OR exemption_type IS NOT NULL`,
    ),
  ],
);

export const revisionTypeEnum = pgEnum("component_revision_type", [
  "marks_correction", // a verified value was wrong
  "re_evaluation", // board/school re-evaluation changed the mark
  "data_entry_error", // typo-class, acknowledged by the enterer
  "other",
]);

/**
 * The hard-rule-7 ledger: written BEFORE the component row updates, holding
 * the previous value, the new one, the reason, and the approver. Append-only
 * — no updatedAt by design; nothing edits or deletes a correction record.
 * The revision WINDOW (exam_class_publication.state) groups these into one
 * recompute/re-version pass at close.
 */
export const studentComponentResultRevisions = pgTable(
  "student_component_result_revisions",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    originalResultId: uuid()
      .notNull()
      .references(() => studentComponentResults.id),

    previousMarks: numeric({ precision: 6, scale: 2 }),
    revisedMarks: numeric({ precision: 6, scale: 2 }),
    previousGrade: varchar({ length: 10 }),
    revisedGrade: varchar({ length: 10 }),
    previousStatus: componentResultStatusEnum().notNull(),
    revisedStatus: componentResultStatusEnum().notNull(),

    reason: varchar({ length: 500 }).notNull(),
    revisionType: revisionTypeEnum().notNull(),

    requestedBy: text()
      .notNull()
      .references(() => user.id),
    approvedBy: text()
      .notNull()
      .references(() => user.id),
    revisedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("student_component_result_revisions_result_idx").on(
      t.originalResultId,
    ),
    index("student_component_result_revisions_school_idx").on(t.schoolId),
    index("student_component_result_revisions_org_idx").on(t.organizationId),
  ],
);

/**
 * Term-end grades for `term_grade` subjects — the reshaped coscholastic
 * table (ADR-032 §2): no fixed CBSE area enum, the mapping IS the area
 * (school-defined "Discipline", "Personality Development", whatever the
 * school names it via its subject type). Grades + remarks ONLY — this table
 * NEVER touches result math or pass/fail. Class teacher is the default
 * entry role (areas have no subject-teacher assignments).
 */
export const termAssessments = pgTable(
  "term_assessments",
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
    termId: uuid()
      .notNull()
      .references(() => terms.id),
    mappingId: uuid()
      .notNull()
      .references(() => classSubjectMappings.id),

    grade: varchar({ length: 10 }).notNull(),
    descriptor: varchar({ length: 100 }),
    teacherRemarks: varchar({ length: 500 }),

    enteredBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("term_assessments_student_term_mapping_uq").on(
      t.studentId,
      t.termId,
      t.mappingId,
    ),
    index("term_assessments_term_idx").on(t.termId),
    index("term_assessments_mapping_idx").on(t.mappingId),
    index("term_assessments_org_idx").on(t.organizationId),
  ],
);

// ---------------------------------------------------------------------------
// The computed chain — 0015 (pure math over the entry layer; disposable and
// recomputable — every row snapshots the rules that produced it)
// ---------------------------------------------------------------------------

export const aggregateResultStatusEnum = pgEnum("aggregate_result_status", [
  "draft", // computed, invisible to students
  "published", // frozen into published_report_cards
  "locked",
]);

/**
 * One subject, one exam, one student — the exam-grain layer of the chain
 * (ADR-032 §12: the term result aggregates THESE; there is no
 * student_exam_results table). Every value a parent could ask about is
 * snapshotted: max/pass marks, the grading scale, and the mapping-type
 * flags (`countsTowardResult`, `isGradedOnly`) at compute time — a config
 * edit after the fact can never restate this row.
 *
 * Grace lives here as history: `marksBeforeGrace`, `graceMarksApplied`,
 * `finalMarks` — the rescue is auditable per subject. Ranks are written
 * only by the explicit rank computation (`rankComputedAt`), never live.
 */
export const studentSubjectResults = pgTable(
  "student_subject_results",
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
    examId: uuid()
      .notNull()
      .references(() => exams.id),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id),

    // Weighted rollup of components, BEFORE grace.
    marksObtained: numeric({ precision: 6, scale: 2 }),
    // Snapshots — what the compute used, whatever the config says later.
    maxMarks: numeric({ precision: 6, scale: 2 }).notNull(),
    passMarks: numeric({ precision: 6, scale: 2 }).notNull(),

    marksBeforeGrace: numeric({ precision: 6, scale: 2 }),
    graceMarksApplied: numeric({ precision: 5, scale: 2 })
      .notNull()
      .default("0.00"),
    finalMarks: numeric({ precision: 6, scale: 2 }),

    isPassed: boolean().notNull(),
    // Component ids that failed a mandatory pass — the "why" on the card.
    failedComponents: jsonb().notNull().default(sql`'[]'::jsonb`),

    isAbsent: boolean().notNull().default(false),
    isExempted: boolean().notNull().default(false),

    grade: varchar({ length: 10 }),
    gradePoint: numeric({ precision: 4, scale: 2 }),
    // The scale this grade came from — also the ADR-013 lock trigger's subject.
    gradingScaleId: uuid().references(() => gradingScales.id),

    // ADR-031/032 snapshots — the type flags at compute time.
    countsTowardResult: boolean().notNull(),
    isGradedOnly: boolean().notNull(),

    rankInSection: smallint(),
    rankInClass: smallint(),
    rankComputedAt: timestamp({ withTimezone: true }),

    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    resultStatus: aggregateResultStatusEnum().notNull().default("draft"),
    publishedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("student_subject_results_student_exam_subject_uq").on(
      t.studentId,
      t.examId,
      t.subjectId,
    ),
    index("student_subject_results_exam_idx").on(t.examId),
    index("student_subject_results_subject_idx").on(t.subjectId),
    index("student_subject_results_status_idx").on(t.resultStatus),
    index("student_subject_results_school_idx").on(t.schoolId),
    index("student_subject_results_org_idx").on(t.organizationId),
  ],
);

/**
 * The term — the first REPORTING unit (ADR-032 §12): totals over counted
 * subjects weighted by `exams.weightageInTerm`, or the GPA branch when
 * every counted subject is graded-only. Attendance snapshot comes from the
 * `attendance_summary` term row; section is snapshotted (mid-year moves
 * must not rewrite history); the resolved pass policy is frozen JSONB so a
 * later criteria change cannot make a pass/fail unauditable.
 */
export const studentTermResults = pgTable(
  "student_term_results",
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
    termId: uuid()
      .notNull()
      .references(() => terms.id),

    // Where the student sat when computed — section moves don't rewrite.
    sectionId: uuid().references(() => sections.id),

    totalMarks: numeric({ precision: 8, scale: 2 }),
    maxMarks: numeric({ precision: 8, scale: 2 }),
    percentage: numeric({ precision: 5, scale: 2 }),
    grade: varchar({ length: 10 }),
    gradePoint: numeric({ precision: 4, scale: 2 }),

    isPassed: boolean().notNull(),
    subjectsFailedCount: smallint().notNull().default(0),
    subjectsFailed: uuid().array().notNull().default(sql`'{}'::uuid[]`),

    attendancePercentage: numeric({ precision: 5, scale: 2 }),

    rankInSection: smallint(),
    rankInClass: smallint(),
    rankComputedAt: timestamp({ withTimezone: true }),

    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    // The resolved pass criteria at compute time (ADR-032 §10).
    passPolicySnapshot: jsonb(),

    resultStatus: aggregateResultStatusEnum().notNull().default("draft"),
    publishedBy: text().references(() => user.id),
    publishedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("student_term_results_student_term_uq").on(t.studentId, t.termId),
    index("student_term_results_term_idx").on(t.termId),
    index("student_term_results_status_idx").on(t.resultStatus),
    index("student_term_results_school_idx").on(t.schoolId),
    index("student_term_results_org_idx").on(t.organizationId),
  ],
);

/**
 * The year's verdict — percentage from the per-term policy
 * (`terms.resultMode`), or the GPA branch, ending in `promotionStatus`,
 * which the future rollover reads to create next year's enrollment row
 * (hard rule 6 — this row influences, that row is new).
 */
export const studentFinalResults = pgTable(
  "student_final_results",
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

    totalMarks: numeric({ precision: 8, scale: 2 }),
    maxMarks: numeric({ precision: 8, scale: 2 }),
    percentage: numeric({ precision: 5, scale: 2 }),
    grade: varchar({ length: 10 }),
    gradePoint: numeric({ precision: 4, scale: 2 }),

    isPassed: boolean().notNull(),
    subjectsFailedCount: smallint().notNull().default(0),
    subjectsFailed: uuid().array().notNull().default(sql`'{}'::uuid[]`),

    attendancePercentage: numeric({ precision: 5, scale: 2 }),

    promotionStatus: promotionStatusEnum().notNull().default("pending"),
    compartmentSubjects: uuid().array().notNull().default(sql`'{}'::uuid[]`),

    rankInClass: smallint(),
    rankComputedAt: timestamp({ withTimezone: true }),

    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    passPolicySnapshot: jsonb(),

    resultStatus: aggregateResultStatusEnum().notNull().default("draft"),
    publishedBy: text().references(() => user.id),
    publishedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("student_final_results_student_year_uq").on(
      t.studentId,
      t.academicYearId,
    ),
    index("student_final_results_year_idx").on(t.academicYearId),
    index("student_final_results_promotion_idx").on(
      t.academicYearId,
      t.promotionStatus,
    ),
    index("student_final_results_school_idx").on(t.schoolId),
    index("student_final_results_org_idx").on(t.organizationId),
  ],
);

// ---------------------------------------------------------------------------
// The publication layer — 0015
// ---------------------------------------------------------------------------

/**
 * Layout per class-group: which widgets (subject types) appear and in what
 * order come from the types themselves; this config decides the rest —
 * marks vs grades, rank/attendance/co-scholastic toggles, language,
 * header/footer. `academicYearId` NULL = applies across years. Data and
 * design are decoupled forever: the snapshot is frozen, the template is
 * swappable.
 */
export const reportCardTemplates = pgTable(
  "report_card_templates",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    name: varchar({ length: 100 }).notNull(),
    // Empty = all classes; otherwise the template applies to exactly these.
    applicableClassIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    layoutConfig: jsonb().notNull(),
    // NULL = applies across years.
    academicYearId: uuid().references(() => academicYears.id),

    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("report_card_templates_school_name_uq").on(t.schoolId, t.name),
    uniqueIndex("report_card_templates_school_default_uq")
      .on(t.schoolId)
      .where(sql`is_default = true`),
    index("report_card_templates_school_idx").on(t.schoolId),
    index("report_card_templates_org_idx").on(t.organizationId),
  ],
);

/**
 * THE FROZEN PHOTOGRAPH — one versioned JSONB snapshot per student per term
 * (plus one annual). The ONLY table the student portal reads (hard rule 8):
 * before this row exists, a parent sees nothing, no matter what the live
 * tables hold. `snapshotData` is the assembled card (marks, grades, ranks,
 * attendance, co-scholastic, names, the template used) validated by the
 * versioned Zod schema in @repo/contracts; `snapshotVersion` names that
 * schema so v2 cards can carry fields v1 cards never had.
 *
 * Corrections never edit: version N+1 sets `replacesVersion` and flips
 * `isCurrent`; version N stays queryable forever — a duplicate marksheet in
 * 2032 prints exactly what was handed over in 2026.
 */
export const publishedReportCards = pgTable(
  "published_report_cards",
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
    // NULL = the annual card.
    termId: uuid().references(() => terms.id),

    version: integer().notNull().default(1),
    isCurrent: boolean().notNull().default(true),
    replacesVersion: integer(),

    snapshotData: jsonb().notNull(),
    snapshotVersion: integer().notNull().default(1),

    templateId: uuid().references(() => reportCardTemplates.id),
    revisionReason: varchar({ length: 500 }),

    publishedBy: text()
      .notNull()
      .references(() => user.id),
    publishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Version uniqueness and the is_current singleton, per card type —
    // partial indexes again, because term_id NULLs are distinct.
    uniqueIndex("published_report_cards_annual_version_uq")
      .on(t.studentId, t.academicYearId, t.version)
      .where(sql`term_id IS NULL`),
    uniqueIndex("published_report_cards_term_version_uq")
      .on(t.studentId, t.academicYearId, t.termId, t.version)
      .where(sql`term_id IS NOT NULL`),
    uniqueIndex("published_report_cards_annual_current_uq")
      .on(t.studentId, t.academicYearId)
      .where(sql`is_current = true AND term_id IS NULL`),
    uniqueIndex("published_report_cards_term_current_uq")
      .on(t.studentId, t.academicYearId, t.termId)
      .where(sql`is_current = true AND term_id IS NOT NULL`),
    index("published_report_cards_student_idx").on(t.studentId),
    index("published_report_cards_year_idx").on(t.academicYearId),
    index("published_report_cards_school_idx").on(t.schoolId),
    index("published_report_cards_org_idx").on(t.organizationId),
  ],
);

export const publicationStateEnum = pgEnum("publication_state", [
  "published", // the class's cards are live
  "revision_open", // corrections accumulating; cards stay on their version
  "re_issued", // the window closed; recompute + re-version done
]);

/**
 * The per-class release record (ADR-032 §7): publication is NOT all-or-
 * nothing across a school — one slow class must not hold every other one.
 * "Publish exam" loops this table. The revision window lives here as a
 * state machine: `published → revision_open → re_issued` — during the open
 * state, ledger rows accumulate and no card moves; at close, one recompute
 * re-versions every affected card.
 */
export const examClassPublication = pgTable(
  "exam_class_publication",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    examId: uuid()
      .notNull()
      .references(() => exams.id),
    classId: uuid()
      .notNull()
      .references(() => classes.id),

    state: publicationStateEnum().notNull().default("published"),

    publishedBy: text()
      .notNull()
      .references(() => user.id),
    publishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    revisionOpenedBy: text().references(() => user.id),
    revisionOpenedAt: timestamp({ withTimezone: true }),
    reIssuedBy: text().references(() => user.id),
    reIssuedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("exam_class_publication_exam_class_uq").on(t.examId, t.classId),
    index("exam_class_publication_exam_idx").on(t.examId),
    index("exam_class_publication_class_idx").on(t.classId),
    index("exam_class_publication_school_idx").on(t.schoolId),
    index("exam_class_publication_org_idx").on(t.organizationId),
  ],
);
