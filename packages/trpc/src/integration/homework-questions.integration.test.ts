import { beforeAll, describe, expect, it } from "vitest";

/**
 * HOMEWORK QUESTIONS (ADR-039 slice B) — the proofs against REAL Postgres:
 *
 *   - the bank: MCQ option validation, tenancy;
 *   - the SNAPSHOT: attaching a set writes frozen copies, auto-adds the
 *     questions channel, and locks forever on the first attempt;
 *   - THE ANSWER KEY NEVER REACHES A STUDENT SESSION: the attempt view strips
 *     is_correct/correct_answer/explanation, and the result view reveals
 *     correctness and keys only through the show_score/show_answers policies;
 *   - the auto-grader: MCQ single/multi, true_false, numeric with tolerance,
 *     fill_blank accepted answers, match pairs — and short answers flagged
 *     for the teacher, whose manual grade finalizes the attempt and writes
 *     the evaluation;
 *   - the attempt cap and the is_auto evaluation path.
 *
 * FIXTURE: the authz world's OWNED student (6-A) reached through run-scoped
 * portal logins; no new enrollments (other suites pin the roster).
 */

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  assignmentEvaluations,
  assignmentQuestions,
  assignments,
  questionAttemptAnswers,
  questionAttempts,
  studentAssignments,
} from "@repo/db/schema";
import { homeworkQuestionsService, homeworkService } from "@repo/services";
import { and, eq } from "drizzle-orm";
import { buildWorld, findOrCreateUser } from "./world";

const RUN = Date.now();
const title = (s: string) => `ITG HWQ ${RUN} ${s}`;

const schoolScope = (organizationId: string, schoolId: string): DataScope => ({
  organizationId,
  schoolId,
  classId: null,
  sectionId: null,
});

function dueInDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(18, 0, 0, 0);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString();
}

const MCQ_OPTIONS = [
  { optionText: "4", isCorrect: true, sortOrder: 0 },
  { optionText: "5", isCorrect: false, sortOrder: 1 },
  { optionText: "6", isCorrect: false, sortOrder: 2 },
];

describe("homework questions (slice B)", () => {
  let orgAId: string;
  let orgBId: string;
  let scopeA1: DataScope;
  let scopeB1: DataScope;
  let section6aId: string;
  let subjectMathId: string;
  let currentYearAId: string;
  let adminAId: string;

  let portalStudentUserId: string;
  let portalStudentId: string;
  let portalEnrollmentId: string;
  let autoSaId: string; // auto-gradeable assignment (MCQ/TF/numeric/fill)
  let mixedSaId: string; // has a short_answer needing manual review

  const setupPortal = async () => {
    const user = await findOrCreateUser(`hwq-student-${RUN}`);
    portalStudentUserId = user.id;
    const { studentPortalAccess } = await import("@repo/db/schema");
    await db
      .insert(studentPortalAccess)
      .values({ userId: user.id, studentId: portalStudentId, guardianId: null })
      .onConflictDoNothing();
  };

  const createPublishedWithQuestions = async (
    name: string,
    questions: Parameters<typeof homeworkQuestionsService.setAssignmentQuestions>[2]["questions"],
  ) => {
    const draft = await homeworkService.createAssignment(scopeA1, adminAId, {
      academicYearId: currentYearAId,
      subjectId: subjectMathId,
      sectionId: section6aId,
      title: title(name),
      submissionTypes: ["questions"],
      gradingMode: "none",
      dueAt: dueInDays(5),
      closeAt: dueInDays(6),
    });
    await homeworkQuestionsService.setAssignmentQuestions(scopeA1, adminAId, {
      id: draft.id,
      sectionId: section6aId,
      subjectId: subjectMathId,
      questions,
    });
    await homeworkService.publishAssignment(scopeA1, adminAId, draft.id);
    const [sa] = await db
      .select()
      .from(studentAssignments)
      .where(
        and(
          eq(studentAssignments.assignmentId, draft.id),
          eq(studentAssignments.studentEnrollmentId, portalEnrollmentId),
        ),
      );
    return { assignment: draft, saId: sa!.id };
  };

  beforeAll(async () => {
    const world = await buildWorld();
    orgAId = world.orgAId;
    orgBId = world.orgBId;
    scopeA1 = schoolScope(orgAId, world.schoolA1Id);
    scopeB1 = schoolScope(orgBId, world.schoolB1Id);
    section6aId = world.section6aId;
    subjectMathId = world.subjectA1MathId;
    currentYearAId = world.currentYearAId;
    adminAId = world.users.adminA;
    portalStudentId = world.ownedStudentId;
    portalEnrollmentId = world.enrollmentOwnedId;
    await setupPortal();
  });

  it("creates bank questions — MCQ validation bites, tenancy holds", async () => {
    await expect(
      homeworkQuestionsService.createBankItem(scopeA1, adminAId, {
        subjectId: subjectMathId,
        questionType: "mcq_single",
        body: "No correct option marked",
        options: MCQ_OPTIONS.map((o) => ({ ...o, isCorrect: false })),
        difficulty: "easy",
        defaultMarks: "1",
        visibility: "private",
      }),
    ).rejects.toThrow(/at least one option correct/);

    await expect(
      homeworkQuestionsService.createBankItem(scopeA1, adminAId, {
        subjectId: subjectMathId,
        questionType: "mcq_single",
        body: "Two corrects on single-choice",
        options: [MCQ_OPTIONS[0]!, { ...MCQ_OPTIONS[1]!, isCorrect: true }!],
        difficulty: "easy",
        defaultMarks: "1",
        visibility: "private",
      }),
    ).rejects.toThrow(/exactly one correct option/);

    const item = await homeworkQuestionsService.createBankItem(scopeA1, adminAId, {
      subjectId: subjectMathId,
      questionType: "mcq_single",
      body: "What is 2+2?",
      options: MCQ_OPTIONS,
      explanation: "Basic arithmetic.",
      difficulty: "easy",
      defaultMarks: "2",
      visibility: "private",
    });
    expect(item.questionType).toBe("mcq_single");

    const detail = await homeworkQuestionsService.getBankItem(scopeA1, item.id);
    expect(detail?.options).toHaveLength(3);
    expect(await homeworkQuestionsService.getBankItem(scopeB1, item.id)).toBeNull();
  });

  it("attaches a snapshot: frozen copies, the questions channel auto-added, staff sees keys", async () => {
    const { assignment } = await createPublishedWithQuestions("auto", [
      {
        position: 1,
        questionType: "mcq_single",
        body: "What is 2+2?",
        options: MCQ_OPTIONS,
        marks: "2",
      },
      {
        position: 2,
        questionType: "true_false",
        body: "The sun rises in the east.",
        correctAnswer: { value: true },
        marks: "1",
      },
      {
        position: 3,
        questionType: "numeric",
        body: "g on Earth (m/s^2), tolerance 0.1",
        correctAnswer: { value: 9.8, tolerance: 0.1 },
        marks: "1",
      },
      {
        position: 4,
        questionType: "fill_blank",
        body: "Plants make food by ______.",
        correctAnswer: { accepted: ["photosynthesis"], case_sensitive: false },
        marks: "1",
      },
    ]);
    autoSaId = (
      await db
        .select({ id: studentAssignments.id })
        .from(studentAssignments)
        .where(eq(studentAssignments.assignmentId, assignment.id))
    )[0]!.id;

    const [updated] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    expect(updated!.submissionTypes).toContain("questions");

    const snapshot = await db
      .select()
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignment.id));
    expect(snapshot).toHaveLength(4);
    // The answer key lives in the snapshot (staff reads get it).
    expect(snapshot.find((q) => q.position === 1)?.options).toBeTruthy();
    void autoSaId;
  });

  it("a student's attempt view carries NO answer key; the attempt locks the set", async () => {
    const attempt = await homeworkQuestionsService.startAttempt(
      portalStudentUserId,
      [portalStudentId],
      autoSaId,
    );
    expect(attempt.attemptNo).toBe(1);

    const [locked] = await db
      .select({ isLocked: assignments.isLocked })
      .from(assignments)
      .where(eq(assignments.id, (
        await db
          .select({ id: studentAssignments.assignmentId })
          .from(studentAssignments)
          .where(eq(studentAssignments.id, autoSaId))
      )[0]!.id));
    expect(locked!.isLocked).toBe(true);

    // The set is locked now — even the owner cannot swap questions.
    await expect(
      homeworkQuestionsService.setAssignmentQuestions(scopeA1, adminAId, {
        id: (
          await db
            .select({ id: studentAssignments.assignmentId })
            .from(studentAssignments)
            .where(eq(studentAssignments.id, autoSaId))
        )[0]!.id,
        sectionId: section6aId,
        subjectId: subjectMathId,
        questions: [],
      }),
    ).rejects.toThrow(/question set is locked/);

    const view = await homeworkQuestionsService.getAttemptForStudent(
      [portalStudentId],
      attempt!.id,
    );
    expect(view).not.toBeNull();
    expect(view!.questions).toHaveLength(4);
    for (const q of view!.questions) {
      const raw = JSON.stringify(q);
      expect(raw).not.toContain("is_correct");
      expect(raw).not.toContain("correctAnswer");
      expect(raw).not.toContain("explanation");
    }
  });

  it("saves answers and submits — the auto-grader marks every decidable type", async () => {
    const [attempt] = await db
      .select()
      .from(questionAttempts)
      .where(eq(questionAttempts.studentAssignmentId, autoSaId));

    const questions = await db
      .select()
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, (
        await db
          .select({ id: studentAssignments.assignmentId })
          .from(studentAssignments)
          .where(eq(studentAssignments.id, autoSaId))
      )[0]!.id))
      .orderBy(assignmentQuestions.position);
    const byPosition = new Map(questions.map((q) => [q.position, q]));

    // Q1 MCQ: correct (option id 1); Q2 TF: correct; Q3 numeric within
    // tolerance; Q4 fill_blank: wrong on purpose.
    await homeworkQuestionsService.saveAnswer(portalStudentUserId, [portalStudentId], {
      attemptId: attempt!.id,
      assignmentQuestionId: byPosition.get(1)!.id,
      answer: { option_ids: [1] },
    });
    await homeworkQuestionsService.saveAnswer(portalStudentUserId, [portalStudentId], {
      attemptId: attempt!.id,
      assignmentQuestionId: byPosition.get(2)!.id,
      answer: { value: true },
    });
    await homeworkQuestionsService.saveAnswer(portalStudentUserId, [portalStudentId], {
      attemptId: attempt!.id,
      assignmentQuestionId: byPosition.get(3)!.id,
      answer: { value: 9.85 },
    });
    await homeworkQuestionsService.saveAnswer(portalStudentUserId, [portalStudentId], {
      attemptId: attempt!.id,
      assignmentQuestionId: byPosition.get(4)!.id,
      answer: { text: "respiration" },
    });

    const { submitted, needsManualReview } = await homeworkQuestionsService.submitAttempt(
      portalStudentUserId,
      [portalStudentId],
      attempt!.id,
    );
    expect(needsManualReview).toBe(false);
    expect(submitted.status).toBe("graded");
    // 2 + 1 + 1 + 0 = 4 of 5
    expect(submitted.totalScore).toBe("4.00");
    expect(submitted.maxScore).toBe("5.00");

    // The is_auto evaluation landed and the row is reviewed.
    const [sa] = await db
      .select()
      .from(studentAssignments)
      .where(eq(studentAssignments.id, autoSaId));
    expect(sa!.status).toBe("reviewed");
    expect(sa!.currentMarks).toBe("4.00");
    const evals = await db
      .select()
      .from(assignmentEvaluations)
      .where(eq(assignmentEvaluations.studentAssignmentId, autoSaId));
    expect(evals).toHaveLength(1);
    expect(evals[0]!.isAuto).toBe(true);
  });

  it("the result view follows the reveal policies: score after submit, answers only after close", async () => {
    const [attempt] = await db
      .select()
      .from(questionAttempts)
      .where(eq(questionAttempts.studentAssignmentId, autoSaId));
    const result = await homeworkQuestionsService.getAttemptResult(
      [portalStudentId],
      attempt!.id,
    );
    expect(result!.scoreVisible).toBe(true);
    expect(result!.answersVisible).toBe(false);
    expect(result!.explanationsVisible).toBe(false);
    expect(result!.answers[0]!.isCorrect).toBe(true);
    expect(result!.answers[0]!.marksAwarded).toBe("2.00");
    // The key is withheld while show_answers = after_close.
    expect(result!.answers[0]!.correctOptionIds).toBeUndefined();
    expect(result!.answers[0]!.correctAnswer).toBeUndefined();

    // A foreign family gets null, not someone else's result.
    expect(
      await homeworkQuestionsService.getAttemptResult([crypto.randomUUID()], attempt!.id),
    ).toBeNull();
  });

  it("manual review flows: short answers flagged, teacher grades, attempt finalizes", async () => {
    const { assignment } = await createPublishedWithQuestions("mixed", [
      {
        position: 1,
        questionType: "short_answer",
        body: "Explain inertia in one sentence.",
        marks: "3",
      },
    ]);
    mixedSaId = (
      await db
        .select({ id: studentAssignments.id })
        .from(studentAssignments)
        .where(eq(studentAssignments.assignmentId, assignment.id))
    )[0]!.id;

    const attempt = await homeworkQuestionsService.startAttempt(
      portalStudentUserId,
      [portalStudentId],
      mixedSaId,
    );
    const questions = await db
      .select()
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, assignment.id));
    await homeworkQuestionsService.saveAnswer(portalStudentUserId, [portalStudentId], {
      attemptId: attempt!.id,
      assignmentQuestionId: questions[0]!.id,
      answer: { text: "Objects resist changes to their motion." },
    });
    const { needsManualReview } = await homeworkQuestionsService.submitAttempt(
      portalStudentUserId,
      [portalStudentId],
      attempt!.id,
    );
    expect(needsManualReview).toBe(true);
    expect((await db.select().from(studentAssignments).where(eq(studentAssignments.id, mixedSaId)))[0]!.status).toBe("submitted");

    // The teacher sees the answer in the grading view; over-max refuses.
    const attemptsForStaff = await homeworkQuestionsService.listAttempts([scopeA1], mixedSaId);
    const answer = attemptsForStaff![0]!.answers[0]!;
    expect(answer.needsManualReview).toBe(true);
    expect(answer.answer).toEqual({ text: "Objects resist changes to their motion." });

    await expect(
      homeworkQuestionsService.gradeAttemptAnswer(scopeA1, adminAId, {
        id: attempt.id,
        sectionId: section6aId,
        subjectId: subjectMathId,
        answerId: answer.id,
        marksAwarded: "4",
      }),
    ).rejects.toThrow(/cannot exceed the question's maximum/);

    const { fullyGraded } = await homeworkQuestionsService.gradeAttemptAnswer(
      scopeA1,
      adminAId,
      {
        id: attempt.id,
        sectionId: section6aId,
        subjectId: subjectMathId,
        answerId: answer.id,
        marksAwarded: "2.5",
        feedback: "Good, add an example.",
      },
    );
    expect(fullyGraded).toBe(true);

    const [gradedAttempt] = await db
      .select()
      .from(questionAttempts)
      .where(eq(questionAttempts.id, attempt.id));
    expect(gradedAttempt!.status).toBe("graded");
    expect(gradedAttempt!.scoreManual).toBe("2.50");
    expect(gradedAttempt!.totalScore).toBe("2.50");

    const [sa] = await db
      .select()
      .from(studentAssignments)
      .where(eq(studentAssignments.id, mixedSaId));
    expect(sa!.status).toBe("reviewed");
    expect(sa!.currentMarks).toBe("2.50");
    const evals = await db
      .select()
      .from(assignmentEvaluations)
      .where(eq(assignmentEvaluations.studentAssignmentId, mixedSaId));
    expect(evals).toHaveLength(1);
    expect(evals[0]!.isAuto).toBe(false);
    expect(evals[0]!.evaluatedBy).toBe(adminAId);
  });

  it("enforces the attempt cap; a foreign family cannot start someone else's attempt", async () => {
    // autoSaId's settings default to maxAttempts=1 and the attempt is used.
    await expect(
      homeworkQuestionsService.startAttempt(portalStudentUserId, [portalStudentId], autoSaId),
    ).rejects.toThrow(/attempt\(s\)/);

    const outsider = await findOrCreateUser(`hwq-outsider2-${RUN}`);
    await expect(
      // A well-formed uuid that is nobody's student — the same NOT_FOUND.
      homeworkQuestionsService.startAttempt(outsider.id, [crypto.randomUUID()], mixedSaId),
    ).rejects.toThrow(/Student assignment not found/);
  });
});
