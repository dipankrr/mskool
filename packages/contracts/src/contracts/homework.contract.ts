import {
  assignmentEvaluations,
  assignmentSettings,
  assignmentTargets,
  assignments,
  rubricCriteria,
  rubricLevels,
  rubrics,
  studentAssignments,
  submissions,
} from "@repo/db/schema";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * HOMEWORK / ASSIGNMENTS vocabulary (ADR-039).
 *
 * Operation inputs are handcrafted (the house pattern for anything with
 * timestamps the client sends): the wire format is ISO strings, never Date
 * objects, and createInsertSchema would demand Dates. Read models are
 * drizzle-zod select schemas. Marks are decimal STRINGS (hard rule 4's
 * cousin — never float), validated by the same money regex the fees
 * contract uses.
 */

const MARKS = /^\d{1,5}(\.\d{1,2})?$/;
const marksSchema = z.string().regex(MARKS, "Use a number with up to 2 decimals");

// ---------------------------------------------------------------------------
// Settings — school default + per-class overrides
// ---------------------------------------------------------------------------

export const assignmentSettingsSelectSchema = createSelectSchema(assignmentSettings);
export type AssignmentSettings = z.infer<typeof assignmentSettingsSelectSchema>;

export const upsertAssignmentSettingsInput = createSelectSchema(assignmentSettings, {
  maxFilesPerSubmission: z.number().int().min(1).max(20),
  maxFileSizeMb: z.number().int().min(1).max(100),
  defaultLateWindowHours: z.number().int().min(0).max(24 * 30),
  maxAssignmentsPerDay: z.number().int().min(1).max(20).nullable(),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // The caller names the class for an override, or omits it for the
    // school default row. (The select schema's classId would also accept it,
    // but the explicit field keeps the router's two endpoints honest.)
  });

/**
 * The EFFECTIVE settings for a class: the class override with the school
 * default filling every absent field. This is what publish-time checks read.
 */
export const effectiveAssignmentSettingsSchema = assignmentSettingsSelectSchema.omit({
  id: true,
  organizationId: true,
  schoolId: true,
  classId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});
export type EffectiveAssignmentSettings = z.infer<
  typeof effectiveAssignmentSettingsSchema
>;

// ---------------------------------------------------------------------------
// Rubrics
// ---------------------------------------------------------------------------

export const rubricSelectSchema = createSelectSchema(rubrics);
export const rubricCriterionSelectSchema = createSelectSchema(rubricCriteria);
export const rubricLevelSelectSchema = createSelectSchema(rubricLevels);

export const rubricLevelInput = z.object({
  label: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  points: marksSchema,
  sortOrder: z.number().int().min(0).default(0),
});

export const rubricCriterionInput = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  sortOrder: z.number().int().min(0).default(0),
  levels: z.array(rubricLevelInput).min(1),
});

export const createRubricInput = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  criteria: z.array(rubricCriterionInput).min(1),
});
export type CreateRubricInput = z.infer<typeof createRubricInput>;

export const rubricDetailSchema = rubricSelectSchema.extend({
  criteria: z.array(
    rubricCriterionSelectSchema.extend({
      levels: z.array(rubricLevelSelectSchema),
    }),
  ),
});
export type RubricDetail = z.infer<typeof rubricDetailSchema>;

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export const assignmentSelectSchema = createSelectSchema(assignments);
export type Assignment = z.infer<typeof assignmentSelectSchema>;
export const assignmentTargetSelectSchema = createSelectSchema(assignmentTargets);

export const assignmentResourceInput = z
  .object({
    resourceType: z.enum(["file", "link", "video"]),
    objectId: z.uuid().optional(),
    url: z.string().max(2000).optional(),
    title: z.string().max(250).optional(),
    sortOrder: z.number().int().min(0).default(0),
  })
  // The DB holds the same shape CHECK; stating it here gives a field error
  // instead of a 500 for the most likely mistake.
  .refine(
    (r) => (r.resourceType === "file" ? !!r.objectId : !!r.url),
    "A file resource needs an uploaded object; a link/video needs a URL",
  );

export const createAssignmentInput = z
  .object({
    academicYearId: z.uuid(),
    termId: z.uuid().optional(),
    subjectId: z.uuid(),
    // The single target section of v1 (the subject gate's pair). Multi-section
    // targeting is a recorded deferral — the targets table already supports it.
    sectionId: z.uuid(),
    // Optional individual targets (extra students) beyond the section.
    studentEnrollmentIds: z.array(z.uuid()).max(200).optional(),
    kind: z.enum(["homework", "classwork", "project", "worksheet", "reading", "practice", "quiz"]).default("homework"),
    title: z.string().min(1).max(250),
    description: z.string().max(20000).optional(),
    topic: z.string().max(250).optional(),
    estimatedMinutes: z.number().int().min(1).max(600).optional(),

    submissionTypes: z
      .array(z.enum(["none", "tick", "offline", "text", "file", "link", "questions"]))
      .min(1)
      .default(["none"]),
    gradingMode: z
      .enum(["none", "marks", "grade", "rubric", "completion"])
      .default("none"),
    maxMarks: marksSchema.optional(),
    gradingScaleId: z.uuid().optional(),
    rubricId: z.uuid().optional(),

    // Absent closeAt = dueAt + the effective settings' late window.
    dueAt: z.string(),
    closeAt: z.string().optional(),
    latePolicy: z.enum(["not_allowed", "allowed"]).optional(),
    allowResubmission: z.boolean().default(true),
    maxSubmissions: z.number().int().min(1).max(10).optional(),

    resources: z.array(assignmentResourceInput).max(20).optional(),
  })
  .refine((i) => i.gradingMode !== "marks" || !!i.maxMarks, {
    message: "Marks grading needs a maximum",
    path: ["maxMarks"],
  })
  .refine((i) => i.gradingMode !== "grade" || !!i.gradingScaleId, {
    message: "Grade grading needs a grading scale",
    path: ["gradingScaleId"],
  })
  .refine((i) => i.gradingMode !== "rubric" || !!i.rubricId, {
    message: "Rubric grading needs a rubric",
    path: ["rubricId"],
  });
export type CreateAssignmentInput = z.infer<typeof createAssignmentInput>;

/** PATCH + the gate pair. Service verifies the pair matches the row. */
export const updateAssignmentInput = z.object({
  id: z.uuid(),
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  title: z.string().min(1).max(250).optional(),
  description: z.string().max(20000).optional(),
  topic: z.string().max(250).optional(),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
  dueAt: z.string().optional(),
  closeAt: z.string().optional(),
  latePolicy: z.enum(["not_allowed", "allowed"]).optional(),
  allowResubmission: z.boolean().optional(),
  maxSubmissions: z.number().int().min(1).max(10).nullable().optional(),
  submissionTypes: z
    .array(z.enum(["none", "tick", "offline", "text", "file", "link", "questions"]))
    .min(1)
    .optional(),
  resources: z.array(assignmentResourceInput).max(20).optional(),
  changeSummary: z.string().max(500).optional(),
});
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentInput>;

/** Publish / cancel — row-addressed, gate pair required by the builder. */
export const assignmentTransitionInput = z.object({
  id: z.uuid(),
  sectionId: z.uuid(),
  subjectId: z.uuid(),
});
export const cancelAssignmentInput = assignmentTransitionInput.extend({
  reason: z.string().min(3).max(500),
});

export const listAssignmentsInput = z.object({
  academicYearId: z.uuid(),
  subjectId: z.uuid().optional(),
  status: z.enum(["draft", "scheduled", "published", "closed", "cancelled"]).optional(),
  dueFrom: z.string().optional(),
  dueTo: z.string().optional(),
});

export const assignmentDetailSchema = assignmentSelectSchema.extend({
  targets: z.array(assignmentTargetSelectSchema),
  revisionCount: z.number().int(),
});
export type AssignmentDetail = z.infer<typeof assignmentDetailSchema>;

// ---------------------------------------------------------------------------
// Student assignments — the teacher's grading grid + lifecycle acts
// ---------------------------------------------------------------------------

export const studentAssignmentSelectSchema = createSelectSchema(studentAssignments);
export type StudentAssignment = z.infer<typeof studentAssignmentSelectSchema>;

export const listStudentAssignmentsInput = z.object({
  id: z.uuid(), // the assignment
  status: z
    .enum(["assigned", "in_progress", "submitted", "resubmit_requested", "reviewed", "excused", "missing"])
    .optional(),
});

/**
 * Grade / verify / request-resubmit — ONE append-only evaluation row. Which
 * fields are required follows the assignment's gradingMode (service-checked):
 * marks → marks within maxMarks; rubric → rubricScores; completion/none →
 * neither. outcome 'resubmit_requested' ignores marks entirely.
 */
export const evaluateStudentAssignmentInput = z.object({
  id: z.uuid(), // studentAssignmentId
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  outcome: z.enum(["reviewed", "resubmit_requested"]).default("reviewed"),
  marks: marksSchema.optional(),
  grade: z.string().max(20).optional(),
  feedback: z.string().max(5000).optional(),
  rubricScores: z
    .array(
      z.object({
        criterionId: z.uuid(),
        levelId: z.uuid().optional(),
        points: marksSchema,
        comment: z.string().max(2000).optional(),
      }),
    )
    .max(30)
    .optional(),
});
export type EvaluateStudentAssignmentInput = z.infer<
  typeof evaluateStudentAssignmentInput
>;

export const evaluationSelectSchema = createSelectSchema(assignmentEvaluations);
export const submissionSelectSchema = createSelectSchema(submissions);

export const studentAssignmentDetailSchema = studentAssignmentSelectSchema.extend({
  submissions: z.array(submissionSelectSchema),
  evaluations: z.array(evaluationSelectSchema),
});
export type StudentAssignmentDetail = z.infer<typeof studentAssignmentDetailSchema>;

export const grantExtensionInput = z.object({
  id: z.uuid(), // studentAssignmentId
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  newDueAt: z.string(),
  newCloseAt: z.string(),
  reason: z.string().max(500).optional(),
});
export type GrantExtensionInput = z.infer<typeof grantExtensionInput>;

export const excuseStudentAssignmentInput = z.object({
  id: z.uuid(),
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  reason: z.string().min(3).max(500),
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const postAssignmentCommentInput = z.object({
  assignmentId: z.uuid(),
  // Absent = class-wide Q&A; present = the private student↔teacher thread.
  studentAssignmentId: z.uuid().optional(),
  parentCommentId: z.uuid().optional(),
  body: z.string().min(1).max(2000),
});
export type PostAssignmentCommentInput = z.infer<typeof postAssignmentCommentInput>;

export const assignmentCommentSelectSchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  studentAssignmentId: z.uuid().nullable(),
  parentCommentId: z.uuid().nullable(),
  authorUserId: z.string(),
  authorName: z.string(),
  authorIsStaff: z.boolean(),
  body: z.string(),
  isDeleted: z.boolean(),
  createdAt: z.date(),
  editedAt: z.date().nullable(),
});
export type AssignmentComment = z.infer<typeof assignmentCommentSelectSchema>;

// ---------------------------------------------------------------------------
// PORTAL — the family door. Ownership only; nothing unpublished leaks, and
 // no answer key lives in any of these shapes.
// ---------------------------------------------------------------------------

export const portalStudentIdInput = z.object({ studentId: z.uuid() });

export const portalAssignmentListItemSchema = z.object({
  studentAssignmentId: z.uuid(),
  assignmentId: z.uuid(),
  subjectName: z.string(),
  teacherName: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  kind: z.string(),
  topic: z.string().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  submissionTypes: z.array(z.string()),
  status: z.string(),
  dueAt: z.date(),
  closeAt: z.date(),
  isLate: z.boolean(),
  submittedAt: z.date().nullable(),
  submissionCount: z.number().int(),
  currentMarks: z.string().nullable(),
  currentGrade: z.string().nullable(),
  feedback: z.string().nullable(),
  reviewedAt: z.date().nullable(),
  firstViewedAt: z.date().nullable(),
});
export type PortalAssignmentListItem = z.infer<typeof portalAssignmentListItemSchema>;

export const portalSubmissionSchema = z.object({
  id: z.uuid(),
  versionNo: z.number().int(),
  bodyText: z.string().nullable(),
  linkUrl: z.string().nullable(),
  submittedByRole: z.string(),
  isLate: z.boolean(),
  submittedAt: z.date(),
  files: z.array(z.object({ objectId: z.uuid(), sortOrder: z.number().int() })),
});

export const portalEvaluationSchema = z.object({
  outcome: z.string(),
  marks: z.string().nullable(),
  grade: z.string().nullable(),
  feedback: z.string().nullable(),
  evaluatedAt: z.date(),
  isCurrent: z.boolean(),
});

export const portalAssignmentDetailSchema = portalAssignmentListItemSchema.extend({
  resources: z.array(
    z.object({
      resourceType: z.string(),
      objectId: z.uuid().nullable(),
      url: z.string().nullable(),
      title: z.string().nullable(),
    }),
  ),
  submissions: z.array(portalSubmissionSchema),
  evaluations: z.array(portalEvaluationSchema),
  acknowledgedBy: z.array(z.string()),
});
export type PortalAssignmentDetail = z.infer<typeof portalAssignmentDetailSchema>;

export const portalSubmitAssignmentInput = z
  .object({
    studentAssignmentId: z.uuid(),
    bodyText: z.string().max(20000).optional(),
    linkUrl: z.string().max(2000).optional(),
    fileObjectIds: z.array(z.uuid()).max(10).optional(),
  })
  .refine(
    (i) => !!i.bodyText || !!i.linkUrl || (!!i.fileObjectIds && i.fileObjectIds.length > 0),
    "Write something, attach a file, or paste a link",
  );
export type PortalSubmitAssignmentInput = z.infer<typeof portalSubmitAssignmentInput>;

export const portalAcknowledgeInput = z.object({ studentAssignmentId: z.uuid() });

// ---------------------------------------------------------------------------
// SLICE B — QUESTIONS. Bank, the per-assignment snapshot, attempts, and the
// auto-grading result model. The STUDENT-facing schemas below carry NO answer
// key — options are served stripped (id + text only), and correctness/marks
// appear only through the reveal-policy flags.
// ---------------------------------------------------------------------------

import { questionBankItems, questionOptions } from "@repo/db/schema";

export const bankItemSelectSchema = createSelectSchema(questionBankItems);
export const bankOptionSelectSchema = createSelectSchema(questionOptions);

export const bankOptionInput = z.object({
  optionText: z.string().min(1).max(2000),
  imageObjectId: z.uuid().optional(),
  isCorrect: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

export const createBankItemInput = z
  .object({
    subjectId: z.uuid(),
    classId: z.uuid().optional(),
    topic: z.string().max(250).optional(),
    questionType: z.enum([
      "mcq_single", "mcq_multi", "true_false", "fill_blank", "numeric",
      "match", "short_answer", "long_answer", "file_upload",
    ]),
    body: z.string().min(1).max(10000),
    imageObjectId: z.uuid().optional(),
    correctAnswer: z.unknown().optional(),
    explanation: z.string().max(5000).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    defaultMarks: marksSchema.default("1"),
    visibility: z.enum(["private", "school"]).default("private"),
    options: z.array(bankOptionInput).max(10).optional(),
  })
  .refine((i) => !["mcq_single", "mcq_multi"].includes(i.questionType) || (i.options?.length ?? 0) >= 2, {
    message: "MCQ questions need at least two options",
    path: ["options"],
  });
export type CreateBankItemInput = z.infer<typeof createBankItemInput>;

export const bankItemDetailSchema = bankItemSelectSchema.extend({
  options: z.array(bankOptionSelectSchema),
});
export type BankItemDetail = z.infer<typeof bankItemDetailSchema>;

export const listBankItemsInput = z.object({
  subjectId: z.uuid().optional(),
  classId: z.uuid().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  questionType: z
    .enum(["mcq_single", "mcq_multi", "true_false", "fill_blank", "numeric", "match", "short_answer", "long_answer", "file_upload"])
    .optional(),
});

// --- the snapshot ----------------------------------------------------------

/** One snapshot question. Options are snapshotted WITH 1-based ids. */
export const snapshotQuestionInput = z.object({
  sourceQuestionId: z.uuid().optional(),
  position: z.number().int().min(1).max(200),
  questionType: z.enum([
    "mcq_single", "mcq_multi", "true_false", "fill_blank", "numeric",
    "match", "short_answer", "long_answer", "file_upload",
  ]),
  body: z.string().min(1).max(10000),
  imageObjectId: z.uuid().optional(),
  // Server-built from the bank item's options; a fresh question may pass
  // options directly (is_correct stripped on the student read model).
  options: z.array(bankOptionInput).max(10).optional(),
  correctAnswer: z.unknown().optional(),
  explanation: z.string().max(5000).optional(),
  marks: marksSchema.default("1"),
});

export const setAssignmentQuestionsInput = z.object({
  id: z.uuid(), // assignment
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  questions: z.array(snapshotQuestionInput).max(200),
  settings: z
    .object({
      shuffleQuestions: z.boolean().default(false),
      shuffleOptions: z.boolean().default(false),
      oneQuestionAtATime: z.boolean().default(false),
      maxAttempts: z.number().int().min(1).max(10).default(1),
      attemptScoring: z.enum(["best", "latest", "first"]).default("best"),
      showScore: z.enum(["never", "after_submit", "after_close"]).default("after_submit"),
      showAnswers: z.enum(["never", "after_submit", "after_close"]).default("after_close"),
      showExplanations: z.boolean().default(true),
    })
    .optional(),
});
export type SetAssignmentQuestionsInput = z.infer<typeof setAssignmentQuestionsInput>;

/** Staff read of the snapshot — WITH answer keys (teacher-facing). */
export const assignmentQuestionStaffSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  sourceQuestionId: z.uuid().nullable(),
  questionType: z.string(),
  body: z.string(),
  imageFileId: z.uuid().nullable(),
  options: z.array(
    z.object({
      id: z.number().int(),
      text: z.string(),
      imageFileId: z.uuid().nullable(),
      isCorrect: z.boolean(),
    }),
  ).nullable(),
  correctAnswer: z.unknown().nullable(),
  explanation: z.string().nullable(),
  marks: z.string(),
});

// --- attempts (portal) ------------------------------------------------------

export const startAttemptInput = z.object({ studentAssignmentId: z.uuid() });

/** The student's read model: NO isCorrect, NO correctAnswer, NO explanation. */
export const attemptQuestionStudentSchema = z.object({
  id: z.uuid(),
  position: z.number().int(),
  questionType: z.string(),
  body: z.string(),
  imageFileId: z.uuid().nullable(),
  options: z.array(
    z.object({
      id: z.number().int(),
      text: z.string(),
      imageFileId: z.uuid().nullable(),
    }),
  ).nullable(),
  marks: z.string(),
  savedAnswer: z.unknown().nullable(),
  savedFileObjectIds: z.array(z.uuid()),
});
export type AttemptQuestionStudent = z.infer<typeof attemptQuestionStudentSchema>;

export const saveAnswerInput = z.object({
  attemptId: z.uuid(),
  assignmentQuestionId: z.uuid(),
  answer: z.unknown().optional(),
  fileObjectIds: z.array(z.uuid()).max(5).optional(),
});
export type SaveAnswerInput = z.infer<typeof saveAnswerInput>;

export const submitAttemptInput = z.object({ attemptId: z.uuid() });

export const attemptAnswerResultSchema = z.object({
  assignmentQuestionId: z.uuid(),
  isCorrect: z.boolean().nullable(),
  marksAwarded: z.string().nullable(),
  feedback: z.string().nullable(),
  /** Present only when the answer policy allows it. */
  correctAnswer: z.unknown().optional(),
  correctOptionIds: z.array(z.number().int()).optional(),
  explanation: z.string().optional(),
});
export type AttemptAnswerResult = z.infer<typeof attemptAnswerResultSchema>;

export const attemptResultSchema = z.object({
  attemptId: z.uuid(),
  attemptNo: z.number().int(),
  status: z.string(),
  submittedAt: z.date().nullable(),
  isLate: z.boolean(),
  scoreAuto: z.string(),
  scoreManual: z.string(),
  totalScore: z.string(),
  maxScore: z.string(),
  scoreVisible: z.boolean(),
  answersVisible: z.boolean(),
  explanationsVisible: z.boolean(),
  answers: z.array(attemptAnswerResultSchema),
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;

// --- teacher manual grading --------------------------------------------------

export const listAttemptsInput = z.object({ id: z.uuid() }); // studentAssignmentId

export const attemptStaffSchema = z.object({
  id: z.uuid(),
  attemptNo: z.number().int(),
  status: z.string(),
  startedAt: z.date(),
  submittedAt: z.date().nullable(),
  isLate: z.boolean(),
  scoreAuto: z.string(),
  scoreManual: z.string(),
  totalScore: z.string(),
  maxScore: z.string(),
  answers: z.array(
    z.object({
      id: z.uuid(),
      assignmentQuestionId: z.uuid(),
      position: z.number().int(),
      questionType: z.string(),
      body: z.string(),
      answer: z.unknown().nullable(),
      isCorrect: z.boolean().nullable(),
      marksAwarded: z.string().nullable(),
      needsManualReview: z.boolean(),
      feedback: z.string().nullable(),
      fileObjectIds: z.array(z.uuid()),
    }),
  ),
});
export type AttemptStaff = z.infer<typeof attemptStaffSchema>;

export const gradeAttemptAnswerInput = z.object({
  id: z.uuid(), // attempt
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  answerId: z.uuid(),
  marksAwarded: marksSchema,
  isCorrect: z.boolean().optional(),
  feedback: z.string().max(2000).optional(),
});
export type GradeAttemptAnswerInput = z.infer<typeof gradeAttemptAnswerInput>;
