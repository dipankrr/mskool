import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
  type AnyPgColumn,
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
 * HOMEWORK (ADR-039, rebuilt by ADR-064) — the daily homework diary.
 *
 * Assignment (what the teacher gave: type, how it comes back, grading, one or
 * more sections of one subject) → StudentAssignment (one row per child, THE
 * record every read uses, carrying the teacher's check result) → Submission
 * (at most one per child, replaced until checked). Quizzes add a snapshotted
 * question set and one attempt per child.
 *
 * ADR-064 removed what a school diary does not need: school settings, rubrics,
 * series, revisions, extensions, evaluation history, acknowledgements and the
 * summary table. Nothing keeps history: a check result, a submission and a
 * per-child deadline are overwritten in place.
 *
 * Every table carries BOTH `organizationId` and `schoolId` so `scopeWhere`
 * applies (hard rule 1). `createdBy` is audit, never ownership. Scores here
 * NEVER feed exams or report cards. File columns are foreign keys to
 * `storage_objects` (ADR-063), indexed for the sweeper's delete check.
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** What the teacher is giving. Each kind allows some ways back (ADR-064). */
export const assignmentKindEnum = pgEnum("assignment_kind", [
  "homework",
  "practice",
  "project",
  "reading",
  "quiz",
]);

/**
 * How the work comes back to the teacher.
 *  - `brought`: brought to class; only the teacher sets each child's result.
 *  - `sent`: sent in the app (photos and/or typed text); not sent by the close
 *    time becomes `missing`.
 *  - `tick`: the student ticks it done; nothing to check.
 *  - `none`: nothing comes back; it only goes in the diary.
 *  - `questions`: a quiz, answered in the app.
 */
export const homeworkComesBackEnum = pgEnum("homework_comes_back", [
  "brought",
  "sent",
  "tick",
  "none",
  "questions",
]);

/**
 * What the teacher adds on top of the check (Done / Incomplete / Not done).
 * Only for work that comes back to the teacher; a quiz is always `marks`.
 */
export const assignmentGradingModeEnum = pgEnum("assignment_grading_mode", [
  "none",
  "marks",
  "grade",
  "remark",
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

/**
 * One child's homework, in the order it moves:
 *  - `assigned`: to do.
 *  - `in_progress`: a quiz attempt is open.
 *  - `submitted`: sent, ticked, or a quiz handed in.
 *  - `redo`: the teacher sent it back; the student sends again.
 *  - `checked`: the teacher recorded a check result (or a quiz was marked).
 *  - `missing`: work sent in the app or a quiz, nothing by the close time.
 */
export const studentAssignmentStatusEnum = pgEnum("student_assignment_status", [
  "assigned",
  "in_progress",
  "submitted",
  "redo",
  "checked",
  "missing",
]);

/** The teacher's check result for one child. */
export const homeworkCheckStatusEnum = pgEnum("homework_check_status", [
  "done",
  "incomplete",
  "not_done",
  "absent",
]);

/** Grading mode `remark`: one of three words. */
export const homeworkRemarkEnum = pgEnum("homework_remark", ["excellent", "good", "bad"]);

/** Who ticked work that comes back as `tick`. */
export const homeworkTickSourceEnum = pgEnum("homework_tick_source", ["student", "teacher"]);

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

/** When a student may see their score / the answer key. */
export const questionRevealPolicyEnum = pgEnum("homework_reveal_policy", [
  "never",
  "after_submit",
  "after_close",
]);

// ---------------------------------------------------------------------------
// 1. ASSIGNMENTS — what the teacher gave
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
    // Provenance when given again to another class or copied.
    sourceAssignmentId: uuid().references((): AnyPgColumn => assignments.id),

    kind: assignmentKindEnum().notNull(),
    comesBack: homeworkComesBackEnum().notNull(),
    // Homework/Practice/Project: the short title; Reading: chapter or pages.
    title: varchar({ length: 250 }).notNull(),
    // Homework/Practice/Project: details (typed questions, instructions).
    description: text(),
    // Reading: the book.
    topic: varchar({ length: 250 }),
    estimatedMinutes: integer(),

    gradingMode: assignmentGradingModeEnum().notNull().default("none"),
    maxMarks: numeric({ precision: 7, scale: 2 }),
    // Grading mode `grade`: the school's default scale, fixed at creation.
    gradingScaleId: uuid().references(() => gradingScales.id),

    // A future publish moment → status `scheduled`; the homework worker
    // publishes it.
    publishAt: timestamp({ withTimezone: true }),
    // due_at is the on-time mark; close_at the hard cutoff (equal = no late).
    dueAt: timestamp({ withTimezone: true }).notNull(),
    closeAt: timestamp({ withTimezone: true }).notNull(),

    status: assignmentStatusEnum().notNull().default("draft"),
    publishedAt: timestamp({ withTimezone: true }),
    // Set on the first hand-in, attempt or check: freezes how it comes back,
    // grading, the classes and a quiz's questions.
    isLocked: boolean().notNull().default(false),
    cancelledAt: timestamp({ withTimezone: true }),

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
    index("assignments_school_year_status_idx").on(t.schoolId, t.academicYearId, t.status),
    index("assignments_subject_due_idx").on(t.subjectId, t.dueAt),
    index("assignments_status_due_idx").on(t.status, t.dueAt),
    index("assignments_created_by_idx").on(t.createdBy, t.createdAt),
    check("assignments_close_after_due", sql`close_at >= due_at`),
    check(
      "assignments_quiz_questions",
      sql`(kind = 'quiz') = (comes_back = 'questions')`,
    ),
    check(
      "assignments_grading_needs_return",
      sql`grading_mode = 'none' OR comes_back IN ('brought','sent','questions')`,
    ),
    check("assignment_marks_require_max", sql`grading_mode <> 'marks' OR max_marks IS NOT NULL`),
    check(
      "assignment_grade_requires_scale",
      sql`grading_mode <> 'grade' OR grading_scale_id IS NOT NULL`,
    ),
  ],
);

/** Audience: one or more sections, or some students of them. */
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

/** The teacher's photos (board, worksheet). Images only for now (ADR-064). */
export const assignmentFiles = pgTable(
  "assignment_files",
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
    objectId: uuid()
      .notNull()
      .references(() => storageObjects.id),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    index("assignment_files_assignment_idx").on(t.assignmentId),
    index("assignment_files_object_idx").on(t.objectId),
  ],
);

// ---------------------------------------------------------------------------
// 2. STUDENT_ASSIGNMENTS — one row per child, resolved when given. The check
// result lives here and is overwritten when changed (no history, ADR-064).
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
    // Section at the moment it was given.
    sectionId: uuid()
      .notNull()
      .references(() => sections.id),

    status: studentAssignmentStatusEnum().notNull().default("assigned"),
    // Copied from the assignment when given; moving a due date (for everyone,
    // one section or one child) rewrites these.
    effectiveDueAt: timestamp({ withTimezone: true }).notNull(),
    effectiveCloseAt: timestamp({ withTimezone: true }).notNull(),

    firstViewedAt: timestamp({ withTimezone: true }),
    // When the student last opened it after a result or a send-back, and last
    // read its questions: what makes it show as "new" in the family app.
    resultSeenAt: timestamp({ withTimezone: true }),
    commentsSeenAt: timestamp({ withTimezone: true }),
    // Sent, ticked or handed in; cleared when a tick is undone.
    submittedAt: timestamp({ withTimezone: true }),
    isLate: boolean().notNull().default(false),
    tickedBy: homeworkTickSourceEnum(),

    // The teacher's check result. Visible to the student once saved.
    checkStatus: homeworkCheckStatusEnum(),
    marks: numeric({ precision: 7, scale: 2 }),
    grade: varchar({ length: 20 }),
    remark: homeworkRemarkEnum(),
    // A note the student sees (also the reason for a redo).
    note: text(),
    checkedBy: text().references(() => user.id),
    checkedAt: timestamp({ withTimezone: true }),

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
    index("student_assignments_enrollment_status_idx").on(t.studentEnrollmentId, t.status),
    index("student_assignments_assignment_section_idx").on(t.assignmentId, t.sectionId),
    index("student_assignments_section_idx").on(t.sectionId),
    // The worker's scan path (missing at close).
    index("student_assignments_close_scan_idx")
      .on(t.effectiveCloseAt)
      .where(sql`status IN ('assigned','in_progress','redo')`),
  ],
);

// ---------------------------------------------------------------------------
// 3. SUBMISSIONS — at most one per child, replaced until checked (ADR-064)
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
    bodyText: text(),
    // Stored, never shown (a parent and a student login are treated the same).
    submittedByUserId: text()
      .notNull()
      .references(() => user.id),
    isLate: boolean().notNull().default(false),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("submissions_sa_uq").on(t.studentAssignmentId)],
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
  (t) => [
    index("submission_files_submission_idx").on(t.submissionId),
    index("submission_files_object_idx").on(t.objectId),
  ],
);

// ---------------------------------------------------------------------------
// 4. COMMENTS
// studentAssignmentId NULL  => class-wide questions on the homework
// studentAssignmentId SET   => private thread (student <-> teacher)
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
    authorUserId: text()
      .notNull()
      .references(() => user.id),
    body: text().notNull(),
    isDeleted: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assignment_comments_assignment_idx").on(t.assignmentId, t.createdAt),
    index("assignment_comments_sa_idx")
      .on(t.studentAssignmentId)
      .where(sql`student_assignment_id IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// 5. QUESTION BANK — reusable questions (Private / School visibility)
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
    index("question_bank_items_image_idx").on(t.imageObjectId),
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
  (t) => [
    index("question_options_question_idx").on(t.questionId),
    index("question_options_image_idx").on(t.imageObjectId),
  ],
);

// ---------------------------------------------------------------------------
// 6. QUESTION-SET CONFIG (1:1 with assignment)
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

    showScore: questionRevealPolicyEnum().notNull().default("after_submit"),
    showAnswers: questionRevealPolicyEnum().notNull().default("after_close"),
    showExplanations: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex("assignment_question_settings_assignment_uq").on(t.assignmentId)],
);

// ---------------------------------------------------------------------------
// 7. ASSIGNMENT QUESTIONS — the SNAPSHOT taken when the set is attached.
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
    index("assignment_questions_image_idx").on(t.imageObjectId),
  ],
);

// ---------------------------------------------------------------------------
// 8. ATTEMPTS & ANSWERS
// One attempt per student (ADR-064). No timer: the only limit is
// student_assignments.effective_close_at; the worker hands in open attempts at close.
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
    // ADR-064: one attempt per student.
    uniqueIndex("question_attempts_sa_uq").on(t.studentAssignmentId),
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
  (t) => [
    index("question_attempt_answer_files_answer_idx").on(t.answerId),
    index("question_attempt_answer_files_object_idx").on(t.objectId),
  ],
);
