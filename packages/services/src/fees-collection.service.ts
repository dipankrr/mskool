import { atSchoolLevel, requireSchoolId, yearVisibilityWhere } from "./academic.service";
import {
  allocateOldestFirst,
  computeLateFee,
  daysInMonth,
  fromCents,
  isoOf,
  monthsBetween,
  toCents,
} from "./fees-maths";
import { feesService } from "./fees.service";
import { escapeLike, scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  FeeMatrixCellInput,
  FeeMatrixCellOutput,
  FeeMatrixInput,
  FeeMatrixOutput,
  FeePaymentListRow,
  FinancialTransactionListRow,
  GatewayPaymentInput,
  LedgerCashEffect,
  PaymentDetailOutput,
  PaymentTransitionInput,
  RecordPaymentInput,
  RecordRefundInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  feeHeads,
  feeInstallments,
  feePayments,
  feeRefunds,
  financialTransactions,
  openingBalances,
  paymentAllocations,
  receiptNumberSequences,
  sections,
  studentEnrollments,
  studentFeeAssignments,
  students,
} from "@repo/db/schema";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";

/**
 * FEES — collection and the ledger. Phase 4, chunk F5.
 *
 * HARD RULE 3 is this file's spine: `financial_transactions` is append-only
 * (the migration 0011 trigger ENFORCES it) — every money movement INSERTs,
 * nothing ever updates or deletes, corrections are new offsetting rows.
 *
 * The money-safety discipline (plan, layer 2) lives in `recordPayment`:
 * ONE transaction, which
 *   1. answers the idempotency question first (a `clientReference` the
 *      school has already served returns the ORIGINAL payment — a
 *      double-click is one receipt, not two),
 *   2. row-locks the receipt sequence (`SELECT … FOR UPDATE`) so two
 *      concurrent cashiers serialize on the number,
 *   3. row-locks the target installments in DETERMINISTIC ID ORDER
 *      (deadlock prevention) and re-checks each balance INSIDE the
 *      transaction — neither cashier reads a stale balance,
 *   4. writes allocations, installment updates, and the ledger rows
 *      together, or none of it.
 *
 * Payment status is a LIFECYCLE moved only by the named operations below —
 * `clearPayment`, `bouncePayment`, `reversePayment`, `cancelPayment` — each
 * validating the current state and recording `status_updated_*`. There is no
 * free-form status PATCH anywhere. A bounce and a reversal RE-OPEN the
 * installment balances the payment reduced (allocations stay — they are
 * history) and write their own ledger rows; `cancelPayment` re-opens too and
 * writes `payment_cancelled` debits — no money moved, but the pending payment
 * was credited at entry, so the credit is offset (ADR-049).
 *
 * `recordGatewayPayment` is the ADR-009 `system` path: the webhook's signed
 * fact, not a session, is the authorization; the gateway's order id is the
 * idempotency key; allocation is server-side, oldest-due first; surplus is
 * REFUSED (the recorded deferral), not silently banked.
 */

const PAYMENT_SCOPE: ScopeColumns = {
  organizationId: feePayments.organizationId,
  schoolId: feePayments.schoolId,
};
const INSTALLMENT_SCOPE: ScopeColumns = {
  organizationId: feeInstallments.organizationId,
  schoolId: feeInstallments.schoolId,
};
const LEDGER_SCOPE: ScopeColumns = {
  organizationId: financialTransactions.organizationId,
  schoolId: financialTransactions.schoolId,
};
const MATRIX_ENROLLMENT_SCOPE: ScopeColumns = {
  organizationId: studentEnrollments.organizationId,
  schoolId: studentEnrollments.schoolId,
  classId: studentEnrollments.classId,
  sectionId: studentEnrollments.sectionId,
};
const MATRIX_STUDENT_SCOPE: ScopeColumns = {
  organizationId: students.organizationId,
  schoolId: students.schoolId,
};
const MATRIX_YEAR_SCOPE: ScopeColumns = {
  organizationId: academicYears.organizationId,
  schoolId: academicYears.schoolId,
};
const MATRIX_OPENING_BALANCE_SCOPE: ScopeColumns = {
  organizationId: openingBalances.organizationId,
  schoolId: openingBalances.schoolId,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * ADR-049: the ledger types that move what is OWED, not cash. They keep their
 * written direction (rows are immutable) but never count as Money in/out.
 */
const NON_CASH_TRANSACTION_TYPES = new Set([
  "opening_balance",
  "concession_applied",
  "waiver_applied",
]);

function ledgerCashEffect(row: {
  transactionType: string;
  direction: "credit" | "debit";
}): LedgerCashEffect {
  if (NON_CASH_TRANSACTION_TYPES.has(row.transactionType)) return "none";
  return row.direction === "credit" ? "in" : "out";
}

type HeldLine = {
  kind: "installment" | "opening_balance";
  id: string;
  heldCents: bigint;
};

/**
 * Greedy walk: takes `cents` off the lines in order, mutating each line's
 * `heldCents`, and returns what was taken from each.
 */
function takeFromLines(lines: HeldLine[], cents: bigint) {
  let remaining = cents;
  const takes: { line: HeldLine; cents: bigint }[] = [];
  for (const line of lines) {
    if (remaining <= 0n) break;
    const take = line.heldCents < remaining ? line.heldCents : remaining;
    if (take === 0n) continue;
    line.heldCents -= take;
    remaining -= take;
    takes.push({ line, cents: take });
  }
  return takes;
}

function fullName(parts: {
  firstName: string;
  middleName: string | null;
  lastName: string | null;
}) {
  return [parts.firstName, parts.middleName, parts.lastName]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

/** The modes that confirm money at the desk; everything else enters `pending`. */
const IMMEDIATE_MODES = new Set(["cash"]);
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

type MatrixInstallment = {
  studentId: string;
  feeHeadId: string;
  amount: string;
  concessionAmount: string;
  netAmount: string;
  paidAmount: string;
  dueDate: string;
  paymentStatus: "unpaid" | "partial" | "paid" | "waived" | "cancelled";
};

type MatrixAccumulator = {
  assessedCents: bigint;
  concessionCents: bigint;
  netCents: bigint;
  paidCents: bigint;
  balanceCents: bigint;
  feeHeadIds: Set<string>;
  activeInstallmentCount: number;
  waivedInstallmentCount: number;
  outstandingDueDates: string[];
  oldestDueDate: string | null;
};

type MatrixOpeningBalanceRow = {
  amount: string;
  paidAmount: string;
  status: "unpaid" | "partial" | "paid" | "waived";
  originAcademicYearId: string;
};

type MatrixOpeningBalanceAccumulator = {
  amountCents: bigint;
  paidCents: bigint;
  balanceCents: bigint;
  originAcademicYearIds: Set<string>;
  rowCount: number;
  waivedCount: number;
};

function emptyMatrixAccumulator(): MatrixAccumulator {
  return {
    assessedCents: 0n,
    concessionCents: 0n,
    netCents: 0n,
    paidCents: 0n,
    balanceCents: 0n,
    feeHeadIds: new Set<string>(),
    activeInstallmentCount: 0,
    waivedInstallmentCount: 0,
    outstandingDueDates: [],
    oldestDueDate: null,
  };
}

function matrixInstallmentBalance(
  installment: Pick<MatrixInstallment, "netAmount" | "paidAmount" | "paymentStatus">,
) {
  const netCents = toCents(installment.netAmount);
  const paidCents = toCents(installment.paidAmount);
  return installment.paymentStatus === "waived" || netCents <= paidCents ? 0n : netCents - paidCents;
}

function addMatrixInstallment(accumulator: MatrixAccumulator, installment: MatrixInstallment) {
  if (installment.paymentStatus === "cancelled") return;

  const netCents = toCents(installment.netAmount);
  const paidCents = toCents(installment.paidAmount);
  const balanceCents = matrixInstallmentBalance(installment);

  accumulator.assessedCents += toCents(installment.amount);
  accumulator.concessionCents += toCents(installment.concessionAmount);
  accumulator.netCents += netCents;
  accumulator.paidCents += paidCents;
  accumulator.balanceCents += balanceCents;
  accumulator.feeHeadIds.add(installment.feeHeadId);
  accumulator.activeInstallmentCount += 1;
  if (installment.paymentStatus === "waived") {
    accumulator.waivedInstallmentCount += 1;
  }
  if (balanceCents > 0n) {
    accumulator.outstandingDueDates.push(installment.dueDate);
    if (accumulator.oldestDueDate === null || installment.dueDate < accumulator.oldestDueDate) {
      accumulator.oldestDueDate = installment.dueDate;
    }
  }
}

function mergeMatrixAccumulator(target: MatrixAccumulator, source: MatrixAccumulator) {
  target.assessedCents += source.assessedCents;
  target.concessionCents += source.concessionCents;
  target.netCents += source.netCents;
  target.paidCents += source.paidCents;
  target.balanceCents += source.balanceCents;
  for (const feeHeadId of source.feeHeadIds) target.feeHeadIds.add(feeHeadId);
  target.activeInstallmentCount += source.activeInstallmentCount;
  target.waivedInstallmentCount += source.waivedInstallmentCount;
  target.outstandingDueDates.push(...source.outstandingDueDates);
  if (
    source.oldestDueDate !== null &&
    (target.oldestDueDate === null || source.oldestDueDate < target.oldestDueDate)
  ) {
    target.oldestDueDate = source.oldestDueDate;
  }
}

function matrixStates(accumulator: MatrixAccumulator, asOf: string) {
  let paymentState: "no_fee" | "unpaid" | "partial" | "paid" | "conceded";
  if (accumulator.activeInstallmentCount === 0 || accumulator.assessedCents === 0n) {
    paymentState = "no_fee";
  } else if (accumulator.netCents === 0n) {
    paymentState = "conceded";
  } else if (accumulator.balanceCents > 0n) {
    paymentState = accumulator.paidCents > 0n ? "partial" : "unpaid";
  } else if (accumulator.waivedInstallmentCount === accumulator.activeInstallmentCount) {
    paymentState = "conceded";
  } else {
    paymentState = "paid";
  }

  let timingState: "none" | "upcoming" | "due" | "overdue" = "none";
  if (accumulator.outstandingDueDates.length > 0) {
    if (accumulator.outstandingDueDates.some((dueDate) => dueDate < asOf)) {
      timingState = "overdue";
    } else if (accumulator.outstandingDueDates.some((dueDate) => dueDate === asOf)) {
      timingState = "due";
    } else {
      timingState = "upcoming";
    }
  }

  return {
    paymentState,
    timingState,
    oldestDueDate: accumulator.oldestDueDate,
  };
}

function matrixAmounts(accumulator: MatrixAccumulator, asOf: string) {
  return {
    assessedAmount: fromCents(accumulator.assessedCents),
    concessionAmount: fromCents(accumulator.concessionCents),
    netAmount: fromCents(accumulator.netCents),
    paidAmount: fromCents(accumulator.paidCents),
    balanceAmount: fromCents(accumulator.balanceCents),
    feeHeadCount: accumulator.feeHeadIds.size,
    ...matrixStates(accumulator, asOf),
  };
}

function emptyOpeningBalanceAccumulator(): MatrixOpeningBalanceAccumulator {
  return {
    amountCents: 0n,
    paidCents: 0n,
    balanceCents: 0n,
    originAcademicYearIds: new Set<string>(),
    rowCount: 0,
    waivedCount: 0,
  };
}

function addOpeningBalance(
  accumulator: MatrixOpeningBalanceAccumulator,
  row: MatrixOpeningBalanceRow,
) {
  const amountCents = toCents(row.amount);
  const paidCents = toCents(row.paidAmount);
  const balanceCents =
    row.status === "waived" || amountCents <= paidCents ? 0n : amountCents - paidCents;

  accumulator.amountCents += amountCents;
  accumulator.paidCents += paidCents;
  accumulator.balanceCents += balanceCents;
  accumulator.originAcademicYearIds.add(row.originAcademicYearId);
  accumulator.rowCount += 1;
  if (row.status === "waived") accumulator.waivedCount += 1;
}

function mergeOpeningBalance(
  target: MatrixOpeningBalanceAccumulator,
  source: MatrixOpeningBalanceAccumulator,
) {
  target.amountCents += source.amountCents;
  target.paidCents += source.paidCents;
  target.balanceCents += source.balanceCents;
  for (const originId of source.originAcademicYearIds) {
    target.originAcademicYearIds.add(originId);
  }
  target.rowCount += source.rowCount;
  target.waivedCount += source.waivedCount;
}

function openingBalanceSummary(accumulator: MatrixOpeningBalanceAccumulator) {
  let status: "none" | "unpaid" | "partial" | "paid" | "waived" = "none";
  if (accumulator.rowCount > 0) {
    if (accumulator.waivedCount === accumulator.rowCount) {
      status = "waived";
    } else if (accumulator.balanceCents === 0n) {
      status = "paid";
    } else if (accumulator.paidCents > 0n) {
      status = "partial";
    } else {
      status = "unpaid";
    }
  }

  return {
    amount: fromCents(accumulator.amountCents),
    paid: fromCents(accumulator.paidCents),
    balance: fromCents(accumulator.balanceCents),
    status,
    originCount: accumulator.originAcademicYearIds.size,
  };
}

function matrixRowBalance(row: FeeMatrixOutput["rows"][number]) {
  return toCents(row.totals.balanceAmount) + toCents(row.openingBalance.balance);
}

function matrixRowMatchesView(row: FeeMatrixOutput["rows"][number], view: FeeMatrixInput["view"]) {
  switch (view) {
    case "all":
      return true;
    case "attention":
      return (
        row.generationState !== "generated" ||
        toCents(row.openingBalance.balance) > 0n ||
        (toCents(row.totals.balanceAmount) > 0n && row.timingState !== "upcoming")
      );
    case "unpaid":
      return row.paymentState === "unpaid";
    case "partial":
      return row.paymentState === "partial";
    case "overdue":
      return row.timingState === "overdue";
    case "paid":
      return ["paid", "conceded"].includes(row.paymentState);
    case "notGenerated":
      return row.generationState !== "generated";
  }
}

function matrixRowSort(
  left: FeeMatrixOutput["rows"][number],
  right: FeeMatrixOutput["rows"][number],
  sort: FeeMatrixInput["sort"],
) {
  if (sort === "balance") {
    const leftBalance = matrixRowBalance(left);
    const rightBalance = matrixRowBalance(right);
    if (leftBalance !== rightBalance) return leftBalance > rightBalance ? -1 : 1;
  }
  if (sort === "oldestDue") {
    if (left.oldestDueDate === null) return right.oldestDueDate === null ? 0 : 1;
    if (right.oldestDueDate === null) return -1;
    if (left.oldestDueDate !== right.oldestDueDate) {
      return left.oldestDueDate < right.oldestDueDate ? -1 : 1;
    }
  }
  const nameOrder = left.studentName.localeCompare(right.studentName);
  if (nameOrder !== 0) return nameOrder;
  const admissionOrder = left.admissionNumber.localeCompare(right.admissionNumber);
  return admissionOrder !== 0 ? admissionOrder : left.studentId.localeCompare(right.studentId);
}

export class FeesCollectionService {
  /**
   * THE COUNTER COLLECTION. See the file comment for the transaction's
   * ordering. `amount` is derived from the allocations; the only balance
   * refusal is exceeding one (paying ahead within generated installments is
   * v1 core — the Locked decision).
   */
  async recordPayment(
    scope: DataScope,
    input: RecordPaymentInput,
    actorId: string | null,
    opts?: { mode?: "online_portal" },
  ) {
    const schoolId = requireSchoolId(scope);
    const openingAllocations = input.openingBalanceAllocations ?? [];
    const installmentCents = input.allocations.reduce(
      (acc, a) => acc + toCents(a.amount),
      0n,
    );
    const openingCents = openingAllocations.reduce((acc, a) => acc + toCents(a.amount), 0n);
    const allocationCents = installmentCents + openingCents;
    if (allocationCents <= 0n) {
      throw new Error("A payment must allocate a positive amount.");
    }
    if (openingAllocations.some((a) => toCents(a.amount) <= 0n)) {
      throw new Error("Each opening balance allocation must be a positive amount.");
    }
    if (
      new Set(openingAllocations.map((a) => a.openingBalanceId)).size !==
      openingAllocations.length
    ) {
      throw new Error("An opening balance can appear only once in a payment.");
    }

    return db.transaction(async (tx) => {
      // Idempotency first — before the receipt sequence is touched, so a
      // replayed retry cannot even burn a number. S1 (F1): a hit is a
      // promise about a SPECIFIC payload — a reused key on a different
      // student or amount is a refusal, not a healthy 200.
      if (input.clientReference) {
        const [existing] = await tx
          .select()
          .from(feePayments)
          .where(
            and(
              eq(feePayments.schoolId, schoolId),
              eq(feePayments.clientReference, input.clientReference),
            ),
          );
        if (existing) {
          const sameStudent = existing.studentId === input.studentId;
          const sameAmount = toCents(existing.amount) === allocationCents;
          if (!sameStudent || !sameAmount) {
            throw new Error(
              "This payment reference was already used for a different payment.",
            );
          }
          return existing;
        }
      }

      const [student] = await tx
        .select({ id: students.id })
        .from(students)
        .where(
          and(eq(students.id, input.studentId), eq(students.schoolId, schoolId)),
        );
      if (!student) {
        throw new Error("Student not found in this school.");
      }

      // The receipt sequence: row-locked (created on first use) so two
      // concurrent cashiers serialize. The unique index on
      // fee_payments(school, receipt) is the backstop, not the mechanism.
      await tx
        .insert(receiptNumberSequences)
        .values({ schoolId, academicYearId: input.academicYearId })
        .onConflictDoNothing();
      const [year] = await tx
        .select({ name: academicYears.name })
        .from(academicYears)
        .where(eq(academicYears.id, input.academicYearId));
      if (!year) {
        throw new Error("Academic year not found.");
      }
      const [seq] = await tx
        .select({
          lastNumber: receiptNumberSequences.lastNumber,
          prefix: receiptNumberSequences.prefix,
        })
        .from(receiptNumberSequences)
        .where(
          and(
            eq(receiptNumberSequences.schoolId, schoolId),
            eq(receiptNumberSequences.academicYearId, input.academicYearId),
          ),
        )
        .for("update");
      if (!seq) {
        throw new Error("Failed to lock the receipt sequence.");
      }
      const nextNumber = BigInt(seq.lastNumber) + 1n;
      await tx
        .update(receiptNumberSequences)
        .set({ lastNumber: Number(nextNumber) })
        .where(
          and(
            eq(receiptNumberSequences.schoolId, schoolId),
            eq(receiptNumberSequences.academicYearId, input.academicYearId),
          ),
        );
      const receiptNumber = `${seq.prefix}-${year.name.split("-")[0]}-${String(nextNumber).padStart(5, "0")}`;

      // The installments, ROW-LOCKED IN DETERMINISTIC ID ORDER, then the
      // carried-forward balances the same way — every path takes installment
      // locks before opening-balance locks, so the order is global.
      const lateFeeCents =
        input.allocations.length > 0
          ? await this.lockInstallmentsAndPriceLateFee(tx, scope, schoolId, input)
          : 0n;
      await this.lockOpeningBalances(tx, schoolId, input, openingAllocations);

      // S1 (F4): the persisted mode is the wire mode unless the webhook's
      // system path overrides it internally. recordGatewayPayment inherits
      // the same late-fee policy — online payments pay it too, by design.
      const persistedMode = opts?.mode ?? input.paymentMode;
      const paymentStatus = IMMEDIATE_MODES.has(persistedMode) ? "cleared" : "pending";

      const [payment] = await tx
        .insert(feePayments)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: input.studentId,
          academicYearId: input.academicYearId,
          receiptNumber,
          amount: fromCents(allocationCents),
          lateFeeAmount: fromCents(lateFeeCents),
          paymentDate: input.paymentDate,
          paymentMode: persistedMode,
          transactionReference: input.transactionReference ?? null,
          bankName: input.bankName ?? null,
          chequeDate: input.chequeDate ?? null,
          paymentStatus,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: actorId ?? null,
          statusReason: paymentStatus === "pending" ? "Awaiting confirmation" : null,
          remarks: input.remarks ?? null,
          collectedBy: actorId ?? null,
          clientReference: input.clientReference ?? null,
        })
        .returning();

      if (!payment) {
        throw new Error("Failed to record payment.");
      }

      if (input.allocations.length > 0) {
        await tx.insert(paymentAllocations).values(
          input.allocations.map((a) => ({
            organizationId: scope.organizationId,
            schoolId,
            paymentId: payment.id,
            installmentId: a.installmentId,
            amountAllocated: a.amount,
          })),
        );
      }

      await this.applyToInstallments(tx, input.allocations);
      await this.applyToOpeningBalances(tx, openingAllocations);

      // The ledger: the installment principal, one row per carried-forward
      // portion, then the frozen late fee if any. Hard rule 3: inserts only.
      if (installmentCents > 0n) {
        await tx.insert(financialTransactions).values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: input.studentId,
          academicYearId: input.academicYearId,
          transactionType: "fee_payment",
          direction: "credit",
          amount: fromCents(installmentCents),
          referenceId: payment.id,
          referenceTable: "fee_payments",
          receiptNumber,
          description: `Fee payment ${receiptNumber}`,
          transactionDate: input.paymentDate,
          createdBy: actorId ?? null,
        });
      }
      // ADR-049: this row IS the payment ↔ opening-balance link (reference =
      // the balance, receipt number = the payment). It is append-only, which
      // is exactly the immutability payment_allocations promises.
      for (const a of openingAllocations) {
        await tx.insert(financialTransactions).values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: input.studentId,
          academicYearId: input.academicYearId,
          transactionType: "opening_balance_payment",
          direction: "credit",
          amount: fromCents(toCents(a.amount)),
          referenceId: a.openingBalanceId,
          referenceTable: "opening_balances",
          receiptNumber,
          description: `Opening balance paid on ${receiptNumber}`,
          transactionDate: input.paymentDate,
          createdBy: actorId ?? null,
        });
      }
      if (lateFeeCents > 0n) {
        await tx.insert(financialTransactions).values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: input.studentId,
          academicYearId: input.academicYearId,
          transactionType: "late_fee_charged",
          direction: "credit",
          amount: fromCents(lateFeeCents),
          referenceId: payment.id,
          referenceTable: "fee_payments",
          receiptNumber,
          description: `Late fee charged on ${receiptNumber}`,
          transactionDate: input.paymentDate,
          createdBy: actorId ?? null,
        });
      }

      return payment;
    });
  }

  /**
   * Locks the allocated installments in id order, re-checks every balance
   * inside the lock, and prices the late fee on those locked balances.
   * Returns the late fee in paise; the caller freezes it on the payment.
   */
  private async lockInstallmentsAndPriceLateFee(
    tx: Tx,
    scope: DataScope,
    schoolId: string,
    input: RecordPaymentInput,
  ): Promise<bigint> {
    // The installments, ROW-LOCKED IN DETERMINISTIC ID ORDER — the deadlock
    // prevention. Balances are re-checked INSIDE the transaction.
    const allocationIds = input.allocations.map((a) => a.installmentId);
    const locked = await tx
      .select({
        id: feeInstallments.id,
        studentId: feeInstallments.studentId,
        academicYearId: feeInstallments.academicYearId,
        studentFeeAssignmentId: feeInstallments.studentFeeAssignmentId,
        dueDate: feeInstallments.dueDate,
        netAmount: feeInstallments.netAmount,
        paidAmount: feeInstallments.paidAmount,
        paymentStatus: feeInstallments.paymentStatus,
      })
      .from(feeInstallments)
      .where(
        and(
          inArray(feeInstallments.id, allocationIds),
          eq(feeInstallments.schoolId, schoolId),
        ),
      )
      .orderBy(asc(feeInstallments.id))
      .for("update");

    const byId = new Map(locked.map((i) => [i.id, i]));
    for (const allocation of input.allocations) {
      const inst = byId.get(allocation.installmentId);
      if (!inst) {
        throw new Error("One of the installments does not exist in this school.");
      }
      if (inst.studentId !== input.studentId) {
        throw new Error("Every allocated installment must belong to the paying student.");
      }
      // S1 (F2): a year-X payment cannot allocate year-Y installments —
      // ledger year-scoped reads would otherwise misreport.
      if (inst.academicYearId !== input.academicYearId) {
        throw new Error(
          "Every allocated installment must belong to the payment's academic year.",
        );
      }
      if (inst.paymentStatus === "waived" || inst.paymentStatus === "cancelled") {
        throw new Error("A waived or cancelled installment cannot be paid.");
      }
      const balance = toCents(inst.netAmount) - toCents(inst.paidAmount);
      if (toCents(allocation.amount) > balance) {
        throw new Error(
          "An allocation exceeds the installment's outstanding balance. The outstanding amount is " +
            fromCents(balance) +
            ".",
        );
      }
    }

    // S1 (F3): late fee is computed live on the locked balances and
    // frozen when charged — never trusted from the client. One
    // installment list, one assignment; a mixed allocation is a refusal.
    const assignmentIds = new Set(locked.map((i) => i.studentFeeAssignmentId));
    if (assignmentIds.size !== 1) {
      throw new Error("Every allocated installment must belong to one fee assignment.");
    }
    const [assignmentId] = [...assignmentIds];
    const [assignment] = await tx
      .select({ feeStructureId: studentFeeAssignments.feeStructureId })
      .from(studentFeeAssignments)
      .where(eq(studentFeeAssignments.id, assignmentId as string));
    if (!assignment) {
      throw new Error("Fee assignment not found in this school.");
    }
    const rules = await feesService.listActiveLateFeeRules([atSchoolLevel(scope)]);
    let lateFeeCents = 0n;
    for (const allocation of input.allocations) {
      const inst = byId.get(allocation.installmentId);
      if (!inst) continue;
      lateFeeCents += computeLateFee(
        {
          dueDate: inst.dueDate,
          balanceCents: toCents(inst.netAmount) - toCents(inst.paidAmount),
        },
        rules.map((r) => ({
          feeStructureId: r.feeStructureId,
          gracePeriodDays: r.gracePeriodDays ?? 0,
          calculationType: r.calculationType,
          valueCents: toCents(r.value),
          maxLateFeeCents: r.maxLateFee ? toCents(r.maxLateFee) : null,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
        })),
        assignment.feeStructureId,
        input.paymentDate,
      );
    }
    return lateFeeCents;
  }

  /**
   * Adds each allocation to its installment's paid_amount and restates the
   * status. Caller holds the row locks; shared by record (adds) and the
   * transition operations' re-open path (negatives).
   */
  private async applyToInstallments(
    tx: Tx,
    deltas: { installmentId: string; amount: string }[],
  ) {
    for (const delta of deltas) {
      const [inst] = await tx
        .select({
          netAmount: feeInstallments.netAmount,
          paidAmount: feeInstallments.paidAmount,
        })
        .from(feeInstallments)
        .where(eq(feeInstallments.id, delta.installmentId))
        .for("update");
      if (!inst) {
        throw new Error("Installment vanished mid-transaction.");
      }
      const paid = toCents(inst.paidAmount) + toCents(delta.amount);
      const net = toCents(inst.netAmount);
      const status =
        paid <= 0n ? "unpaid" : paid >= net ? "paid" : "partial";
      await tx
        .update(feeInstallments)
        .set({ paidAmount: fromCents(paid < 0n ? 0n : paid), paymentStatus: status })
        .where(eq(feeInstallments.id, delta.installmentId));
    }
  }

  /**
   * Locks the carried-forward balances a payment pays, in id order, and
   * re-checks each inside the lock: same school, same student, the payment's
   * own year (the year the balance was carried INTO), not waived, and no
   * more than what is still owed.
   */
  private async lockOpeningBalances(
    tx: Tx,
    schoolId: string,
    input: Pick<RecordPaymentInput, "studentId" | "academicYearId">,
    allocations: { openingBalanceId: string; amount: string }[],
  ) {
    if (allocations.length === 0) return;
    const locked = await tx
      .select({
        id: openingBalances.id,
        studentId: openingBalances.studentId,
        academicYearId: openingBalances.academicYearId,
        amount: openingBalances.amount,
        paidAmount: openingBalances.paidAmount,
        status: openingBalances.status,
      })
      .from(openingBalances)
      .where(
        and(
          inArray(
            openingBalances.id,
            allocations.map((a) => a.openingBalanceId),
          ),
          eq(openingBalances.schoolId, schoolId),
        ),
      )
      .orderBy(asc(openingBalances.id))
      .for("update");

    const byId = new Map(locked.map((b) => [b.id, b]));
    for (const allocation of allocations) {
      const balance = byId.get(allocation.openingBalanceId);
      if (!balance) {
        throw new Error("One of the opening balances does not exist in this school.");
      }
      if (balance.studentId !== input.studentId) {
        throw new Error("Every opening balance paid must belong to the paying student.");
      }
      if (balance.academicYearId !== input.academicYearId) {
        throw new Error(
          "An opening balance is paid in the academic year it was carried into.",
        );
      }
      if (balance.status === "waived") {
        throw new Error("A waived opening balance cannot be paid.");
      }
      const owed = toCents(balance.amount) - toCents(balance.paidAmount);
      if (toCents(allocation.amount) > owed) {
        throw new Error(
          "An allocation exceeds the opening balance still owed. The outstanding amount is " +
            fromCents(owed < 0n ? 0n : owed) +
            ".",
        );
      }
    }
  }

  /**
   * The opening-balance sibling of `applyToInstallments`: adds each delta to
   * paid_amount (negatives re-open) and restates the status. Caller holds,
   * or here takes, the row lock.
   */
  private async applyToOpeningBalances(
    tx: Tx,
    deltas: { openingBalanceId: string; amount: string }[],
  ) {
    for (const delta of deltas) {
      const [balance] = await tx
        .select({ amount: openingBalances.amount, paidAmount: openingBalances.paidAmount })
        .from(openingBalances)
        .where(eq(openingBalances.id, delta.openingBalanceId))
        .for("update");
      if (!balance) {
        throw new Error("Opening balance vanished mid-transaction.");
      }
      const paid = toCents(balance.paidAmount) + toCents(delta.amount);
      const amount = toCents(balance.amount);
      const status = paid <= 0n ? "unpaid" : paid >= amount ? "paid" : "partial";
      await tx
        .update(openingBalances)
        .set({ paidAmount: fromCents(paid < 0n ? 0n : paid), status })
        .where(eq(openingBalances.id, delta.openingBalanceId));
    }
  }

  /**
   * What a payment still holds on each line it paid: installment allocations
   * (due date, then id) followed by carried-forward portions (ledger order),
   * less everything earlier refunds took back. Refunds always walk the lines
   * greedily in this order, so replaying their SUM reproduces every earlier
   * walk exactly — the answer does not depend on how the refunds were split.
   */
  private async heldLines(
    tx: Tx,
    payment: { id: string; schoolId: string; academicYearId: string; receiptNumber: string },
  ): Promise<HeldLine[]> {
    const allocations = await tx
      .select({
        installmentId: paymentAllocations.installmentId,
        amountAllocated: paymentAllocations.amountAllocated,
      })
      .from(paymentAllocations)
      .innerJoin(feeInstallments, eq(feeInstallments.id, paymentAllocations.installmentId))
      .where(eq(paymentAllocations.paymentId, payment.id))
      .orderBy(asc(feeInstallments.dueDate), asc(paymentAllocations.installmentId));
    const portions = await this.openingBalancePortions(tx, payment);
    const lines: HeldLine[] = [
      ...allocations.map((a) => ({
        kind: "installment" as const,
        id: a.installmentId,
        heldCents: toCents(a.amountAllocated),
      })),
      ...portions.map((p) => ({
        kind: "opening_balance" as const,
        id: p.openingBalanceId,
        heldCents: toCents(p.amount),
      })),
    ];
    const prior = await tx
      .select({ refundAmount: feeRefunds.refundAmount })
      .from(feeRefunds)
      .where(eq(feeRefunds.originalPaymentId, payment.id));
    takeFromLines(
      lines,
      prior.reduce((acc, r) => acc + toCents(r.refundAmount), 0n),
    );
    return lines;
  }

  /** Re-opens each line by the given amount (installment or opening balance). */
  private async reopenLines(tx: Tx, takes: { line: HeldLine; cents: bigint }[]) {
    const open = takes.filter((t) => t.cents > 0n);
    await this.applyToInstallments(
      tx,
      open
        .filter((t) => t.line.kind === "installment")
        .map((t) => ({ installmentId: t.line.id, amount: `-${fromCents(t.cents)}` })),
    );
    await this.applyToOpeningBalances(
      tx,
      open
        .filter((t) => t.line.kind === "opening_balance")
        .map((t) => ({ openingBalanceId: t.line.id, amount: `-${fromCents(t.cents)}` })),
    );
  }

  /**
   * The carried-forward portions of a payment, read from their
   * `opening_balance_payment` ledger rows (ADR-049) — the receipt number is
   * unique per school, so (school, year, receipt) names exactly one payment.
   */
  private async openingBalancePortions(
    runner: Tx | typeof db,
    payment: { schoolId: string; academicYearId: string; receiptNumber: string },
  ) {
    const rows = await runner
      .select({
        openingBalanceId: financialTransactions.referenceId,
        amount: financialTransactions.amount,
      })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.schoolId, payment.schoolId),
          eq(financialTransactions.academicYearId, payment.academicYearId),
          eq(financialTransactions.receiptNumber, payment.receiptNumber),
          eq(financialTransactions.transactionType, "opening_balance_payment"),
          eq(financialTransactions.referenceTable, "opening_balances"),
        ),
      )
      .orderBy(asc(financialTransactions.createdAt), asc(financialTransactions.id));
    return rows.flatMap((r) =>
      r.openingBalanceId ? [{ openingBalanceId: r.openingBalanceId, amount: r.amount }] : [],
    );
  }

  /**
   * The common skeleton of bounce/reverse/cancel: validate the current
   * status, flip it with the audit triple, and re-open the installments the
   * payment's allocations had reduced (the allocations themselves stay —
   * history), plus any opening-balance portions. `transactionType` decides
   * which offsetting debits are written: every transition mirrors the credits
   * the payment wrote (principal still held AND frozen late fee, ADR-049).
   */
  private async transitionPayment(
    scope: DataScope,
    input: PaymentTransitionInput,
    actorId: string,
    opts: {
      from: ("pending" | "cleared")[];
      to: "bounced" | "reversed" | "cancelled";
      transactionType: "cheque_bounce_charge" | "fee_refund" | "payment_cancelled";
    },
  ) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(feePayments)
        .where(
          and(
            eq(feePayments.id, input.paymentId),
            scopeWhere(atSchoolLevel(scope), PAYMENT_SCOPE),
          ),
        )
        .for("update");
      if (!payment) {
        throw new Error("Payment not found in this school.");
      }
      if (!opts.from.includes(payment.paymentStatus as "pending" | "cleared")) {
        throw new Error(
          `A ${payment.paymentStatus} payment cannot move to ${opts.to}.`,
        );
      }

      // Re-open what the payment STILL HOLDS on each line — a partial refund
      // already took its share back, and must not be re-opened twice.
      const lines = await this.heldLines(tx, payment);
      const heldCents = lines.reduce((acc, l) => acc + l.heldCents, 0n);
      if (heldCents === 0n && opts.to !== "cancelled") {
        throw new Error(
          `This payment has been fully refunded; there is nothing left to mark ${opts.to}.`,
        );
      }
      await this.reopenLines(
        tx,
        lines.map((l) => ({ line: l, cents: l.heldCents })),
      );

      const [updated] = await tx
        .update(feePayments)
        .set({
          paymentStatus: opts.to,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: actorId,
          statusReason: input.reason,
        })
        .where(eq(feePayments.id, payment.id))
        .returning();

      if (!updated) {
        throw new Error("Failed to update the payment.");
      }

      if (heldCents > 0n) {
        await tx.insert(financialTransactions).values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: payment.studentId,
          academicYearId: payment.academicYearId,
          transactionType: opts.transactionType,
          direction: "debit",
          // The principal less what refunds already debited (gap 17).
          amount: fromCents(heldCents),
          referenceId: payment.id,
          referenceTable: "fee_payments",
          receiptNumber: payment.receiptNumber,
          description: `${input.reason} (${payment.receiptNumber})`,
          transactionDate: new Date().toISOString().slice(0, 10),
          createdBy: actorId,
        });
      }
      // ADR-049: the late fee frozen on this payment never arrived (bounce,
      // cancel) or went back with it (reversal) — offset its credit too, as
      // its own row so each debit mirrors one credit.
      if (toCents(payment.lateFeeAmount) > 0n) {
        await tx.insert(financialTransactions).values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: payment.studentId,
          academicYearId: payment.academicYearId,
          transactionType: opts.transactionType,
          direction: "debit",
          amount: payment.lateFeeAmount,
          referenceId: payment.id,
          referenceTable: "fee_payments",
          receiptNumber: payment.receiptNumber,
          description: `Late fee reversed: ${input.reason} (${payment.receiptNumber})`,
          transactionDate: new Date().toISOString().slice(0, 10),
          createdBy: actorId,
        });
      }

      return updated;
    });
  }

  /** A pending (or, at some schools, cleared) payment confirms: money arrived. */
  async clearPayment(scope: DataScope, input: PaymentTransitionInput, actorId: string) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(feePayments)
        .where(
          and(
            eq(feePayments.id, input.paymentId),
            scopeWhere(atSchoolLevel(scope), PAYMENT_SCOPE),
          ),
        )
        .for("update");
      if (!payment) {
        throw new Error("Payment not found in this school.");
      }
      if (payment.paymentStatus !== "pending") {
        throw new Error(`A ${payment.paymentStatus} payment cannot be cleared.`);
      }

      const [updated] = await tx
        .update(feePayments)
        .set({
          paymentStatus: "cleared",
          statusUpdatedAt: new Date(),
          statusUpdatedBy: actorId,
          statusReason: input.reason,
        })
        .where(eq(feePayments.id, payment.id))
        .returning();

      if (!updated) {
        throw new Error("Failed to clear the payment.");
      }
      return updated;
    });
  }

  /** A bounced cheque: money is NOT arriving; balances re-open, ledger debit. */
  async bouncePayment(scope: DataScope, input: PaymentTransitionInput, actorId: string) {
    return this.transitionPayment(scope, input, actorId, {
      from: ["pending", "cleared"],
      to: "bounced",
      transactionType: "cheque_bounce_charge",
    });
  }

  /** A reversal (UPI dispute, duplicate entry): balances re-open, ledger debit. */
  async reversePayment(scope: DataScope, input: PaymentTransitionInput, actorId: string) {
    return this.transitionPayment(scope, input, actorId, {
      from: ["cleared"],
      to: "reversed",
      transactionType: "fee_refund",
    });
  }

  /**
   * A pending payment withdrawn before confirmation. No money moved, but
   * recordPayment credited it at entry, so the credits are offset with
   * `payment_cancelled` debits (gap 15, ADR-049) and it nets to zero cash.
   */
  async cancelPayment(scope: DataScope, input: PaymentTransitionInput, actorId: string) {
    return this.transitionPayment(scope, input, actorId, {
      from: ["pending"],
      to: "cancelled",
      transactionType: "payment_cancelled",
    });
  }

  /**
   * A refund against a CLEARED payment, validated against what that payment
   * actually contributed minus what earlier refunds already took back. The
   * re-open walks the allocations oldest-first until the refund amount is
   * consumed — deterministic, and the allocation rows themselves stay as
   * history. Writes its own `fee_refund` ledger row.
   */
  async recordRefund(scope: DataScope, input: RecordRefundInput, actorId: string) {
    const schoolId = requireSchoolId(scope);
    const refundCents = toCents(input.refundAmount);

    return db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(feePayments)
        .where(
          and(
            eq(feePayments.id, input.originalPaymentId),
            eq(feePayments.schoolId, schoolId),
          ),
        )
        .for("update");
      if (!payment) {
        throw new Error("Payment not found in this school.");
      }
      if (payment.paymentStatus !== "cleared") {
        throw new Error(
          `Only a cleared payment can be refunded; this one is ${payment.paymentStatus}.`,
        );
      }

      const lines = await this.heldLines(tx, payment);
      const refundable = lines.reduce((acc, l) => acc + l.heldCents, 0n);
      if (refundCents > refundable) {
        throw new Error(
          `The refund exceeds what this payment still holds. Refundable: ${fromCents(refundable)}.`,
        );
      }

      // Take the refund back off the lines in the same deterministic order
      // the earlier refunds used (gap 16): installments by due date, then
      // carried-forward portions.
      await this.reopenLines(tx, takeFromLines(lines, refundCents));

      const [refund] = await tx
        .insert(feeRefunds)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: payment.studentId,
          academicYearId: payment.academicYearId,
          originalPaymentId: payment.id,
          refundAmount: input.refundAmount,
          refundDate: input.refundDate,
          refundMode: input.refundMode,
          transactionReference: input.transactionReference ?? null,
          reason: input.reason,
          status: "processed",
          approvedBy: actorId,
          processedBy: actorId,
        })
        .returning();

      if (!refund) {
        throw new Error("Failed to record refund.");
      }

      await tx.insert(financialTransactions).values({
        organizationId: scope.organizationId,
        schoolId,
        studentId: payment.studentId,
        academicYearId: payment.academicYearId,
        transactionType: "fee_refund",
        direction: "debit",
        amount: input.refundAmount,
        referenceId: refund.id,
        referenceTable: "fee_refunds",
        receiptNumber: payment.receiptNumber,
        description: `Refund against ${payment.receiptNumber}: ${input.reason}`,
        transactionDate: input.refundDate,
        createdBy: actorId,
      });

      return refund;
    });
  }

  /**
   * Management forgives an outstanding installment: never-paid only (money
   * already received is not waived, it is refunded), and the waiver writes
   * its `waiver_applied` ledger row. `fee_waiver:approve` gates the router.
   */
  async waiveInstallment(scope: DataScope, installmentId: string, actorId: string) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [installment] = await tx
        .select()
        .from(feeInstallments)
        .where(
          and(
            eq(feeInstallments.id, installmentId),
            scopeWhere(atSchoolLevel(scope), INSTALLMENT_SCOPE),
          ),
        )
        .for("update");
      if (!installment) {
        throw new Error("Installment not found in this school.");
      }
      if (installment.paymentStatus !== "unpaid" || installment.paidAmount !== "0.00") {
        throw new Error(
          "Only a never-paid installment can be waived. Money already received must be refunded instead.",
        );
      }

      const [updated] = await tx
        .update(feeInstallments)
        .set({ paymentStatus: "waived" })
        .where(eq(feeInstallments.id, installment.id))
        .returning();

      if (!updated) {
        throw new Error("Failed to waive the installment.");
      }

      await tx.insert(financialTransactions).values({
        organizationId: scope.organizationId,
        schoolId,
        studentId: installment.studentId,
        academicYearId: installment.academicYearId,
        transactionType: "waiver_applied",
        direction: "debit",
        amount: installment.netAmount,
        referenceId: installment.id,
        referenceTable: "fee_installments",
        description: installment.description ?? "Fee waiver",
        transactionDate: new Date().toISOString().slice(0, 10),
        createdBy: actorId,
      });

      return updated;
    });
  }

  /**
   * THE ADR-009 SYSTEM PATH. The caller is the webhook route, which has
   * already verified the HMAC signature over the raw body — that signature,
   * not a session, is the authorization, and this method is only reachable
   * from that seam. The gateway's order id is the idempotency key; the
   * allocation is server-side, oldest-due first; a total exceeding the
   * student's outstanding balances is REFUSED (surplus is the recorded
   * deferral, never a silent wallet).
   */
  async recordGatewayPayment(input: GatewayPaymentInput) {
    const schoolId = await this.schoolOfStudent(input.organizationId, input.studentId);
    if (!schoolId) {
      throw new Error("Student not found.");
    }

    const systemScope: DataScope = {
      organizationId: input.organizationId,
      schoolId,
      classId: null,
      sectionId: null,
    };

    // The student's open installments, then the pure allocator decides where
    // the money goes. recordPayment re-locks and re-checks everything.
    const installments = await db
      .select({
        id: feeInstallments.id,
        dueDate: feeInstallments.dueDate,
        netAmount: feeInstallments.netAmount,
        paidAmount: feeInstallments.paidAmount,
      })
      .from(feeInstallments)
      .where(
        and(
          eq(feeInstallments.studentId, input.studentId),
          eq(feeInstallments.schoolId, schoolId),
        ),
      );

    const allocations = allocateOldestFirst(
      toCents(input.amount),
      installments.map((i) => ({
        installmentId: i.id,
        dueDate: i.dueDate,
        balanceCents: toCents(i.netAmount) - toCents(i.paidAmount),
      })),
    );
    if (!allocations || allocations.length === 0) {
      throw new Error(
        "The payment exceeds the student's outstanding dues, which the portal does not accept.",
      );
    }

    const [firstAllocation] = allocations;
    if (!firstAllocation) {
      throw new Error("No allocation could be computed for this payment.");
    }
    const [yearRow] = await db
      .select({ academicYearId: feeInstallments.academicYearId })
      .from(feeInstallments)
      .where(eq(feeInstallments.id, firstAllocation.installmentId));
    if (!yearRow) {
      throw new Error("The allocated installment no longer exists.");
    }

    return this.recordPayment(
      systemScope,
      {
        studentId: input.studentId,
        academicYearId: yearRow.academicYearId,
        paymentDate: input.paymentDate,
        // Dummy wire mode (pending like the portal); the persisted mode
        // comes from opts below and is what the ledger sees.
        paymentMode: "upi",
        allocations: allocations.map((a) => ({
          installmentId: a.installmentId,
          amount: fromCents(a.amountCents),
        })),
        clientReference: input.gatewayOrderId,
        remarks: "Portal payment (gateway webhook)",
      },
      null, // the system context is not a user row (ADR-009)
      { mode: "online_portal" },
    );
  }

  private async schoolOfStudent(
    organizationId: string,
    studentId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: students.schoolId })
      .from(students)
      .where(
        and(eq(students.id, studentId), eq(students.organizationId, organizationId)),
      );
    return row?.schoolId ?? null;
  }

  async listMatrix(
    scopes: DataScope[],
    input: FeeMatrixInput,
    includeHistory: boolean,
  ): Promise<FeeMatrixOutput | null> {
    const [year] = await db
      .select({
        id: academicYears.id,
        name: academicYears.name,
        startDate: academicYears.startDate,
        endDate: academicYears.endDate,
      })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, input.academicYearId),
          scopeWhere(scopes.map(atSchoolLevel), MATRIX_YEAR_SCOPE),
          yearVisibilityWhere(includeHistory),
        ),
      );

    if (!year) return null;

    const search = input.search?.trim();
    const searchWhere = search
      ? or(
          ilike(students.firstName, `%${escapeLike(search)}%`),
          ilike(students.middleName, `%${escapeLike(search)}%`),
          ilike(students.lastName, `%${escapeLike(search)}%`),
          ilike(students.admissionNumber, `%${escapeLike(search)}%`),
        )
      : undefined;

    const cohort = await db
      .select({
        enrollmentId: studentEnrollments.id,
        studentId: students.id,
        admissionNumber: students.admissionNumber,
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
        classId: studentEnrollments.classId,
        className: classes.name,
        sectionId: studentEnrollments.sectionId,
        sectionName: sections.name,
        rollNumber: studentEnrollments.rollNumber,
        assignmentId: studentFeeAssignments.id,
        assignmentStatus: studentFeeAssignments.status,
      })
      .from(studentEnrollments)
      .innerJoin(
        academicYears,
        and(
          eq(academicYears.id, studentEnrollments.academicYearId),
          eq(academicYears.organizationId, studentEnrollments.organizationId),
          eq(academicYears.schoolId, studentEnrollments.schoolId),
        ),
      )
      .innerJoin(
        students,
        and(
          eq(students.id, studentEnrollments.studentId),
          eq(students.organizationId, studentEnrollments.organizationId),
          eq(students.schoolId, studentEnrollments.schoolId),
        ),
      )
      .innerJoin(
        classes,
        and(
          eq(classes.id, studentEnrollments.classId),
          eq(classes.organizationId, studentEnrollments.organizationId),
          eq(classes.schoolId, studentEnrollments.schoolId),
        ),
      )
      .leftJoin(
        sections,
        and(
          eq(sections.id, studentEnrollments.sectionId),
          eq(sections.organizationId, studentEnrollments.organizationId),
          eq(sections.schoolId, studentEnrollments.schoolId),
          eq(sections.classId, studentEnrollments.classId),
          eq(sections.academicYearId, year.id),
        ),
      )
      .leftJoin(
        studentFeeAssignments,
        and(
          eq(studentFeeAssignments.enrollmentId, studentEnrollments.id),
          eq(studentFeeAssignments.studentId, studentEnrollments.studentId),
          eq(studentFeeAssignments.academicYearId, year.id),
          eq(studentFeeAssignments.organizationId, studentEnrollments.organizationId),
          eq(studentFeeAssignments.schoolId, studentEnrollments.schoolId),
        ),
      )
      .where(
        and(
          eq(studentEnrollments.academicYearId, year.id),
          input.classId ? eq(studentEnrollments.classId, input.classId) : undefined,
          input.sectionId ? eq(studentEnrollments.sectionId, input.sectionId) : undefined,
          searchWhere,
          scopeWhere(scopes, MATRIX_ENROLLMENT_SCOPE),
          scopeWhere(scopes.map(atSchoolLevel), MATRIX_STUDENT_SCOPE),
          yearVisibilityWhere(includeHistory),
        ),
      )
      .orderBy(asc(students.lastName), asc(students.firstName), asc(students.id));

    const studentIds = cohort.map((row) => row.studentId);
    const installmentRows = studentIds.length
      ? await db
          .select({
            studentId: feeInstallments.studentId,
            feeHeadId: feeInstallments.feeHeadId,
            amount: feeInstallments.amount,
            concessionAmount: feeInstallments.concessionAmount,
            netAmount: feeInstallments.netAmount,
            paidAmount: feeInstallments.paidAmount,
            dueDate: feeInstallments.dueDate,
            paymentStatus: feeInstallments.paymentStatus,
          })
          .from(feeInstallments)
          .where(
            and(
              eq(feeInstallments.academicYearId, year.id),
              inArray(feeInstallments.studentId, studentIds),
              scopeWhere(scopes.map(atSchoolLevel), INSTALLMENT_SCOPE),
            ),
          )
          .orderBy(asc(feeInstallments.dueDate), asc(feeInstallments.id))
      : [];

    const openingRows = studentIds.length
      ? await db
          .select({
            studentId: openingBalances.studentId,
            amount: openingBalances.amount,
            paidAmount: openingBalances.paidAmount,
            status: openingBalances.status,
            originAcademicYearId: openingBalances.originAcademicYearId,
          })
          .from(openingBalances)
          .where(
            and(
              eq(openingBalances.academicYearId, year.id),
              inArray(openingBalances.studentId, studentIds),
              scopeWhere(scopes.map(atSchoolLevel), MATRIX_OPENING_BALANCE_SCOPE),
            ),
          )
          .orderBy(asc(openingBalances.createdAt))
      : [];

    const installmentsByStudent = new Map<string, MatrixInstallment[]>();
    for (const installment of installmentRows) {
      const rows = installmentsByStudent.get(installment.studentId) ?? [];
      rows.push(installment);
      installmentsByStudent.set(installment.studentId, rows);
    }

    const openingByStudent = new Map<string, MatrixOpeningBalanceRow[]>();
    for (const row of openingRows) {
      const rows = openingByStudent.get(row.studentId) ?? [];
      rows.push(row);
      openingByStudent.set(row.studentId, rows);
    }

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const months = monthsBetween(year.startDate, year.endDate).map((month) => {
      const firstDate = isoOf(month.year, month.month, 1);
      const lastDate = isoOf(month.year, month.month, daysInMonth(month.year, month.month));
      return {
        key: `${month.year}-${String(month.month).padStart(2, "0")}`,
        year: month.year,
        month: month.month,
        label: `${monthNames[month.month - 1]} ${month.year}`,
        startDate: firstDate < year.startDate ? year.startDate : firstDate,
        endDate: lastDate > year.endDate ? year.endDate : lastDate,
      };
    });
    const monthAccumulators = new Map<string, MatrixAccumulator>(
      months.map((month) => [month.key, emptyMatrixAccumulator()]),
      );
    const monthStudentCounts = new Map<string, number>();
    const monthOutstandingCounts = new Map<string, number>();
    const asOf = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
    const cohortAccumulator = emptyMatrixAccumulator();
    const cohortOpeningAccumulator = emptyOpeningBalanceAccumulator();
    const computedRows: FeeMatrixOutput["rows"] = [];

    for (const cohortRow of cohort) {
      const studentInstallments = installmentsByStudent.get(cohortRow.studentId) ?? [];
      const rowAccumulator = emptyMatrixAccumulator();
      const cellAccumulators = new Map<string, MatrixAccumulator>(
        months.map((month) => [month.key, emptyMatrixAccumulator()]),
      );

      for (const installment of studentInstallments) {
        addMatrixInstallment(rowAccumulator, installment);
        const month = installment.dueDate.slice(0, 7);
        const cellAccumulator = cellAccumulators.get(month);
        if (cellAccumulator) addMatrixInstallment(cellAccumulator, installment);
      }

      const rowOpeningAccumulator = emptyOpeningBalanceAccumulator();
      for (const openingRow of openingByStudent.get(cohortRow.studentId) ?? []) {
        addOpeningBalance(rowOpeningAccumulator, openingRow);
      }

      const totals = matrixAmounts(rowAccumulator, asOf);
      const assignmentState: FeeMatrixOutput["rows"][number]["assignmentState"] =
        cohortRow.assignmentId === null ? "unassigned" : (cohortRow.assignmentStatus ?? "active");
      const generationState: FeeMatrixOutput["rows"][number]["generationState"] =
        cohortRow.assignmentId === null
          ? "not_assigned"
          : studentInstallments.length === 0
            ? "not_generated"
            : "generated";
      const row: FeeMatrixOutput["rows"][number] = {
        studentId: cohortRow.studentId,
        admissionNumber: cohortRow.admissionNumber,
        studentName: [cohortRow.firstName, cohortRow.middleName, cohortRow.lastName]
          .filter((part): part is string => Boolean(part))
          .join(" "),
        classId: cohortRow.classId,
        className: cohortRow.className,
        sectionId: cohortRow.sectionId,
        sectionName: cohortRow.sectionName,
        rollNumber: cohortRow.rollNumber,
        assignmentId: cohortRow.assignmentId,
        assignmentState,
        generationState,
        generatedInstallmentCount: studentInstallments.length,
        cells: months.map((month) => {
          const cell = matrixAmounts(
            cellAccumulators.get(month.key) ?? emptyMatrixAccumulator(),
            asOf,
          );
          return { ...cell, month: month.key };
        }),
        totals,
        openingBalance: openingBalanceSummary(rowOpeningAccumulator),
        paymentState: totals.paymentState,
        timingState: totals.timingState,
        oldestDueDate: totals.oldestDueDate,
      };

      computedRows.push(row);
      mergeMatrixAccumulator(cohortAccumulator, rowAccumulator);
      mergeOpeningBalance(cohortOpeningAccumulator, rowOpeningAccumulator);
      for (const month of months) {
        const cellAccumulator = cellAccumulators.get(month.key);
        if (!cellAccumulator || cellAccumulator.activeInstallmentCount === 0) continue;
        const cohortMonth = monthAccumulators.get(month.key);
        if (!cohortMonth) continue;
        mergeMatrixAccumulator(cohortMonth, cellAccumulator);
        monthStudentCounts.set(month.key, (monthStudentCounts.get(month.key) ?? 0) + 1);
        if (cellAccumulator.balanceCents > 0n) {
          monthOutstandingCounts.set(month.key, (monthOutstandingCounts.get(month.key) ?? 0) + 1);
        }
      }
    }

    const cohortAmounts = matrixAmounts(cohortAccumulator, asOf);
    const cohortTotals = {
      ...cohortAmounts,
      studentCount: computedRows.length,
      assignedCount: computedRows.filter((row) => row.assignmentId !== null).length,
      notGeneratedCount: computedRows.filter((row) => row.generationState !== "generated").length,
      outstandingStudentCount: computedRows.filter((row) => matrixRowBalance(row) > 0n).length,
      openingBalance: openingBalanceSummary(cohortOpeningAccumulator),
    };
    const monthSummaries = months.map((month) => {
      const accumulator = monthAccumulators.get(month.key) ?? emptyMatrixAccumulator();
      const amounts = matrixAmounts(accumulator, asOf);
      return {
        month: month.key,
        studentCount: monthStudentCounts.get(month.key) ?? 0,
        outstandingStudentCount: monthOutstandingCounts.get(month.key) ?? 0,
        assessedAmount: amounts.assessedAmount,
        concessionAmount: amounts.concessionAmount,
        netAmount: amounts.netAmount,
        paidAmount: amounts.paidAmount,
        balanceAmount: amounts.balanceAmount,
        feeHeadCount: amounts.feeHeadCount,
        oldestDueDate: amounts.oldestDueDate,
      };
    });

    const view = input.view ?? "all";
    const filteredRows = computedRows.filter((row) => matrixRowMatchesView(row, view));
    filteredRows.sort((left, right) => matrixRowSort(left, right, input.sort ?? "student"));
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    const total = filteredRows.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const pageInfo = {
      page,
      pageSize,
      total,
      totalPages,
      hasPreviousPage: page > 1 && total > 0,
      hasNextPage: start + pageSize < total,
    };

    return {
      academicYear: {
        id: year.id,
        name: year.name,
        startDate: year.startDate,
        endDate: year.endDate,
      },
      months,
      rows: filteredRows.slice(start, start + pageSize),
      cohortTotals,
      monthSummaries,
      pageInfo,
    };
  }

  async getMatrixCell(
    scopes: DataScope[],
    input: FeeMatrixCellInput,
    includeHistory: boolean,
  ): Promise<FeeMatrixCellOutput | null> {
    const [year] = await db
      .select({ id: academicYears.id })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, input.academicYearId),
          scopeWhere(scopes.map(atSchoolLevel), MATRIX_YEAR_SCOPE),
          yearVisibilityWhere(includeHistory),
        ),
      );

    if (!year) return null;

    const [enrollment] = await db
      .select({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .innerJoin(
        academicYears,
        and(
          eq(academicYears.id, studentEnrollments.academicYearId),
          eq(academicYears.organizationId, studentEnrollments.organizationId),
          eq(academicYears.schoolId, studentEnrollments.schoolId),
        ),
      )
      .innerJoin(
        students,
        and(
          eq(students.id, studentEnrollments.studentId),
          eq(students.organizationId, studentEnrollments.organizationId),
          eq(students.schoolId, studentEnrollments.schoolId),
        ),
      )
      .where(
        and(
          eq(studentEnrollments.academicYearId, input.academicYearId),
          eq(studentEnrollments.studentId, input.studentId),
          scopeWhere(scopes, MATRIX_ENROLLMENT_SCOPE),
          scopeWhere(scopes.map(atSchoolLevel), MATRIX_STUDENT_SCOPE),
          yearVisibilityWhere(includeHistory),
        ),
      );

    if (!enrollment) return null;

    const monthStart = `${input.month}-01`;
    const yearNumber = Number.parseInt(input.month.slice(0, 4), 10);
    const monthNumber = Number.parseInt(input.month.slice(5, 7), 10);
    const nextMonth =
      monthNumber === 12 ? isoOf(yearNumber + 1, 1, 1) : isoOf(yearNumber, monthNumber + 1, 1);
    const installmentRows = await db
      .select({
        id: feeInstallments.id,
        studentId: feeInstallments.studentId,
        description: feeInstallments.description,
        feeHeadId: feeInstallments.feeHeadId,
        feeHeadName: feeHeads.name,
        dueDate: feeInstallments.dueDate,
        amount: feeInstallments.amount,
        concessionAmount: feeInstallments.concessionAmount,
        netAmount: feeInstallments.netAmount,
        paidAmount: feeInstallments.paidAmount,
        paymentStatus: feeInstallments.paymentStatus,
      })
      .from(feeInstallments)
      .innerJoin(
        feeHeads,
        and(
          eq(feeHeads.id, feeInstallments.feeHeadId),
          eq(feeHeads.organizationId, feeInstallments.organizationId),
          eq(feeHeads.schoolId, feeInstallments.schoolId),
        ),
      )
      .where(
        and(
          eq(feeInstallments.academicYearId, input.academicYearId),
          eq(feeInstallments.studentId, input.studentId),
          sql`${feeInstallments.dueDate} >= ${monthStart}`,
          sql`${feeInstallments.dueDate} < ${nextMonth}`,
          inArray(feeInstallments.paymentStatus, ["unpaid", "partial", "paid", "waived"]),
          scopeWhere(scopes.map(atSchoolLevel), INSTALLMENT_SCOPE),
        ),
      )
      .orderBy(asc(feeInstallments.dueDate), asc(feeInstallments.id));

    const accumulator = emptyMatrixAccumulator();
    const installments = installmentRows.flatMap((installment) => {
      if (installment.paymentStatus === "cancelled") return [];
      addMatrixInstallment(accumulator, installment);
      return [
        {
          id: installment.id,
          description: installment.description,
          feeHeadId: installment.feeHeadId,
          feeHeadName: installment.feeHeadName,
          dueDate: installment.dueDate,
          amount: fromCents(toCents(installment.amount)),
          concessionAmount: fromCents(toCents(installment.concessionAmount)),
          netAmount: fromCents(toCents(installment.netAmount)),
          paidAmount: fromCents(toCents(installment.paidAmount)),
          balanceAmount: fromCents(matrixInstallmentBalance(installment)),
          paymentStatus: installment.paymentStatus,
        },
      ];
    });
    const asOf = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

    return {
      studentId: input.studentId,
      month: input.month,
      ...matrixAmounts(accumulator, asOf),
      installments,
    };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** The accountant's due list — open installments for a year, or a student. */
  async listDues(
    scopes: DataScope[],
    academicYearId: string,
    filters: { studentId?: string; dueOnOrBefore?: string },
  ) {
    return db
      .select()
      .from(feeInstallments)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), INSTALLMENT_SCOPE),
          eq(feeInstallments.academicYearId, academicYearId),
          filters.studentId ? eq(feeInstallments.studentId, filters.studentId) : undefined,
          filters.dueOnOrBefore
            ? sql`${feeInstallments.dueDate} <= ${filters.dueOnOrBefore}`
            : undefined,
          inArray(feeInstallments.paymentStatus, ["unpaid", "partial"]),
        ),
      )
      .orderBy(asc(feeInstallments.dueDate));
  }

  async listPayments(
    scopes: DataScope[],
    academicYearId: string,
    studentId?: string,
  ): Promise<FeePaymentListRow[]> {
    const rows = await db
      .select({
        payment: feePayments,
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
        admissionNumber: students.admissionNumber,
        className: classes.name,
        sectionName: sections.name,
      })
      .from(feePayments)
      .innerJoin(
        students,
        and(eq(students.id, feePayments.studentId), eq(students.schoolId, feePayments.schoolId)),
      )
      .leftJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.studentId, feePayments.studentId),
          eq(studentEnrollments.academicYearId, feePayments.academicYearId),
          eq(studentEnrollments.schoolId, feePayments.schoolId),
        ),
      )
      .leftJoin(classes, eq(classes.id, studentEnrollments.classId))
      .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), PAYMENT_SCOPE),
          eq(feePayments.academicYearId, academicYearId),
          studentId ? eq(feePayments.studentId, studentId) : undefined,
        ),
      )
      .orderBy(asc(feePayments.paymentDate));
    return rows.map((r) => ({
      ...r.payment,
      studentName: fullName(r),
      admissionNumber: r.admissionNumber,
      className: r.className,
      sectionName: r.sectionName,
    }));
  }

  /**
   * A payment with its allocations — the receipt's backing detail. Every
   * line is labelled here (fee head, description, due date; origin year for
   * a carried-forward portion) so a receipt never depends on a client cache.
   */
  async getPaymentDetail(scope: DataScope, paymentId: string): Promise<PaymentDetailOutput | null> {
    const [payment] = await db
      .select()
      .from(feePayments)
      .where(
        and(
          eq(feePayments.id, paymentId),
          scopeWhere(atSchoolLevel(scope), PAYMENT_SCOPE),
        ),
      );
    if (!payment) return null;

    const allocations = await db
      .select({
        installmentId: paymentAllocations.installmentId,
        amountAllocated: paymentAllocations.amountAllocated,
        feeHeadId: feeInstallments.feeHeadId,
        feeHeadName: feeHeads.name,
        description: feeInstallments.description,
        installmentNumber: feeInstallments.installmentNumber,
        dueDate: feeInstallments.dueDate,
      })
      .from(paymentAllocations)
      .innerJoin(
        feeInstallments,
        and(
          eq(feeInstallments.id, paymentAllocations.installmentId),
          eq(feeInstallments.schoolId, paymentAllocations.schoolId),
        ),
      )
      .innerJoin(
        feeHeads,
        and(
          eq(feeHeads.id, feeInstallments.feeHeadId),
          eq(feeHeads.schoolId, feeInstallments.schoolId),
        ),
      )
      .where(eq(paymentAllocations.paymentId, payment.id))
      .orderBy(
        asc(feeInstallments.dueDate),
        asc(feeHeads.name),
        asc(feeInstallments.installmentNumber),
      );

    const portions = await this.openingBalancePortions(db, payment);
    const balanceRows = portions.length
      ? await db
          .select({
            id: openingBalances.id,
            description: openingBalances.description,
            originAcademicYearId: openingBalances.originAcademicYearId,
            originAcademicYearName: academicYears.name,
          })
          .from(openingBalances)
          .innerJoin(academicYears, eq(academicYears.id, openingBalances.originAcademicYearId))
          .where(
            and(
              inArray(
                openingBalances.id,
                portions.map((p) => p.openingBalanceId),
              ),
              eq(openingBalances.schoolId, payment.schoolId),
            ),
          )
      : [];
    const balanceById = new Map(balanceRows.map((b) => [b.id, b]));
    const openingBalanceAllocations = portions.flatMap((p) => {
      const balance = balanceById.get(p.openingBalanceId);
      if (!balance) return [];
      return [
        {
          openingBalanceId: p.openingBalanceId,
          amountAllocated: p.amount,
          description: balance.description,
          originAcademicYearId: balance.originAcademicYearId,
          originAcademicYearName: balance.originAcademicYearName,
        },
      ];
    });

    return { payment, allocations, openingBalanceAllocations };
  }

  /**
   * THE LEDGER READ (hard rule 3's reason for existing): the single table
   * accountants query, per year, optionally per student. Append-only, so
   * there is no "history" question here — every row is history. Each row
   * carries its `cashEffect` (ADR-049) so Money in/out never counts a
   * receivable, and its student label so the list needs no lookup.
   */
  async listLedger(
    scopes: DataScope[],
    academicYearId: string,
    studentId?: string,
  ): Promise<FinancialTransactionListRow[]> {
    const rows = await db
      .select({
        row: financialTransactions,
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
        admissionNumber: students.admissionNumber,
        className: classes.name,
        sectionName: sections.name,
      })
      .from(financialTransactions)
      .leftJoin(
        students,
        and(
          eq(students.id, financialTransactions.studentId),
          eq(students.schoolId, financialTransactions.schoolId),
        ),
      )
      .leftJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.studentId, financialTransactions.studentId),
          eq(studentEnrollments.academicYearId, financialTransactions.academicYearId),
          eq(studentEnrollments.schoolId, financialTransactions.schoolId),
        ),
      )
      .leftJoin(classes, eq(classes.id, studentEnrollments.classId))
      .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), LEDGER_SCOPE),
          eq(financialTransactions.academicYearId, academicYearId),
          studentId ? eq(financialTransactions.studentId, studentId) : undefined,
        ),
      )
      .orderBy(asc(financialTransactions.transactionDate), asc(financialTransactions.createdAt));
    return rows.map((r) => ({
      ...r.row,
      cashEffect: ledgerCashEffect(r.row),
      studentName: r.firstName === null ? null : fullName({ ...r, firstName: r.firstName }),
      admissionNumber: r.admissionNumber,
      className: r.className,
      sectionName: r.sectionName,
    }));
  }

  /** Assignments feed the dues screen's student selector. */
  async getAssignmentForStudent(scope: DataScope, studentId: string, academicYearId: string) {
    const [assignment] = await db
      .select()
      .from(studentFeeAssignments)
      .where(
        and(
          eq(studentFeeAssignments.studentId, studentId),
          eq(studentFeeAssignments.academicYearId, academicYearId),
          scopeWhere(atSchoolLevel(scope), {
            organizationId: studentFeeAssignments.organizationId,
            schoolId: studentFeeAssignments.schoolId,
          }),
        ),
      );
    return assignment ?? null;
  }
}

export const feesCollectionService = new FeesCollectionService();
