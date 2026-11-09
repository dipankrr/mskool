import {
  assignmentKindEnum,
  assignmentGradingModeEnum,
  homeworkCheckStatusEnum,
  homeworkComesBackEnum,
  homeworkRemarkEnum,
  questionBankItems,
  questionOptions,
  studentAssignmentStatusEnum,
} from "@repo/db/schema";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { imageRefSchema, uploadRequestSchema } from "./storage.contract";

/**
 * HOMEWORK vocabulary (ADR-039, rebuilt by ADR-064).
 *
 * Inputs are handcrafted: the wire format is ISO strings, never Date objects.
 * Read models are hand-written shapes built for one screen each. Marks are
 * decimal STRINGS, never floats.
 */

const MARKS = /^\d{1,5}(\.\d{1,2})?$/;
const marksSchema = z.string().regex(MARKS, "Use a number with up to 2 decimals");
const isoDate = z.iso.datetime({ offset: true });

export const HOMEWORK_KINDS = assignmentKindEnum.enumValues;
export const homeworkKindSchema = z.enum(HOMEWORK_KINDS);
export type HomeworkKind = z.infer<typeof homeworkKindSchema>;

export const COMES_BACK = homeworkComesBackEnum.enumValues;
export const comesBackSchema = z.enum(COMES_BACK);
export type ComesBack = z.infer<typeof comesBackSchema>;

export const GRADING_MODES = assignmentGradingModeEnum.enumValues;
export const gradingModeSchema = z.enum(GRADING_MODES);
export type GradingMode = z.infer<typeof gradingModeSchema>;

export const CHECK_STATUSES = homeworkCheckStatusEnum.enumValues;
export const checkStatusSchema = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const REMARKS = homeworkRemarkEnum.enumValues;
export const remarkSchema = z.enum(REMARKS);
export type Remark = z.infer<typeof remarkSchema>;

export const studentHomeworkStatusSchema = z.enum(studentAssignmentStatusEnum.enumValues);
export type StudentHomeworkStatus = z.infer<typeof studentHomeworkStatusSchema>;

/**
 * Which ways back each kind allows, the first being its default (ADR-064).
 * The service enforces it; the Give screen draws its tiles from it.
 */
export const KIND_COMES_BACK: Record<HomeworkKind, readonly ComesBack[]> = {
  homework: ["brought", "sent", "tick", "none"],
  practice: ["none", "tick", "brought"],
  project: ["brought", "sent"],
  reading: ["tick", "none"],
  quiz: ["questions"],
};

/** Which grading each kind allows, the first being its default. */
export const KIND_GRADING: Record<HomeworkKind, readonly GradingMode[]> = {
  homework: ["none", "marks", "grade", "remark"],
  practice: ["none", "remark"],
  project: ["marks", "grade", "remark"],
  reading: ["none"],
  quiz: ["marks"],
};

/** Grading applies only when the work comes back to the teacher. */
export function comesBackAllowsGrading(comesBack: ComesBack): boolean {
  return comesBack === "brought" || comesBack === "sent" || comesBack === "questions";
}

/** What the student sees on each homework, in their own words. */
/**
 * The student's word for one homework. The six agreed words, plus two endings
 * for work the child can't act on after the due time: `with_teacher` (brought
 * to class, not checked yet) and `over` (nothing comes back).
 */
export const STUDENT_WORDS = ["to_do", "sent", "late", "checked", "redo", "missed", "with_teacher", "over"] as const;
export const studentWordSchema = z.enum(STUDENT_WORDS);
export type StudentWord = z.infer<typeof studentWordSchema>;

const titleSchema = z.string().trim().min(1, "Write a title").max(250);
const detailsSchema = z.string().trim().max(10000);
const fileIdsSchema = z.array(z.uuid()).max(10);

// ---------------------------------------------------------------------------
// Give (create, edit)
// ---------------------------------------------------------------------------

/**
 * The shared part of Give's steps 2 and 4. `sectionIds` are the classes (one
 * subject); `studentEnrollmentIds` narrows to some students of them.
 */
const giveCommon = z.object({
  subjectId: z.uuid(),
  sectionIds: z.array(z.uuid()).min(1).max(20),
  studentEnrollmentIds: z.array(z.uuid()).max(200).optional(),
  dueAt: isoDate,
  /** The late window's end; omitted = no late work. */
  closeAt: isoDate.optional(),
  /** A future moment: the homework waits as `scheduled`. */
  publishAt: isoDate.optional(),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
  /** true = give now; false = keep as a draft. */
  give: z.boolean().default(true),
});

const gradingFields = {
  gradingMode: gradingModeSchema.default("none"),
  maxMarks: marksSchema.optional(),
};

/** Homework, Practice, Project: title, details, photos. */
const workInput = giveCommon.extend({
  kind: z.enum(["homework", "practice", "project"]),
  title: titleSchema,
  details: detailsSchema.optional(),
  fileObjectIds: fileIdsSchema.optional(),
  comesBack: comesBackSchema,
  ...gradingFields,
});

/** Reading: the book and what to read. */
const readingInput = giveCommon.extend({
  kind: z.literal("reading"),
  book: z.string().trim().min(1, "Name the book").max(250),
  pages: titleSchema,
  comesBack: z.enum(["tick", "none"]).default("tick"),
});

/** Quiz: a title; questions are set separately (`homework.questions.set`). */
const quizInput = giveCommon.extend({
  kind: z.literal("quiz"),
  title: titleSchema,
  details: detailsSchema.optional(),
});

export const createHomeworkInput = z.discriminatedUnion("kind", [workInput, readingInput, quizInput]);
export type CreateHomeworkInput = z.infer<typeof createHomeworkInput>;

/**
 * Edit reuses Give's steps 3 and 4. After the first hand-in or check
 * (`isLocked`) the classes, how it comes back and grading are refused.
 */
export const updateHomeworkInput = z.object({
  id: z.uuid(),
  title: titleSchema.optional(),
  details: detailsSchema.nullable().optional(),
  book: z.string().trim().min(1).max(250).optional(),
  fileObjectIds: fileIdsSchema.optional(),
  sectionIds: z.array(z.uuid()).min(1).max(20).optional(),
  studentEnrollmentIds: z.array(z.uuid()).max(200).nullable().optional(),
  comesBack: comesBackSchema.optional(),
  gradingMode: gradingModeSchema.optional(),
  maxMarks: marksSchema.nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(600).nullable().optional(),
  dueAt: isoDate.optional(),
  closeAt: isoDate.nullable().optional(),
  publishAt: isoDate.nullable().optional(),
});
export type UpdateHomeworkInput = z.infer<typeof updateHomeworkInput>;

/** Move the due date for everyone, one section, or one child. */
export const moveDueInput = z.object({
  id: z.uuid(),
  dueAt: isoDate,
  closeAt: isoDate.optional(),
  onlySectionId: z.uuid().optional(),
  onlyStudentAssignmentId: z.uuid().optional(),
});
export type MoveDueInput = z.infer<typeof moveDueInput>;

/** Give the same homework to other classes, as a new homework. */
export const giveAgainInput = z.object({
  id: z.uuid(),
  toSectionIds: z.array(z.uuid()).min(1).max(20),
  dueAt: isoDate,
  closeAt: isoDate.optional(),
});
export type GiveAgainInput = z.infer<typeof giveAgainInput>;

export const listHomeworkInput = z.object({
  academicYearId: z.uuid().optional(),
  kind: homeworkKindSchema.optional(),
  subjectId: z.uuid().optional(),
  forSectionId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  /** Only what the caller gave (a teacher's own list). */
  mine: z.boolean().default(false),
  /** Given before this moment (paging back by date). */
  before: isoDate.optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export type ListHomeworkInput = z.infer<typeof listHomeworkInput>;

// ---------------------------------------------------------------------------
// Read models (staff)
// ---------------------------------------------------------------------------

/** One section's progress on one homework. */
export const sectionProgressSchema = z.object({
  sectionId: z.uuid(),
  sectionName: z.string(),
  className: z.string(),
  total: z.number().int(),
  /** Sent, ticked or handed in, not yet checked. */
  toCheck: z.number().int(),
  checked: z.number().int(),
  /** Ticked (tick) or sent (sent) or handed in (quiz). */
  submitted: z.number().int(),
  missing: z.number().int(),
  redo: z.number().int(),
});
export type SectionProgress = z.infer<typeof sectionProgressSchema>;

export const homeworkSummarySchema = z.object({
  id: z.uuid(),
  kind: homeworkKindSchema,
  comesBack: comesBackSchema,
  gradingMode: gradingModeSchema,
  maxMarks: z.string().nullable(),
  title: z.string(),
  book: z.string().nullable(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  status: z.enum(["draft", "scheduled", "published", "closed", "cancelled"]),
  dueAt: z.date(),
  closeAt: z.date(),
  publishAt: z.date().nullable(),
  publishedAt: z.date().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  createdBy: z.string(),
  createdAt: z.date(),
  sections: z.array(sectionProgressSchema),
  fileCount: z.number().int(),
});
export type HomeworkSummary = z.infer<typeof homeworkSummarySchema>;

export const homeworkDetailSchema = homeworkSummarySchema.extend({
  details: z.string().nullable(),
  isLocked: z.boolean(),
  sourceAssignmentId: z.uuid().nullable(),
  files: z.array(imageRefSchema),
  studentEnrollmentIds: z.array(z.uuid()),
  questionCount: z.number().int(),
  commentCount: z.number().int(),
  createdByName: z.string(),
});
export type HomeworkDetail = z.infer<typeof homeworkDetailSchema>;

/** Home: what the teacher should do next, in Home's order. */
/**
 * Home's day strip for one school week: a count per day (Mon-Sat) for the
 * dots, and the full homework for one day only (a big school's week is large).
 */
const weekStripShape = {
  /** Monday of the school week shown (IST, YYYY-MM-DD). */
  weekStart: z.string(),
  weekDays: z.array(z.object({ day: z.string(), count: z.number().int() })),
  /** The day whose homework is in `dayItems` (IST, YYYY-MM-DD). */
  day: z.string(),
  dayItems: z.array(homeworkSummarySchema),
};
export const weekStripSchema = z.object(weekStripShape);

export const homeworkHomeSchema = z.object({
  /** Brought or sent work past due with children still to check, per section. */
  toCheck: z.array(
    z.object({
      homework: homeworkSummarySchema,
      sectionId: z.uuid(),
      sectionName: z.string(),
      className: z.string(),
      toCheck: z.number().int(),
    }),
  ),
  /** Quizzes still open, or closed with written answers to mark. */
  quizzes: z.array(homeworkSummarySchema.extend({ answersToMark: z.number().int() })),
  /** Given and not yet due. */
  outNow: z.array(homeworkSummarySchema),
  givenToday: z.array(homeworkSummarySchema),
  drafts: z.array(homeworkSummarySchema),
  ...weekStripShape,
});
export type HomeworkHome = z.infer<typeof homeworkHomeSchema>;

/** One class and subject: how it is doing, its homework, who owes work. */
export const classViewSchema = z.object({
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  sectionName: z.string(),
  className: z.string(),
  subjectName: z.string(),
  studentCount: z.number().int(),
  /** Work that comes back, due in the last 30 days, done on time; null with nothing due yet. */
  onTimePct: z.number().int().nullable(),
  toCheck: z.number().int(),
  homework: z.array(homeworkSummarySchema),
  owe: z.array(
    z.object({
      studentId: z.uuid(),
      name: z.string(),
      rollNumber: z.string().nullable(),
      notDone: z.number().int(),
      incomplete: z.number().int(),
      missing: z.number().int(),
    }),
  ),
});
export type ClassView = z.infer<typeof classViewSchema>;

/** Give step 2: the caller's classes, grouped by subject. */
export const givePairsSchema = z.array(
  z.object({
    subjectId: z.uuid(),
    subjectName: z.string(),
    sections: z.array(
      z.object({
        sectionId: z.uuid(),
        sectionName: z.string(),
        classId: z.uuid(),
        className: z.string(),
        studentCount: z.number().int(),
        /** Homework (any subject) already due on the next school day. */
        dueTomorrow: z.number().int(),
      }),
    ),
  }),
);
export type GivePairs = z.infer<typeof givePairsSchema>;

/** Give step 4's starting point: this teacher's last choices for a subject. */
export const giveDefaultsSchema = z.object({
  comesBack: comesBackSchema,
  gradingMode: gradingModeSchema,
  maxMarks: z.string().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  /** The last homework given, for "Same as last time". */
  lastId: z.uuid().nullable(),
});
export type GiveDefaults = z.infer<typeof giveDefaultsSchema>;

/** One child on the checking list. */
export const registerRowSchema = z.object({
  studentAssignmentId: z.uuid(),
  studentId: z.uuid(),
  name: z.string(),
  rollNumber: z.string().nullable(),
  photo: imageRefSchema.nullable(),
  status: studentHomeworkStatusSchema,
  /** Absent today by attendance (only for work brought to class). */
  absentToday: z.boolean(),
  submittedAt: z.date().nullable(),
  isLate: z.boolean(),
  fileCount: z.number().int(),
  checkStatus: checkStatusSchema.nullable(),
  marks: z.string().nullable(),
  grade: z.string().nullable(),
  remark: remarkSchema.nullable(),
  note: z.string().nullable(),
  checkedAt: z.date().nullable(),
});
export type RegisterRow = z.infer<typeof registerRowSchema>;

export const registerSchema = z.object({
  homework: homeworkSummarySchema,
  sectionId: z.uuid(),
  sectionName: z.string(),
  className: z.string(),
  /** The school's grade letters, best first, when grading is `grade`. */
  gradeLetters: z.array(z.string()),
  rows: z.array(registerRowSchema),
});
export type Register = z.infer<typeof registerSchema>;

/** One child's result. A null checkStatus clears it (back to unchecked). */
export const checkResultInput = z.object({
  studentAssignmentId: z.uuid(),
  checkStatus: checkStatusSchema.nullable(),
  marks: marksSchema.nullable().optional(),
  grade: z.string().trim().max(20).nullable().optional(),
  remark: remarkSchema.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type CheckResultInput = z.infer<typeof checkResultInput>;

/** Save the checking list: idempotent, so a retry after a dropped connection is safe. */
export const saveRegisterInput = z.object({
  id: z.uuid(),
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  results: z.array(checkResultInput).min(1).max(200),
});
export type SaveRegisterInput = z.infer<typeof saveRegisterInput>;

export const saveRegisterResultSchema = z.object({
  saved: z.number().int(),
  counts: z.object({
    done: z.number().int(),
    incomplete: z.number().int(),
    notDone: z.number().int(),
    absent: z.number().int(),
    unchecked: z.number().int(),
  }),
});

/** One child's homework for the teacher: what they sent and the result. */
export const studentHomeworkSchema = registerRowSchema.extend({
  homeworkId: z.uuid(),
  sectionId: z.uuid(),
  dueAt: z.date(),
  closeAt: z.date(),
  tickedBy: z.enum(["student", "teacher"]).nullable(),
  submission: z
    .object({
      bodyText: z.string().nullable(),
      submittedAt: z.date(),
      isLate: z.boolean(),
      files: z.array(imageRefSchema),
    })
    .nullable(),
});
export type StudentHomework = z.infer<typeof studentHomeworkSchema>;

export const sendBackInput = z.object({
  id: z.uuid(), // student assignment
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  note: z.string().trim().min(1, "Say what to fix").max(1000),
});

export const markTickInput = z.object({
  id: z.uuid(), // student assignment
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  ticked: z.boolean(),
});

export const homeworkUploadInput = z.object({
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  /** The homework being edited; omitted while giving a new one. */
  homeworkId: z.uuid().optional(),
  files: z.array(uploadRequestSchema).min(1).max(10),
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const postHomeworkCommentInput = z.object({
  assignmentId: z.uuid(),
  /** Set = a private thread with one child; omitted = the class question board. */
  studentAssignmentId: z.uuid().optional(),
  body: z.string().trim().min(1).max(2000),
});
export type PostHomeworkCommentInput = z.infer<typeof postHomeworkCommentInput>;

export const homeworkCommentSchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  studentAssignmentId: z.uuid().nullable(),
  authorName: z.string(),
  /** True when a staff member wrote it. */
  fromStaff: z.boolean(),
  isMine: z.boolean(),
  body: z.string(),
  createdAt: z.date(),
});
export type HomeworkComment = z.infer<typeof homeworkCommentSchema>;

// ---------------------------------------------------------------------------
// The student side (family app). Same shapes for a student and a parent login.
// ---------------------------------------------------------------------------

export const portalHomeworkListInput = z.object({
  studentId: z.uuid(),
  /** `open`: to do, redo and sent-not-checked; `done`: checked or missed. */
  filter: z.enum(["open", "done", "all"]).default("all"),
});

export const portalHomeworkItemSchema = z.object({
  studentAssignmentId: z.uuid(),
  kind: homeworkKindSchema,
  comesBack: comesBackSchema,
  gradingMode: gradingModeSchema,
  maxMarks: z.string().nullable(),
  title: z.string(),
  book: z.string().nullable(),
  subjectName: z.string(),
  teacherName: z.string(),
  estimatedMinutes: z.number().int().nullable(),
  givenAt: z.date(),
  dueAt: z.date(),
  closeAt: z.date(),
  word: studentWordSchema,
  checkStatus: checkStatusSchema.nullable(),
  marks: z.string().nullable(),
  grade: z.string().nullable(),
  remark: remarkSchema.nullable(),
  hasNote: z.boolean(),
  /** A result or send-back not opened since it came. */
  isNew: z.boolean(),
  /** Teacher messages not read yet (class board and the child's own thread). */
  newReplies: z.number().int(),
  /** Untick allowed (a tick before the due time). */
  canUntick: z.boolean(),
});
export type PortalHomeworkItem = z.infer<typeof portalHomeworkItemSchema>;

export const portalHomeworkDetailSchema = portalHomeworkItemSchema.extend({
  details: z.string().nullable(),
  files: z.array(imageRefSchema),
  note: z.string().nullable(),
  /** The student can send (or replace) now. */
  canSend: z.boolean(),
  submission: z
    .object({
      bodyText: z.string().nullable(),
      submittedAt: z.date(),
      isLate: z.boolean(),
      files: z.array(imageRefSchema),
    })
    .nullable(),
  quiz: z
    .object({
      questionCount: z.number().int(),
      attemptId: z.uuid().nullable(),
      attemptStatus: z.enum(["in_progress", "submitted", "graded"]).nullable(),
    })
    .nullable(),
});
export type PortalHomeworkDetail = z.infer<typeof portalHomeworkDetailSchema>;

export const portalHomeworkRefInput = z.object({
  studentId: z.uuid(),
  studentAssignmentId: z.uuid(),
});

export const portalTickInput = portalHomeworkRefInput.extend({ ticked: z.boolean() });

export const portalHomeworkUploadInput = portalHomeworkRefInput.extend({
  files: z.array(uploadRequestSchema).min(1).max(10),
});

/** Send (or replace) the child's work. Replaces any earlier one until checked. */
export const portalSendInput = portalHomeworkRefInput
  .extend({
    bodyText: z.string().trim().max(10000).optional(),
    fileObjectIds: fileIdsSchema.default([]),
  })
  .refine((i) => Boolean(i.bodyText) || i.fileObjectIds.length > 0, {
    message: "Add a photo or type your answer",
    path: ["fileObjectIds"],
  });
export type PortalSendInput = z.infer<typeof portalSendInput>;

export const portalPostCommentInput = portalHomeworkRefInput.extend({
  /** true = the class question board; false = a private note to the teacher. */
  toClass: z.boolean().default(false),
  body: z.string().trim().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// QUESTIONS (quizzes). Bank, the per-quiz snapshot, one attempt each, and the
// auto-marking result model. The STUDENT-facing schemas carry NO answer key —
// options are served stripped (id + text only), and correctness/marks appear
// only through the reveal-policy flags.
// ---------------------------------------------------------------------------

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
  /** The question's picture, as a link the app can show. */
  image: imageRefSchema.nullable(),
  options: z.array(
    z.object({
      id: z.number().int(),
      text: z.string(),
      imageFileId: z.uuid().nullable(),
      image: imageRefSchema.nullable(),
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
