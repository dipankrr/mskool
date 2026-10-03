import {
  assignmentCommentSelectSchema,
  assignmentDetailSchema,
  assignmentSelectSchema,
  assignmentSettingsSelectSchema,
  cancelAssignmentInput,
  createAssignmentInput,
  createRubricInput,
  effectiveAssignmentSettingsSchema,
  evaluateStudentAssignmentInput,
  excuseStudentAssignmentInput,
  grantExtensionInput,
  listAssignmentsInput,
  listStudentAssignmentsInput,
  postAssignmentCommentInput,
  portalAcknowledgeInput,
  portalAssignmentDetailSchema,
  portalAssignmentListItemSchema,
  portalStudentIdInput,
  portalSubmitAssignmentInput,
  rubricDetailSchema,
  rubricSelectSchema,
  studentAssignmentDetailSchema,
  studentAssignmentSelectSchema,
  updateAssignmentInput,
  upsertAssignmentSettingsInput,
} from "@repo/contracts";
import { homeworkService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure, studentProcedure, type OwnerResolver } from "../trpc";

/**
 * HOMEWORK / ASSIGNMENTS (ADR-039) — staff namespace `homework.*`, family
 * door `portalHomework.*`.
 *
 * Permission map:
 *  - `homework:create/update` author and edit assignments (subject-gated,
 *    ADR-029 — the teaching role must hold the (section, subject) fact;
 *    admin roles pass on scope alone). `homework:grade` evaluates a student
 *    (subject-gated for the same reason). `homework:comment` runs the Q&A
 *    threads — conversation, not subject content, so not gated.
 *  - Settings and rubrics are school CONFIGURATION and ride
 *    `school_settings:read/update` — the principal-level configuration
 *    permission that already exists.
 *  - Row-addressed routes carry `id` (the builder resolves the owner); the
 *    subject-gated row-addressed ones ALSO carry sectionId + subjectId, and
 *    the service verifies the pair actually describes the row — otherwise a
 *    teacher's legitimate gate fact on one pair could grade or edit a
 *    stranger's row on another.
 *
 * The family door is studentProcedure (ownership only, no can()); its output
 * shapes carry no answer keys and no other child's data.
 */

const resolveAssignmentOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await homeworkService.getAssignmentOwnerId(organizationId, id);
  if (!schoolId) throw new TRPCError({ code: "NOT_FOUND", message: "Assignment not found." });
  return { type: "school", id: schoolId };
};

const resolveStudentAssignmentOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await homeworkService.getStudentAssignmentOwnerId(organizationId, id);
  if (!schoolId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Student assignment not found." });
  }
  return { type: "school", id: schoolId };
};

export const homeworkRouter = router({
  settings: router({
    get: staffProcedure("school_settings:read")
      .meta({ openapi: { method: "GET", path: "/homework/settings", tags: ["homework"], summary: "Effective assignment settings for a class (or the school default)", protect: true } })
      .input(z.object({ classId: z.uuid().optional() }))
      .output(effectiveAssignmentSettingsSchema)
      .query(({ ctx, input }) => {
        if (!ctx.scope.schoolId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose a branch first — assignment settings belong to one branch.",
          });
        }
        return homeworkService.resolveSettings(ctx.scope.schoolId, input.classId ?? null);
      }),

    upsert: staffProcedure("school_settings:update")
      .meta({ openapi: { method: "PUT", path: "/homework/settings", tags: ["homework"], summary: "Save the school default or a class override", protect: true } })
      .input(upsertAssignmentSettingsInput)
      .output(assignmentSettingsSelectSchema)
      .mutation(({ ctx, input }) =>
        homeworkService.upsertSettings(ctx.scope, ctx.userId, input),
      ),
  }),

  rubrics: router({
    list: staffListProcedure("school_settings:read")
      .meta({ openapi: { method: "GET", path: "/homework/rubrics", tags: ["homework"], summary: "The school's rubrics", protect: true } })
      .output(z.array(rubricSelectSchema))
      .query(({ ctx }) => homeworkService.listRubrics(ctx.scopes)),

    create: staffProcedure("school_settings:update")
      .meta({ openapi: { method: "POST", path: "/homework/rubrics", tags: ["homework"], summary: "Create a rubric with criteria and levels", protect: true } })
      .input(createRubricInput)
      .output(rubricSelectSchema)
      .mutation(({ ctx, input }) => homeworkService.createRubric(ctx.scope, ctx.userId, input)),

    byId: staffProcedure("school_settings:read")
      .meta({ openapi: { method: "GET", path: "/homework/rubrics/{rubricId}", tags: ["homework"], summary: "One rubric with criteria + levels", protect: true } })
      .input(z.object({ rubricId: z.uuid() }))
      .output(rubricDetailSchema.nullable())
      .query(({ ctx, input }) => homeworkService.getRubricDetail(ctx.scope, input.rubricId)),

    setActive: staffProcedure("school_settings:update")
      .meta({ openapi: { method: "POST", path: "/homework/rubrics/{rubricId}/active", tags: ["homework"], summary: "Retire or reactivate a rubric", protect: true } })
      .input(z.object({ rubricId: z.uuid(), isActive: z.boolean() }))
      .output(rubricSelectSchema.nullable())
      .mutation(({ ctx, input }) =>
        homeworkService.setRubricActive(ctx.scope, input.rubricId, input.isActive),
      ),
  }),

  list: staffListProcedure("homework:read")
    .meta({ openapi: { method: "GET", path: "/homework", tags: ["homework"], summary: "The year's assignments, scope-clipped", protect: true } })
    .input(listAssignmentsInput)
    .output(z.array(assignmentSelectSchema.extend({ subjectName: z.string() })))
    .query(({ ctx, input }) => homeworkService.listAssignments(ctx.scopes, input)),

  byId: staffProcedure("homework:read", {
    resolveOwner: resolveAssignmentOwner,
    gate: "overlap",
  })
    .meta({ openapi: { method: "GET", path: "/homework/{id}", tags: ["homework"], summary: "One assignment with targets", protect: true } })
    .input(z.object({ id: z.uuid() }))
    .output(assignmentDetailSchema.nullable())
    .query(({ ctx, input }) => homeworkService.getAssignmentDetail(ctx.scope, input.id)),

  create: staffProcedure("homework:create", { subjectGate: true })
    .meta({ openapi: { method: "POST", path: "/homework", tags: ["homework"], summary: "Create a draft assignment (section-targeted)", protect: true } })
    .input(createAssignmentInput)
    .output(assignmentSelectSchema)
    .mutation(({ ctx, input }) => homeworkService.createAssignment(ctx.scope, ctx.userId, input)),

  update: staffProcedure("homework:update", {
    subjectGate: true,
    resolveOwner: resolveAssignmentOwner,
  })
    .meta({ openapi: { method: "PATCH", path: "/homework/{id}", tags: ["homework"], summary: "Edit an assignment (revision-snapshotted after publish)", protect: true } })
    .input(updateAssignmentInput)
    .output(assignmentSelectSchema)
    .mutation(({ ctx, input }) => homeworkService.updateAssignment(ctx.scope, ctx.userId, input)),

  publish: staffProcedure("homework:update", {
    subjectGate: true,
    resolveOwner: resolveAssignmentOwner,
  })
    .meta({ openapi: { method: "POST", path: "/homework/{id}/publish", tags: ["homework"], summary: "Publish — resolve the audience into student assignments", protect: true } })
    .input(z.object({ id: z.uuid(), sectionId: z.uuid(), subjectId: z.uuid() }))
    .output(assignmentSelectSchema)
    .mutation(({ ctx, input }) => homeworkService.publishAssignment(ctx.scope, ctx.userId, input.id)),

  cancel: staffProcedure("homework:update", {
    subjectGate: true,
    resolveOwner: resolveAssignmentOwner,
  })
    .meta({ openapi: { method: "POST", path: "/homework/{id}/cancel", tags: ["homework"], summary: "Cancel an assignment", protect: true } })
    .input(cancelAssignmentInput)
    .output(assignmentSelectSchema)
    .mutation(({ ctx, input }) =>
      homeworkService.cancelAssignment(ctx.scope, ctx.userId, input.id, input.reason),
    ),

  close: staffProcedure("homework:update", {
    subjectGate: true,
    resolveOwner: resolveAssignmentOwner,
  })
    .meta({ openapi: { method: "POST", path: "/homework/{id}/close", tags: ["homework"], summary: "Close submissions", protect: true } })
    .input(z.object({ id: z.uuid(), sectionId: z.uuid(), subjectId: z.uuid() }))
    .output(assignmentSelectSchema)
    .mutation(({ ctx, input }) => homeworkService.closeAssignment(ctx.scope, input.id)),

  students: router({
    list: staffListProcedure("homework:read")
      .meta({ openapi: { method: "GET", path: "/homework/{id}/students", tags: ["homework"], summary: "The grading grid — resolved rows per student", protect: true } })
      .input(listStudentAssignmentsInput)
      .output(
        z.array(
          studentAssignmentSelectSchema.extend({
            studentName: z.string(),
            admissionNumber: z.string(),
            rollNumber: z.string().nullable(),
          }),
        ),
      )
      .query(({ ctx, input }) =>
        homeworkService.listStudentAssignments(ctx.scopes, input.id, input.status),
      ),

    get: staffProcedure("homework:read", {
      resolveOwner: resolveStudentAssignmentOwner,
      gate: "overlap",
    })
      .meta({ openapi: { method: "GET", path: "/homework/students/{id}", tags: ["homework"], summary: "One student's assignment: submissions + evaluations", protect: true } })
      .input(z.object({ id: z.uuid() }))
      .output(studentAssignmentDetailSchema.nullable())
      .query(({ ctx, input }) =>
        homeworkService.getStudentAssignmentDetail(ctx.scope, input.id),
      ),

    evaluate: staffProcedure("homework:grade", {
      subjectGate: true,
      resolveOwner: resolveStudentAssignmentOwner,
    })
      .meta({ openapi: { method: "POST", path: "/homework/students/{id}/evaluate", tags: ["homework"], summary: "Grade / verify / request resubmit (append-only)", protect: true } })
      .input(evaluateStudentAssignmentInput)
      .output(z.object({ evaluationId: z.uuid(), status: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const result = await homeworkService.evaluateStudentAssignment(ctx.scope, ctx.userId, input);
        return { evaluationId: result.evaluation.id, status: result.studentAssignment.status };
      }),

    extend: staffProcedure("homework:update", {
      subjectGate: true,
      resolveOwner: resolveStudentAssignmentOwner,
    })
      .meta({ openapi: { method: "POST", path: "/homework/students/{id}/extend", tags: ["homework"], summary: "Grant a deadline extension (append-only)", protect: true } })
      .input(grantExtensionInput)
      .output(z.object({ effectiveDueAt: z.date(), effectiveCloseAt: z.date() }))
      .mutation(async ({ ctx, input }) => {
        const sa = await homeworkService.grantExtension(ctx.scope, ctx.userId, input);
        return { effectiveDueAt: sa.effectiveDueAt, effectiveCloseAt: sa.effectiveCloseAt };
      }),

    excuse: staffProcedure("homework:update", {
      subjectGate: true,
      resolveOwner: resolveStudentAssignmentOwner,
    })
      .meta({ openapi: { method: "POST", path: "/homework/students/{id}/excuse", tags: ["homework"], summary: "Excuse a student from the assignment", protect: true } })
      .input(excuseStudentAssignmentInput)
      .output(z.object({ status: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const sa = await homeworkService.excuseStudentAssignment(ctx.scope, ctx.userId, input);
        return { status: sa.status };
      }),
  }),

  comments: router({
    list: staffProcedure("homework:read")
      .meta({ openapi: { method: "GET", path: "/homework/{assignmentId}/comments", tags: ["homework"], summary: "The class-wide thread (+ a private one)", protect: true } })
      .input(
        z.object({
          assignmentId: z.uuid(),
          studentAssignmentId: z.uuid().optional(),
        }),
      )
      .output(z.array(assignmentCommentSelectSchema))
      .query(({ ctx, input }) =>
        homeworkService.listComments({
          scopes: [ctx.scope],
          assignmentId: input.assignmentId,
          studentAssignmentId: input.studentAssignmentId ?? null,
        }),
      ),

    post: staffProcedure("homework:comment")
      .meta({ openapi: { method: "POST", path: "/homework/comments", tags: ["homework"], summary: "Post to the class thread or a private one", protect: true } })
      .input(postAssignmentCommentInput)
      .output(assignmentCommentSelectSchema.omit({ authorName: true, authorIsStaff: true }))
      .mutation(({ ctx, input }) =>
        homeworkService.staffPostComment(ctx.scope, ctx.userId, input),
      ),
  }),
});

/**
 * THE FAMILY DOOR — `portalHomework.*`. studentProcedure (ownership only, no
 * can()); every query filters by the login's owned studentIds. The outputs
 * never carry question answer keys (slice B serves students from a separate
 * read model), and nothing draft/cancelled leaks.
 */
export const portalHomeworkRouter = router({
  list: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/homework", tags: ["portal"], summary: "The family's homework list", protect: true } })
    .input(
      z.object({
        studentId: z.uuid().optional(),
        status: z
          .enum(["assigned", "in_progress", "submitted", "resubmit_requested", "reviewed", "excused", "missing"])
          .optional(),
      }),
    )
    .output(z.array(portalAssignmentListItemSchema))
    .query(({ ctx, input }) =>
      homeworkService.portalList(ctx.studentIds, { studentId: input.studentId, status: input.status }),
    ),

  get: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/homework/{studentAssignmentId}", tags: ["portal"], summary: "One assignment: resources, submissions, evaluations", protect: true } })
    .input(z.object({ studentAssignmentId: z.uuid() }))
    .output(portalAssignmentDetailSchema.nullable())
    .query(({ ctx, input }) =>
      homeworkService.portalGet(ctx.studentIds, input.studentAssignmentId),
    ),

  markViewed: studentProcedure
    .meta({ openapi: { method: "POST", path: "/portal/homework/{studentAssignmentId}/viewed", tags: ["portal"], summary: "Stamp firstViewedAt once", protect: true } })
    .input(z.object({ studentAssignmentId: z.uuid() }))
    .output(z.object({ firstViewedAt: z.date().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const sa = await homeworkService.portalMarkViewed(ctx.studentIds, input.studentAssignmentId);
      return { firstViewedAt: sa?.firstViewedAt ?? null };
    }),

  submit: studentProcedure
    .meta({ openapi: { method: "POST", path: "/portal/homework/submit", tags: ["portal"], summary: "Submit (or resubmit) homework as student or parent", protect: true } })
    .input(portalSubmitAssignmentInput)
    .output(z.object({ submissionId: z.uuid(), versionNo: z.number().int(), isLate: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await homeworkService.portalSubmit(ctx.userId, ctx.studentIds, input);
      return {
        submissionId: result.submission.id,
        versionNo: result.submission.versionNo,
        isLate: result.submission.isLate,
      };
    }),

  acknowledge: studentProcedure
    .meta({ openapi: { method: "POST", path: "/portal/homework/acknowledge", tags: ["portal"], summary: "The parent's diary signature", protect: true } })
    .input(portalAcknowledgeInput)
    .output(z.object({ studentAssignmentId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await homeworkService.portalAcknowledge(ctx.userId, ctx.studentIds, input.studentAssignmentId);
      return { studentAssignmentId: input.studentAssignmentId };
    }),

  comments: router({
    list: studentProcedure
      .meta({ openapi: { method: "GET", path: "/portal/homework/{assignmentId}/comments", tags: ["portal"], summary: "The class thread + this family's private threads", protect: true } })
      .input(
        z.object({
          assignmentId: z.uuid(),
          studentAssignmentId: z.uuid().optional(),
        }),
      )
      .output(z.array(assignmentCommentSelectSchema))
      .query(({ ctx, input }) =>
        homeworkService.listComments({
          studentIds: ctx.studentIds,
          assignmentId: input.assignmentId,
          studentAssignmentId: input.studentAssignmentId ?? null,
        }),
      ),

    post: studentProcedure
      .meta({ openapi: { method: "POST", path: "/portal/homework/comments", tags: ["portal"], summary: "Ask in the private thread", protect: true } })
      .input(postAssignmentCommentInput)
      .output(assignmentCommentSelectSchema.omit({ authorName: true, authorIsStaff: true }))
      .mutation(({ ctx, input }) =>
        homeworkService.portalPostComment(ctx.userId, ctx.studentIds, input),
      ),
  }),
});
