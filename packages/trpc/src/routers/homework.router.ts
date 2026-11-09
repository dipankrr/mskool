import {
  assignmentQuestionStaffSchema,
  attemptQuestionStudentSchema,
  attemptResultSchema,
  attemptStaffSchema,
  bankItemDetailSchema,
  bankItemSelectSchema,
  classViewSchema,
  createBankItemInput,
  createHomeworkInput,
  giveAgainInput,
  giveDefaultsSchema,
  givePairsSchema,
  gradeAttemptAnswerInput,
  homeworkCommentSchema,
  homeworkDetailSchema,
  homeworkHomeSchema,
  homeworkKindSchema,
  homeworkSummarySchema,
  homeworkUploadInput,
  listBankItemsInput,
  listHomeworkInput,
  markTickInput,
  moveDueInput,
  portalHomeworkDetailSchema,
  weekStripSchema,
  portalHomeworkItemSchema,
  portalHomeworkListInput,
  portalHomeworkRefInput,
  portalHomeworkUploadInput,
  studentRecentHomeworkInput,
  studentRecentHomeworkSchema,
  portalPostCommentInput,
  portalSendInput,
  portalTickInput,
  postHomeworkCommentInput,
  registerSchema,
  saveAnswerInput,
  saveRegisterInput,
  saveRegisterResultSchema,
  sendBackInput,
  setAssignmentQuestionsInput,
  startAttemptInput,
  studentHomeworkSchema,
  submitAttemptInput,
  updateHomeworkInput,
  uploadTicketSchema,
} from "@repo/contracts";
import { homeworkQuestionsService, homeworkService, type HomeworkAccess } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assertSubjectPairs,
  onlySubjectTeacher,
  router,
  staffListProcedure,
  staffProcedure,
  studentProcedure,
  type OwnerResolver,
} from "../trpc";

/**
 * HOMEWORK (ADR-039, rebuilt by ADR-064) — staff `homework.*`, family
 * `portalHomework.*`.
 *
 * Permission map:
 *  - `homework:create/update/grade` give, edit and check homework. They are
 *    subject-gated (ADR-029): the call names a (section, subject) pair, the
 *    builder checks it, and the service proves the pair describes the row.
 *    Giving to several sections checks EVERY section (`assertSubjectPairs`).
 *  - `homework:read` reads. A caller whose only grant is subject_teacher sees
 *    only their own pairs (and what they gave); a class teacher or principal
 *    sees their scope.
 *  - `homework:comment` runs the question board and private threads.
 *
 * The family door is studentProcedure: one child per call (ADR-062). A
 * student and a parent login are treated the same. Outputs never carry a quiz
 * answer key.
 */

const resolveAssignmentOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await homeworkService.getAssignmentOwnerId(organizationId, id);
  if (!schoolId) throw new TRPCError({ code: "NOT_FOUND", message: "That homework could not be found." });
  return { type: "school", id: schoolId };
};

const resolveCommentOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await homeworkService.getCommentOwnerId(organizationId, id);
  if (!schoolId) throw new TRPCError({ code: "NOT_FOUND", message: "That comment could not be found." });
  return { type: "school", id: schoolId };
};

/** What every subject-gated call names (the builder checks the pair). */
const pairInput = z.object({ sectionId: z.uuid(), subjectId: z.uuid() });
const rowPairInput = pairInput.extend({ id: z.uuid() });
const idInput = z.object({ id: z.uuid() });

/** The pair a subject-gated call named. */
const pairOf = (input: { sectionId: string; subjectId: string }) => ({
  sectionId: input.sectionId,
  subjectId: input.subjectId,
});

/** Read access for list procedures: scopes, narrowed to own pairs for a subject teacher. */
async function accessFor(ctx: {
  userId: string;
  organizationId: string;
  scopes: HomeworkAccess["scopes"];
  authCache: Parameters<typeof onlySubjectTeacher>[0];
}): Promise<HomeworkAccess> {
  const pairs = onlySubjectTeacher(ctx.authCache, ctx.organizationId, "homework:read")
    ? await homeworkService.teachingPairs(ctx.organizationId, ctx.userId)
    : null;
  return { userId: ctx.userId, scopes: ctx.scopes, pairs };
}

export const homeworkRouter = router({
  // ── Reads ───────────────────────────────────────────────────────────────

  /** Home: to check, quizzes, out now, given today, drafts. */
  home: staffListProcedure("homework:read")
    .meta({ openapi: { method: "GET", path: "/homework/home", tags: ["homework"], summary: "The teacher's homework home", protect: true } })
    .output(homeworkHomeSchema)
    .query(async ({ ctx }) => homeworkService.home(await accessFor(ctx))),

  /** One student's last 10, for the staff profile (same visibility as the list). */
  studentRecent: staffListProcedure("homework:read")
    .meta({ openapi: { method: "GET", path: "/homework/students/{studentId}/recent", tags: ["homework"], summary: "One student's recent homework", protect: true } })
    .input(studentRecentHomeworkInput)
    .output(studentRecentHomeworkSchema)
    .query(async ({ ctx, input }) => homeworkService.studentRecent(await accessFor(ctx), input)),

  /** All homework, newest first. */
  list: staffListProcedure("homework:read")
    .meta({ openapi: { method: "GET", path: "/homework", tags: ["homework"], summary: "All homework the caller may see", protect: true } })
    .input(listHomeworkInput)
    .output(z.array(homeworkSummarySchema))
    .query(async ({ ctx, input }) => homeworkService.list(await accessFor(ctx), input)),

  /** Give step 2: the caller's classes, grouped by subject. */
  pairs: staffListProcedure("homework:read")
    .meta({ openapi: { method: "GET", path: "/homework/pairs", tags: ["homework"], summary: "Classes the caller can give homework to", protect: true } })
    .input(z.object({ academicYearId: z.uuid().optional() }))
    .output(givePairsSchema)
    .query(async ({ ctx, input }) => {
      const pairs = onlySubjectTeacher(ctx.authCache, ctx.organizationId, "homework:create")
        ? await homeworkService.teachingPairs(ctx.organizationId, ctx.userId)
        : null;
      return homeworkService.givePairs(
        { userId: ctx.userId, scopes: ctx.scopes, pairs },
        input.academicYearId,
      );
    }),

  /** Give step 4's starting point: the caller's last choices for this subject and type. */
  defaults: staffListProcedure("homework:read")
    .meta({ openapi: { method: "GET", path: "/homework/defaults", tags: ["homework"], summary: "The caller's last choices for a subject", protect: true } })
    .input(z.object({ subjectId: z.uuid(), kind: homeworkKindSchema }))
    .output(giveDefaultsSchema)
    .query(async ({ ctx, input }) =>
      homeworkService.giveDefaults(await accessFor(ctx), input.subjectId, input.kind),
    ),

  /** Home's day strip for another week (Monday, YYYY-MM-DD). */
  week: staffListProcedure("homework:read")
    .meta({ openapi: { method: "GET", path: "/homework/week", tags: ["homework"], summary: "Homework due in one school week", protect: true } })
    .input(z.object({ from: z.iso.date(), day: z.iso.date().optional() }))
    .output(weekStripSchema)
    .query(async ({ ctx, input }) => homeworkService.week(await accessFor(ctx), input.from, input.day)),

  /** One class and subject (Home v3's class page). */
  classView: staffListProcedure("homework:read")
    .meta({ openapi: { method: "GET", path: "/homework/class", tags: ["homework"], summary: "One class and subject at a glance", protect: true } })
    .input(z.object({ forSectionId: z.uuid(), subjectId: z.uuid() }))
    .output(classViewSchema)
    .query(async ({ ctx, input }) =>
      homeworkService.classView(await accessFor(ctx), { sectionId: input.forSectionId, subjectId: input.subjectId }),
    ),

  byId: staffProcedure("homework:read", { resolveOwner: resolveAssignmentOwner, gate: "overlap" })
    .meta({ openapi: { method: "GET", path: "/homework/{id}", tags: ["homework"], summary: "One homework with photos and progress", protect: true } })
    .input(idInput)
    .output(homeworkDetailSchema)
    .query(({ ctx, input }) => homeworkService.detail(ctx.scope, input.id)),

  // ── Give ────────────────────────────────────────────────────────────────

  /** Upload links for the teacher's photos (then PUT, then name them in create/update). */
  fileUpload: staffProcedure("homework:create", { subjectGate: true })
    .meta({ openapi: { method: "POST", path: "/homework/files", tags: ["homework"], summary: "Upload links for homework photos", protect: true } })
    .input(homeworkUploadInput.extend(pairInput.shape))
    .output(z.array(uploadTicketSchema))
    .mutation(({ ctx, input }) =>
      homeworkService.fileUploadTickets(ctx.scope, ctx.userId, {
        homeworkId: input.homeworkId,
        files: input.files,
      }),
    ),

  /** Give (or keep as a draft). `sectionId` is the first of `sectionIds`; every one is gated. */
  create: staffProcedure("homework:create", { subjectGate: true })
    .meta({ openapi: { method: "POST", path: "/homework", tags: ["homework"], summary: "Give homework (or save a draft)", protect: true } })
    .input(createHomeworkInput.and(pairInput))
    .output(homeworkSummarySchema)
    .mutation(async ({ ctx, input }) => {
      if (!input.sectionIds.includes(input.sectionId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the classes again." });
      }
      await assertSubjectPairs({
        authCache: ctx.authCache,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        permission: "homework:create",
        sectionIds: input.sectionIds,
        subjectId: input.subjectId,
      });
      return homeworkService.create(ctx.scope, ctx.userId, input);
    }),

  update: staffProcedure("homework:update", { subjectGate: true })
    .meta({ openapi: { method: "PATCH", path: "/homework/{id}", tags: ["homework"], summary: "Edit a homework", protect: true } })
    .input(updateHomeworkInput.extend(pairInput.shape))
    .output(homeworkSummarySchema)
    .mutation(async ({ ctx, input }) => {
      if (input.sectionIds) {
        await assertSubjectPairs({
          authCache: ctx.authCache,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          permission: "homework:update",
          sectionIds: input.sectionIds,
          subjectId: input.subjectId,
        });
      }
      return homeworkService.update(ctx.scope, ctx.userId, pairOf(input), input);
    }),

  give: staffProcedure("homework:update", { subjectGate: true })
    .meta({ openapi: { method: "POST", path: "/homework/{id}/give", tags: ["homework"], summary: "Give a draft now", protect: true } })
    .input(rowPairInput)
    .output(homeworkSummarySchema)
    .mutation(({ ctx, input }) => homeworkService.give(ctx.scope, pairOf(input), input.id)),

  /** The Undo on the toast after Give. */
  undoGive: staffProcedure("homework:update", { subjectGate: true })
    .meta({ openapi: { method: "POST", path: "/homework/{id}/undo", tags: ["homework"], summary: "Undo a just-given homework (back to a draft)", protect: true } })
    .input(rowPairInput)
    .output(homeworkSummarySchema)
    .mutation(({ ctx, input }) => homeworkService.undoGive(ctx.scope, pairOf(input), input.id)),

  deleteDraft: staffProcedure("homework:delete", { subjectGate: true })
    .meta({ openapi: { method: "DELETE", path: "/homework/{id}", tags: ["homework"], summary: "Delete a draft that was never given", protect: true } })
    .input(rowPairInput)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await homeworkService.deleteDraft(ctx.scope, pairOf(input), input.id);
      return { ok: true as const };
    }),

  cancel: staffProcedure("homework:update", { subjectGate: true })
    .meta({ openapi: { method: "POST", path: "/homework/{id}/cancel", tags: ["homework"], summary: "Cancel a given homework", protect: true } })
    .input(rowPairInput)
    .output(homeworkSummarySchema)
    .mutation(({ ctx, input }) => homeworkService.cancel(ctx.scope, pairOf(input), input.id)),

  /** Stop accepting work now. */
  close: staffProcedure("homework:update", { subjectGate: true })
    .meta({ openapi: { method: "POST", path: "/homework/{id}/close", tags: ["homework"], summary: "Stop accepting work", protect: true } })
    .input(rowPairInput)
    .output(homeworkSummarySchema)
    .mutation(({ ctx, input }) => homeworkService.close(ctx.scope, pairOf(input), input.id)),

  moveDue: staffProcedure("homework:update", { subjectGate: true })
    .meta({ openapi: { method: "POST", path: "/homework/{id}/due", tags: ["homework"], summary: "Move the due date (everyone, a class, or one child)", protect: true } })
    .input(moveDueInput.extend(pairInput.shape))
    .output(homeworkSummarySchema)
    .mutation(({ ctx, input }) => homeworkService.moveDue(ctx.scope, pairOf(input), input)),

  /** Give the same homework to other classes, as a new homework. */
  giveAgain: staffProcedure("homework:create", { subjectGate: true })
    .meta({ openapi: { method: "POST", path: "/homework/{id}/give-again", tags: ["homework"], summary: "Give to another class", protect: true } })
    .input(giveAgainInput.extend(pairInput.shape))
    .output(homeworkSummarySchema)
    .mutation(async ({ ctx, input }) => {
      await assertSubjectPairs({
        authCache: ctx.authCache,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        permission: "homework:create",
        sectionIds: input.toSectionIds,
        subjectId: input.subjectId,
      });
      return homeworkService.giveAgain(ctx.scope, ctx.userId, pairOf(input), input);
    }),

  // ── Check ───────────────────────────────────────────────────────────────

  register: router({
    /** The checking list for one section (`sectionId`), in roll order. */
    get: staffProcedure("homework:grade", { subjectGate: true })
      .meta({ openapi: { method: "GET", path: "/homework/{id}/register", tags: ["homework"], summary: "The checking list for one class", protect: true } })
      .input(rowPairInput)
      .output(registerSchema)
      .query(({ ctx, input }) => homeworkService.register(ctx.scope, pairOf(input), input.id)),

    /** Save the list. Idempotent; saving makes results visible to students. */
    save: staffProcedure("homework:grade", { subjectGate: true })
      .meta({ openapi: { method: "PUT", path: "/homework/{id}/register", tags: ["homework"], summary: "Save the checking list", protect: true } })
      .input(saveRegisterInput)
      .output(saveRegisterResultSchema)
      .mutation(({ ctx, input }) => homeworkService.saveRegister(ctx.scope, ctx.userId, input)),
  }),

  students: router({
    /** One child's homework: what they sent and the result (`id` = the child's homework). */
    get: staffProcedure("homework:grade", { subjectGate: true })
      .meta({ openapi: { method: "GET", path: "/homework/students/{id}", tags: ["homework"], summary: "One child's homework", protect: true } })
      .input(rowPairInput)
      .output(studentHomeworkSchema)
      .query(({ ctx, input }) => homeworkService.studentHomework(ctx.scope, pairOf(input), input.id)),

    sendBack: staffProcedure("homework:grade", { subjectGate: true })
      .meta({ openapi: { method: "POST", path: "/homework/students/{id}/send-back", tags: ["homework"], summary: "Send work back to redo, with a note", protect: true } })
      .input(sendBackInput)
      .output(studentHomeworkSchema)
      .mutation(({ ctx, input }) =>
        homeworkService.sendBack(ctx.scope, pairOf(input), input.id, input.note),
      ),

    /** "Mark read" (or undo) for work that comes back as a tick. */
    markTick: staffProcedure("homework:grade", { subjectGate: true })
      .meta({ openapi: { method: "POST", path: "/homework/students/{id}/tick", tags: ["homework"], summary: "Tick a child's homework for them", protect: true } })
      .input(markTickInput)
      .output(studentHomeworkSchema)
      .mutation(({ ctx, input }) =>
        homeworkService.markTick(ctx.scope, pairOf(input), input.id, input.ticked),
      ),

    attempts: router({
      /** A child's quiz attempt with answers (`id` = the child's homework). */
      list: staffProcedure("homework:grade", { subjectGate: true })
        .meta({ openapi: { method: "GET", path: "/homework/students/{id}/attempts", tags: ["homework"], summary: "A child's quiz attempt with answers", protect: true } })
        .input(rowPairInput)
        .output(z.array(attemptStaffSchema).nullable())
        .query(({ ctx, input }) => homeworkQuestionsService.listAttempts([ctx.scope], input.id)),

      gradeAnswer: staffProcedure("homework:grade", { subjectGate: true })
        .meta({ openapi: { method: "POST", path: "/homework/students/attempts/{id}/grade-answer", tags: ["homework"], summary: "Mark one written answer; finalises when all are marked", protect: true } })
        .input(gradeAttemptAnswerInput)
        .output(
          z.object({
            attemptId: z.uuid(),
            status: z.string(),
            totalScore: z.string(),
            fullyGraded: z.boolean(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const { attempt, fullyGraded } = await homeworkQuestionsService.gradeAttemptAnswer(
            ctx.scope,
            ctx.userId,
            input,
          );
          return {
            attemptId: attempt.id,
            status: attempt.status,
            totalScore: attempt.totalScore,
            fullyGraded,
          };
        }),
    }),
  }),

  // ── Quiz questions and the bank ─────────────────────────────────────────

  questions: router({
    set: staffProcedure("homework:update", { subjectGate: true })
      .meta({ openapi: { method: "PUT", path: "/homework/{id}/questions", tags: ["homework"], summary: "Set a quiz's questions (a frozen copy)", protect: true } })
      .input(setAssignmentQuestionsInput)
      .output(z.array(assignmentQuestionStaffSchema))
      .mutation(({ ctx, input }) =>
        homeworkQuestionsService.setAssignmentQuestions(ctx.scope, ctx.userId, input),
      ),

    get: staffProcedure("homework:read", { resolveOwner: resolveAssignmentOwner, gate: "overlap" })
      .meta({ openapi: { method: "GET", path: "/homework/{id}/questions", tags: ["homework"], summary: "A quiz's questions with answer keys", protect: true } })
      .input(idInput)
      .output(z.array(assignmentQuestionStaffSchema).nullable())
      .query(({ ctx, input }) => homeworkQuestionsService.getAssignmentQuestions(ctx.scope, input.id)),
  }),

  bank: router({
    /** Shared questions plus the caller's own private ones. */
    list: staffListProcedure("homework:read")
      .meta({ openapi: { method: "GET", path: "/homework/bank", tags: ["homework"], summary: "The question bank the caller may use", protect: true } })
      .input(listBankItemsInput.partial())
      .output(z.array(bankItemDetailSchema))
      .query(({ ctx, input }) => homeworkQuestionsService.listBankItems(ctx.scopes, ctx.userId, input)),

    create: staffProcedure("homework:create", { subjectGate: true })
      .meta({ openapi: { method: "POST", path: "/homework/bank", tags: ["homework"], summary: "Add a bank question", protect: true } })
      .input(createBankItemInput)
      .output(bankItemSelectSchema)
      .mutation(({ ctx, input }) => homeworkQuestionsService.createBankItem(ctx.scope, ctx.userId, input)),

    byId: staffListProcedure("homework:read")
      .meta({ openapi: { method: "GET", path: "/homework/bank/{itemId}", tags: ["homework"], summary: "One bank question with options and answer key", protect: true } })
      .input(z.object({ itemId: z.uuid() }))
      .output(bankItemDetailSchema.nullable())
      .query(async ({ ctx, input }) => {
        for (const scope of ctx.scopes) {
          const item = await homeworkQuestionsService.getBankItem(scope, ctx.userId, input.itemId);
          if (item) return item;
        }
        return null;
      }),

    /**
     * Retire or bring back a bank question. Its author may; so may anyone
     * holding `school_settings:update` (they manage the school's bank). Gated
     * on read because the service limits the write to those two.
     */
    setActive: staffListProcedure("homework:read")
      .meta({ openapi: { method: "POST", path: "/homework/bank/{itemId}/active", tags: ["homework"], summary: "Retire or bring back a bank question", protect: true } })
      .input(z.object({ itemId: z.uuid(), isActive: z.boolean() }))
      .output(bankItemSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const canManageAll = ctx.canWithin("school_settings:update");
        for (const scope of ctx.scopes) {
          const row = await homeworkQuestionsService.setBankItemActive(
            scope,
            ctx.userId,
            input.itemId,
            input.isActive,
            canManageAll,
          );
          if (row) return row;
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "That question could not be found." });
      }),
  }),

  // ── Comments ────────────────────────────────────────────────────────────

  comments: router({
    /** The class question board, or one child's private thread. */
    list: staffProcedure("homework:read", { resolveOwner: resolveAssignmentOwner, gate: "overlap" })
      .meta({ openapi: { method: "GET", path: "/homework/{id}/comments", tags: ["homework"], summary: "The question board or one child's thread", protect: true } })
      .input(idInput.extend({ studentAssignmentId: z.uuid().optional() }))
      .output(z.array(homeworkCommentSchema))
      .query(({ ctx, input }) =>
        homeworkService.listComments(ctx.scope, ctx.userId, input.id, input.studentAssignmentId),
      ),

    post: staffProcedure("homework:comment", { resolveOwner: resolveAssignmentOwner })
      .meta({ openapi: { method: "POST", path: "/homework/{id}/comments", tags: ["homework"], summary: "Answer on the board or in a child's thread", protect: true } })
      .input(postHomeworkCommentInput.omit({ assignmentId: true }).extend(idInput.shape))
      .output(z.array(homeworkCommentSchema))
      .mutation(({ ctx, input }) =>
        homeworkService.postComment(ctx.scope, ctx.userId, {
          assignmentId: input.id,
          studentAssignmentId: input.studentAssignmentId,
          body: input.body,
        }),
      ),

    delete: staffProcedure("homework:comment", { resolveOwner: resolveCommentOwner })
      .meta({ openapi: { method: "DELETE", path: "/homework/comments/{id}", tags: ["homework"], summary: "Remove a comment", protect: true } })
      .input(idInput)
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        await homeworkService.deleteComment(ctx.scope, input.id);
        return { ok: true as const };
      }),
  }),
});

/**
 * THE FAMILY DOOR — `portalHomework.*`. One child per call (ADR-062); a
 * student and a parent login are the same. Nothing draft, scheduled or
 * cancelled is visible, and no answer key leaves the server.
 */
export const portalHomeworkRouter = router({
  list: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/homework", tags: ["portal"], summary: "A child's homework", protect: true } })
    .input(portalHomeworkListInput)
    .output(z.array(portalHomeworkItemSchema))
    .query(({ ctx, input }) => homeworkService.portalList(ctx.studentIds, input.studentId, input.filter)),

  get: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/homework/{studentAssignmentId}", tags: ["portal"], summary: "One homework with photos, what was sent and the result", protect: true } })
    .input(portalHomeworkRefInput)
    .output(portalHomeworkDetailSchema)
    .query(({ ctx, input }) =>
      homeworkService.portalGet(ctx.studentIds, input.studentId, input.studentAssignmentId),
    ),

  markViewed: studentProcedure
    .meta({ openapi: { method: "POST", path: "/portal/homework/{studentAssignmentId}/viewed", tags: ["portal"], summary: "Record the first look", protect: true } })
    .input(portalHomeworkRefInput)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await homeworkService.portalMarkViewed(ctx.studentIds, input.studentId, input.studentAssignmentId);
      return { ok: true as const };
    }),

  /** Tick it done, or untick a mistaken tick before the due time. */
  tick: studentProcedure
    .meta({ openapi: { method: "POST", path: "/portal/homework/{studentAssignmentId}/tick", tags: ["portal"], summary: "Tick or untick", protect: true } })
    .input(portalTickInput)
    .output(portalHomeworkDetailSchema)
    .mutation(({ ctx, input }) =>
      homeworkService.portalTick(ctx.studentIds, input.studentId, input.studentAssignmentId, input.ticked),
    ),

  /** Upload links for the child's photos (then PUT, then `send`). */
  fileUpload: studentProcedure
    .meta({ openapi: { method: "POST", path: "/portal/homework/{studentAssignmentId}/files", tags: ["portal"], summary: "Upload links for photos of the work", protect: true } })
    .input(portalHomeworkUploadInput)
    .output(z.array(uploadTicketSchema))
    .mutation(({ ctx, input }) =>
      homeworkService.portalUploadTickets(
        ctx.userId,
        ctx.studentIds,
        input.studentId,
        input.studentAssignmentId,
        input.files,
      ),
    ),

  /** Send (or replace, until checked) the child's work. */
  send: studentProcedure
    .meta({ openapi: { method: "POST", path: "/portal/homework/{studentAssignmentId}/send", tags: ["portal"], summary: "Send or replace the work", protect: true } })
    .input(portalSendInput)
    .output(portalHomeworkDetailSchema)
    .mutation(({ ctx, input }) => homeworkService.portalSend(ctx.userId, ctx.studentIds, input)),

  comments: router({
    /** The class question board plus this child's private thread. */
    list: studentProcedure
      .meta({ openapi: { method: "GET", path: "/portal/homework/{studentAssignmentId}/comments", tags: ["portal"], summary: "The question board and the private thread", protect: true } })
      .input(portalHomeworkRefInput)
      .output(z.array(homeworkCommentSchema))
      .query(({ ctx, input }) =>
        homeworkService.portalComments(ctx.userId, ctx.studentIds, input.studentId, input.studentAssignmentId),
      ),

    post: studentProcedure
      .meta({ openapi: { method: "POST", path: "/portal/homework/{studentAssignmentId}/comments", tags: ["portal"], summary: "Ask the class or the teacher", protect: true } })
      .input(portalPostCommentInput)
      .output(z.array(homeworkCommentSchema))
      .mutation(({ ctx, input }) => homeworkService.portalPostComment(ctx.userId, ctx.studentIds, input)),
  }),

  attempts: router({
    start: studentProcedure
      .meta({ openapi: { method: "POST", path: "/portal/homework/attempts/start", tags: ["portal"], summary: "Start or resume the quiz (one attempt)", protect: true } })
      .input(startAttemptInput)
      .output(z.object({ attemptId: z.uuid() }))
      .mutation(async ({ ctx, input }) => {
        const attempt = await homeworkQuestionsService.startAttempt(
          ctx.userId,
          ctx.studentIds,
          input.studentAssignmentId,
        );
        return { attemptId: attempt.id };
      }),

    get: studentProcedure
      .meta({ openapi: { method: "GET", path: "/portal/homework/attempts/{attemptId}", tags: ["portal"], summary: "The open attempt (questions without answers, saved answers)", protect: true } })
      .input(z.object({ attemptId: z.uuid() }))
      .output(
        z
          .object({
            attemptId: z.uuid(),
            status: z.string(),
            questionOrder: z.array(z.uuid()).nullable(),
            maxScore: z.string(),
            questions: z.array(attemptQuestionStudentSchema),
          })
          .partial({ questionOrder: true })
          .nullable(),
      )
      .query(({ ctx, input }) => homeworkQuestionsService.getAttemptForStudent(ctx.studentIds, input.attemptId)),

    saveAnswer: studentProcedure
      .meta({ openapi: { method: "POST", path: "/portal/homework/attempts/save-answer", tags: ["portal"], summary: "Save one answer", protect: true } })
      .input(saveAnswerInput)
      .output(z.object({ answerId: z.uuid() }))
      .mutation(({ ctx, input }) => homeworkQuestionsService.saveAnswer(ctx.userId, ctx.studentIds, input)),

    submit: studentProcedure
      .meta({ openapi: { method: "POST", path: "/portal/homework/attempts/submit", tags: ["portal"], summary: "Hand in; marks everything the app can", protect: true } })
      .input(submitAttemptInput)
      .output(
        z.object({
          attemptId: z.uuid(),
          status: z.string(),
          totalScore: z.string(),
          needsManualReview: z.boolean(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { submitted, needsManualReview } = await homeworkQuestionsService.submitAttempt(
          ctx.userId,
          ctx.studentIds,
          input.attemptId,
        );
        return {
          attemptId: submitted.id,
          status: submitted.status,
          totalScore: submitted.totalScore,
          needsManualReview,
        };
      }),

    result: studentProcedure
      .meta({ openapi: { method: "GET", path: "/portal/homework/attempts/{attemptId}/result", tags: ["portal"], summary: "The marked result, as the quiz's rules allow", protect: true } })
      .input(z.object({ attemptId: z.uuid() }))
      .output(attemptResultSchema.nullable())
      .query(({ ctx, input }) => homeworkQuestionsService.getAttemptResult(ctx.studentIds, input.attemptId)),
  }),
});
