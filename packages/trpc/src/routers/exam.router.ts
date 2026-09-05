import {
  componentResultSelectSchema,
  createExamSchema,
  createGradingScaleSchema,
  createPassCriteriaSchema,
  createSubjectTypeSchema,
  examClassPublicationSelectSchema,
  examComponentSelectSchema,
  examEligibilitySelectSchema,
  examScheduleSelectSchema,
  examSelectSchema,
  examTransitionInput,
  gradingScaleBandSelectSchema,
  gradingScaleSelectSchema,
  overrideEligibilityInput,
  passCriteriaSelectSchema,
  publishedReportCardSelectSchema,
  publishClassInput,
  publishExamInput,
  revisionWindowInput,
  saveComponentResultInput,
  saveExamComponentsInput,
  saveExamSchedulesInput,
  subjectTypeSelectSchema,
  submitRevisionInput,
  updateExamSchema,
  updatePassCriteriaSchema,
  updateSubjectTypeSchema,
  verifyComponentResultsInput,
} from "@repo/contracts";
import {
  examConfigService,
  examMarksService,
  examResultsService,
} from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  router,
  staffListProcedure,
  staffProcedure,
  studentProcedure,
  type OwnerResolver,
} from "../trpc";

/**
 * EXAMS — Phase 5 (ADR-032). Namespaced `exam.*` for the staff side and
 * `portalExam.*` for the parents' read-only card door.
 *
 * Routers stay thin: validate, resolve scope, call the service, map empty to
 * NOT_FOUND. The two load-bearing pieces here are ADR-029's SUBJECT GATE —
 * `marks.save` composes `subjectGate: true`, which requires sectionId +
 * subjectId in the input and a live section_teacher_assignments fact AFTER
 * the permission check (check:builders enforces the wiring) — and hard rule
 * 8: the portal sub-router reads `published_report_cards` ONLY, through
 * ownership, never the live tables.
 *
 * Permissions (authz vocabulary, one addition): `exam:*` runs the config and
 * lifecycle, `marks:create/update` the autosave cell (subject-gated),
 * `marks:verify` the review view (class teacher / VP / principal by default;
 * schools tighten via roles), `marks:publish` the correction ledger
 * (cache-bypassed sensitive permission), `report_card:read` staff card
 * history. Publication is `exam:publish` — a school-level act.
 */

const resolveExamOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await examConfigService.getExamOwnerId(organizationId, id);
  if (!schoolId) throw new TRPCError({ code: "NOT_FOUND", message: "Exam not found." });
  return { type: "school", id: schoolId };
};

const resolveSubjectTypeOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await examConfigService.getSubjectTypeOwnerId(organizationId, id);
  if (!schoolId) throw new TRPCError({ code: "NOT_FOUND", message: "Subject type not found." });
  return { type: "school", id: schoolId };
};

const resolveGradingScaleOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await examConfigService.getGradingScaleOwnerId(organizationId, id);
  if (!schoolId) throw new TRPCError({ code: "NOT_FOUND", message: "Grading scale not found." });
  return { type: "school", id: schoolId };
};

const resolveScheduleOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await examConfigService.getScheduleOwnerId(organizationId, id);
  if (!schoolId) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found." });
  return { type: "school", id: schoolId };
};

const resolveComponentResultOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await examMarksService.getComponentResultOwnerId(organizationId, id);
  if (!schoolId) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found." });
  return { type: "school", id: schoolId };
};

export const examRouter = router({
  subjectTypes: router({
    list: staffListProcedure("exam:read")
      .meta({ openapi: { method: "GET", path: "/exam/subject-types", tags: ["exams"], summary: "List the school's subject types", protect: true } })
      .input(z.object({}))
      .output(z.array(subjectTypeSelectSchema))
      .query(({ ctx }) => examConfigService.listSubjectTypes(ctx.scopes)),

    byId: staffProcedure("exam:read", { resolveOwner: resolveSubjectTypeOwner, gate: "overlap" })
      .meta({ openapi: { method: "GET", path: "/exam/subject-types/{id}", tags: ["exams"], summary: "One subject type", protect: true } })
      .input(z.object({ id: z.uuid() }))
      .output(subjectTypeSelectSchema.nullable())
      .query(({ ctx, input }) => examConfigService.getSubjectTypeById(ctx.scope, input.id)),

    create: staffProcedure("exam:create")
      .meta({ openapi: { method: "POST", path: "/exam/subject-types", tags: ["exams"], summary: "Create a subject type", protect: true } })
      .input(z.object({ data: createSubjectTypeSchema }))
      .output(subjectTypeSelectSchema.nullable())
      .mutation(({ ctx, input }) => examConfigService.createSubjectType(ctx.scope, input.data)),

    update: staffProcedure("exam:update", { resolveOwner: resolveSubjectTypeOwner })
      .meta({ openapi: { method: "PATCH", path: "/exam/subject-types/{id}", tags: ["exams"], summary: "Edit a subject type", protect: true } })
      .input(z.object({ id: z.uuid(), data: updateSubjectTypeSchema }))
      .output(subjectTypeSelectSchema.nullable())
      .mutation(({ ctx, input }) => examConfigService.updateSubjectType(ctx.scope, input.id, input.data)),

    deactivate: staffProcedure("exam:update", { resolveOwner: resolveSubjectTypeOwner })
      .meta({ openapi: { method: "DELETE", path: "/exam/subject-types/{id}", tags: ["exams"], summary: "Deactivate a subject type", protect: true } })
      .input(z.object({ id: z.uuid() }))
      .output(subjectTypeSelectSchema.nullable())
      .mutation(({ ctx, input }) => examConfigService.deactivateSubjectType(ctx.scope, input.id)),

    applyPreset: staffProcedure("exam:create")
      .meta({ openapi: { method: "POST", path: "/exam/subject-types/apply-preset", tags: ["exams"], summary: "Seed the standard subject types", protect: true } })
      .input(z.object({}))
      .output(z.array(subjectTypeSelectSchema))
      .mutation(({ ctx }) => examConfigService.applyCbsePreset(ctx.scope, ctx.userId)),
  }),

  gradingScales: router({
    list: staffListProcedure("exam:read")
      .meta({ openapi: { method: "GET", path: "/exam/grading-scales", tags: ["exams"], summary: "List grading scales with bands", protect: true } })
      .input(z.object({}))
      .output(z.array(gradingScaleSelectSchema.extend({ bands: z.array(gradingScaleBandSelectSchema) })))
      .query(({ ctx }) => examConfigService.listGradingScales(ctx.scopes)),

    create: staffProcedure("exam:create")
      .meta({ openapi: { method: "POST", path: "/exam/grading-scales", tags: ["exams"], summary: "Create a grading scale with its bands", protect: true } })
      .input(createGradingScaleSchema)
      .output(gradingScaleSelectSchema.extend({ bands: z.array(gradingScaleBandSelectSchema) }).nullable())
      .mutation(({ ctx, input }) => examConfigService.createGradingScale(ctx.scope, input)),

    update: staffProcedure("exam:update", { resolveOwner: resolveGradingScaleOwner })
      .meta({ openapi: { method: "PATCH", path: "/exam/grading-scales/{id}", tags: ["exams"], summary: "Rename or deactivate a grading scale", protect: true } })
      .input(z.object({ id: z.uuid(), data: z.object({ name: z.string().min(1).max(100).optional(), description: z.string().max(255).optional(), isActive: z.boolean().optional() }) }))
      .output(gradingScaleSelectSchema.nullable())
      .mutation(({ ctx, input }) => examConfigService.updateGradingScale(ctx.scope, input.id, input.data)),

    replaceBands: staffProcedure("exam:update", { resolveOwner: resolveGradingScaleOwner })
      .meta({ openapi: { method: "PUT", path: "/exam/grading-scales/{id}/bands", tags: ["exams"], summary: "Replace all bands of an unlocked scale", protect: true } })
      .input(z.object({ id: z.uuid(), bands: createGradingScaleSchema.shape.bands }))
      .output(gradingScaleSelectSchema.extend({ bands: z.array(gradingScaleBandSelectSchema) }).nullable())
      .mutation(({ ctx, input }) =>
        examConfigService.replaceGradingScaleBands(ctx.scope, input.id, { bands: input.bands }),
      ),
  }),

  passCriteria: router({
    list: staffListProcedure("exam:read")
      .meta({ openapi: { method: "GET", path: "/exam/pass-criteria", tags: ["exams"], summary: "One year's pass criteria", protect: true } })
      .input(z.object({ academicYearId: z.uuid() }))
      .output(z.array(passCriteriaSelectSchema))
      .query(({ ctx, input }) => examConfigService.listPassCriteria(ctx.scopes, input.academicYearId)),

    create: staffProcedure("exam:create")
      .meta({ openapi: { method: "POST", path: "/exam/pass-criteria/{academicYearId}", tags: ["exams"], summary: "Create the default or a class override", protect: true } })
      .input(z.object({ academicYearId: z.uuid(), data: createPassCriteriaSchema }))
      .output(passCriteriaSelectSchema.nullable())
      .mutation(({ ctx, input }) =>
        examConfigService.createPassCriteria(ctx.scope, input.academicYearId, input.data),
      ),

    update: staffProcedure("exam:update")
      .meta({ openapi: { method: "PATCH", path: "/exam/pass-criteria/{id}", tags: ["exams"], summary: "Edit pass criteria", protect: true } })
      .input(z.object({ id: z.uuid(), data: updatePassCriteriaSchema }))
      .output(passCriteriaSelectSchema.nullable())
      .mutation(({ ctx, input }) => examConfigService.updatePassCriteria(ctx.scope, input.id, input.data)),
  }),

  exam: router({
    list: staffListProcedure("exam:read")
      .meta({ openapi: { method: "GET", path: "/exams", tags: ["exams"], summary: "List exams", protect: true } })
      .input(z.object({ academicYearId: z.uuid().optional() }))
      .output(z.array(examSelectSchema))
      .query(({ ctx, input }) => examConfigService.listExams(ctx.scopes, input.academicYearId)),

    byId: staffProcedure("exam:read", { resolveOwner: resolveExamOwner, gate: "overlap" })
      .meta({ openapi: { method: "GET", path: "/exams/{id}", tags: ["exams"], summary: "One exam with schedules and components", protect: true } })
      .input(z.object({ id: z.uuid() }))
      .output(
        z.object({
          exam: examSelectSchema,
          schedules: z.array(
            examScheduleSelectSchema.extend({ components: z.array(examComponentSelectSchema) }),
          ),
        }).nullable(),
      )
      .query(({ ctx, input }) => examConfigService.getExamById(ctx.scope, input.id)),

    create: staffProcedure("exam:create")
      .meta({ openapi: { method: "POST", path: "/exams", tags: ["exams"], summary: "Create an exam", protect: true } })
      .input(z.object({ data: createExamSchema }))
      .output(examSelectSchema.nullable())
      .mutation(({ ctx, input }) => examConfigService.createExam(ctx.scope, input.data)),

    update: staffProcedure("exam:update", { resolveOwner: resolveExamOwner })
      .meta({ openapi: { method: "PATCH", path: "/exams/{id}", tags: ["exams"], summary: "Edit an exam", protect: true } })
      .input(z.object({ id: z.uuid(), data: updateExamSchema }))
      .output(examSelectSchema.nullable())
      .mutation(({ ctx, input }) => examConfigService.updateExam(ctx.scope, input.id, input.data)),

    transition: staffProcedure("exam:update", { resolveOwner: resolveExamOwner })
      .meta({ openapi: { method: "POST", path: "/exams/{id}/transition", tags: ["exams"], summary: "Move the exam through its lifecycle", protect: true } })
      .input(examTransitionInput)
      .output(examSelectSchema.nullable())
      .mutation(({ ctx, input }) => examConfigService.transition(ctx.scope, input)),
  }),

  schedules: router({
    list: staffListProcedure("exam:read")
      .meta({ openapi: { method: "GET", path: "/exams/{examId}/schedules", tags: ["exams"], summary: "One exam's schedules", protect: true } })
      .input(z.object({ examId: z.uuid() }))
      .output(z.array(examScheduleSelectSchema))
      .query(({ ctx, input }) => examConfigService.listSchedules(ctx.scopes, input.examId)),

    save: staffProcedure("exam:update", { resolveOwner: resolveExamOwner })
      .meta({ openapi: { method: "PUT", path: "/exams/{examId}/schedules", tags: ["exams"], summary: "Replace a class's schedules", protect: true } })
      .input(saveExamSchedulesInput)
      .output(z.array(examScheduleSelectSchema).nullable())
      .mutation(({ ctx, input }) => examConfigService.saveSchedules(ctx.scope, input)),
  }),

  components: router({
    list: staffProcedure("exam:read", { resolveOwner: resolveScheduleOwner, gate: "overlap" })
      .meta({ openapi: { method: "GET", path: "/exam/schedules/{scheduleId}/components", tags: ["exams"], summary: "One schedule's components", protect: true } })
      .input(z.object({ scheduleId: z.uuid() }))
      .output(z.array(examComponentSelectSchema))
      .query(({ ctx, input }) => examConfigService.listComponents([ctx.scope], input.scheduleId)),

    save: staffProcedure("exam:update", { resolveOwner: resolveScheduleOwner })
      .meta({ openapi: { method: "PUT", path: "/exam/schedules/{scheduleId}/components", tags: ["exams"], summary: "Replace a schedule's components", protect: true } })
      .input(saveExamComponentsInput)
      .output(z.array(examComponentSelectSchema).nullable())
      .mutation(({ ctx, input }) => examConfigService.saveComponents(ctx.scope, input)),
  }),

  eligibility: router({
    list: staffListProcedure("exam:read")
      .meta({ openapi: { method: "GET", path: "/exams/{examId}/eligibility", tags: ["exams"], summary: "The exam's advisory eligibility list", protect: true } })
      .input(z.object({ examId: z.uuid() }))
      .output(z.array(examEligibilitySelectSchema))
      .query(({ ctx, input }) => examMarksService.listEligibility(ctx.scopes, input.examId)),

    recompute: staffProcedure("exam:update", { resolveOwner: resolveExamOwner })
      .meta({ openapi: { method: "POST", path: "/exams/{examId}/eligibility/recompute", tags: ["exams"], summary: "Recompute eligibility for the cohort", protect: true } })
      .input(z.object({ examId: z.uuid() }))
      .output(z.array(z.object({ studentId: z.uuid(), isEligible: z.boolean() })).nullable())
      .mutation(({ ctx, input }) => examMarksService.recomputeEligibility(ctx.scope, input.examId)),

    override: staffProcedure("exam:update")
      .meta({ openapi: { method: "POST", path: "/exams/eligibility/override", tags: ["exams"], summary: "Allow a below-bar student, with a reason", protect: true } })
      .input(overrideEligibilityInput)
      .output(examEligibilitySelectSchema.nullable())
      .mutation(({ ctx, input }) => examMarksService.overrideEligibility(ctx.scope, ctx.userId, input)),
  }),

  marks: router({
    save: staffProcedure("marks:create", { subjectGate: true })
      .meta({ openapi: { method: "PUT", path: "/exam/marks", tags: ["marks"], summary: "Autosave one marks cell", protect: true } })
      .input(
        saveComponentResultInput.extend({
          sectionId: z.uuid(),
          subjectId: z.uuid(),
        }),
      )
      .output(
        z.object({
          id: z.uuid(),
          resultStatus: z.string(),
          marksObtained: z.string().nullable(),
          gradeObtained: z.string().nullable(),
          isAbsent: z.boolean(),
          isExempted: z.boolean(),
          updatedAt: z.date(),
        }).nullable(),
      )
      .mutation(({ ctx, input }) =>
        examMarksService.saveComponentResult(ctx.scope, ctx.userId, input),
      ),

    verify: staffProcedure("marks:verify")
      .meta({ openapi: { method: "POST", path: "/exam/marks/verify", tags: ["marks"], summary: "Verify a batch of entries", protect: true } })
      .input(verifyComponentResultsInput)
      .output(z.array(componentResultSelectSchema))
      .mutation(({ ctx, input }) =>
        examMarksService.verifyComponentResults(ctx.scope, ctx.userId, input),
      ),
  }),

  results: router({
    compute: staffProcedure("exam:update", { resolveOwner: resolveExamOwner })
      .meta({ openapi: { method: "POST", path: "/exams/{examId}/results/compute", tags: ["results"], summary: "Compute one class's results", protect: true } })
      .input(z.object({ examId: z.uuid(), classId: z.uuid() }))
      .output(z.array(z.object({ studentId: z.uuid() })).nullable())
      .mutation(({ ctx, input }) =>
        examResultsService.computeClassResults(ctx.scope, input.examId, input.classId),
      ),

    computeTermRanks: staffProcedure("exam:update")
      .meta({ openapi: { method: "POST", path: "/exam/terms/{termId}/ranks", tags: ["results"], summary: "Compute one term's ranks", protect: true } })
      .input(z.object({ termId: z.uuid() }))
      .output(z.object({ updated: z.number().int() }))
      .mutation(({ ctx, input }) => examResultsService.computeTermRanks(ctx.scope, input.termId)),

    computeFinal: staffProcedure("exam:update")
      .meta({ openapi: { method: "POST", path: "/exam/years/{academicYearId}/final-results", tags: ["results"], summary: "Compute a year's final results", protect: true } })
      .input(z.object({ academicYearId: z.uuid() }))
      .output(z.array(z.object({ studentId: z.uuid(), promotionStatus: z.string() })))
      .mutation(({ ctx, input }) =>
        examResultsService.computeFinalResults(ctx.scope, input.academicYearId),
      ),
  }),

  publication: router({
    publishClass: staffProcedure("exam:publish", { resolveOwner: resolveExamOwner })
      .meta({ openapi: { method: "POST", path: "/exams/{examId}/publish-class", tags: ["publication"], summary: "Publish one class's results", protect: true } })
      .input(publishClassInput)
      .output(z.object({ examId: z.uuid(), classId: z.uuid(), published: z.boolean() }).nullable())
      .mutation(({ ctx, input }) =>
        examResultsService.publishClass(ctx.scope, ctx.userId, input.examId, input.classId),
      ),

    publishExam: staffProcedure("exam:publish", { resolveOwner: resolveExamOwner })
      .meta({ openapi: { method: "POST", path: "/exams/{examId}/publish", tags: ["publication"], summary: "Publish every class of the exam", protect: true } })
      .input(publishExamInput)
      .output(z.object({ publishedClasses: z.number().int() }))
      .mutation(({ ctx, input }) => examResultsService.publishExam(ctx.scope, ctx.userId, input.examId)),

    openRevisionWindow: staffProcedure("marks:publish", { resolveOwner: resolveExamOwner })
      .meta({ openapi: { method: "POST", path: "/exams/{examId}/revision-window/open", tags: ["publication"], summary: "Open a correction window for one class", protect: true } })
      .input(revisionWindowInput)
      .output(examClassPublicationSelectSchema.nullable())
      .mutation(({ ctx, input }) =>
        examResultsService.openRevisionWindow(ctx.scope, ctx.userId, input.examId, input.classId),
      ),

    closeRevisionWindow: staffProcedure("marks:publish", { resolveOwner: resolveExamOwner })
      .meta({ openapi: { method: "POST", path: "/exams/{examId}/revision-window/close", tags: ["publication"], summary: "Close the window: recompute and re-issue affected cards", protect: true } })
      .input(revisionWindowInput)
      .output(z.object({ reIssued: z.number().int() }).nullable())
      .mutation(({ ctx, input }) =>
        examResultsService.closeRevisionWindow(ctx.scope, ctx.userId, input.examId, input.classId),
      ),

    applyRevision: staffProcedure("marks:publish", { resolveOwner: resolveComponentResultOwner })
      .meta({ openapi: { method: "POST", path: "/exam/marks/revisions", tags: ["publication"], summary: "Apply a post-publication correction (ledger first)", protect: true } })
      .input(submitRevisionInput)
      .output(z.object({ componentResultId: z.uuid(), applied: z.boolean() }).nullable())
      .mutation(({ ctx, input }) =>
        examResultsService.applyRevision(ctx.scope, ctx.userId, input),
      ),
  }),

  cards: router({
    versions: staffProcedure("report_card:read")
      .meta({ openapi: { method: "GET", path: "/exam/students/{studentId}/cards", tags: ["publication"], summary: "A student's report card versions", protect: true } })
      .input(z.object({ studentId: z.uuid() }))
      .output(z.array(publishedReportCardSelectSchema))
      .query(({ ctx, input }) => examResultsService.listCardVersions(ctx.scope, input.studentId)),
  }),
});

/**
 * THE PORTAL DOOR — `portalExam.results.*`. studentProcedure (ownership
 * only, no can()); the queries touch `published_report_cards` and NOTHING
 * else (hard rule 8). No live marks, no drafts, nothing unpublished.
 */
export const portalExamRouter = router({
  results: router({
    list: studentProcedure
      .meta({ openapi: { method: "GET", path: "/portal/exam/results", tags: ["portal"], summary: "The family's current report cards", protect: true } })
      .input(z.object({ academicYearId: z.uuid().optional() }))
      .output(z.array(publishedReportCardSelectSchema))
      .query(({ ctx, input }) =>
        examResultsService.listOwnedCards(ctx.studentIds, input.academicYearId),
      ),

    card: studentProcedure
      .meta({ openapi: { method: "GET", path: "/portal/exam/results/{cardId}", tags: ["portal"], summary: "One published report card", protect: true } })
      .input(z.object({ cardId: z.uuid() }))
      .output(publishedReportCardSelectSchema.nullable())
      .query(({ ctx, input }) => examResultsService.getOwnedCard(ctx.studentIds, input.cardId)),
  }),
});
