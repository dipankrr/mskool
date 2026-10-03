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
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import {
  academicYears,
  classes,
  sections,
  studentEnrollments,
  subjects,
  terms,
} from "./academic";
import { gradingScales } from "./exam";
import { organizations, schools } from "./organization";
import { storageObjects } from "./storage";

/**
 * HOMEWORK / ASSIGNMENTS (ADR-039) — the daily homework-diary domain, ported
 * from docs/reference/assignment/06_assignments.sql + 07_questions.sql.
 *
 * The domain's spine: Assignment (authored) → StudentAssignment (resolved
 * per-student, THE authoritative record other modules read) → Submission
 * (versioned, immutable) → Evaluation (append-only). Assignments belong to
 * year + subject + target sections; `createdBy` is audit, never ownership —
 * access is decided by the caller's scope plus, for the teaching role, the
 * ADR-029 subject gate. Scores here NEVER feed exams or report cards.
 *
 * Adaptations from the reference SQL (ADR-039 has the full list):
 *  - uuid primary keys (hard rule 10), `timestamptz` (rule 11), and BOTH
 *    `organizationId` + `schoolId` on every table so `scopeWhere` applies
 *    (hard rule 1) — the reference carried only school_id.
 *  - File references point at `storage_objects` (ADR-038 seam), not the
 *    reference's `files` table.
 *  - Target resolution reads `student_enrollments` (the year anchor). The
 *    reference's `student_subject_enrollments` elective path does not exist
 *    yet; backfill semantics (`is_backfilled`) are reserved in the schema.
 *  - Status vocabularies are pgEnums, lowercase house style.
 *  - Nothing here is hard-deleted: cancelling sets status, comments use
 *    isDeleted, evaluations append and flip isCurrent.
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const assignmentKindEnum = pgEnum("assignment_kind", [
  "homework",
  "classwork",
  "project",
  "worksheet",
  "reading",
  "practice",
  "quiz",
]);

/**
 * How a student responds. `questions` means the assignment carries a
 * snapshotted question set (07) answered through attempts; it can be combined
 * with text/file/link for the free-form response, which goes through
 * `submissions`.
 */
export const submissionTypeEnum = pgEnum("assignment_submission_type", [
  "none",
  "tick",
  "offline",
  "text",
  "file",
  "link",
  "questions",
]);

export const assignmentGradingModeEnum = pgEnum("assignment_grading_mode", [
  "none",
  "marks",
  "grade",
  "rubric",
  "completion",
]);

export const assignmentLatePolicyEnum = pgEnum("assignment_late_policy", [
  "not_allowed",
  "allowed",
]);

export const assignmentStatusEnum = pgEnum("assignment_status", [
  "draft",
  "scheduled",
  "published",
  "closed",
  "cancelled",
]);

export const assignmentTargetTypeEnum = pgEnum("assignment_target_type", [
  "section",
  "student",
]);

export const assignmentResourceTypeEnum = pgEnum("assignment_resource_type", [
  "file",
  "link",
  "video",
]);

export const studentAssignmentStatusEnum = pgEnum("student_assignment_status", [
  "assigned",
  "in_progress",
  "submitted",
  "resubmit_requested",
  "reviewed",
  "excused",
  "missing",
]);

export const assignmentCompletionSourceEnum = pgEnum(
  "assignment_completion_source",
  ["student", "parent", "teacher_verified"],
);

export const submissionAuthorRoleEnum = pgEnum("submission_author_role", [
  "student",
  "parent",
  "teacher",
]);

export const assignmentEvaluationOutcomeEnum = pgEnum(
  "assignment_evaluation_outcome",
  ["reviewed", "resubmit_requested"],
);

export const assignmentSummaryPeriodEnum = pgEnum("assignment_summary_period", [
  "month",
  "term",
  "year",
]);

export const questionTypeEnum = pgEnum("homework_question_type", [
  "mcq_single",
  "mcq_multi",
  "true_false",
  "fill_blank",
  "numeric",
  "match",
  "short_answer",
  "long_answer",
  "file_upload",
]);

export const questionDifficultyEnum = pgEnum("homework_question_difficulty", [
  "easy",
  "medium",
  "hard",
]);

/** `platform` (cross-org curation) is deliberately absent until curation exists. */
export const questionVisibilityEnum = pgEnum("homework_question_visibility", [
  "private",
  "school",
]);

export const questionAttemptStatusEnum = pgEnum("homework_attempt_status", [
  "in_progress",
  "submitted",
  "graded",
]);

export const attemptScoringEnum = pgEnum("homework_attempt_scoring", [
  "best",
  "latest",
  "first",
]);

/** When a student may see their score / the answer key. */
export const questionRevealPolicyEnum = pgEnum("homework_reveal_policy", [
  "never",
  "after_submit",
  "after_close",
]);

// ---------------------------------------------------------------------------
// 1. CONFIGURATION — school default (classId null) + per-class overrides
// ---------------------------------------------------------------------------

export const assignmentSettings = pgTable(
  "assignment_settings",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    // NULL = the school default row; otherwise the override for one class.
    classId: uuid().references(() => classes.id),

    allowedSubmissionTypes: submissionTypeEnum()
      .array()
      .notNull()
      .default(sql`ARRAY['none','tick','offline','text','file','link','questions']`),
    studentsCanSubmit: boolean().notNull().default(true),
    parentsCanSubmit: boolean().notNull().default(true),

    maxFilesPerSubmission: integer().notNull().default(5),
    maxFileSizeMb: integer().notNull().default(10),
    allowedMimeTypes: text().array(), // NULL = platform default

    defaultLatePolicy: assignmentLatePolicyEnum().notNull().default("allowed"),
    // close_at = due_at + this many hours, when the default policy is applied.
    defaultLateWindowHours: integer().notNull().default(48),

    // Per section per day, checked at publish time. NULL = no cap.
    maxAssignmentsPerDay: integer(),
    allowWeekendAssignments: boolean().notNull().default(true),
    questionsEnabled: boolean().notNull().default(true),

    createdBy: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("assignment_settings_school_default_uq")
      .on(t.schoolId)
      .where(sql`class_id IS NULL`),
    uniqueIndex("assignment_settings_school_class_uq")
      .on(t.schoolId, t.classId)
      .where(sql`class_id IS NOT NULL`),
    index("assignment_settings_school_idx").on(t.schoolId),
  ],
);

// ---------------------------------------------------------------------------
// 2. RUBRICS — reusable per school
// ---------------------------------------------------------------------------

export const rubrics = pgTable(
  "rubrics",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    name: varchar({ length: 150 }).notNull(),
    description: text(),
    isActive: boolean().notNull().default(true),

    createdBy: text()
      .notNull()
      .references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("rubrics_school_name_uq").on(t.schoolId, t.name),
    index("rubrics_school_idx").on(t.schoolId),
  ],
);

export const rubricCriteria = pgTable(
  "rubric_criteria",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    rubricId: uuid()
      .notNull()
      .references(() => rubrics.id, { onDelete: "cascade" }),

    name: varchar({ length: 150 }).notNull(),
    description: text(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index("rubric_criteria_rubric_idx").on(t.rubricId)],
);

export const rubricLevels = pgTable(
  "rubric_levels",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    criterionId: uuid()
      .notNull()
      .references(() => rubricCriteria.id, { onDelete: "cascade" }),

    label: varchar({ length: 100 }).notNull(),
    description: text(),
    points: numeric({ precision: 6, scale: 2 }).notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index("rubric_levels_criterion_idx").on(t.criterionId)],
);

// ---------------------------------------------------------------------------
// 3. SERIES — recurring assignments (weekly reading log, daily practice)
// ---------------------------------------------------------------------------

export const assignmentSeries = pgTable(
  "assignment_series",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    title: varchar({ length: 200 }).notNull(),
    // iCal RRULE string.
    recurrence: text(),

    createdBy: text()
      .notNull()
      .references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assignment_series_school_idx").on(t.schoolId)],
);

// ---------------------------------------------------------------------------
// 4. ASSIGNMENTS — the authored item
// ---------------------------------------------------------------------------

export const assignments = pgTable(
  "assignments",
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
    termId: uuid().references(() => terms.id),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id),

    seriesId: uuid().references(() => assignmentSeries.id),
    // Provenance when this was cloned from another assignment.
    sourceAssignmentId: uuid().references((): AnyPgColumn => assignments.id),

    kind: assignmentKindEnum().notNull().default("homework"),
    title: varchar({ length: 250 }).notNull(),
    description: text(), // rich text / markdown
    topic: varchar({ length: 250 }), // chapter / topic label
    estimatedMinutes: integer(),

    submissionTypes: submissionTypeEnum()
      .array()
      .notNull()
      .default(sql`ARRAY['none']`),
    gradingMode: assignmentGradingModeEnum().notNull().default("none"),
    maxMarks: numeric({ precision: 7, scale: 2 }),
    gradingScaleId: uuid().references(() => gradingScales.id),
    rubricId: uuid().references(() => rubrics.id),

    // Future publish moment → status 'scheduled' (a worker flips it; ADR-039
    // defers the worker, so v1 publishes immediately or not at all).
    publishAt: timestamp({ withTimezone: true }),
    // due_at is the on-time mark; close_at the hard cutoff.
    dueAt: timestamp({ withTimezone: true }).notNull(),
    closeAt: timestamp({ withTimezone: true }).notNull(),
    latePolicy: assignmentLatePolicyEnum().notNull().default("allowed"),
    allowResubmission: boolean().notNull().default(true),
    // NULL = unlimited versions.
    maxSubmissions: integer(),

    status: assignmentStatusEnum().notNull().default("draft"),
    // Set on first submission/attempt — freezes the question set.
    isLocked: boolean().notNull().default(false),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),

    createdBy: text()
      .notNull()
      .references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("assignments_school_year_status_idx").on(
      t.schoolId,
      t.academicYearId,
      t.status,
    ),
    index("assignments_subject_due_idx").on(t.subjectId, t.dueAt),
    index("assignments_status_due_idx").on(t.status, t.dueAt),
    index("assignments_series_idx").on(t.seriesId),
    check(
      "assignments_close_after_due",
      sql`close_at >= due_at`,
    ),
    check(
      "assignments_late_requires_window",
      sql`late_policy = 'allowed' OR close_at = due_at`,
    ),
    check(
      "assignment_marks_require_max",
      sql`grading_mode <> 'marks' OR max_marks IS NOT NULL`,
    ),
    check(
      "assignment_grade_requires_scale",
      sql`grading_mode <> 'grade' OR grading_scale_id IS NOT NULL`,
    ),
    check(
      "assignment_rubric_requires_rubric",
      sql`grading_mode <> 'rubric' OR rubric_id IS NOT NULL`,
    ),
  ],
);

/** Audience: whole section(s) or individual students. */
export const assignmentTargets = pgTable(
  "assignment_targets",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    targetType: assignmentTargetTypeEnum().notNull(),
    sectionId: uuid().references(() => sections.id),
    studentEnrollmentId: uuid().references(() => studentEnrollments.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assignment_targets_section_uq")
      .on(t.assignmentId, t.sectionId)
      .where(sql`section_id IS NOT NULL`),
    uniqueIndex("assignment_targets_student_uq")
      .on(t.assignmentId, t.studentEnrollmentId)
      .where(sql`student_enrollment_id IS NOT NULL`),
    index("assignment_targets_section_idx").on(t.sectionId),
    check(
      "assignment_targets_shape",
      sql`(target_type = 'section' AND section_id IS NOT NULL AND student_enrollment_id IS NULL) OR
          (target_type = 'student' AND student_enrollment_id IS NOT NULL AND section_id IS NULL)`,
    ),
  ],
);

/** Teacher-provided reference material. */
export const assignmentResources = pgTable(
  "assignment_resources",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    resourceType: assignmentResourceTypeEnum().notNull(),
    // ADR-038: object pointer, served through the stable /api/storage/:id route.
    objectId: uuid().references(() => storageObjects.id),
    url: text(),
    title: varchar({ length: 250 }),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    index("assignment_resources_assignment_idx").on(t.assignmentId),
    check(
      "assignment_resources_shape",
      sql`(resource_type = 'file' AND object_id IS NOT NULL) OR
          (resource_type <> 'file' AND url IS NOT NULL)`,
    ),
  ],
);

/** Snapshot of the assignment BEFORE any material edit after publish. */
export const assignmentRevisions = pgTable(
  "assignment_revisions",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    revisionNo: integer().notNull(),
    snapshot: jsonb().notNull(),
    changeSummary: text(),
    changedBy: text()
      .notNull()
      .references(() => user.id),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assignment_revisions_assignment_no_uq").on(
      t.assignmentId,
      t.revisionNo,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 5. STUDENT_ASSIGNMENTS — the resolved, authoritative per-student record.
// Resolved at publish from active enrollments in the target sections.
// Other modules read ONLY this table, never the targets.
// ---------------------------------------------------------------------------

export const studentAssignments = pgTable(
  "student_assignments",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    studentEnrollmentId: uuid()
      .notNull()
      .references(() => studentEnrollments.id),
    // Section snapshot at resolve time.
    sectionId: uuid()
      .notNull()
      .references(() => sections.id),

    status: studentAssignmentStatusEnum().notNull().default("assigned"),
    completionSource: assignmentCompletionSourceEnum(),

    // Snapshotted from the assignment at publish; extensions override.
    effectiveDueAt: timestamp({ withTimezone: true }).notNull(),
    effectiveCloseAt: timestamp({ withTimezone: true }).notNull(),

    // Late joiner / elective backfill: view-only rows excluded from stats.
    isBackfilled: boolean().notNull().default(false),
    countsTowardStats: boolean().notNull().default(true),

    firstViewedAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    submittedAt: timestamp({ withTimezone: true }),
    isLate: boolean().notNull().default(false),
    submissionCount: integer().notNull().default(0),

    // Denormalised from the current evaluation.
    currentEvaluationId: uuid().references((): AnyPgColumn => assignmentEvaluations.id),
    currentMarks: numeric({ precision: 7, scale: 2 }),
    currentGrade: varchar({ length: 20 }),
    reviewedAt: timestamp({ withTimezone: true }),

    excusedBy: text().references(() => user.id),
    excusedReason: text(),
    excusedAt: timestamp({ withTimezone: true }),
    missingMarkedAt: timestamp({ withTimezone: true }),

    statusChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("student_assignments_assignment_student_uq").on(
      t.assignmentId,
      t.studentEnrollmentId,
    ),
    index("student_assignments_enrollment_status_idx").on(
      t.studentEnrollmentId,
      t.status,
    ),
    index("student_assignments_assignment_status_idx").on(
      t.assignmentId,
      t.status,
    ),
    index("student_assignments_section_idx").on(t.sectionId),
    // The missing-sweeper's scan path.
    index("student_assignments_missing_scan_idx")
      .on(t.effectiveCloseAt)
      .where(sql`status IN ('assigned','in_progress')`),
  ],
);

/** Per-student deadline overrides. Append-only. */
export const assignmentExtensions = pgTable(
  "assignment_extensions",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentAssignmentId: uuid()
      .notNull()
      .references(() => studentAssignments.id, { onDelete: "cascade" }),

    previousDueAt: timestamp({ withTimezone: true }).notNull(),
    previousCloseAt: timestamp({ withTimezone: true }).notNull(),
    newDueAt: timestamp({ withTimezone: true }).notNull(),
    newCloseAt: timestamp({ withTimezone: true }).notNull(),
    reason: text(),
    grantedBy: text()
      .notNull()
      .references(() => user.id),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assignment_extensions_sa_idx").on(t.studentAssignmentId)],
);

// ---------------------------------------------------------------------------
// 6. SUBMISSIONS — immutable, versioned
// ---------------------------------------------------------------------------

export const submissions = pgTable(
  "submissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentAssignmentId: uuid()
      .notNull()
      .references(() => studentAssignments.id, { onDelete: "cascade" }),
    versionNo: integer().notNull(),
    bodyText: text(),
    linkUrl: text(),
    submittedByUserId: text()
      .notNull()
      .references(() => user.id),
    submittedByRole: submissionAuthorRoleEnum().notNull(),
    isLate: boolean().notNull().default(false),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("submissions_sa_version_uq").on(
      t.studentAssignmentId,
      t.versionNo,
    ),
    index("submissions_sa_idx").on(t.studentAssignmentId),
  ],
);

export const submissionFiles = pgTable(
  "submission_files",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    submissionId: uuid()
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    objectId: uuid()
      .notNull()
      .references(() => storageObjects.id),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index("submission_files_submission_idx").on(t.submissionId)],
);

// ---------------------------------------------------------------------------
// 7. EVALUATIONS — append-only; regrade = new row, is_current flips
// ---------------------------------------------------------------------------

export const assignmentEvaluations = pgTable(
  "assignment_evaluations",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentAssignmentId: uuid()
      .notNull()
      .references(() => studentAssignments.id, { onDelete: "cascade" }),
    // NULL for offline / completion-only evaluations.
    submissionId: uuid().references(() => submissions.id),
    outcome: assignmentEvaluationOutcomeEnum().notNull().default("reviewed"),
    marks: numeric({ precision: 7, scale: 2 }),
    grade: varchar({ length: 20 }),
    feedback: text(),
    isCurrent: boolean().notNull().default(true),
    // NULL when the system graded the attempt (auto-scored questions).
    evaluatedBy: text().references(() => user.id),
    isAuto: boolean().notNull().default(false),
    evaluatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One current evaluation per student assignment.
    uniqueIndex("assignment_evaluations_current_uq")
      .on(t.studentAssignmentId)
      .where(sql`is_current`),
    index("assignment_evaluations_sa_idx").on(t.studentAssignmentId),
    check(
      "assignment_evaluations_evaluator",
      sql`is_auto OR evaluated_by IS NOT NULL`,
    ),
  ],
);

/** Annotated copies / feedback attachments. */
export const evaluationFiles = pgTable(
  "evaluation_files",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    evaluationId: uuid()
      .notNull()
      .references(() => assignmentEvaluations.id, { onDelete: "cascade" }),
    objectId: uuid()
      .notNull()
      .references(() => storageObjects.id),
  },
  (t) => [index("evaluation_files_evaluation_idx").on(t.evaluationId)],
);

export const assignmentRubricScores = pgTable(
  "assignment_rubric_scores",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    evaluationId: uuid()
      .notNull()
      .references(() => assignmentEvaluations.id, { onDelete: "cascade" }),
    criterionId: uuid()
      .notNull()
      .references(() => rubricCriteria.id),
    levelId: uuid().references(() => rubricLevels.id),
    points: numeric({ precision: 6, scale: 2 }).notNull(),
    comment: text(),
  },
  (t) => [
    uniqueIndex("assignment_rubric_scores_eval_criterion_uq").on(
      t.evaluationId,
      t.criterionId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 8. COMMENTS & ACKNOWLEDGEMENTS
// studentAssignmentId NULL  => class-wide Q&A on the assignment
// studentAssignmentId SET   => private thread (student/parent <-> teacher)
// ---------------------------------------------------------------------------

export const assignmentComments = pgTable(
  "assignment_comments",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    studentAssignmentId: uuid().references(() => studentAssignments.id, {
      onDelete: "cascade",
    }),
    parentCommentId: uuid().references((): AnyPgColumn => assignmentComments.id),
    authorUserId: text()
      .notNull()
      .references(() => user.id),
    body: text().notNull(),
    isDeleted: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("assignment_comments_assignment_idx").on(t.assignmentId, t.createdAt),
    index("assignment_comments_sa_idx")
      .on(t.studentAssignmentId)
      .where(sql`student_assignment_id IS NOT NULL`),
  ],
);

/** The parent-signed homework diary, digital. */
export const assignmentAcknowledgements = pgTable(
  "assignment_acknowledgements",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentAssignmentId: uuid()
      .notNull()
      .references(() => studentAssignments.id, { onDelete: "cascade" }),
    guardianUserId: text()
      .notNull()
      .references(() => user.id),
    acknowledgedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assignment_acknowledgements_sa_guardian_uq").on(
      t.studentAssignmentId,
      t.guardianUserId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 9. SUMMARY — pre-aggregated counts (same idea as attendance_summary).
// Schema ships with the backbone; the aggregation job is a recorded deferral.
// subjectId NULL => across all subjects.
// ---------------------------------------------------------------------------

export const studentAssignmentSummary = pgTable(
  "student_assignment_summary",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentEnrollmentId: uuid()
      .notNull()
      .references(() => studentEnrollments.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    termId: uuid().references(() => terms.id),
    subjectId: uuid().references(() => subjects.id),
    periodType: assignmentSummaryPeriodEnum().notNull(),
    periodStart: date().notNull(),

    totalAssigned: integer().notNull().default(0),
    submittedOnTime: integer().notNull().default(0),
    submittedLate: integer().notNull().default(0),
    missing: integer().notNull().default(0),
    excused: integer().notNull().default(0),
    reviewed: integer().notNull().default(0),
    avgScorePercent: numeric({ precision: 5, scale: 2 }),

    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("student_assignment_summary_uq")
      .on(t.studentEnrollmentId, t.periodType, t.periodStart, t.subjectId)
      .where(sql`subject_id IS NOT NULL`),
    uniqueIndex("student_assignment_summary_all_subjects_uq")
      .on(t.studentEnrollmentId, t.periodType, t.periodStart)
      .where(sql`subject_id IS NULL`),
    index("student_assignment_summary_school_idx").on(t.schoolId, t.academicYearId),
  ],
);

// ---------------------------------------------------------------------------
// 10. QUESTION BANK — reusable questions (Private / School visibility)
// ---------------------------------------------------------------------------

export const questionBankItems = pgTable(
  "question_bank_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    subjectId: uuid()
      .notNull()
      .references(() => subjects.id),
    classId: uuid().references(() => classes.id),
    topic: varchar({ length: 250 }),

    questionType: questionTypeEnum().notNull(),
    body: text().notNull(),
    imageObjectId: uuid().references(() => storageObjects.id),
    /**
     * Answer key for non-option types:
     *   fill_blank  {"accepted":["photosynthesis"],"case_sensitive":false}
     *   numeric     {"value":9.8,"tolerance":0.1}
     *   match       {"pairs":[["A","2"],["B","1"]]}
     *   true_false  {"value":true}
     * NULL for MCQ (uses question_options) and short/long answers (manual).
     */
    correctAnswer: jsonb(),
    explanation: text(),
    difficulty: questionDifficultyEnum().notNull().default("medium"),
    defaultMarks: numeric({ precision: 6, scale: 2 }).notNull().default("1"),

    visibility: questionVisibilityEnum().notNull().default("private"),
    isActive: boolean().notNull().default(true),
    createdBy: text()
      .notNull()
      .references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("question_bank_lookup_idx").on(
      t.schoolId,
      t.subjectId,
      t.classId,
      t.difficulty,
    ),
  ],
);

export const questionOptions = pgTable(
  "question_options",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    questionId: uuid()
      .notNull()
      .references(() => questionBankItems.id, { onDelete: "cascade" }),
    optionText: text().notNull(),
    imageObjectId: uuid().references(() => storageObjects.id),
    isCorrect: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index("question_options_question_idx").on(t.questionId)],
);

// ---------------------------------------------------------------------------
// 11. QUESTION-SET CONFIG (1:1 with assignment)
// ---------------------------------------------------------------------------

export const assignmentQuestionSettings = pgTable(
  "assignment_question_settings",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),

    shuffleQuestions: boolean().notNull().default(false),
    shuffleOptions: boolean().notNull().default(false),
    oneQuestionAtATime: boolean().notNull().default(false),
    maxAttempts: integer().notNull().default(1),
    attemptScoring: attemptScoringEnum().notNull().default("best"),

    showScore: questionRevealPolicyEnum().notNull().default("after_submit"),
    showAnswers: questionRevealPolicyEnum().notNull().default("after_close"),
    showExplanations: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex("assignment_question_settings_assignment_uq").on(t.assignmentId)],
);

// ---------------------------------------------------------------------------
// 12. ASSIGNMENT QUESTIONS — the SNAPSHOT taken when the set is attached.
// Editing the bank never changes an assignment already given. The answer key
// must NEVER reach a student session (ADR-039; the portal read model omits
// correctAnswer and option isCorrect).
// ---------------------------------------------------------------------------

export const assignmentQuestions = pgTable(
  "assignment_questions",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    assignmentId: uuid()
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    // Provenance only.
    sourceQuestionId: uuid().references(() => questionBankItems.id),
    position: integer().notNull(),

    questionType: questionTypeEnum().notNull(),
    body: text().notNull(),
    imageObjectId: uuid().references(() => storageObjects.id),
    // [{ "text": "...", "image_object_id": null, "is_correct": true }, ...]
    options: jsonb(),
    correctAnswer: jsonb(),
    explanation: text(),
    marks: numeric({ precision: 6, scale: 2 }).notNull().default("1"),
  },
  (t) => [
    uniqueIndex("assignment_questions_assignment_position_uq").on(
      t.assignmentId,
      t.position,
    ),
    index("assignment_questions_assignment_idx").on(t.assignmentId),
  ],
);

// ---------------------------------------------------------------------------
// 13. ATTEMPTS & ANSWERS
// No timer: the only limit is student_assignments.effective_close_at.
// ---------------------------------------------------------------------------

export const questionAttempts = pgTable(
  "question_attempts",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    studentAssignmentId: uuid()
      .notNull()
      .references(() => studentAssignments.id, { onDelete: "cascade" }),
    attemptNo: integer().notNull(),

    status: questionAttemptStatusEnum().notNull().default("in_progress"),
    // Per-attempt shuffle order (assignment_question ids).
    questionOrder: jsonb(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp({ withTimezone: true }),
    isLate: boolean().notNull().default(false),

    scoreAuto: numeric({ precision: 7, scale: 2 }).notNull().default("0"),
    scoreManual: numeric({ precision: 7, scale: 2 }).notNull().default("0"),
    totalScore: numeric({ precision: 7, scale: 2 }).notNull().default("0"),
    maxScore: numeric({ precision: 7, scale: 2 }).notNull().default("0"),
  },
  (t) => [
    uniqueIndex("question_attempts_sa_attempt_uq").on(
      t.studentAssignmentId,
      t.attemptNo,
    ),
    index("question_attempts_sa_idx").on(t.studentAssignmentId),
  ],
);

export const questionAttemptAnswers = pgTable(
  "question_attempt_answers",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    attemptId: uuid()
      .notNull()
      .references(() => questionAttempts.id, { onDelete: "cascade" }),
    assignmentQuestionId: uuid()
      .notNull()
      .references(() => assignmentQuestions.id, { onDelete: "cascade" }),

    // mcq: {"option_ids":[...]}  text: {"text":"..."}  numeric: {"value":9.8}
    answer: jsonb(),
    // NULL until graded.
    isCorrect: boolean(),
    marksAwarded: numeric({ precision: 6, scale: 2 }),
    // short_answer / long_answer / file_upload always land here.
    needsManualReview: boolean().notNull().default(false),
    feedback: text(),
    // NULL = auto-graded.
    gradedBy: text().references(() => user.id),
    gradedAt: timestamp({ withTimezone: true }),
    answeredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("question_attempt_answers_attempt_question_uq").on(
      t.attemptId,
      t.assignmentQuestionId,
    ),
    index("question_attempt_answers_review_idx")
      .on(t.attemptId)
      .where(sql`needs_manual_review`),
  ],
);

/** Uploads for file_upload-type questions (photo of worked solution, etc.). */
export const questionAttemptAnswerFiles = pgTable(
  "question_attempt_answer_files",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    answerId: uuid()
      .notNull()
      .references(() => questionAttemptAnswers.id, { onDelete: "cascade" }),
    objectId: uuid()
      .notNull()
      .references(() => storageObjects.id),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index("question_attempt_answer_files_answer_idx").on(t.answerId)],
);
