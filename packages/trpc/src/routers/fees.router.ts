import {
  createConcessionSchema,
  createFeeHeadSchema,
  createFeeStructureLineSchema,
  createFeeStructureSchema,
  createLateFeeRuleSchema,
  createOpeningBalanceSchema,
  createSubscriptionSchema,
  duesListSchema,
  assignFeeStructureSchema,
  feeHeadSelectSchema,
  feeInstallmentSelectSchema,
  feePaymentSelectSchema,
  feeRefundSelectSchema,
  feeStructureLineSelectSchema,
  feeStructureSelectSchema,
  financialTransactionSelectSchema,
  lateFeeRuleSelectSchema,
  openingBalanceSelectSchema,
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
  feesBillingService,
  feesCollectionService,
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
 * back is `fee_refund:*`; forgiving is `fee_waiver:approve`; the ledger read
 * is `fee_report:read`. The SENSITIVE set already covers the acts that must
 * skip the Redis snapshot: `fee_payment:approve` (the bounce/reverse/cancel
 * transitions), `fee_waiver:approve`, `fee_waiver:create`,
 * `fee_refund:approve`.
 */

const notFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Resource not found." });

/** Required school parent (B5): overrides the builder's optional schoolId. */
const schoolParent = z.object({ schoolId: z.uuid() });

export const feesRouter = router({
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
        feesService.createFeeStructureLine(ctx.scope, input.id, input.data, ctx.userId),
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
      .output(z.array(feeStructureLineSelectSchema))
      .query(({ ctx, input }) => feesService.listFeeStructureLines(ctx.scope, input.id)),

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
          summary: "Resolve the class fee structure onto an enrollment",
          protect: true,
        },
      })
      .input(z.object({ data: assignFeeStructureSchema, ...schoolParent.shape }))
      .output(studentFeeAssignmentSelectSchema)
      .mutation(({ ctx, input }) =>
        feesBillingService.assignFeeStructure(ctx.scope, input.data, ctx.userId),
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
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(z.object({ inserted: z.number().int() }))
      .mutation(({ ctx, input }) =>
        feesBillingService.generateInstallments(ctx.scope, input.id),
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
      .mutation(({ ctx, input }) =>
        feesCollectionService.recordPayment(ctx.scope, input.data, ctx.userId),
      ),

    detail: staffProcedure("fee_payment:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-payments/{id}",
          tags: ["fees"],
          summary: "Payment detail with allocations",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), ...schoolParent.shape }))
      .output(
        z.object({
          payment: feePaymentSelectSchema,
          allocations: z.array(z.object({ installmentId: z.uuid(), amountAllocated: z.string() })),
        }),
      )
      .query(async ({ ctx, input }) => {
        const detail = await feesCollectionService.getPaymentDetail(ctx.scope, input.id);
        if (!detail) throw notFound();
        return {
          payment: detail.payment,
          allocations: detail.allocations.map((a) => ({
            installmentId: a.installmentId,
            amountAllocated: a.amountAllocated,
          })),
        };
      }),

    list: staffListProcedure("fee_payment:read")
      .meta({
        openapi: {
          method: "GET",
          path: "/fee-payments",
          tags: ["fees"],
          summary: "List a year's payments",
          protect: true,
        },
      })
      .input(
        z.object({ academicYearId: z.uuid(), studentId: z.uuid().optional() }),
      )
      .output(z.array(feePaymentSelectSchema))
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
          summary: "Cancel a pending payment (no money moved, no ledger row)",
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
      .output(z.array(financialTransactionSelectSchema))
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
  }),
});
