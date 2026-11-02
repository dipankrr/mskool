import {
  feeConcessions,
  feeHeads,
  feeInstallments,
  feePayments,
  feeRefunds,
  feeStructureLines,
  feeStructures,
  financialTransactions,
  feeLinePeriods,
  lateFeeRules,
  openingBalances,
  paymentAllocations,
  studentFeeAssignments,
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
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "That date does not exist.");

/**
 * HARD RULE 4's input face: money arrives as a DECIMAL STRING — never a JS
 * number, never a float. `12`, `12.5` and `12.50` are accepted; `1e3`,
 * `12.999` and `NaN` are refused with a field-level message instead of a
 * Postgres one. The database's numeric(10,2) stays the final authority; this
 * only keeps float from ever touching the wire.
 */
const money = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, "Use a decimal amount like 1250.00.");

/** The payment modes, shared with the select-schema shape below. */
export const feePaymentModeSchema = z.enum([
  "cash",
  "upi",
  "cheque",
  "neft_rtgs",
  "card",
  "dd",
  "online_portal",
]);

/**
 * S1 (F4): the counter wire. Staff can record desk collections only —
 * `online_portal` is written exclusively by the webhook's system path via an
 * internal opts parameter, never from the wire contract.
 */
export const feeCounterPaymentModeSchema = z.enum([
  "cash",
  "upi",
  "cheque",
  "neft_rtgs",
  "card",
  "dd",
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
    billingStartedAt: true, // set by Start billing, never sent
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
    billingStartedAt: true, // set by Start billing, never sent
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

export const feeLineFrequencySchema = z.enum([
  "monthly",
  "quarterly",
  "half_yearly",
  "term_wise",
  "once",
]);
export type FeeLineFrequency = z.infer<typeof feeLineFrequencySchema>;

export const feeWhoPaysSchema = z.enum(["everyone", "new_students"]);

/**
 * One fee inside a structure: how often, how much per period, who pays, and
 * which periods it charges. Leave `periodKeys` out and a new line starts from
 * the months the school charges. Uniqueness (structure, head) is the database's
 * `fee_structure_lines_structure_head_uq` (ADR-022), not pre-checked here.
 */
export const createFeeStructureLineSchema = z.object({
  feeHeadId: z.uuid(),
  frequency: feeLineFrequencySchema,
  amount: money,
  whoPays: feeWhoPaysSchema.optional(),
  periodKeys: z.array(z.string().min(1).max(60)).optional(),
});
export type CreateFeeStructureLineInput = z.infer<typeof createFeeStructureLineSchema>;

/** The head is not patchable. A created due keeps its own amount. */
export const updateFeeStructureLineSchema = z.object({
  frequency: feeLineFrequencySchema.optional(),
  amount: money.optional(),
  whoPays: feeWhoPaysSchema.optional(),
  periodKeys: z.array(z.string().min(1).max(60)).optional(),
});
export type UpdateFeeStructureLineInput = z.infer<typeof updateFeeStructureLineSchema>;

export const feeLinePeriodSelectSchema = createSelectSchema(feeLinePeriods);
export type FeeLinePeriod = z.infer<typeof feeLinePeriodSelectSchema>;

/** A structure line with its schedule, one row per period it charges. */
export const feeStructureLineWithPeriodsSchema = feeStructureLineSelectSchema.extend({
  periods: z.array(feeLinePeriodSelectSchema),
});

/** Changes one schedule row. */
export const updateLinePeriodSchema = z
  .object({ amount: money.optional(), dueDate: isoDate.optional() })
  .refine((v) => v.amount !== undefined || v.dueDate !== undefined, {
    message: "Change the amount or the due date.",
  });
export type UpdateLinePeriodInput = z.infer<typeof updateLinePeriodSchema>;

export const periodOptionSchema = z.object({
  key: z.string(),
  label: z.string(),
  startDate: isoDate,
  endDate: isoDate,
  dueDate: isoDate,
  termId: z.uuid().nullable(),
});

/** One school's fee choices for one session. */
export const feeSessionSettingsSchema = z.object({
  chargedMonths: z.array(z.string().regex(/^\d{4}-\d{2}$/)),
  dueDay: z.number().int().min(1).max(31),
  receiptPrefix: z.string().min(1).max(20),
  nextReceiptNumber: z.number().int().min(1),
});
export const updateFeeSessionSettingsSchema = feeSessionSettingsSchema.partial().extend({
  receiptPrefix: z
    .string()
    .regex(/^[A-Za-z0-9]{1,20}$/, "Use letters and numbers only.")
    .optional(),
});
export type UpdateFeeSessionSettingsInput = z.infer<typeof updateFeeSessionSettingsSchema>;

// ---------------------------------------------------------------------------
// Late fee rules
// ---------------------------------------------------------------------------

export const lateFeeRuleSelectSchema = createSelectSchema(lateFeeRules);
export type LateFeeRule = z.infer<typeof lateFeeRuleSelectSchema>;

/**
 * A school-wide rule when `feeStructureId` is null, or one narrowed to a
 * structure. Precedence is `pickLateFeeRule`'s policy, not a constraint: the
 * rule in effect when the due fell due, the latest start winning and a
 * structure-named rule breaking a tie.
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
    coveredPeriods: true, // fixed by the service when created
    status: true,
    voidedAt: true,
    voidedBy: true,
    voidReason: true,
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

export const voidConcessionSchema = z.object({
  reason: z.string().min(1).max(500),
});

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
  // Needed only when a class has several structures and nothing decides it.
  feeStructureId: z.uuid().optional(),
  // Defaults to the enrollment's effective date in the service.
  feeEffectiveFrom: isoDate.optional(),
  joiningMonthFullCharge: z.boolean().optional(),
});
export type AssignFeeStructureInput = z.infer<typeof assignFeeStructureSchema>;

/**
 * "Bill all students in this class": for every enrollment of the class (and
 * section, when given) in the year that has NO fee assignment yet, assign the
 * class's active structure and generate its installments — one transaction
 * per student. Already-billed students are skipped, so a second run bills
 * nobody. Billing one student (`assignFeeStructureSchema`) stays for
 * mid-year admissions and special cases.
 */
export const billClassSchema = z.object({
  academicYearId: z.uuid(),
  classId: z.uuid(),
  sectionId: z.uuid().optional(),
});
export type BillClassInput = z.infer<typeof billClassSchema>;

const billClassStudentSchema = z.object({
  studentId: z.uuid(),
  enrollmentId: z.uuid(),
  studentName: z.string(),
  admissionNumber: z.string(),
});

/**
 * The outcome per student. `refusal` is set when the class refuses AS A WHOLE
 * (no active fee chart) — then all three lists are empty. Otherwise each
 * enrolled student lands in exactly one list; every refusal carries a
 * plain-English reason.
 */
/**
 * When a school's dues are created (ADR-051): the whole session at billing,
 * or month by month — automatically by the API's daily sweep, or when staff
 * generate them.
 */
export const feeGenerationModeSchema = z.enum(["monthly_auto", "monthly_manual"]);
export type FeeGenerationModeValue = z.infer<typeof feeGenerationModeSchema>;

/** "Generate dues up to {date}" for a session, optionally one class. */
/** A request-level ISO date, exported for routes that take one. */
export const feeIsoDateSchema = isoDate;

export const generateThroughSchema = z.object({
  academicYearId: z.uuid(),
  through: isoDate,
  classId: z.uuid().nullish(),
});
export type GenerateThroughInput = z.infer<typeof generateThroughSchema>;

export const generateThroughOutputSchema = z.object({
  through: isoDate,
  studentCount: z.number().int().nonnegative(),
  studentsWithNewDues: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  failed: z.array(z.object({ assignmentId: z.uuid(), reason: z.string() })),
});
export type GenerateThroughOutput = z.infer<typeof generateThroughOutputSchema>;

export const billClassOutputSchema = z.object({
  feeStructureId: z.uuid().nullable(),
  refusal: z.string().nullable(),
  billedCount: z.number().int(),
  skippedCount: z.number().int(),
  refusedCount: z.number().int(),
  billed: z.array(
    billClassStudentSchema.extend({
      assignmentId: z.uuid(),
      installmentsCreated: z.number().int(),
    }),
  ),
  skipped: z.array(billClassStudentSchema.extend({ assignmentId: z.uuid() })),
  refused: z.array(billClassStudentSchema.extend({ reason: z.string() })),
});
export type BillClassOutput = z.infer<typeof billClassOutputSchema>;

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
  // Left out when the dues predate the school's use of the app.
  originAcademicYearId: z.uuid().nullish(),
  amount: money,
  description: z.string().min(1).max(255).nullish(),
});
export type CreateOpeningBalanceInput = z.infer<typeof createOpeningBalanceSchema>;

export const voidOpeningBalanceSchema = z.object({
  reason: z.string().min(1).max(255),
});
export type VoidOpeningBalanceInput = z.infer<typeof voidOpeningBalanceSchema>;

/** A bill that is not part of any fee structure: a dress, a notebook, a fine. */
export const createOneOffChargeSchema = z.object({
  studentId: z.uuid(),
  academicYearId: z.uuid(),
  // Left out, it goes under the school's hidden one-off charges type.
  feeHeadId: z.uuid().nullish(),
  description: z.string().min(1).max(150),
  amount: money,
  dueDate: isoDate.optional(),
  // Paid on the spot: the charge and its receipt are made together, or neither.
  paid: z
    .object({
      paymentMode: feeCounterPaymentModeSchema,
      // Defaults to today.
      paymentDate: isoDate.optional(),
      transactionReference: z.string().min(1).max(150).nullish(),
      bankName: z.string().min(1).max(100).nullish(),
      chequeDate: isoDate.nullish(),
      clientReference: z.string().min(1).max(150).nullish(),
    })
    .refine(
      (v) => v.paymentMode !== "cheque" || Boolean(v.transactionReference && v.bankName),
      { message: "A cheque needs its number and bank.", path: ["transactionReference"] },
    )
    .optional(),
});
export type CreateOneOffChargeInput = z.infer<typeof createOneOffChargeSchema>;

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
 * One carried-forward balance (an `opening_balances` row of the payment's
 * year) this payment pays, and how much of it. The link is the append-only
 * `opening_balance_payment` ledger row written per portion — ADR-049.
 */
export const paymentOpeningBalanceAllocationInputSchema = z.object({
  openingBalanceId: z.uuid(),
  amount: money,
});
export type PaymentOpeningBalanceAllocationInput = z.infer<
  typeof paymentOpeningBalanceAllocationInputSchema
>;

/**
 * A counter collection. The payment's `amount` is DERIVED as the sum of its
 * allocations — the cashier cannot type a total that disagrees with what the
 * money is FOR. Allocations may target ANY generated installment with a
 * balance — future-due or not (paying November's fees in October is the
 * normal Indian-school case; the Locked decision is that the ONLY refusal is
 * exceeding a balance). `clientReference` is the idempotency key: a retry
 * with the same key returns the original receipt instead of writing a second.
 * `openingBalanceAllocations` pays carried-forward dues on the same receipt;
 * either list may be empty, but together they must allocate a positive total
 * (the service refuses otherwise).
 */
export const recordPaymentSchema = z.object({
  studentId: z.uuid(),
  academicYearId: z.uuid(),
  paymentDate: isoDate,
  paymentMode: feeCounterPaymentModeSchema,
  allocations: z.array(paymentAllocationInputSchema),
  openingBalanceAllocations: z.array(paymentOpeningBalanceAllocationInputSchema).optional(),
  // Taken off at the counter, per due, with a reason. Needs the concession permission.
  discounts: z.array(paymentAllocationInputSchema).optional(),
  discountReason: z.string().min(1).max(255).nullish(),
  // Forgive the late fee on this payment. Needs the concession permission.
  waiveLateFee: z.boolean().optional(),
  transactionReference: z.string().min(1).max(150).nullish(),
  bankName: z.string().min(1).max(100).nullish(),
  chequeDate: isoDate.nullish(),
  remarks: z.string().min(1).max(500).nullish(),
  clientReference: z.string().min(1).max(150).nullish(),
}).refine(
  (v) => v.paymentMode !== "cheque" || Boolean(v.transactionReference && v.bankName),
  { message: "A cheque needs its number and bank.", path: ["transactionReference"] },
);
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/** What a payment would cost before it is recorded. */
export const quotePaymentSchema = z.object({
  studentId: z.uuid(),
  academicYearId: z.uuid(),
  paymentDate: isoDate,
  allocations: z.array(paymentAllocationInputSchema),
});
export type QuotePaymentInput = z.infer<typeof quotePaymentSchema>;

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

// ---------------------------------------------------------------------------
// Row shapes the routers return (drizzle-zod derived like everything here)
// ---------------------------------------------------------------------------

export const feeInstallmentSelectSchema = createSelectSchema(feeInstallments);
export type FeeInstallment = z.infer<typeof feeInstallmentSelectSchema>;

export const feePaymentSelectSchema = createSelectSchema(feePayments);
export type FeePayment = z.infer<typeof feePaymentSelectSchema>;

export const paymentAllocationSelectSchema = createSelectSchema(paymentAllocations);
export type PaymentAllocation = z.infer<typeof paymentAllocationSelectSchema>;

export const feeRefundSelectSchema = createSelectSchema(feeRefunds);
export type FeeRefund = z.infer<typeof feeRefundSelectSchema>;

export const financialTransactionSelectSchema = createSelectSchema(
  financialTransactions,
);
export type FinancialTransaction = z.infer<typeof financialTransactionSelectSchema>;

export const studentFeeAssignmentSelectSchema = createSelectSchema(
  studentFeeAssignments,
);
export type StudentFeeAssignment = z.infer<typeof studentFeeAssignmentSelectSchema>;

export const openingBalanceSelectSchema = createSelectSchema(openingBalances);
export type OpeningBalance = z.infer<typeof openingBalanceSelectSchema>;

/** Who a payment or ledger row is about — joined so lists need no lookup. */
const studentLabelShape = {
  studentName: z.string(),
  admissionNumber: z.string(),
  // The student's enrollment in the row's academic year, when there is one.
  className: z.string().nullable(),
  sectionName: z.string().nullable(),
};

/** `payment.list` row: the payment plus its student label. */
export const feePaymentListRowSchema = feePaymentSelectSchema.extend(studentLabelShape);
export type FeePaymentListRow = z.infer<typeof feePaymentListRowSchema>;

/**
 * What a ledger row does to the school's cash (ADR-049). `in` and `out` are
 * money that arrived or left; `none` is a receivable or memo movement
 * (`opening_balance`, `concession_applied`, `waiver_applied`) that changes
 * what is owed, not what was collected. Money in/out totals sum `in`/`out`.
 */
export const ledgerCashEffectSchema = z.enum(["in", "out", "none"]);
export type LedgerCashEffect = z.infer<typeof ledgerCashEffectSchema>;

/** `ledger.list` row. The student label is null on a non-student row. */
export const financialTransactionListRowSchema = financialTransactionSelectSchema.extend({
  cashEffect: ledgerCashEffectSchema,
  studentName: z.string().nullable(),
  admissionNumber: z.string().nullable(),
  className: z.string().nullable(),
  sectionName: z.string().nullable(),
});
export type FinancialTransactionListRow = z.infer<typeof financialTransactionListRowSchema>;

/** One installment line of a receipt, labelled by the server. */
export const paymentDetailAllocationSchema = z.object({
  installmentId: z.uuid(),
  amountAllocated: z.string(),
  feeHeadId: z.uuid(),
  feeHeadName: z.string(),
  description: z.string().nullable(),
  periodKey: z.string(),
  dueDate: z.string(),
  lateFeeAmount: z.string(),
  discountAmount: z.string(),
});
export type PaymentDetailAllocation = z.infer<typeof paymentDetailAllocationSchema>;

/** One carried-forward line of a receipt. */
export const paymentDetailOpeningBalanceAllocationSchema = z.object({
  openingBalanceId: z.uuid(),
  amountAllocated: z.string(),
  description: z.string().nullable(),
  originAcademicYearId: z.uuid().nullable(),
  originAcademicYearName: z.string().nullable(),
});
export type PaymentDetailOpeningBalanceAllocation = z.infer<
  typeof paymentDetailOpeningBalanceAllocationSchema
>;

/** `payment.detail`: the receipt's backing shape. */
export const paymentDetailOutputSchema = z.object({
  payment: feePaymentSelectSchema,
  allocations: z.array(paymentDetailAllocationSchema),
  openingBalanceAllocations: z.array(paymentDetailOpeningBalanceAllocationSchema),
});
export type PaymentDetailOutput = z.infer<typeof paymentDetailOutputSchema>;

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

export const feeMatrixSortSchema = z.enum(["student", "balance", "oldestDue"]);
export type FeeMatrixSort = z.infer<typeof feeMatrixSortSchema>;

export const feeMatrixViewSchema = z.enum([
  "all",
  "attention",
  "unpaid",
  "partial",
  "overdue",
  "paid",
  "notGenerated",
]);
export type FeeMatrixView = z.infer<typeof feeMatrixViewSchema>;

export const feeMatrixInputSchema = z.object({
  academicYearId: z.uuid(),
  classId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
  search: z.string().trim().max(150).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: feeMatrixSortSchema.default("student"),
  view: feeMatrixViewSchema.default("all"),
});
export type FeeMatrixInput = z.infer<typeof feeMatrixInputSchema>;

export const feeMatrixCellInputSchema = z.object({
  academicYearId: z.uuid(),
  studentId: z.uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
export type FeeMatrixCellInput = z.infer<typeof feeMatrixCellInputSchema>;

export const feeMatrixPaymentStateSchema = z.enum([
  "no_fee",
  "unpaid",
  "partial",
  "paid",
  "conceded",
]);
export type FeeMatrixPaymentState = z.infer<typeof feeMatrixPaymentStateSchema>;

export const feeMatrixTimingStateSchema = z.enum(["none", "upcoming", "due", "overdue"]);
export type FeeMatrixTimingState = z.infer<typeof feeMatrixTimingStateSchema>;

export const feeMatrixAssignmentStateSchema = z.enum([
  "unassigned",
  "active",
  "suspended",
  "cancelled",
]);
export type FeeMatrixAssignmentState = z.infer<typeof feeMatrixAssignmentStateSchema>;

export const feeMatrixGenerationStateSchema = z.enum([
  "not_assigned",
  "not_generated",
  "generated",
]);
export type FeeMatrixGenerationState = z.infer<typeof feeMatrixGenerationStateSchema>;

export const feeMatrixOpeningBalanceStatusSchema = z.enum([
  "none",
  "unpaid",
  "partial",
  "paid",
  "waived",
]);
export type FeeMatrixOpeningBalanceStatus = z.infer<typeof feeMatrixOpeningBalanceStatusSchema>;

export const feeMatrixAmountsSchema = z.object({
  assessedAmount: money,
  concessionAmount: money,
  netAmount: money,
  paidAmount: money,
  balanceAmount: money,
  feeHeadCount: z.number().int().nonnegative(),
  oldestDueDate: isoDate.nullable(),
  paymentState: feeMatrixPaymentStateSchema,
  timingState: feeMatrixTimingStateSchema,
});
export type FeeMatrixAmounts = z.infer<typeof feeMatrixAmountsSchema>;

/**
 * A student's (or the cohort's) year totals. `paidAmount` is installment
 * principal only; `lateFeePaidAmount` is the late fee frozen on the year's
 * payments that still stand (pending or cleared — the same payments whose
 * principal `paidAmount` counts), so "collected incl. late fees" is their sum.
 * Bounced, reversed and cancelled payments are excluded: their late fee is
 * offset in the ledger (ADR-049).
 */
export const feeMatrixTotalsSchema = feeMatrixAmountsSchema.extend({
  // Unpaid up to the end of this month. balanceAmount also holds later months.
  dueNowAmount: money,
  lateFeePaidAmount: money,
});
export type FeeMatrixTotals = z.infer<typeof feeMatrixTotalsSchema>;

export const feeMatrixMonthSchema = z.object({
  key: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  label: z.string(),
  startDate: isoDate,
  endDate: isoDate,
});
export type FeeMatrixMonth = z.infer<typeof feeMatrixMonthSchema>;

export const feeMatrixCellSchema = feeMatrixAmountsSchema.extend({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
export type FeeMatrixCell = z.infer<typeof feeMatrixCellSchema>;

export const feeMatrixCellInstallmentSchema = z.object({
  id: z.uuid(),
  description: z.string().nullable(),
  feeHeadId: z.uuid(),
  feeHeadName: z.string(),
  dueDate: isoDate,
  amount: money,
  concessionAmount: money,
  netAmount: money,
  paidAmount: money,
  balanceAmount: money,
  paymentStatus: z.enum(["unpaid", "partial", "paid", "waived"]),
});
export type FeeMatrixCellInstallment = z.infer<typeof feeMatrixCellInstallmentSchema>;

export const feeMatrixCellOutputSchema = feeMatrixCellSchema.extend({
  studentId: z.uuid(),
  installments: z.array(feeMatrixCellInstallmentSchema),
});
export type FeeMatrixCellOutput = z.infer<typeof feeMatrixCellOutputSchema>;

export const feeMatrixOpeningBalanceSchema = z.object({
  amount: money,
  paid: money,
  balance: money,
  status: feeMatrixOpeningBalanceStatusSchema,
  originCount: z.number().int().nonnegative(),
});
export type FeeMatrixOpeningBalance = z.infer<typeof feeMatrixOpeningBalanceSchema>;

export const feeMatrixRowSchema = z.object({
  /** Lets a list mark a student who left but still owes money. */
  enrollmentStatus: z.string(),
  studentId: z.uuid(),
  admissionNumber: z.string(),
  studentName: z.string(),
  classId: z.uuid(),
  className: z.string(),
  sectionId: z.uuid().nullable(),
  sectionName: z.string().nullable(),
  rollNumber: z.string().nullable(),
  assignmentId: z.uuid().nullable(),
  assignmentState: feeMatrixAssignmentStateSchema,
  generationState: feeMatrixGenerationStateSchema,
  generatedInstallmentCount: z.number().int().nonnegative(),
  cells: z.array(feeMatrixCellSchema),
  totals: feeMatrixTotalsSchema,
  openingBalance: feeMatrixOpeningBalanceSchema,
  paymentState: feeMatrixPaymentStateSchema,
  timingState: feeMatrixTimingStateSchema,
  oldestDueDate: isoDate.nullable(),
});
export type FeeMatrixRow = z.infer<typeof feeMatrixRowSchema>;

export const feeMatrixMonthSummarySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  studentCount: z.number().int().nonnegative(),
  outstandingStudentCount: z.number().int().nonnegative(),
  assessedAmount: money,
  concessionAmount: money,
  netAmount: money,
  paidAmount: money,
  balanceAmount: money,
  feeHeadCount: z.number().int().nonnegative(),
  oldestDueDate: isoDate.nullable(),
});
export type FeeMatrixMonthSummary = z.infer<typeof feeMatrixMonthSummarySchema>;

export const feeMatrixCohortTotalsSchema = feeMatrixTotalsSchema.extend({
  studentCount: z.number().int().nonnegative(),
  assignedCount: z.number().int().nonnegative(),
  notGeneratedCount: z.number().int().nonnegative(),
  outstandingStudentCount: z.number().int().nonnegative(),
  openingBalance: feeMatrixOpeningBalanceSchema,
});
export type FeeMatrixCohortTotals = z.infer<typeof feeMatrixCohortTotalsSchema>;

export const feeMatrixPageInfoSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasPreviousPage: z.boolean(),
  hasNextPage: z.boolean(),
});
export type FeeMatrixPageInfo = z.infer<typeof feeMatrixPageInfoSchema>;

export const feeMatrixOutputSchema = z.object({
  academicYear: z.object({
    id: z.uuid(),
    name: z.string(),
    startDate: isoDate,
    endDate: isoDate,
  }),
  months: z.array(feeMatrixMonthSchema),
  rows: z.array(feeMatrixRowSchema),
  cohortTotals: feeMatrixCohortTotalsSchema,
  monthSummaries: z.array(feeMatrixMonthSummarySchema),
  pageInfo: feeMatrixPageInfoSchema,
});
export type FeeMatrixOutput = z.infer<typeof feeMatrixOutputSchema>;

// ---------------------------------------------------------------------------
// The Fees dashboard and the student fee page
// ---------------------------------------------------------------------------

export const feeDashboardInputSchema = z.object({
  organizationId: z.uuid(),
  academicYearId: z.uuid(),
});
export type FeeDashboardInput = z.infer<typeof feeDashboardInputSchema>;

/**
 * Every figure the top of the dashboard shows, with one definition each:
 *
 * - `dueThisMonth`: still unpaid on dues that fall in this calendar month.
 * - `allTimeDue`: everything still unpaid up to now, with previous dues.
 * - `collectedThisMonth`: cash received this month by payment date, whichever
 *   month it paid for, net of refunds. Pending cheques are apart, in `pending`.
 */
export const feeDashboardOutputSchema = z.object({
  month: z.string(),
  monthLabel: z.string(),
  dueThisMonth: z.string(),
  billedThisMonth: z.string(),
  paidOnThisMonth: z.string(),
  collectedThisMonth: z.string(),
  collectedToday: z.string(),
  receiptsToday: z.number().int(),
  allTimeDue: z.string(),
  laterThisSession: z.string(),
  studentsWithDue: z.number().int(),
  studentsBilled: z.number().int(),
  studentsNotBilled: z.number().int(),
  // Only while automatic is paused: how many dues are waiting to be added.
  paused: z.object({ missingDues: z.number().int() }).nullable(),
  pending: z.object({ count: z.number().int(), amount: z.string() }),
  trend: z.array(z.object({ month: z.string(), label: z.string(), balance: z.string() })),
  setup: z.object({
    hasFeeTypes: z.boolean(),
    structures: z.number().int(),
    structuresNotStarted: z.number().int(),
  }),
});
export type FeeDashboardOutput = z.infer<typeof feeDashboardOutputSchema>;

/** What the Fee setup screen shows, in one read. */
export const feeSetupStatusSchema = z.object({
  classes: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      hasStructure: z.boolean(),
      billedStudents: z.number().int(),
    }),
  ),
  structures: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      className: z.string(),
      started: z.boolean(),
      lineCount: z.number().int(),
      waitingStudents: z.number().int(),
    }),
  ),
  previousDuesStudents: z.number().int(),
});
export type FeeSetupStatus = z.infer<typeof feeSetupStatusSchema>;

/** A background "create these dues now". `rest` is the whole remaining session. */
export const startFeeDuesRunSchema = z.object({
  academicYearId: z.uuid(),
  upTo: z.enum(["this_month", "rest"]),
  classId: z.uuid().nullish(),
});
export type StartFeeDuesRunInput = z.infer<typeof startFeeDuesRunSchema>;

export const feeDuesRunSchema = z.object({
  id: z.uuid(),
  status: z.enum(["running", "done", "failed"]),
  through: isoDate,
  studentCount: z.number().int(),
  studentsWithNewDues: z.number().int(),
  insertedCount: z.number().int(),
  failedCount: z.number().int(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
});
export type FeeDuesRun = z.infer<typeof feeDuesRunSchema>;

export const feeDashboardListInputSchema = feeDashboardInputSchema.extend({
  search: z.string().trim().max(100).optional(),
  classId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
  show: z.enum(["owes", "paid", "not_billed", "all"]).default("owes"),
  sort: z.enum(["oldest", "highest", "name"]).default("oldest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type FeeDashboardListInput = z.infer<typeof feeDashboardListInputSchema>;

export const feeDashboardRowSchema = z.object({
  studentId: z.uuid(),
  studentName: z.string(),
  admissionNumber: z.string(),
  className: z.string(),
  sectionName: z.string().nullable(),
  rollNumber: z.string().nullable(),
  enrollmentStatus: z.string(),
  billed: z.boolean(),
  dueNow: z.string(),
  thisMonth: z.string(),
  overdue: z.string(),
  previousDues: z.string(),
  later: z.string(),
  overdueMonths: z.number().int(),
  oldestDueDate: z.string().nullable(),
  lastPaymentDate: z.string().nullable(),
  lastPaymentAmount: z.string().nullable(),
});
export type FeeDashboardRow = z.infer<typeof feeDashboardRowSchema>;

export const feeDashboardListOutputSchema = z.object({
  rows: z.array(feeDashboardRowSchema),
  total: z.number().int(),
  totalDue: z.string(),
  page: z.number().int(),
  totalPages: z.number().int(),
});
export type FeeDashboardListOutput = z.infer<typeof feeDashboardListOutputSchema>;

export const feeStudentSummaryInputSchema = feeDashboardInputSchema.extend({
  studentId: z.uuid(),
});
export type FeeStudentSummaryInput = z.infer<typeof feeStudentSummaryInputSchema>;

/** Everything the student fee page shows, in one call. */
export const feeStudentSummarySchema = z.object({
  student: z.object({
    id: z.uuid(),
    name: z.string(),
    admissionNumber: z.string(),
    className: z.string().nullable(),
    sectionName: z.string().nullable(),
    rollNumber: z.string().nullable(),
    enrollmentId: z.uuid().nullable(),
    enrollmentStatus: z.string().nullable(),
  }),
  feeRecord: z
    .object({
      id: z.uuid(),
      status: z.string(),
      structureId: z.uuid(),
      structureName: z.string(),
      effectiveFrom: z.string(),
      isNewStudent: z.boolean(),
    })
    .nullable(),
  structureChoices: z.array(z.object({ id: z.uuid(), name: z.string() })),
  totals: z.object({
    dueNow: z.string(),
    thisMonth: z.string(),
    overdue: z.string(),
    previousDues: z.string(),
    later: z.string(),
    paid: z.string(),
    concession: z.string(),
    discount: z.string(),
  }),
  months: z.array(
    z.object({
      month: z.string(),
      label: z.string(),
      net: z.string(),
      paid: z.string(),
      balance: z.string(),
      state: z.enum(["overdue", "due", "upcoming", "paid", "none"]),
    }),
  ),
  dues: z.array(feeInstallmentSelectSchema),
  previousDues: z.array(openingBalanceSelectSchema),
  concessions: z.array(
    z.object({
      id: z.uuid(),
      concessionType: z.string(),
      calculationType: z.string(),
      value: z.string(),
      concessionAmount: z.string(),
      reason: z.string().nullable(),
    }),
  ),
  recentPayments: z.array(feePaymentSelectSchema.extend({ refundedAmount: z.string() })),
});
export type FeeStudentSummary = z.infer<typeof feeStudentSummarySchema>;

// ---------------------------------------------------------------------------
// Printed documents
// ---------------------------------------------------------------------------

export const FEE_DOCUMENT_KINDS = [
  "receipt",
  "statement",
  "dueNotice",
  "defaulters",
  "dayBook",
  "chequeList",
  "noDues",
  "structureSheet",
] as const;
export type FeeDocumentKind = (typeof FEE_DOCUMENT_KINDS)[number];

export const feeReceiptLayoutSchema = z.enum([
  "a4_full",
  "a4_half_two",
  "a4_half_top",
  "a4_half_bottom",
  "thermal_58",
  "thermal_80",
]);
export type FeeReceiptLayout = z.infer<typeof feeReceiptLayoutSchema>;

/** Finished HTML, plus the page size the phone needs to turn it into a PDF. */
export const feeDocumentSchema = z.object({
  html: z.string(),
  fileName: z.string(),
  width: z.number(),
  height: z.number(),
});
export type FeeDocument = z.infer<typeof feeDocumentSchema>;

export const feeDocumentNoticesSchema = z.object({
  academicYearId: z.uuid(),
  classId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
  perPage: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(2),
});
export type FeeDocumentNoticesInput = z.infer<typeof feeDocumentNoticesSchema>;

export const feeDocumentDefaultersSchema = z.object({
  academicYearId: z.uuid(),
  classId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
});
export type FeeDocumentDefaultersInput = z.infer<typeof feeDocumentDefaultersSchema>;

export const feeDocumentDayBookSchema = z.object({
  academicYearId: z.uuid(),
  date: isoDate,
});
export type FeeDocumentDayBookInput = z.infer<typeof feeDocumentDayBookSchema>;

const printLines = z
  .string()
  .max(300)
  .refine((value) => value.split("\n").length <= 3, "Keep this to three lines.")
  .refine(
    (value) => value.split("\n").every((line) => line.length <= 80),
    "Keep each line to 80 characters.",
  );

export const feePrintUpiModeSchema = z.enum(["off", "upi_id", "image"]);

export const feePrintSettingsSchema = z.object({
  headerText: z.string(),
  subText: z.string(),
  footerText: z.string(),
  signatureLabel: z.string(),
  titles: z.record(z.string(), z.string()),
  showAmountInWords: z.boolean(),
  receiptLayout: feeReceiptLayoutSchema,
  upiMode: feePrintUpiModeSchema,
  upiId: z.string().nullable(),
  upiPayeeName: z.string().nullable(),
  logoObjectId: z.uuid().nullable(),
  upiImageObjectId: z.uuid().nullable(),
});
export type FeePrintSettings = z.infer<typeof feePrintSettingsSchema>;

export const updateFeePrintSettingsSchema = z
  .object({
    headerText: printLines,
    subText: printLines,
    footerText: printLines,
    signatureLabel: z.string().trim().max(60),
    titles: z.partialRecord(z.enum(FEE_DOCUMENT_KINDS), z.string().trim().max(60)),
    showAmountInWords: z.boolean(),
    receiptLayout: feeReceiptLayoutSchema,
    upiMode: feePrintUpiModeSchema,
    upiId: z
      .string()
      .trim()
      .regex(/^[\w.\-+]+@[\w.\-]+$/, "Enter a UPI ID like school@bank.")
      .nullish(),
    upiPayeeName: z.string().trim().max(100).nullish(),
    logoObjectId: z.uuid().nullish(),
    upiImageObjectId: z.uuid().nullish(),
  })
  .partial();
export type UpdateFeePrintSettingsInput = z.infer<typeof updateFeePrintSettingsSchema>;

export const uploadFeePrintImageSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataBase64: z
    .string()
    .max(Math.ceil((512 * 1024) / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "The image data is not valid base64."),
});
export type UploadFeePrintImageInput = z.infer<typeof uploadFeePrintImageSchema>;
