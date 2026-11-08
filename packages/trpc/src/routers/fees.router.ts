import {
  createConcessionSchema,
  createFeeHeadSchema,
  createFeeStructureLineSchema,
  createFeeStructureSchema,
  createLateFeeRuleSchema,
  createOneOffChargeSchema,
  createOpeningBalanceSchema,
  createSubscriptionSchema,
  feeDashboardInputSchema,
  feeDashboardListInputSchema,
  feeDashboardListOutputSchema,
  feeDashboardOutputSchema,
  feeDocumentDayBookSchema,
  feeDocumentDefaultersSchema,
  feeDocumentNoticesSchema,
  feeDocumentSchema,
  feeDuesRunSchema,
  feePrintSettingsSchema,
  feeReceiptLayoutSchema,
  feeSetupStatusSchema,
  updateFeePrintSettingsSchema,
  uploadFeePrintImageSchema,
  startFeeDuesRunSchema,
  feeStudentSummaryInputSchema,
  feeStudentSummarySchema,
  feeLineFrequencySchema,
  feeLinePeriodSelectSchema,
  feeSessionSettingsSchema,
  feeStructureLineWithPeriodsSchema,
  periodOptionSchema,
  quotePaymentSchema,
  updateFeeSessionSettingsSchema,
  updateLinePeriodSchema,
  voidConcessionSchema,
  voidOpeningBalanceSchema,
  duesListSchema,
  assignFeeStructureSchema,
  billClassOutputSchema,
  billClassSchema,
  feeGenerationModeSchema,
  feeIsoDateSchema,
  generateThroughOutputSchema,
  generateThroughSchema,
  feeHeadSelectSchema,
  feeMatrixCellInputSchema,
  feeMatrixCellOutputSchema,
  feeMatrixInputSchema,
  feeMatrixOutputSchema,
  feeInstallmentSelectSchema,
  feePaymentListRowSchema,
  feePaymentSelectSchema,
  feeRefundSelectSchema,
  feeStructureLineSelectSchema,
  feeStructureSelectSchema,
  financialTransactionListRowSchema,
  lateFeeRuleSelectSchema,
  openingBalanceSelectSchema,
  paymentDetailOutputSchema,
  paymentTransitionSchema,
  recordPaymentSchema,
  recordRefundSchema,
  studentFeeAssignmentSelectSchema,
  studentOptionalFeeSubscriptionSelectSchema,
  updateFeeHeadSchema,
  updateFeeStructureLineSchema,
  updateFeeStructureSchema,
} from "@repo/contracts";
import {
  feeDocumentsService,
  feesBillingService,
  feesCollectionService,
  feesDashboardService,
  feesService,
} from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure } from "../trpc";

/**
 * FEES — Phase 4. The thinnest layer: validate, take the tenancy filter from
 * ctx, call the service, map an empty row to NOT_FOUND.
 *
 * ADDRESSING (the use-branches rules): every fee row carries its own
 * org+school columns, so mutations name the SCHOOL node (`schoolId` is the
 * required parent in each input — B5) and the row id rides beside it or in
 * the path; the service's scopeWhere is what makes a cross-tenant row id
 * indistinguishable from a nonexistent one — both empty, both NOT_FOUND.
 * There is deliberately NO per-row owner resolver here: unlike a student
 * (whose owner is a join away), a fee row's owner is its own schoolId, and
 * the node gate on the addressed school plus the row filter is the complete
 * question. Lists use the permissive builder and clip.
 *
 * PERMISSION MAPPING (the plan's policy — owner-reviewed): the authz
 * vocabulary names CONCEPTS, so concessions ride `fee_waiver:*` (the
 * discount's name in the permission system), and late-fee rules,
 * subscriptions, and opening balances ride the `fee_structure` family —
 * they are configuration. Money movement is `fee_payment:*`; taking money
 * back is `fee_refund:create`: whoever holds it can refund, with no separate
 * approval; forgiving is `fee_waiver:approve`; a discount or a forgiven late fee
 * at the counter rides `fee_waiver:create`; the ledger read is `fee_report:read`.
 * The SENSITIVE set covers the acts that must skip the Redis snapshot:
 * `fee_payment:approve` (the bounce/reverse/cancel transitions),
 * `fee_waiver:approve`, `fee_waiver:create`, `fee_refund:create`.
 */

const notFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Resource not found." });

const READ_HISTORY = "academic_year:read_history" as const;

/** Required school parent (B5): overrides the builder's optional schoolId. */
const schoolParent = z.object({ schoolId: z.uuid() });

export const feesRouter = router({
  // -------------------------------------------------------------------------
  // School fee settings — fee.settings.* (ADR-051)
  // -------------------------------------------------------------------------
  settings: router({
    get: staffProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-settings",
          tags: ["fees"],
          summary: "The school's fee settings (when dues are created)",
          protect: true,
        },
      })
      .input(schoolParent)
      .output(z.object({ mode: feeGenerationModeSchema }))
      .query(({ ctx }) => feesBillingService.getFeeGenerationMode(ctx.scope)),

    setGenerationMode: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "PATCH",
          path: "/fee-settings/generation-mode",
          tags: ["fees"],
          summary: "Pause or resume adding each month's dues automatically",
          protect: true,
        },
      })
      .input(z.object({ mode: feeGenerationModeSchema, ...schoolParent.shape }))
      .output(z.object({ mode: feeGenerationModeSchema }))
      .mutation(({ ctx, input }) =>
        feesBillingService.setFeeGenerationMode(ctx.scope, input.mode),
      ),

    getSession: staffProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-settings/session",
          tags: ["fees"],
          summary: "A session's fee months, due day and receipt numbering",
          protect: true,
        },
      })
      .input(z.object({ academicYearId: z.uuid(), ...schoolParent.shape }))
      .output(feeSessionSettingsSchema)
      .query(({ ctx, input }) =>
        feesBillingService.getSessionSettings(ctx.scope, input.academicYearId),
      ),

    setSession: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "PATCH",
          path: "/fee-settings/session",
          tags: ["fees"],
          summary: "Set a session's fee months, due day and receipt numbering",
          protect: true,
        },
      })
      .input(
        z.object({
          academicYearId: z.uuid(),
          data: updateFeeSessionSettingsSchema,
          ...schoolParent.shape,
        }),
      )
      .output(feeSessionSettingsSchema)
      .mutation(({ ctx, input }) =>
        feesBillingService.setSessionSettings(ctx.scope, input.academicYearId, input.data),
      ),
  }),

  // -------------------------------------------------------------------------
  // The Fees dashboard and the student fee page
  // -------------------------------------------------------------------------
  dashboard: router({
    overview: staffListProcedure("fee_report:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fees/dashboard",
          tags: ["fees"],
          summary: "Every figure at the top of the Fees dashboard",
          protect: true,
        },
      })
      .input(feeDashboardInputSchema)
      .output(feeDashboardOutputSchema)
      .query(async ({ ctx, input }) => {
        const overview = await feesDashboardService.overview(
          ctx.scopes,
          input,
          ctx.canWithin(READ_HISTORY),
        );
        if (!overview) throw notFound();
        return overview;
      }),

    list: staffListProcedure("fee_report:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fees/dashboard/students",
          tags: ["fees"],
          summary: "Students on the Fees dashboard: who owes, who paid, who is not billed",
          protect: true,
        },
      })
      .input(feeDashboardListInputSchema)
      .output(feeDashboardListOutputSchema)
      .query(async ({ ctx, input }) => {
        const list = await feesDashboardService.list(ctx.scopes, input, ctx.canWithin(READ_HISTORY));
        if (!list) throw notFound();
        return list;
      }),

    student: staffListProcedure("fee_report:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fees/dashboard/students/{studentId}",
          tags: ["fees"],
          summary: "Everything the student fee page shows",
          protect: true,
        },
      })
      .input(feeStudentSummaryInputSchema)
      .output(feeStudentSummarySchema)
      .query(async ({ ctx, input }) => {
        const summary = await feesDashboardService.studentSummary(
          ctx.scopes,
          input,
          ctx.canWithin(READ_HISTORY),
        );
        if (!summary) throw notFound();
        return summary;
      }),

    setup: staffProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fees/setup-status",
          tags: ["fees"],
          summary: "What the Fee setup screen shows: classes, structures, who is waiting",
          protect: true,
        },
      })
      .input(z.object({ academicYearId: z.uuid(), ...schoolParent.shape }))
      .output(feeSetupStatusSchema)
      .query(({ ctx, input }) =>
        feesDashboardService.setupStatus(ctx.scope, input.academicYearId),
      ),
  }),

  // -------------------------------------------------------------------------
  // Printed documents: finished HTML the client turns into a PDF. A page of HTML
  // is no use to a REST caller, so these stay off the REST surface.
  // -------------------------------------------------------------------------
  document: router({
    receipt: staffProcedure("fee_payment:read")
      .input(z.object({ id: z.uuid(), layout: feeReceiptLayoutSchema.optional(), ...schoolParent.shape }))
      .output(feeDocumentSchema)
      .query(async ({ ctx, input }) => {
        const document = await feeDocumentsService.receipt(ctx.scope, input.id, input.layout);
        if (!document) throw notFound();
        return document;
      }),

    statement: staffProcedure("fee_report:read")
      .input(z.object({ academicYearId: z.uuid(), studentId: z.uuid(), ...schoolParent.shape }))
      .output(feeDocumentSchema)
      .query(async ({ ctx, input }) => {
        const document = await feeDocumentsService.statement(ctx.scope, input, ctx.can(READ_HISTORY));
        if (!document) throw notFound();
        return document;
      }),

    noDues: staffProcedure("fee_report:read")
      .input(z.object({ academicYearId: z.uuid(), studentId: z.uuid(), ...schoolParent.shape }))
      .output(feeDocumentSchema)
      .query(async ({ ctx, input }) => {
        const document = await feeDocumentsService.noDues(ctx.scope, input, ctx.can(READ_HISTORY));
        if (!document) throw notFound();
        return document;
      }),

    notices: staffProcedure("fee_report:read")
      .input(z.object({ data: feeDocumentNoticesSchema, ...schoolParent.shape }))
      .output(feeDocumentSchema)
      .query(async ({ ctx, input }) => {
        const document = await feeDocumentsService.notices(ctx.scope, input.data, ctx.can(READ_HISTORY));
        if (!document) throw notFound();
        return document;
      }),

    defaulters: staffProcedure("fee_report:read")
      .input(z.object({ data: feeDocumentDefaultersSchema, ...schoolParent.shape }))
      .output(feeDocumentSchema)
      .query(async ({ ctx, input }) => {
        const document = await feeDocumentsService.defaulters(ctx.scope, input.data, ctx.can(READ_HISTORY));
        if (!document) throw notFound();
        return document;
      }),

    dayBook: staffProcedure("fee_report:read")
      .input(z.object({ data: feeDocumentDayBookSchema, ...schoolParent.shape }))
      .output(feeDocumentSchema)
      .query(async ({ ctx, input }) => {
        const document = await feeDocumentsService.dayBook(ctx.scope, input.data);
        if (!document) throw notFound();
        return document;
      }),

    chequeList: staffProcedure("fee_payment:read")
      .input(z.object({ academicYearId: z.uuid(), ...schoolParent.shape }))
      .output(feeDocumentSchema)
      .query(async ({ ctx, input }) => {
        const document = await feeDocumentsService.chequeList(ctx.scope, input.academicYearId);
        if (!document) throw notFound();
        return document;
      }),

    structureSheet: staffProcedure("fee_structure:read")
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(feeDocumentSchema)
      .query(async ({ ctx, input }) => {
        const document = await feeDocumentsService.structureSheet(ctx.scope, input.id, ctx.can(READ_HISTORY));
        if (!document) throw notFound();
        return document;
      }),
  }),

  printing: router({
    get: staffProcedure("fee_payment:read")
      .input(schoolParent)
      .output(feePrintSettingsSchema)
      .query(({ ctx }) => feeDocumentsService.getPrintSettings(ctx.scope)),

    update: staffProcedure("fee_structure:update")
      .input(z.object({ data: updateFeePrintSettingsSchema, ...schoolParent.shape }))
      .output(feePrintSettingsSchema)
      .mutation(({ ctx, input }) =>
        feeDocumentsService.updatePrintSettings(ctx.scope, input.data, ctx.userId),
      ),

    uploadImage: staffProcedure("fee_structure:update")
      .input(z.object({ data: uploadFeePrintImageSchema, ...schoolParent.shape }))
      .output(z.object({ objectId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        feeDocumentsService.uploadPrintImage(ctx.scope, input.data, ctx.userId),
      ),
  }),

  // -------------------------------------------------------------------------
  // Creating dues for everyone in the background
  // -------------------------------------------------------------------------
  duesRun: router({
    start: staffProcedure("student_fee_assignment:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-dues-runs",
          tags: ["fees"],
          summary: "Start creating dues for everyone, in the background",
          protect: true,
        },
      })
      .input(z.object({ data: startFeeDuesRunSchema, ...schoolParent.shape }))
      .output(feeDuesRunSchema)
      .mutation(({ ctx, input }) =>
        feesBillingService.startDuesRun(ctx.scope, input.data, ctx.userId),
      ),

    latest: staffProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-dues-runs/latest",
          tags: ["fees"],
          summary: "The latest run and how it went",
          protect: true,
        },
      })
      .input(z.object({ academicYearId: z.uuid(), ...schoolParent.shape }))
      .output(feeDuesRunSchema.nullable())
      .query(({ ctx, input }) =>
        feesBillingService.latestDuesRun(ctx.scope, input.academicYearId),
      ),
  }),

  // -------------------------------------------------------------------------
  // Heads — fee.head.*
  // -------------------------------------------------------------------------
  head: router({
    list: staffListProcedure("fee_head:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-heads",
          tags: ["fees"],
          summary: "List active fee heads",
          protect: true,
        },
      })
      .output(z.array(feeHeadSelectSchema))
      .query(({ ctx }) => feesService.listFeeHeads(ctx.scopes)),

    byId: staffProcedure("fee_head:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-heads/{id}",
          tags: ["fees"],
          summary: "Get one fee head",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(feeHeadSelectSchema)
      .query(async ({ ctx, input }) => {
        const head = await feesService.getFeeHeadById(ctx.scope, input.id);
        if (!head) throw notFound();
        return head;
      }),

    create: staffProcedure("fee_head:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-heads",
          tags: ["fees"],
          summary: "Create a fee head",
          protect: true,
        },
      })
      .input(z.object({ data: createFeeHeadSchema, ...schoolParent.shape }))
      .output(feeHeadSelectSchema)
      .mutation(({ ctx, input }) =>
        feesService.createFeeHead(ctx.scope, input.data, ctx.userId),
      ),

    update: staffProcedure("fee_head:update")
      .meta({
        openapi: {
          method: "PATCH",
          path: "/fee-heads/{id}",
          tags: ["fees"],
          summary: "Update a fee head",
          protect: true,
        },
      })
      .input(
        z.object({ id: z.uuid(), data: updateFeeHeadSchema, ...schoolParent.shape }),
      )
      .output(feeHeadSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const head = await feesService.updateFeeHead(ctx.scope, input.id, input.data);
        if (!head) throw notFound();
        return head;
      }),

    deactivate: staffProcedure("fee_head:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-heads/{id}/deactivate",
          tags: ["fees"],
          summary: "Deactivate a fee head (hard rule 2: never delete)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(feeHeadSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const head = await feesService.deactivateFeeHead(ctx.scope, input.id);
        if (!head) throw notFound();
        return head;
      }),
  }),

  // -------------------------------------------------------------------------
  // Structures, lines, late-fee rules — fee.structure.*
  // -------------------------------------------------------------------------
  structure: router({
    list: staffListProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-structures",
          tags: ["fees"],
          summary: "List a year's fee structures",
          protect: true,
        },
      })
      .input(z.object({ academicYearId: z.uuid(), includeHistory: z.boolean() }))
      .output(z.array(feeStructureSelectSchema))
      .query(({ ctx, input }) =>
        feesService.listFeeStructures(ctx.scopes, input.academicYearId, input.includeHistory),
      ),

    byId: staffProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-structures/{id}",
          tags: ["fees"],
          summary: "Get one fee structure",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), includeHistory: z.boolean(), ...schoolParent.shape }))
      .output(feeStructureSelectSchema)
      .query(async ({ ctx, input }) => {
        const structure = await feesService.getFeeStructureById(
          ctx.scope,
          input.id,
          input.includeHistory,
        );
        if (!structure) throw notFound();
        return structure;
      }),

    create: staffProcedure("fee_structure:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-structures",
          tags: ["fees"],
          summary: "Create a fee structure",
          protect: true,
        },
      })
      .input(z.object({ data: createFeeStructureSchema, ...schoolParent.shape }))
      .output(feeStructureSelectSchema)
      .mutation(({ ctx, input }) =>
        feesService.createFeeStructure(ctx.scope, input.data, ctx.userId),
      ),

    update: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "PATCH",
          path: "/fee-structures/{id}",
          tags: ["fees"],
          summary: "Update a fee structure",
          protect: true,
        },
      })
      .input(
        z.object({ id: z.uuid(), data: updateFeeStructureSchema, ...schoolParent.shape }),
      )
      .output(feeStructureSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const structure = await feesService.updateFeeStructure(
          ctx.scope,
          input.id,
          input.data,
        );
        if (!structure) throw notFound();
        return structure;
      }),

    deactivate: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-structures/{id}/deactivate",
          tags: ["fees"],
          summary: "Deactivate a fee structure (assignments snapshot from it)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(feeStructureSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const structure = await feesService.deactivateFeeStructure(ctx.scope, input.id);
        if (!structure) throw notFound();
        return structure;
      }),

    addLine: staffProcedure("fee_structure:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-structures/{id}/lines",
          tags: ["fees"],
          summary: "Add a head line to a structure",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), data: createFeeStructureLineSchema, ...schoolParent.shape }))
      .output(feeStructureLineSelectSchema)
      .mutation(({ ctx, input }) =>
        feesService.createFeeStructureLine(ctx.scope, input.id, input.data),
      ),

    listLines: staffProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-structures/{id}/lines",
          tags: ["fees"],
          summary: "List a structure's lines",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(z.array(feeStructureLineWithPeriodsSchema))
      .query(({ ctx, input }) => feesService.listFeeStructureLines(ctx.scope, input.id)),

    periodOptions: staffProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-structures/period-options",
          tags: ["fees"],
          summary: "The periods a fee line of a given frequency could charge this session",
          protect: true,
        },
      })
      .input(
        z.object({
          academicYearId: z.uuid(),
          frequency: feeLineFrequencySchema,
          ...schoolParent.shape,
        }),
      )
      .output(z.array(periodOptionSchema))
      .query(({ ctx, input }) =>
        feesService.listPeriodOptions(ctx.scope, input.academicYearId, input.frequency),
      ),

    updatePeriod: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "PATCH",
          path: "/fee-line-periods/{id}",
          tags: ["fees"],
          summary: "Change one row of a fee line's schedule",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), data: updateLinePeriodSchema, ...schoolParent.shape }))
      .output(feeLinePeriodSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const period = await feesService.updateLinePeriod(ctx.scope, input.id, input.data);
        if (!period) throw notFound();
        return period;
      }),

    listSections: staffProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-structures/{id}/sections",
          tags: ["fees"],
          summary: "The sections a structure covers",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(z.array(z.uuid()))
      .query(({ ctx, input }) => feesService.listStructureSections(ctx.scope, input.id)),

    setSections: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "PUT",
          path: "/fee-structures/{id}/sections",
          tags: ["fees"],
          summary: "Link a structure to sections, when a class has several structures",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), sectionIds: z.array(z.uuid()), ...schoolParent.shape }))
      .output(z.object({ sectionIds: z.array(z.uuid()) }))
      .mutation(({ ctx, input }) =>
        feesService.setStructureSections(ctx.scope, input.id, input.sectionIds),
      ),

    startBilling: staffProcedure("student_fee_assignment:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-structures/{id}/start-billing",
          tags: ["fees"],
          summary: "Start billing a structure: bills everyone it covers, then new admissions",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(billClassOutputSchema)
      .mutation(({ ctx, input }) =>
        feesBillingService.startBilling(ctx.scope, input.id, ctx.userId),
      ),

    removeLateFeeRule: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "DELETE",
          path: "/fee-late-fee-rules/{id}",
          tags: ["fees"],
          summary: "Switch a late fee rule off (payments already made keep theirs)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(lateFeeRuleSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const rule = await feesService.deactivateLateFeeRule(ctx.scope, input.id);
        if (!rule) throw notFound();
        return rule;
      }),

    updateLine: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "PATCH",
          path: "/fee-structure-lines/{id}",
          tags: ["fees"],
          summary: "Update a structure line",
          protect: true,
        },
      })
      .input(
        z.object({ id: z.uuid(), data: updateFeeStructureLineSchema, ...schoolParent.shape }),
      )
      .output(feeStructureLineSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const line = await feesService.updateFeeStructureLine(ctx.scope, input.id, input.data);
        if (!line) throw notFound();
        return line;
      }),

    addLateFeeRule: staffProcedure("fee_structure:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/late-fee-rules",
          tags: ["fees"],
          summary: "Create a late-fee rule",
          protect: true,
        },
      })
      .input(z.object({ data: createLateFeeRuleSchema, ...schoolParent.shape }))
      .output(lateFeeRuleSelectSchema)
      .mutation(({ ctx, input }) =>
        feesService.createLateFeeRule(ctx.scope, input.data, ctx.userId),
      ),

    listLateFeeRules: staffListProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/late-fee-rules",
          tags: ["fees"],
          summary: "List active late-fee rules",
          protect: true,
        },
      })
      .output(z.array(lateFeeRuleSelectSchema))
      .query(({ ctx }) => feesService.listActiveLateFeeRules(ctx.scopes)),
  }),

  // -------------------------------------------------------------------------
  // Optional-fee subscriptions — fee.subscription.*
  // -------------------------------------------------------------------------
  subscription: router({
    list: staffListProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-subscriptions",
          tags: ["fees"],
          summary: "List a year's optional-fee subscriptions",
          protect: true,
        },
      })
      .input(
        z.object({
          academicYearId: z.uuid(),
          includeHistory: z.boolean(),
          studentId: z.uuid().optional(),
        }),
      )
      .output(z.array(studentOptionalFeeSubscriptionSelectSchema))
      .query(({ ctx, input }) =>
        feesService.listSubscriptions(
          ctx.scopes,
          input.academicYearId,
          input.includeHistory,
          input.studentId,
        ),
      ),

    create: staffProcedure("fee_structure:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-subscriptions",
          tags: ["fees"],
          summary: "Subscribe a student to an optional service",
          protect: true,
        },
      })
      .input(z.object({ data: createSubscriptionSchema, ...schoolParent.shape }))
      .output(studentOptionalFeeSubscriptionSelectSchema)
      .mutation(({ ctx, input }) =>
        feesService.createSubscription(ctx.scope, input.data, ctx.userId),
      ),

    cancel: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-subscriptions/{id}/cancel",
          tags: ["fees"],
          summary: "Cancel a subscription",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(studentOptionalFeeSubscriptionSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const subscription = await feesService.cancelSubscription(ctx.scope, input.id);
        if (!subscription) throw notFound();
        return subscription;
      }),
  }),

  // -------------------------------------------------------------------------
  // Assignments and the generator — fee.assignment.*
  // -------------------------------------------------------------------------
  assignment: router({
    byStudent: staffProcedure("student_fee_assignment:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-assignments",
          tags: ["fees"],
          summary: "A student's fee assignment for a year",
          protect: true,
        },
      })
      .input(
        z.object({
          studentId: z.uuid(),
          academicYearId: z.uuid(),
          ...schoolParent.shape,
        }),
      )
      .output(studentFeeAssignmentSelectSchema.nullable())
      .query(({ ctx, input }) =>
        feesCollectionService.getAssignmentForStudent(
          ctx.scope,
          input.studentId,
          input.academicYearId,
        ),
      ),

    assign: staffProcedure("student_fee_assignment:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-assignments",
          tags: ["fees"],
          summary: "Bill one student: their fee record and their dues together",
          protect: true,
        },
      })
      .input(z.object({ data: assignFeeStructureSchema, ...schoolParent.shape }))
      .output(studentFeeAssignmentSelectSchema.extend({ installmentsCreated: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const { assignment, inserted } = await feesBillingService.billEnrollment(
          ctx.scope,
          input.data,
          ctx.userId,
        );
        return { ...assignment, installmentsCreated: inserted };
      }),

    setStatus: staffProcedure("student_fee_assignment:update")
      .meta({
        openapi: {
          method: "PATCH",
          path: "/fee-assignments/{id}/status",
          tags: ["fees"],
          summary: "Suspend, cancel or restore a student's billing",
          protect: true,
        },
      })
      .input(
        z.object({
          id: z.uuid(),
          status: z.enum(["active", "suspended", "cancelled"]),
          ...schoolParent.shape,
        }),
      )
      .output(studentFeeAssignmentSelectSchema)
      .mutation(({ ctx, input }) =>
        feesBillingService.setAssignmentStatus(ctx.scope, input.id, input.status),
      ),

    billClass: staffProcedure("student_fee_assignment:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-assignments/bill-class",
          tags: ["fees"],
          summary: "Bill every not-yet-billed student of a class (skips the billed)",
          protect: true,
        },
      })
      .input(z.object({ data: billClassSchema, ...schoolParent.shape }))
      .output(billClassOutputSchema)
      .mutation(({ ctx, input }) =>
        feesBillingService.billClass(ctx.scope, input.data, ctx.userId),
      ),

    generateInstallments: staffProcedure("student_fee_assignment:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-assignments/{id}/generate-installments",
          tags: ["fees"],
          summary: "Run the idempotent installment generator",
          protect: true,
        },
      })
      // `through` (ADR-051): write only dues due on or before this date —
      // "pay ahead" in a monthly school. Left out, the school's mode decides.
      .input(z.object({ id: z.uuid(), through: feeIsoDateSchema.optional(), ...schoolParent.shape }))
      .output(z.object({ inserted: z.number().int(), through: feeIsoDateSchema.nullable() }))
      .mutation(({ ctx, input }) =>
        feesBillingService.generateInstallments(ctx.scope, input.id, undefined, {
          through: input.through,
        }),
      ),

    generateThrough: staffProcedure("student_fee_assignment:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-assignments/generate-through",
          tags: ["fees"],
          summary: "Generate every billed student's dues up to a date (month by month)",
          protect: true,
        },
      })
      .input(z.object({ data: generateThroughSchema, ...schoolParent.shape }))
      .output(generateThroughOutputSchema)
      .mutation(({ ctx, input }) =>
        feesBillingService.generateThrough(ctx.scope, input.data),
      ),

    recomputeConcessions: staffProcedure("student_fee_assignment:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-assignments/{id}/recompute-concessions",
          tags: ["fees"],
          summary: "Re-apportion concessions onto never-paid installments",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(z.object({ recomputed: z.boolean() }))
      .mutation(({ ctx, input }) =>
        feesBillingService.recomputeAssignmentConcessions(ctx.scope, input.id),
      ),

    addConcession: staffProcedure("fee_waiver:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-assignments/{id}/concessions",
          tags: ["fees"],
          summary: "Record a concession (the audit amount is computed, never sent)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), data: createConcessionSchema, ...schoolParent.shape }))
      .output(z.object({ concessionAmount: z.string() }))
      .mutation(({ ctx, input }) =>
        feesService
          .createConcession(ctx.scope, input.id, input.data, ctx.userId)
          .then((c) => ({ concessionAmount: c.concessionAmount })),
      ),

    voidConcession: staffProcedure("fee_waiver:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-concessions/{id}/void",
          tags: ["fees"],
          summary: "Withdraw a concession; unpaid dues go back to full",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), data: voidConcessionSchema, ...schoolParent.shape }))
      .output(z.object({ id: z.uuid() }))
      .mutation(({ ctx, input }) =>
        feesService
          .voidConcession(ctx.scope, input.id, input.data.reason, ctx.userId)
          .then((c) => ({ id: c.id })),
      ),
  }),

  matrix: router({
    list: staffListProcedure("fee_report:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-matrix",
          tags: ["fees"],
          summary: "List the student fee status matrix",
          protect: true,
        },
      })
      .input(feeMatrixInputSchema)
      .output(feeMatrixOutputSchema)
      .query(async ({ ctx, input }) => {
        const result = await feesCollectionService.listMatrix(
          ctx.scopes,
          input,
          ctx.canWithin(READ_HISTORY),
        );
        if (!result) throw notFound();
        return result;
      }),

    cell: staffListProcedure("fee_report:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-matrix/cell",
          tags: ["fees"],
          summary: "Get one student fee matrix cell breakdown",
          protect: true,
        },
      })
      .input(feeMatrixCellInputSchema)
      .output(feeMatrixCellOutputSchema.nullable())
      .query(({ ctx, input }) =>
        feesCollectionService.getMatrixCell(
          ctx.scopes,
          input,
          ctx.canWithin(READ_HISTORY),
        ),
      ),
  }),

  // -------------------------------------------------------------------------
  // Dues — fee.installment.*
  // -------------------------------------------------------------------------
  installment: router({
    dues: staffListProcedure("student_fee_assignment:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-dues",
          tags: ["fees"],
          summary: "The accountant's open-dues list",
          protect: true,
        },
      })
      .input(
        duesListSchema.pick({
          academicYearId: true,
          studentId: true,
          dueOnOrBefore: true,
        }),
      )
      .output(z.array(feeInstallmentSelectSchema))
      .query(({ ctx, input }) =>
        feesCollectionService.listDues(ctx.scopes, input.academicYearId, {
          studentId: input.studentId,
          dueOnOrBefore: input.dueOnOrBefore,
        }),
      ),

    waive: staffProcedure("fee_waiver:approve")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-installments/{id}/waive",
          tags: ["fees"],
          summary: "Waive a never-paid installment (never-paid only)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(feeInstallmentSelectSchema)
      .mutation(({ ctx, input }) =>
        feesCollectionService.waiveInstallment(ctx.scope, input.id, ctx.userId),
      ),

    cancel: staffProcedure("student_fee_assignment:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-installments/{id}/cancel",
          tags: ["fees"],
          summary: "Cancel a due created by mistake (never-paid only)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(feeInstallmentSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const due = await feesBillingService.cancelDue(ctx.scope, input.id);
        if (!due) throw notFound();
        return due;
      }),

    addOneOff: staffProcedure("student_fee_assignment:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-installments/one-off",
          tags: ["fees"],
          summary: "Add a one-off charge on a student, such as a dress or notebook",
          protect: true,
        },
      })
      .input(z.object({ data: createOneOffChargeSchema, ...schoolParent.shape }))
      .output(
        z.object({
          due: feeInstallmentSelectSchema.nullable(),
          payment: feePaymentSelectSchema.nullable(),
        }),
      )
      .mutation(({ ctx, input }) => {
        if (input.data.paid && !ctx.can("fee_payment:create")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your role can't record a payment.",
          });
        }
        return feesCollectionService.addOneOffCharge(ctx.scope, input.data, ctx.userId);
      }),
  }),

  // -------------------------------------------------------------------------
  // Payments — fee.payment.*
  // -------------------------------------------------------------------------
  payment: router({
    record: staffProcedure("fee_payment:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-payments",
          tags: ["fees"],
          summary: "Record a counter collection (idempotent on clientReference)",
          protect: true,
        },
      })
      .input(z.object({ data: recordPaymentSchema, ...schoolParent.shape }))
      .output(feePaymentSelectSchema)
      .mutation(({ ctx, input }) => {
        const givesSomethingOff =
          (input.data.discounts?.length ?? 0) > 0 || input.data.waiveLateFee === true;
        if (givesSomethingOff && !ctx.can("fee_waiver:create")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Your role can't give a discount or forgive a late fee.",
          });
        }
        return feesCollectionService.recordPayment(ctx.scope, input.data, ctx.userId);
      }),

    // What a payment would cost, late fee included, before recording it. Its
    // input is a list, so it stays off the REST surface.
    quote: staffProcedure("fee_payment:create")
      .input(z.object({ data: quotePaymentSchema, ...schoolParent.shape }))
      .output(z.object({ lateFeeAmount: z.string() }))
      .query(({ ctx, input }) => feesCollectionService.quotePayment(ctx.scope, input.data)),

    detail: staffProcedure("fee_payment:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-payments/{id}",
          tags: ["fees"],
          summary: "Payment detail with labelled installment and opening-balance lines",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(paymentDetailOutputSchema)
      .query(async ({ ctx, input }) => {
        const detail = await feesCollectionService.getPaymentDetail(ctx.scope, input.id);
        if (!detail) throw notFound();
        return detail;
      }),

    list: staffListProcedure("fee_payment:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-payments",
          tags: ["fees"],
          summary: "List a year's payments, each with its student label",
          protect: true,
        },
      })
      .input(
        z.object({ academicYearId: z.uuid(), studentId: z.uuid().optional() }),
      )
      .output(z.array(feePaymentListRowSchema))
      .query(({ ctx, input }) =>
        feesCollectionService.listPayments(ctx.scopes, input.academicYearId, input.studentId),
      ),

    clear: staffProcedure("fee_payment:approve")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-payments/{id}/clear",
          tags: ["fees"],
          summary: "Confirm a pending payment",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), reason: paymentTransitionSchema.shape.reason, ...schoolParent.shape }))
      .output(feePaymentSelectSchema)
      .mutation(({ ctx, input }) =>
        feesCollectionService.clearPayment(
          ctx.scope,
          { paymentId: input.id, reason: input.reason },
          ctx.userId,
        ),
      ),

    bounce: staffProcedure("fee_payment:approve")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-payments/{id}/bounce",
          tags: ["fees"],
          summary: "Record a cheque bounce (balances re-open, ledger debit)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), reason: paymentTransitionSchema.shape.reason, ...schoolParent.shape }))
      .output(feePaymentSelectSchema)
      .mutation(({ ctx, input }) =>
        feesCollectionService.bouncePayment(
          ctx.scope,
          { paymentId: input.id, reason: input.reason },
          ctx.userId,
        ),
      ),

    reverse: staffProcedure("fee_payment:approve")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-payments/{id}/reverse",
          tags: ["fees"],
          summary: "Reverse a cleared payment (balances re-open, ledger debit)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), reason: paymentTransitionSchema.shape.reason, ...schoolParent.shape }))
      .output(feePaymentSelectSchema)
      .mutation(({ ctx, input }) =>
        feesCollectionService.reversePayment(
          ctx.scope,
          { paymentId: input.id, reason: input.reason },
          ctx.userId,
        ),
      ),

    cancel: staffProcedure("fee_payment:approve")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-payments/{id}/cancel",
          tags: ["fees"],
          summary: "Cancel a pending payment (balances re-open, its credit is offset)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), reason: paymentTransitionSchema.shape.reason, ...schoolParent.shape }))
      .output(feePaymentSelectSchema)
      .mutation(({ ctx, input }) =>
        feesCollectionService.cancelPayment(
          ctx.scope,
          { paymentId: input.id, reason: input.reason },
          ctx.userId,
        ),
      ),

    refund: staffProcedure("fee_refund:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-refunds",
          tags: ["fees"],
          summary: "Refund against a cleared payment",
          protect: true,
        },
      })
      .input(z.object({ data: recordRefundSchema, ...schoolParent.shape }))
      .output(feeRefundSelectSchema)
      .mutation(({ ctx, input }) =>
        feesCollectionService.recordRefund(ctx.scope, input.data, ctx.userId),
      ),
  }),

  // -------------------------------------------------------------------------
  // Ledger and opening balances — fee.ledger.*
  // -------------------------------------------------------------------------
  ledger: router({
    list: staffListProcedure("fee_report:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-ledger",
          tags: ["fees"],
          summary: "The unified financial ledger for a year",
          protect: true,
        },
      })
      .input(z.object({ academicYearId: z.uuid(), studentId: z.uuid().optional() }))
      .output(z.array(financialTransactionListRowSchema))
      .query(({ ctx, input }) =>
        feesCollectionService.listLedger(ctx.scopes, input.academicYearId, input.studentId),
      ),

    listOpeningBalances: staffListProcedure("fee_structure:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-opening-balances",
          tags: ["fees"],
          summary: "Opening balances carried into a year",
          protect: true,
        },
      })
      .input(z.object({ academicYearId: z.uuid(), studentId: z.uuid().optional() }))
      .output(z.array(openingBalanceSelectSchema))
      .query(({ ctx, input }) =>
        feesBillingService.listOpeningBalances(
          ctx.scopes,
          input.academicYearId,
          input.studentId,
        ),
      ),

    recordOpeningBalance: staffProcedure("fee_structure:create")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-opening-balances",
          tags: ["fees"],
          summary: "Carry last year's dues into a year (writes its ledger row)",
          protect: true,
        },
      })
      .input(z.object({ data: createOpeningBalanceSchema, ...schoolParent.shape }))
      .output(openingBalanceSelectSchema)
      .mutation(({ ctx, input }) =>
        feesBillingService.createOpeningBalance(ctx.scope, input.data, ctx.userId),
      ),

    cancelOpeningBalance: staffProcedure("fee_structure:update")
      .meta({
        openapi: {
          method: "POST",
          path: "/fee-opening-balances/{id}/cancel",
          tags: ["fees"],
          summary: "Cancel previous dues entered by mistake (nothing paid yet)",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), data: voidOpeningBalanceSchema, ...schoolParent.shape }))
      .output(openingBalanceSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const balance = await feesBillingService.cancelOpeningBalance(
          ctx.scope,
          { id: input.id, reason: input.data.reason },
          ctx.userId,
        );
        if (!balance) throw notFound();
        return balance;
      }),
  }),
});
