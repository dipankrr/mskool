import { scopeWhere, type DataScope } from "@repo/authz";
import type {
  CreateBankItemInput,
  GradeAttemptAnswerInput,
  SaveAnswerInput,
  SetAssignmentQuestionsInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  assignmentEvaluations,
  assignmentQuestionSettings,
  assignmentQuestions,
  assignmentRevisions,
  assignments,
  questionAttemptAnswerFiles,
  questionAttemptAnswers,
  questionAttempts,
  questionBankItems,
  questionOptions,
  sections,
  studentAssignments,
  studentEnrollments,
  storageObjects,
  subjects,
  assignmentTargets,
} from "@repo/db/schema";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

/**
 * HOMEWORK QUESTIONS (ADR-039 slice B) — the bank, the per-assignment
 * snapshot, the attempt lifecycle, and the auto-grading engine.
 *
 * The two integrity rules that shape everything here:
 *  1. THE SNAPSHOT. `assignment_questions` is a frozen copy taken when the
 *     set is attached — editing the bank never changes a live assignment.
 *     The set locks (`assignments.is_locked`) on the FIRST attempt.
 *  2. THE ANSWER KEY NEVER REACHES A STUDENT SESSION. Every student-facing
 *     read goes through an explicit stripping step; correctness reaches the
 *     family only through the attempt-result view, gated by the assignment's
 *     showScore / showAnswers / showExplanations policies.
 *
 * Auto-grading covers mcq_single, mcq_multi, true_false, numeric (tolerance),
 * fill_blank (accepted-answer list) and match (pair equality); short/long
 * answers and file uploads always flag needs_manual_review for the teacher.
 * No timer: the only bound is student_assignments.effective_close_at.
 * Question scores never feed exams or report cards.
 */

const SCHOOL_LEVEL = (scope: DataScope): DataScope => ({
  ...scope,
  classId: null,
  sectionId: null,
});

const BANK_COLS = {
  organizationId: questionBankItems.organizationId,
  schoolId: questionBankItems.schoolId,
} as const;

const ASSIGNMENT_COLS = {
  organizationId: assignments.organizationId,
  schoolId: assignments.schoolId,
} as const;

const STUDENT_ASSIGNMENT_COLS = {
  organizationId: studentAssignments.organizationId,
  schoolId: studentAssignments.schoolId,
} as const;

const QUESTION_TYPES = [
  "mcq_single",
  "mcq_multi",
  "true_false",
  "fill_blank",
  "numeric",
  "match",
  "short_answer",
  "long_answer",
  "file_upload",
] as const;
type QuestionType = (typeof QUESTION_TYPES)[number];

const OPTION_TYPES: QuestionType[] = ["mcq_single", "mcq_multi"];

/** Stored JSONB shape for snapshot options. */
type SnapshotOption = {
  id: number;
  text: string;
  image_object_id: string | null;
  is_correct: boolean;
};

function requireSchoolId(scope: DataScope): string {
  const schoolId = SCHOOL_LEVEL(scope).schoolId;
  if (!schoolId) {
    throw new Error(
      "Homework needs a school. The caller's scope must resolve to a school node.",
    );
  }
  return schoolId;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const round2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

/** Order-insensitive canonical form for match pairs. */
function canonicalPairs(pairs: unknown): string | null {
  if (!Array.isArray(pairs)) return null;
  const norm = pairs
    .map((p) =>
      Array.isArray(p) && p.length === 2 ? [String(p[0]), String(p[1])] : null,
    )
    .filter((p): p is [string, string] => p !== null)
    .sort((a, b) => (a[0] + "|" + a[1]).localeCompare(b[0] + "|" + b[1]));
  return JSON.stringify(norm);
}

/**
 * THE AUTO-GRADER. Returns null marks for manual-review types; isCorrect null
 * means "not auto-decidable", never "wrong".
 */
export function gradeAutoAnswer(
  questionType: QuestionType,
  correctAnswer: unknown,
  options: SnapshotOption[] | null,
  answer: unknown,
): { isCorrect: boolean | null; needsManualReview: boolean } {
  const noAnswer = answer === null || answer === undefined || answer === "";
  switch (questionType) {
    case "mcq_single":
    case "mcq_multi": {
      const correctIds = (options ?? [])
        .filter((o) => o.is_correct)
        .map((o) => o.id)
        .sort((a, b) => a - b);
      const picked = Array.isArray((answer as { option_ids?: unknown })?.option_ids)
        ? ((answer as { option_ids: unknown[] }).option_ids
            .map((v) => num(v))
            .filter((v): v is number => v !== null) as number[]).sort((a, b) => a - b)
        : null;
      if (noAnswer || !picked) return { isCorrect: false, needsManualReview: false };
      if (questionType === "mcq_single") {
        return { isCorrect: picked.length === 1 && correctIds.includes(picked[0]!), needsManualReview: false };
      }
      return {
        isCorrect:
          picked.length === correctIds.length &&
          picked.every((id, i) => id === correctIds[i]),
        needsManualReview: false,
      };
    }
    case "true_false": {
      const expected = (correctAnswer as { value?: unknown } | null)?.value;
      if (typeof expected !== "boolean") return { isCorrect: null, needsManualReview: true };
      if (noAnswer) return { isCorrect: false, needsManualReview: false };
      return {
        isCorrect: (answer as { value?: unknown }).value === expected,
        needsManualReview: false,
      };
    }
    case "numeric": {
      const c = correctAnswer as { value?: unknown; tolerance?: unknown } | null;
      const expected = num(c?.value);
      if (expected === null) return { isCorrect: null, needsManualReview: true };
      if (noAnswer) return { isCorrect: false, needsManualReview: false };
      const given = num((answer as { value?: unknown }).value);
      if (given === null) return { isCorrect: false, needsManualReview: false };
      const tolerance = num(c?.tolerance) ?? 0;
      return { isCorrect: Math.abs(given - expected) <= tolerance, needsManualReview: false };
    }
    case "fill_blank": {
      const c = correctAnswer as { accepted?: unknown; case_sensitive?: unknown } | null;
      const accepted = Array.isArray(c?.accepted) ? (c!.accepted as unknown[]).map(String) : null;
      if (!accepted) return { isCorrect: null, needsManualReview: true };
      if (noAnswer) return { isCorrect: false, needsManualReview: false };
      const given = String((answer as { text?: unknown }).text ?? "");
      const norm = (v: string) =>
        (c?.case_sensitive ? v : v.toLowerCase()).trim();
      return { isCorrect: accepted.some((a) => norm(a) === norm(given)), needsManualReview: false };
    }
    case "match": {
      const expected = canonicalPairs((correctAnswer as { pairs?: unknown } | null)?.pairs);
      if (!expected) return { isCorrect: null, needsManualReview: true };
      if (noAnswer) return { isCorrect: false, needsManualReview: false };
      return {
        isCorrect: canonicalPairs((answer as { pairs?: unknown }).pairs) === expected,
        needsManualReview: false,
      };
    }
    case "short_answer":
    case "long_answer":
    case "file_upload":
      return { isCorrect: null, needsManualReview: true };
    default:
      return { isCorrect: null, needsManualReview: true };
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Helpers that read rows written in the current transaction accept either. */
type DbLike = typeof db | Tx;

/** Normalizes input options into the stored snapshot shape with 1-based ids. */
function toSnapshotOptions(
  input: { optionText: string; imageObjectId?: string; isCorrect?: boolean }[] | undefined,
): SnapshotOption[] | null {
  if (!input?.length) return null;
  return input.map((o, i) => ({
    id: i + 1,
    text: o.optionText,
    image_object_id: o.imageObjectId ?? null,
    is_correct: o.isCorrect ?? false,
  }));
}

export class HomeworkQuestionsService {
  // -------------------------------------------------------------------------
  // Question bank
  // -------------------------------------------------------------------------

  async createBankItem(scope: DataScope, userId: string, input: CreateBankItemInput) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;

    if (OPTION_TYPES.includes(input.questionType)) {
      const correctCount = (input.options ?? []).filter((o) => o.isCorrect).length;
      if (correctCount === 0) {
        throw new Error("Mark at least one option correct.");
      }
      if (input.questionType === "mcq_single" && correctCount > 1) {
        throw new Error("A single-choice question has exactly one correct option.");
      }
    }

    return db.transaction(async (tx) => {
      const [item] = await tx
        .insert(questionBankItems)
        .values({
          organizationId,
          schoolId,
          subjectId: input.subjectId,
          classId: input.classId ?? null,
          topic: input.topic ?? null,
          questionType: input.questionType,
          body: input.body,
          imageObjectId: input.imageObjectId ?? null,
          correctAnswer: input.correctAnswer ?? null,
          explanation: input.explanation ?? null,
          difficulty: input.difficulty,
          defaultMarks: input.defaultMarks,
          visibility: input.visibility,
          createdBy: userId,
        })
        .returning();
      if (!item) throw new Error("Failed to create the question.");

      if (input.options?.length) {
        await tx.insert(questionOptions).values(
          input.options.map((o) => ({
            organizationId,
            schoolId,
            questionId: item.id,
            optionText: o.optionText,
            imageObjectId: o.imageObjectId ?? null,
            isCorrect: o.isCorrect ?? false,
            sortOrder: o.sortOrder ?? 0,
          })),
        );
      }
      return item;
    });
  }

  async listBankItems(scopes: DataScope[], filters: {
    subjectId?: string;
    classId?: string;
    difficulty?: "easy" | "medium" | "hard";
    questionType?: QuestionType;
  } = {}) {
    const items = await db
      .select()
      .from(questionBankItems)
      .where(
        and(
          scopeWhere(scopes.map(SCHOOL_LEVEL), BANK_COLS),
          eq(questionBankItems.isActive, true),
          filters.subjectId ? eq(questionBankItems.subjectId, filters.subjectId) : undefined,
          filters.classId ? eq(questionBankItems.classId, filters.classId) : undefined,
          filters.difficulty ? eq(questionBankItems.difficulty, filters.difficulty) : undefined,
          filters.questionType ? eq(questionBankItems.questionType, filters.questionType) : undefined,
        ),
      )
      .orderBy(desc(questionBankItems.createdAt))
      .limit(200);
    if (items.length === 0) return [];

    const options = await db
      .select()
      .from(questionOptions)
      .where(inArray(questionOptions.questionId, items.map((i) => i.id)))
      .orderBy(asc(questionOptions.sortOrder));
    return items.map((i) => ({ ...i, options: options.filter((o) => o.questionId === i.id) }));
  }

  async getBankItem(scope: DataScope, itemId: string) {
    const [item] = await db
      .select()
      .from(questionBankItems)
      .where(
        and(eq(questionBankItems.id, itemId), scopeWhere(SCHOOL_LEVEL(scope), BANK_COLS)),
      );
    if (!item) return null;
    const options = await db
      .select()
      .from(questionOptions)
      .where(eq(questionOptions.questionId, itemId))
      .orderBy(asc(questionOptions.sortOrder));
    return { ...item, options };
  }

  async setBankItemActive(scope: DataScope, itemId: string, isActive: boolean) {
    const [row] = await db
      .update(questionBankItems)
      .set({ isActive })
      .where(
        and(eq(questionBankItems.id, itemId), scopeWhere(SCHOOL_LEVEL(scope), BANK_COLS)),
      )
      .returning();
    return row ?? null;
  }

  // -------------------------------------------------------------------------
  // The snapshot — attach / replace an assignment's question set
  // -------------------------------------------------------------------------

  async setAssignmentQuestions(scope: DataScope, userId: string, input: SetAssignmentQuestionsInput) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [assignment] = await tx
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.id, input.id),
            eq(assignments.schoolId, schoolId),
            scopeWhere(SCHOOL_LEVEL(scope), ASSIGNMENT_COLS),
          ),
        );
      if (!assignment) throw new Error("Assignment not found in this school.");
      if (assignment.subjectId !== input.subjectId) {
        throw new Error("The named subject does not match this assignment.");
      }
      if (["closed", "cancelled"].includes(assignment.status)) {
        throw new Error(`A ${assignment.status} assignment cannot take a question set.`);
      }
      if (assignment.isLocked) {
        throw new Error(
          "A student has already started this assignment — its question set is locked.",
        );
      }

      // The gate pair's section half: the named section must be a target of
      // this assignment.
      const [targetRow] = await tx
        .select({ id: assignmentTargets.id })
        .from(assignmentTargets)
        .where(
          and(
            eq(assignmentTargets.assignmentId, assignment.id),
            eq(assignmentTargets.targetType, "section"),
            eq(assignmentTargets.sectionId, input.sectionId),
          ),
        )
        .limit(1);
      if (!targetRow) {
        throw new Error("The named section is not a target of this assignment.");
      }

      // Validate the set: unique positions, MCQs have correct options.
      const positions = new Set<number>();
      for (const q of input.questions) {
        if (positions.has(q.position)) {
          throw new Error(`Two questions share position ${q.position}.`);
        }
        positions.add(q.position);
        if (OPTION_TYPES.includes(q.questionType as QuestionType)) {
          const correct = (q.options ?? []).filter((o) => o.isCorrect).length;
          if (correct === 0) {
            throw new Error(`Question at position ${q.position} has no correct option.`);
          }
          if (q.questionType === "mcq_single" && correct > 1) {
            throw new Error(
              `Question at position ${q.position} is single-choice but has several correct options.`,
            );
          }
        }
      }

      // The published pre-image rule — same as a material edit.
      if (assignment.status === "published") {
        const [revRow] = await tx
          .select({ value: count() })
          .from(assignmentRevisions)
          .where(eq(assignmentRevisions.assignmentId, assignment.id));
        const previousQuestions = await tx
          .select()
          .from(assignmentQuestions)
          .where(eq(assignmentQuestions.assignmentId, assignment.id));
        await tx.insert(assignmentRevisions).values({
          organizationId: assignment.organizationId,
          schoolId: assignment.schoolId,
          assignmentId: assignment.id,
          revisionNo: Number(revRow?.value ?? 0) + 1,
          snapshot: { ...assignment, questions: previousQuestions },
          changeSummary: "Question set changed after publish.",
          changedBy: userId,
        });
      }

      // Replace the set.
      await tx
        .delete(assignmentQuestions)
        .where(eq(assignmentQuestions.assignmentId, assignment.id));
      for (const q of input.questions) {
        await tx.insert(assignmentQuestions).values({
          organizationId: assignment.organizationId,
          schoolId: assignment.schoolId,
          assignmentId: assignment.id,
          sourceQuestionId: q.sourceQuestionId ?? null,
          position: q.position,
          questionType: q.questionType,
          body: q.body,
          imageObjectId: q.imageObjectId ?? null,
          options: toSnapshotOptions(q.options),
          correctAnswer: q.correctAnswer ?? null,
          explanation: q.explanation ?? null,
          marks: q.marks,
        });
      }

      // The assignment accepts the questions channel now.
      if (!assignment.submissionTypes.includes("questions")) {
        await tx
          .update(assignments)
          .set({
            submissionTypes: [...assignment.submissionTypes, "questions"],
          })
          .where(eq(assignments.id, assignment.id));
      }

      if (input.settings) {
        const existing = await tx
          .select({ id: assignmentQuestionSettings.id })
          .from(assignmentQuestionSettings)
          .where(eq(assignmentQuestionSettings.assignmentId, assignment.id));
        if (existing.length) {
          await tx
            .update(assignmentQuestionSettings)
            .set(input.settings)
            .where(eq(assignmentQuestionSettings.assignmentId, assignment.id));
        } else {
          await tx.insert(assignmentQuestionSettings).values({
            organizationId: assignment.organizationId,
            schoolId: assignment.schoolId,
            assignmentId: assignment.id,
            ...input.settings,
          });
        }
      }

      return this.getStaffQuestionSet(tx, assignment.id);
    });
  }

  private async getStaffQuestionSet(tx: DbLike, assignmentId: string) {
    const rows = await tx
      .select()
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignmentId))
      .orderBy(asc(assignmentQuestions.position));
    return rows.map((q) => ({
      id: q.id,
      position: q.position,
      sourceQuestionId: q.sourceQuestionId,
      questionType: q.questionType,
      body: q.body,
      imageFileId: q.imageObjectId,
      options: (q.options as SnapshotOption[] | null)?.map((o) => ({
        id: o.id,
        text: o.text,
        imageFileId: o.image_object_id,
        isCorrect: o.is_correct,
      })) ?? null,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      marks: q.marks,
    }));
  }

  async getAssignmentQuestions(scope: DataScope, assignmentId: string) {
    const [owned] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, assignmentId),
          scopeWhere(SCHOOL_LEVEL(scope), ASSIGNMENT_COLS),
        ),
      );
    if (!owned) return null;
    return this.getStaffQuestionSet(db, assignmentId);
  }

  /** The stripped student view — the ONLY shape that may reach a family. */
  private async getStudentQuestionSet(
    tx: DbLike,
    assignmentId: string,
    savedAnswers: Map<number, { answer: unknown; fileObjectIds: string[] }>,
  ) {
    const rows = await tx
      .select()
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignmentId))
      .orderBy(asc(assignmentQuestions.position));
    return rows.map((q) => ({
      id: q.id,
      position: q.position,
      questionType: q.questionType,
      body: q.body,
      imageFileId: q.imageObjectId,
      // THE STRIP: id/text/image only — is_correct never leaves the server.
      options: (q.options as SnapshotOption[] | null)?.map((o) => ({
        id: o.id,
        text: o.text,
        imageFileId: o.image_object_id,
      })) ?? null,
      marks: q.marks,
      savedAnswer: savedAnswers.get(q.position)?.answer ?? null,
      savedFileObjectIds: savedAnswers.get(q.position)?.fileObjectIds ?? [],
    }));
  }

  // -------------------------------------------------------------------------
  // Attempts (portal)
  // -------------------------------------------------------------------------

  /** Resume-or-open. Locks the question set on the first attempt. */
  async startAttempt(userId: string, studentIds: string[], studentAssignmentId: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ sa: studentAssignments, assignment: assignments })
        .from(studentAssignments)
        .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
        .innerJoin(
          studentEnrollments,
          eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
        )
        .where(
          and(
            eq(studentAssignments.id, studentAssignmentId),
            inArray(studentEnrollments.studentId, studentIds),
          ),
        );
      if (!row) throw new Error("Student assignment not found.");
      const { sa, assignment } = row;
      if (assignment.status !== "published") {
        throw new Error("This assignment is not open.");
      }
      if (new Date().getTime() > sa.effectiveCloseAt.getTime()) {
        throw new Error("The submission window for this homework has closed.");
      }

      const [settings] = await tx
        .select()
        .from(assignmentQuestionSettings)
        .where(eq(assignmentQuestionSettings.assignmentId, assignment.id));

      const questionRows = await tx
        .select({ id: assignmentQuestions.id })
        .from(assignmentQuestions)
        .where(eq(assignmentQuestions.assignmentId, assignment.id));
      if (questionRows.length === 0) {
        throw new Error("This assignment has no question set.");
      }

      const attempts = await tx
        .select()
        .from(questionAttempts)
        .where(eq(questionAttempts.studentAssignmentId, sa.id))
        .orderBy(asc(questionAttempts.attemptNo));
      const inProgress = attempts.find((a) => a.status === "in_progress");
      if (inProgress) return inProgress;

      const maxAttempts = settings?.maxAttempts ?? 1;
      if (attempts.length >= maxAttempts) {
        throw new Error(
          `This assignment allows at most ${maxAttempts} attempt(s).`,
        );
      }

      // Lock the set forever once a student starts.
      if (!assignment.isLocked) {
        await tx
          .update(assignments)
          .set({ isLocked: true })
          .where(eq(assignments.id, assignment.id));
      }

      const order = questionRows.map((q) => q.id);
      if (settings?.shuffleQuestions) {
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
      }

      const [attempt] = await tx
        .insert(questionAttempts)
        .values({
          organizationId: sa.organizationId,
          schoolId: sa.schoolId,
          studentAssignmentId: sa.id,
          attemptNo: attempts.length + 1,
          questionOrder: order,
          maxScore: round2(
            (
              await tx
                .select({ marks: assignmentQuestions.marks })
                .from(assignmentQuestions)
                .where(eq(assignmentQuestions.assignmentId, assignment.id))
            ).reduce((sum, q) => sum + Number(q.marks), 0),
          ),
        })
        .returning();
      if (!attempt) throw new Error("Failed to start the attempt.");

      if (!sa.startedAt || sa.status === "assigned") {
        await tx
          .update(studentAssignments)
          .set({
            startedAt: sa.startedAt ?? new Date(),
            status: "in_progress",
            statusChangedAt: new Date(),
          })
          .where(eq(studentAssignments.id, sa.id));
      }
      return attempt;
    });
  }

  /** The working view for an in-flight attempt — stripped, with saved answers. */
  async getAttemptForStudent(studentIds: string[], attemptId: string) {
    const [row] = await db
      .select({ attempt: questionAttempts, assignmentId: assignments.id })
      .from(questionAttempts)
      .innerJoin(
        studentAssignments,
        eq(questionAttempts.studentAssignmentId, studentAssignments.id),
      )
      .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
      .innerJoin(
        studentEnrollments,
        eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
      )
      .where(
        and(
          eq(questionAttempts.id, attemptId),
          inArray(studentEnrollments.studentId, studentIds),
        ),
      );
    if (!row) return null;

    const answerRows = await db
      .select()
      .from(questionAttemptAnswers)
      .where(eq(questionAttemptAnswers.attemptId, attemptId));
    const fileRows = answerRows.length
      ? await db
          .select({
            answerId: questionAttemptAnswerFiles.answerId,
            objectId: questionAttemptAnswerFiles.objectId,
            sortOrder: questionAttemptAnswerFiles.sortOrder,
          })
          .from(questionAttemptAnswerFiles)
          .where(
            inArray(questionAttemptAnswerFiles.answerId, answerRows.map((a) => a.id)),
          )
      : [];

    const questionIdToPos = new Map<string, number>();
    const questions = await db
      .select()
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, row.assignmentId))
      .orderBy(asc(assignmentQuestions.position));
    for (const q of questions) questionIdToPos.set(q.id, q.position);

    const savedAnswers = new Map<number, { answer: unknown; fileObjectIds: string[] }>();
    for (const a of answerRows) {
      const position = questionIdToPos.get(a.assignmentQuestionId);
      if (position === undefined) continue;
      savedAnswers.set(position, {
        answer: a.answer,
        fileObjectIds: fileRows
          .filter((f) => f.answerId === a.id)
          .sort((x, y) => x.sortOrder - y.sortOrder)
          .map((f) => f.objectId),
      });
    }

    return {
      attemptId: row.attempt.id,
      attemptNo: row.attempt.attemptNo,
      status: row.attempt.status,
      questionOrder: (row.attempt.questionOrder as string[] | null) ?? null,
      maxScore: row.attempt.maxScore,
      questions: await this.getStudentQuestionSet(db, row.assignmentId, savedAnswers),
    };
  }

  async saveAnswer(userId: string, studentIds: string[], input: SaveAnswerInput) {
    void userId;
    return db.transaction(async (tx) => {
      const [attempt] = await tx
        .select({
          attempt: questionAttempts,
          assignmentId: studentAssignments.assignmentId,
        })
        .from(questionAttempts)
        .innerJoin(
          studentAssignments,
          eq(questionAttempts.studentAssignmentId, studentAssignments.id),
        )
        .innerJoin(
          studentEnrollments,
          eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
        )
        .where(
          and(
            eq(questionAttempts.id, input.attemptId),
            inArray(studentEnrollments.studentId, studentIds),
          ),
        );
      if (!attempt) throw new Error("Attempt not found.");
      if (attempt.attempt.status !== "in_progress") {
        throw new Error("This attempt was already submitted.");
      }
      const { attempt: a, assignmentId } = attempt;

      const [question] = await tx
        .select()
        .from(assignmentQuestions)
        .where(
          and(
            eq(assignmentQuestions.id, input.assignmentQuestionId),
            eq(assignmentQuestions.assignmentId, assignmentId),
          ),
        );
      if (!question) throw new Error("That question is not part of this assignment.");

      const [existing] = await tx
        .select({ id: questionAttemptAnswers.id })
        .from(questionAttemptAnswers)
        .where(
          and(
            eq(questionAttemptAnswers.attemptId, a.id),
            eq(questionAttemptAnswers.assignmentQuestionId, question.id),
          ),
        );

      const answerRow = existing
        ? (
            await tx
              .update(questionAttemptAnswers)
              .set({ answer: input.answer ?? null, answeredAt: new Date() })
              .where(eq(questionAttemptAnswers.id, existing.id))
              .returning()
          )[0]
        : (
            await tx
              .insert(questionAttemptAnswers)
              .values({
                organizationId: a.organizationId,
                schoolId: a.schoolId,
                attemptId: a.id,
                assignmentQuestionId: question.id,
                answer: input.answer ?? null,
                needsManualReview: ["short_answer", "long_answer", "file_upload"].includes(
                  question.questionType,
                ),
              })
              .returning()
          )[0];
      if (!answerRow) throw new Error("Failed to save the answer.");

      if (input.fileObjectIds) {
        await tx
          .delete(questionAttemptAnswerFiles)
          .where(eq(questionAttemptAnswerFiles.answerId, answerRow.id));
        if (input.fileObjectIds.length) {
          const objects = await tx
            .select({ id: storageObjects.id })
            .from(storageObjects)
            .where(
              and(
                inArray(storageObjects.id, input.fileObjectIds),
                eq(storageObjects.organizationId, a.organizationId),
              ),
            );
          if (objects.length !== input.fileObjectIds.length) {
            throw new Error("One or more attached files could not be found.");
          }
          await tx.insert(questionAttemptAnswerFiles).values(
            input.fileObjectIds.map((objectId, i) => ({
              organizationId: a.organizationId,
              schoolId: a.schoolId,
              answerId: answerRow.id,
              objectId,
              sortOrder: i,
            })),
          );
        }
      }

      return { answerId: answerRow.id };
    });
  }

  /**
   * SUBMIT — auto-grade everything decidable, flag the rest, and (when
   * nothing needs a human) write the is_auto evaluation immediately.
   */
  async submitAttempt(userId: string, studentIds: string[], attemptId: string) {
    void userId;
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ attempt: questionAttempts, sa: studentAssignments })
        .from(questionAttempts)
        .innerJoin(
          studentAssignments,
          eq(questionAttempts.studentAssignmentId, studentAssignments.id),
        )
        .innerJoin(
          studentEnrollments,
          eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
        )
        .where(
          and(
            eq(questionAttempts.id, attemptId),
            inArray(studentEnrollments.studentId, studentIds),
          ),
        );
      if (!row) throw new Error("Attempt not found.");
      const { attempt, sa } = row;
      if (attempt.status !== "in_progress") {
        throw new Error("This attempt was already submitted.");
      }

      const now = new Date();
      if (now.getTime() > sa.effectiveCloseAt.getTime()) {
        throw new Error("The submission window for this homework has closed.");
      }
      const isLate = now.getTime() > sa.effectiveDueAt.getTime();

      const questions = await tx
        .select()
        .from(assignmentQuestions)
        .where(eq(assignmentQuestions.assignmentId, sa.assignmentId));
      const answers = await tx
        .select()
        .from(questionAttemptAnswers)
        .where(eq(questionAttemptAnswers.attemptId, attempt.id));
      const answerByQuestion = new Map(answers.map((a) => [a.assignmentQuestionId, a]));

      let scoreAuto = 0;
      let maxScore = 0;
      let needsManual = false;
      for (const q of questions) {
        maxScore += Number(q.marks);
        const verdict = gradeAutoAnswer(
          q.questionType as QuestionType,
          q.correctAnswer,
          q.options as SnapshotOption[] | null,
          answerByQuestion.get(q.id)?.answer ?? null,
        );
        const existing = answerByQuestion.get(q.id);
        const marks = verdict.isCorrect === true ? q.marks : verdict.isCorrect === false ? "0" : null;
        if (verdict.isCorrect === true) scoreAuto += Number(q.marks);
        if (verdict.needsManualReview) needsManual = true;
        if (existing) {
          await tx
            .update(questionAttemptAnswers)
            .set({
              isCorrect: verdict.isCorrect,
              marksAwarded: marks,
              needsManualReview: verdict.needsManualReview,
            })
            .where(eq(questionAttemptAnswers.id, existing.id));
        } else {
          await tx.insert(questionAttemptAnswers).values({
            organizationId: sa.organizationId,
            schoolId: sa.schoolId,
            attemptId: attempt.id,
            assignmentQuestionId: q.id,
            answer: null,
            isCorrect: verdict.isCorrect,
            marksAwarded: marks,
            needsManualReview: verdict.needsManualReview,
          });
        }
      }

      const [submitted] = await tx
        .update(questionAttempts)
        .set({
          status: needsManual ? "submitted" : "graded",
          submittedAt: now,
          isLate,
          scoreAuto: round2(scoreAuto),
          maxScore: round2(maxScore),
          totalScore: round2(scoreAuto),
        })
        .where(eq(questionAttempts.id, attempt.id))
        .returning();
      if (!submitted) throw new Error("Failed to submit the attempt.");

      await tx
        .update(studentAssignments)
        .set({
          status: needsManual ? "submitted" : "reviewed",
          submittedAt: now,
          statusChangedAt: now,
          ...(needsManual ? {} : { reviewedAt: now }),
        })
        .where(eq(studentAssignments.id, sa.id));

      if (!needsManual) {
        await this.writeAttemptEvaluation(tx, sa, attempt.id, null);
      }

      return { submitted, needsManualReview: needsManual };
    });
  }

  /**
   * The append-only evaluation for a graded attempt. The SCORE written is the
   * attempt-scoring policy's selection across all graded attempts — the same
   * rule the reference applies, so a best-of-2 resit is honest.
   */
  private async writeAttemptEvaluation(
    tx: Tx,
    sa: typeof studentAssignments.$inferSelect,
    attemptId: string | null,
    evaluatedBy: string | null,
  ) {
    const [settings] = await tx
      .select()
      .from(assignmentQuestionSettings)
      .where(eq(assignmentQuestionSettings.assignmentId, sa.assignmentId));

    const gradedAttempts = await tx
      .select()
      .from(questionAttempts)
      .where(
        and(
          eq(questionAttempts.studentAssignmentId, sa.id),
          inArray(questionAttempts.status, ["submitted", "graded"]),
        ),
      );
    if (gradedAttempts.length === 0) return null;

    const policy = settings?.attemptScoring ?? "best";
    const withScores = gradedAttempts
      .map((a) => ({ a, score: Number(a.totalScore) }))
      .sort((x, y) => x.a.attemptNo - y.a.attemptNo);
    const selected =
      policy === "first"
        ? withScores[0]!
        : policy === "latest"
          ? withScores[withScores.length - 1]!
          : withScores.reduce((best, cur) => (cur.score > best.score ? cur : best));

    await tx
      .update(assignmentEvaluations)
      .set({ isCurrent: false })
      .where(
        and(
          eq(assignmentEvaluations.studentAssignmentId, sa.id),
          eq(assignmentEvaluations.isCurrent, true),
        ),
      );

    const [evaluation] = await tx
      .insert(assignmentEvaluations)
      .values({
        organizationId: sa.organizationId,
        schoolId: sa.schoolId,
        studentAssignmentId: sa.id,
        submissionId: null,
        outcome: "reviewed",
        marks: selected.a.totalScore,
        feedback: null,
        isCurrent: true,
        evaluatedBy,
        isAuto: evaluatedBy === null,
      })
      .returning();
    if (!evaluation) throw new Error("Failed to write the evaluation.");

    const [updatedSa] = await tx
      .update(studentAssignments)
      .set({
        currentEvaluationId: evaluation.id,
        currentMarks: selected.a.totalScore,
        reviewedAt: new Date(),
        status: "reviewed",
        statusChangedAt: new Date(),
      })
      .where(eq(studentAssignments.id, sa.id))
      .returning();
    void attemptId;
    return { evaluation, studentAssignment: updatedSa ?? sa };
  }

  // -------------------------------------------------------------------------
  // The result view — reveal-policy gated
  // -------------------------------------------------------------------------

  async getAttemptResult(studentIds: string[], attemptId: string) {
    const [row] = await db
      .select({ attempt: questionAttempts, sa: studentAssignments })
      .from(questionAttempts)
      .innerJoin(
        studentAssignments,
        eq(questionAttempts.studentAssignmentId, studentAssignments.id),
      )
      .innerJoin(
        studentEnrollments,
        eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
      )
      .where(
        and(
          eq(questionAttempts.id, attemptId),
          inArray(studentEnrollments.studentId, studentIds),
        ),
      );
    if (!row) return null;
    const { attempt, sa } = row;
    if (attempt.status === "in_progress") {
      throw new Error("Submit the attempt first.");
    }

    const [settings] = await db
      .select()
      .from(assignmentQuestionSettings)
      .where(eq(assignmentQuestionSettings.assignmentId, sa.assignmentId));

    const closed = new Date().getTime() > sa.effectiveCloseAt.getTime();
    const gate = (policy: string): boolean =>
      policy === "after_submit"
        ? attempt.status !== "in_progress"
        : policy === "after_close"
          ? closed
          : false;
    // Column defaults are the policy when the school never saved a row.
    const scoreVisible = gate(settings?.showScore ?? "after_submit");
    const answersVisible = gate(settings?.showAnswers ?? "after_close");
    const explanationsVisible = answersVisible && (settings?.showExplanations ?? true);

    const questions = await db
      .select()
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, sa.assignmentId))
      .orderBy(asc(assignmentQuestions.position));
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const answers = await db
      .select()
      .from(questionAttemptAnswers)
      .where(eq(questionAttemptAnswers.attemptId, attempt.id));
    // Deterministic order: the question's position, never table order.
    const positionOf = new Map(
      questions.map((q) => [q.id, q.position] as const),
    );
    answers.sort(
      (x, y) => (positionOf.get(x.assignmentQuestionId) ?? 0) - (positionOf.get(y.assignmentQuestionId) ?? 0),
    );

    return {
      attemptId: attempt.id,
      attemptNo: attempt.attemptNo,
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      isLate: attempt.isLate,
      scoreAuto: attempt.scoreAuto,
      scoreManual: attempt.scoreManual,
      totalScore: attempt.totalScore,
      maxScore: attempt.maxScore,
      scoreVisible,
      answersVisible,
      explanationsVisible,
      answers: answers.map((a) => {
        const q = questionById.get(a.assignmentQuestionId);
        const options = (q?.options as SnapshotOption[] | null) ?? null;
        return {
          assignmentQuestionId: a.assignmentQuestionId,
          isCorrect: scoreVisible ? a.isCorrect : null,
          marksAwarded: scoreVisible ? a.marksAwarded : null,
          feedback: a.feedback,
          correctAnswer: answersVisible ? (q?.correctAnswer ?? null) : undefined,
          correctOptionIds: answersVisible
            ? (options ?? []).filter((o) => o.is_correct).map((o) => o.id)
            : undefined,
          explanation: explanationsVisible ? (q?.explanation ?? undefined) : undefined,
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Teacher side — the manual-grading pass
  // -------------------------------------------------------------------------

  async listAttempts(scopes: DataScope[], studentAssignmentId: string) {
    const [owned] = await db
      .select({ id: studentAssignments.id })
      .from(studentAssignments)
      .where(
        and(
          eq(studentAssignments.id, studentAssignmentId),
          scopeWhere(scopes.map(SCHOOL_LEVEL), STUDENT_ASSIGNMENT_COLS),
        ),
      );
    if (!owned) return null;

    const attemptRows = await db
      .select()
      .from(questionAttempts)
      .where(eq(questionAttempts.studentAssignmentId, studentAssignmentId))
      .orderBy(asc(questionAttempts.attemptNo));
    if (attemptRows.length === 0) return [];

    const answerRows = await db
      .select({
        id: questionAttemptAnswers.id,
        attemptId: questionAttemptAnswers.attemptId,
        assignmentQuestionId: questionAttemptAnswers.assignmentQuestionId,
        answer: questionAttemptAnswers.answer,
        isCorrect: questionAttemptAnswers.isCorrect,
        marksAwarded: questionAttemptAnswers.marksAwarded,
        needsManualReview: questionAttemptAnswers.needsManualReview,
        feedback: questionAttemptAnswers.feedback,
        position: assignmentQuestions.position,
        questionType: assignmentQuestions.questionType,
        body: assignmentQuestions.body,
      })
      .from(questionAttemptAnswers)
      .innerJoin(
        assignmentQuestions,
        eq(questionAttemptAnswers.assignmentQuestionId, assignmentQuestions.id),
      )
      .where(inArray(questionAttemptAnswers.attemptId, attemptRows.map((a) => a.id)))
      .orderBy(asc(assignmentQuestions.position));
    const fileRows = answerRows.length
      ? await db
          .select({
            answerId: questionAttemptAnswerFiles.answerId,
            objectId: questionAttemptAnswerFiles.objectId,
            sortOrder: questionAttemptAnswerFiles.sortOrder,
          })
          .from(questionAttemptAnswerFiles)
          .where(
            inArray(questionAttemptAnswerFiles.answerId, answerRows.map((a) => a.id)),
          )
      : [];

    return attemptRows.map((a) => ({
      id: a.id,
      attemptNo: a.attemptNo,
      status: a.status,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      isLate: a.isLate,
      scoreAuto: a.scoreAuto,
      scoreManual: a.scoreManual,
      totalScore: a.totalScore,
      maxScore: a.maxScore,
      answers: answerRows
        .filter((ans) => ans.attemptId === a.id)
        .map((ans) => ({
          id: ans.id,
          assignmentQuestionId: ans.assignmentQuestionId,
          position: ans.position,
          questionType: ans.questionType,
          body: ans.body,
          answer: ans.answer,
          isCorrect: ans.isCorrect,
          marksAwarded: ans.marksAwarded,
          needsManualReview: ans.needsManualReview,
          feedback: ans.feedback,
          fileObjectIds: fileRows
            .filter((f) => f.answerId === ans.id)
            .sort((x, y) => x.sortOrder - y.sortOrder)
            .map((f) => f.objectId),
        })),
    }));
  }

  /**
   * Grade one manual answer. Recomputes the attempt's manual score; when the
   * last manual answer is settled the attempt becomes `graded` and the
   * evaluation row is written through the policy selection.
   */
  async gradeAttemptAnswer(scope: DataScope, userId: string, input: GradeAttemptAnswerInput) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ attempt: questionAttempts, sa: studentAssignments })
        .from(questionAttempts)
        .innerJoin(
          studentAssignments,
          eq(questionAttempts.studentAssignmentId, studentAssignments.id),
        )
        .where(
          and(
            eq(questionAttempts.id, input.id),
            eq(studentAssignments.schoolId, schoolId),
            scopeWhere(SCHOOL_LEVEL(scope), STUDENT_ASSIGNMENT_COLS),
          ),
        );
      if (!row) throw new Error("Attempt not found in this school.");
      const { attempt, sa } = row;
      if (attempt.status === "in_progress") {
        throw new Error("The student has not submitted this attempt yet.");
      }
      if (sa.sectionId !== input.sectionId) {
        throw new Error("The named section/subject do not match this student's assignment.");
      }

      const [answer] = await tx
        .select()
        .from(questionAttemptAnswers)
        .where(
          and(
            eq(questionAttemptAnswers.id, input.answerId),
            eq(questionAttemptAnswers.attemptId, attempt.id),
          ),
        );
      if (!answer) throw new Error("That answer is not part of this attempt.");
      const [question] = await tx
        .select()
        .from(assignmentQuestions)
        .where(eq(assignmentQuestions.id, answer.assignmentQuestionId));
      if (question && Number(input.marksAwarded) > Number(question.marks)) {
        throw new Error(`The score cannot exceed the question's maximum (${question.marks}).`);
      }

      await tx
        .update(questionAttemptAnswers)
        .set({
          marksAwarded: input.marksAwarded,
          isCorrect: input.isCorrect ?? null,
          feedback: input.feedback ?? null,
          needsManualReview: false,
          gradedBy: userId,
          gradedAt: new Date(),
        })
        .where(eq(questionAttemptAnswers.id, answer.id));

      // Recompute the manual score from the settled answers.
      const allAnswers = await tx
        .select()
        .from(questionAttemptAnswers)
        .where(eq(questionAttemptAnswers.attemptId, attempt.id));
      const marksByQuestion = new Map(
        (await tx
          .select({ id: assignmentQuestions.id, marks: assignmentQuestions.marks })
          .from(assignmentQuestions)
          .where(eq(assignmentQuestions.assignmentId, sa.assignmentId))
        ).map((q) => [q.id, q.marks]),
      );
      let scoreAuto = 0;
      let scoreManual = 0;
      let maxScore = 0;
      let remaining = 0;
      for (const a of allAnswers) {
        const max = Number(marksByQuestion.get(a.assignmentQuestionId) ?? 0);
        maxScore += max;
        if (a.needsManualReview) {
          remaining++;
        } else if (a.gradedBy === null || a.gradedBy === undefined) {
          scoreAuto += Number(a.marksAwarded ?? 0);
        } else {
          scoreManual += Number(a.marksAwarded ?? 0);
        }
      }

      const done = remaining === 0;
      const [updated] = await tx
        .update(questionAttempts)
        .set({
          scoreAuto: round2(scoreAuto),
          scoreManual: round2(scoreManual),
          totalScore: round2(scoreAuto + scoreManual),
          maxScore: round2(maxScore),
          ...(done ? { status: "graded" as const } : {}),
        })
        .where(eq(questionAttempts.id, attempt.id))
        .returning();

      if (done) {
        await this.writeAttemptEvaluation(tx, sa, attempt.id, userId);
      }
      return { attempt: updated ?? attempt, fullyGraded: done };
    });
  }

  // -------------------------------------------------------------------------
  // B6 owner resolver
  // -------------------------------------------------------------------------

  async getAttemptOwnerId(organizationId: string, attemptId: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: questionAttempts.schoolId })
      .from(questionAttempts)
      .where(
        and(
          eq(questionAttempts.id, attemptId),
          eq(questionAttempts.organizationId, organizationId),
        ),
      );
    return row?.schoolId ?? null;
  }

}

export const homeworkQuestionsService = new HomeworkQuestionsService();
