import {
  feeConcessions,
  feeHeads,
  feeStructureLines,
  feeStructures,
  lateFeeRules,
  studentOptionalFeeSubscriptions,
} from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * FEES — Phase 4. This file grows with the phase: F3 owns the configuration
 * vocabulary (heads, structures, lines, late-fee rules, subscriptions, and
 * the concession shape); F4 adds the billing engine's inputs (assignment,
 * generation, late-fee maths), F5 the collection shapes (payments,
 * allocations, refunds, ledger reads).
 *
 * Same derivation as every contract here: schemas come from the Drizzle table
 * via drizzle-zod, so a column change surfaces as a validation-type error
 * rather than drifting silently (the type chain in AGENTS.md).
 */

/**
 * Drizzle's `date()` yields a `string`, not a `Date` — a calendar date has no
 * time or zone to preserve. Validated as ISO `YYYY-MM-DD`, which is what
 * Postgres accepts and what the client sends. (Shared with term.contract.ts,
 * which owns the rationale.)
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.");

/**
 * HARD RULE 4's input face: money arrives as a DECIMAL STRING — never a JS
 * number, never a float. `12`, `12.5` and `12.50` are accepted; `1e3`,
 * `12.999` and `NaN` are refused with a field-level message instead of a
 * Postgres one. The database's numeric(10,2) stays the final authority; this
 * only keeps float from ever touching the wire.
 */
const money = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Use a decimal amount like 1250.00.");

/** The payment modes, shared with the select-schema shape below. */
const feePaymentModeSchema = z.enum([
  "cash",
  "upi",
  "cheque",
  "neft_rtgs",
  "card",
  "dd",
  "online_portal",
]);

/** The refund modes — no online_portal (the gateway refunds through itself). */
const feeRefundModeSchema = z.enum(["cash", "upi", "cheque", "neft_rtgs", "dd"]);

// ---------------------------------------------------------------------------
// Fee heads
// ---------------------------------------------------------------------------

export const feeHeadSelectSchema = createSelectSchema(feeHeads);
export type FeeHead = z.infer<typeof feeHeadSelectSchema>;

export const createFeeHeadSchema = createInsertSchema(feeHeads, {
  name: z.string().min(1).max(150),
  shortCode: z.string().min(1).max(20).nullish(),
  description: z.string().min(1).max(255).nullish(),
})
  .omit({
    id: true,
    // Both come from the authenticated scope, never from the payload.
    organizationId: true,
    schoolId: true,
    isActive: true, // new heads are active; retirement is its own act
    createdBy: true, // the caller's identity, not the payload
    createdAt: true,
    updatedAt: true,
  })
  .refine((v) => !v.isTaxable || v.taxPercentage != null, {
    message: "A taxable fee head needs a tax percentage.",
    path: ["taxPercentage"],
  });
export type CreateFeeHeadInput = z.infer<typeof createFeeHeadSchema>;

/** Rename, re-code, re-categorise, re-tax. Nothing structural is patchable. */
export const updateFeeHeadSchema = createInsertSchema(feeHeads, {
  name: z.string().min(1).max(150),
  shortCode: z.string().min(1).max(20).nullish(),
  description: z.string().min(1).max(255).nullish(),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial()
  .refine((v) => !v.isTaxable || v.taxPercentage != null, {
    message: "A taxable fee head needs a tax percentage.",
    path: ["taxPercentage"],
  });
export type UpdateFeeHeadInput = z.infer<typeof updateFeeHeadSchema>;

// ---------------------------------------------------------------------------
// Fee structures
// ---------------------------------------------------------------------------

export const feeStructureSelectSchema = createSelectSchema(feeStructures);
export type FeeStructure = z.infer<typeof feeStructureSelectSchema>;

/**
 * The class-level template for one year. `academicYearId` and `classId` are
 * the parents this create NAMES (the use-branches addressing rule) — the
 * service re-reads both through the caller's scope (the section-service
 * pattern), because a FK proves a row exists, not that it belongs to your
 * tenant.
 */
export const createFeeStructureSchema = createInsertSchema(feeStructures, {
  name: z.string().min(1).max(150),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    isActive: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine((v) => !v.name || v.name.trim().length > 0, {
    message: "The structure needs a name.",
    path: ["name"],
  });
export type CreateFeeStructureInput = z.infer<typeof createFeeStructureSchema>;

export const updateFeeStructureSchema = createInsertSchema(feeStructures, {
  name: z.string().min(1).max(150),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    academicYearId: true, // not patchable — the year is the template's address
    classId: true, // not patchable — moving would orphan resolved assignments
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();
export type UpdateFeeStructureInput = z.infer<typeof updateFeeStructureSchema>;

// ---------------------------------------------------------------------------
// Fee structure lines
// ---------------------------------------------------------------------------

export const feeStructureLineSelectSchema = createSelectSchema(feeStructureLines);
export type FeeStructureLine = z.infer<typeof feeStructureLineSelectSchema>;

/**
 * One head's annual amount inside a structure. `feeStructureId` is the named
 * parent; the head is re-read in scope by the service. Uniqueness
 * (structure, head) is the database's `fee_structure_lines_structure_head_uq`
 * (ADR-022) — not pre-checked here.
 */
export const createFeeStructureLineSchema = createInsertSchema(feeStructureLines, {
  annualAmount: money,
  applicableFromMonth: z.number().int().min(1).max(12),
  applicableToMonth: z.number().int().min(1).max(12),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    feeStructureId: true, // addressed as the explicit parent by the router
    createdAt: true,
  })
  .refine((v) => v.applicableFromMonth <= v.applicableToMonth, {
    message: "The applicable range cannot end before it starts.",
    path: ["applicableToMonth"],
  });
export type CreateFeeStructureLineInput = z.infer<typeof createFeeStructureLineSchema>;

/** The amount, the frequency, the month range. The head is not patchable. */
export const updateFeeStructureLineSchema = createInsertSchema(feeStructureLines, {
  annualAmount: money,
  applicableFromMonth: z.number().int().min(1).max(12),
  applicableToMonth: z.number().int().min(1).max(12),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    feeStructureId: true,
    feeHeadId: true, // moving a line between heads would muddy the ledger
    createdAt: true,
  })
  .partial()
  .refine(
    (v) =>
      v.applicableFromMonth === undefined ||
      v.applicableToMonth === undefined ||
      v.applicableFromMonth <= v.applicableToMonth,
    {
      message: "The applicable range cannot end before it starts.",
      path: ["applicableToMonth"],
    },
  );
export type UpdateFeeStructureLineInput = z.infer<typeof updateFeeStructureLineSchema>;

// ---------------------------------------------------------------------------
// Late fee rules
// ---------------------------------------------------------------------------

export const lateFeeRuleSelectSchema = createSelectSchema(lateFeeRules);
export type LateFeeRule = z.infer<typeof lateFeeRuleSelectSchema>;

/**
 * A school-wide rule when `feeStructureId` is null, or one narrowed to a
 * structure. Precedence between them is F4's policy (`computeLateFee`
 * prefers the structure-named rule), not a constraint — two overlapping
 * active rules are representable and the resolver documents its choice.
 */
export const createLateFeeRuleSchema = createInsertSchema(lateFeeRules, {
  value: money,
  maxLateFee: money.nullish(),
  gracePeriodDays: z.number().int().min(0).max(365),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullish(),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    isActive: true,
    createdBy: true,
    createdAt: true,
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: "The rule cannot end before it starts.",
    path: ["effectiveTo"],
  });
export type CreateLateFeeRuleInput = z.infer<typeof createLateFeeRuleSchema>;

// ---------------------------------------------------------------------------
// Optional fee subscriptions
// ---------------------------------------------------------------------------

export const studentOptionalFeeSubscriptionSelectSchema = createSelectSchema(
  studentOptionalFeeSubscriptions,
);
export type StudentOptionalFeeSubscription = z.infer<
  typeof studentOptionalFeeSubscriptionSelectSchema
>;

/**
 * An opt-in service priced outside the class structure — transport, hostel,
 * canteen. The service refuses a head whose category is not `optional`: a
 * subscription IS the opt-in, and a `regular` head subscribed to would
 * double-charge what the structure already bills.
 */
export const createSubscriptionSchema = createInsertSchema(
  studentOptionalFeeSubscriptions,
  {
    serviceDetail: z.string().min(1).max(255).nullish(),
    monthlyAmount: money,
    annualAmount: money,
    subscribedFrom: isoDate,
    subscribedTo: isoDate.nullish(),
  },
)
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    status: true, // new subscriptions are active; cancellation is its own act
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    (v) =>
      !v.subscribedTo ||
      !v.subscribedFrom ||
      v.subscribedTo >= v.subscribedFrom,
    {
      message: "The subscription cannot end before it starts.",
      path: ["subscribedTo"],
    },
  );
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

// ---------------------------------------------------------------------------
// Fee concessions
// ---------------------------------------------------------------------------

export const feeConcessionSelectSchema = createSelectSchema(
  feeConcessions,
).extend({
  // The computed rupee amount is a drizzle numeric → string; nothing to add.
});

export type FeeConcession = z.infer<typeof feeConcessionSelectSchema>;

/**
 * A per-student discount on an assignment. `value` is the INPUT; the
 * `concession_amount` is COMPUTED by the service (percentage rounds DOWN —
 * the school never over-discounts) and is never accepted from the wire.
 * `feeHeadId` nullish: omitted/null applies to ALL heads of the assignment.
 *
 * The approval columns are set from the caller's identity by the router —
 * recording WHO approved is the v1 stand-in for the (deferred) approval
 * workflow.
 */
export const createConcessionSchema = createInsertSchema(feeConcessions, {
  value: money,
  reason: z.string().min(1).max(500).nullish(),
  validFrom: isoDate,
  validTo: isoDate.nullish(),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    studentFeeAssignmentId: true, // addressed as the explicit parent
    concessionAmount: true, // computed by the service, never sent
    approvedBy: true, // the caller's identity
    approvedAt: true,
    createdBy: true,
    createdAt: true,
  })
  .refine((v) => !v.validTo || !v.validFrom || v.validTo >= v.validFrom, {
    message: "The concession cannot end before it starts.",
    path: ["validTo"],
  });
export type CreateConcessionInput = z.infer<typeof createConcessionSchema>;

// ---------------------------------------------------------------------------
// The billing engine (F4)
// ---------------------------------------------------------------------------

/**
 * Resolves a class's structure onto ONE enrollment — the fee shadow of the
 * year anchor. The service finds the (unique) active structure for the
 * enrollment's class+year, snapshots the base/net totals, and stamps
 * `fee_effective_from`: the given date, or the enrollment's own start. A
 * student already assigned for that year is refused by the unique index.
 */
export const assignFeeStructureSchema = z.object({
  enrollmentId: z.uuid(),
  // Defaults to the enrollment's effective date in the service.
  feeEffectiveFrom: isoDate.optional(),
  joiningMonthFullCharge: z.boolean().optional(),
});
export type AssignFeeStructureInput = z.infer<typeof assignFeeStructureSchema>;

/** Which assignment to (re-)run the idempotent generator for. */
export const generateInstallmentsSchema = z.object({
  studentFeeAssignmentId: z.uuid(),
});
export type GenerateInstallmentsInput = z.infer<typeof generateInstallmentsSchema>;

/**
 * Carries last year's dues into a year, tagged with the year they came from.
 * The service writes the matching `opening_balance` ledger row in the same
 * transaction — every money movement hits the ledger.
 */
export const createOpeningBalanceSchema = z.object({
  studentId: z.uuid(),
  academicYearId: z.uuid(),
  originAcademicYearId: z.uuid(),
  amount: money,
  description: z.string().min(1).max(255).nullish(),
});
export type CreateOpeningBalanceInput = z.infer<typeof createOpeningBalanceSchema>;

// ---------------------------------------------------------------------------
// Collection and the ledger (F5)
// ---------------------------------------------------------------------------

/** One installment this payment touches, and how much of it this covers. */
export const paymentAllocationInputSchema = z.object({
  installmentId: z.uuid(),
  amount: money,
});
export type PaymentAllocationInput = z.infer<typeof paymentAllocationInputSchema>;

/**
 * A counter collection. The payment's `amount` is DERIVED as the sum of its
 * allocations — the cashier cannot type a total that disagrees with what the
 * money is FOR. Allocations may target ANY generated installment with a
 * balance — future-due or not (paying November's fees in October is the
 * normal Indian-school case; the Locked decision is that the ONLY refusal is
 * exceeding a balance). `clientReference` is the idempotency key: a retry
 * with the same key returns the original receipt instead of writing a second.
 */
export const recordPaymentSchema = z.object({
  studentId: z.uuid(),
  academicYearId: z.uuid(),
  paymentDate: isoDate,
  paymentMode: feePaymentModeSchema,
  allocations: z.array(paymentAllocationInputSchema).min(1),
  lateFeeAmount: money.nullish(),
  transactionReference: z.string().min(1).max(150).nullish(),
  bankName: z.string().min(1).max(100).nullish(),
  chequeDate: isoDate.nullish(),
  remarks: z.string().min(1).max(500).nullish(),
  clientReference: z.string().min(1).max(150).nullish(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const paymentTransitionSchema = z.object({
  paymentId: z.uuid(),
  reason: z.string().min(1).max(255),
});
export type PaymentTransitionInput = z.infer<typeof paymentTransitionSchema>;

/**
 * Money going back out against an ORIGINAL payment. The service validates the
 * refund against what that payment actually contributed minus what has
 * already been refunded, and re-opens the installment balances it reduced.
 */
export const recordRefundSchema = z.object({
  originalPaymentId: z.uuid(),
  refundAmount: money,
  refundDate: isoDate,
  refundMode: feeRefundModeSchema,
  transactionReference: z.string().min(1).max(150).nullish(),
  reason: z.string().min(1).max(500),
});
export type RecordRefundInput = z.infer<typeof recordRefundSchema>;

/** Which payment's full shape to read (payment + allocations + ledger rows). */
export const paymentDetailSchema = z.object({ paymentId: z.uuid() });
export type PaymentDetailInput = z.infer<typeof paymentDetailSchema>;

/** The accountant's due list — the collection screen's primary query. */
export const duesListSchema = z.object({
  academicYearId: z.uuid(),
  studentId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
  dueOnOrBefore: isoDate.optional(),
});
export type DuesListInput = z.infer<typeof duesListSchema>;

/**
 * THE GATEWAY WEBHOOK PAYLOAD (ADR-009) — what the (future) provider posts,
 * and what the stub posts in tests. The signature is verified over the RAW
 * body BEFORE this is parsed; the gateway's order id becomes the
 * idempotency key, so a replayed webhook returns the original receipt.
 * Allocation is SERVER-side: the gateway knows only a total; the service
 * applies it to the student's outstanding balances oldest-due first, and
 * REFUSES a total exceeding them (no surplus credit in v1 — the recorded
 * deferral).
 */
export const gatewayPaymentSchema = z.object({
  organizationId: z.uuid(),
  studentId: z.uuid(),
  gatewayOrderId: z.string().min(1).max(150),
  amount: money,
  paymentDate: isoDate,
});
export type GatewayPaymentInput = z.infer<typeof gatewayPaymentSchema>;
