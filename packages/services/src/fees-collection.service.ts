import { atSchoolLevel, requireSchoolId } from "./academic.service";
import { allocateOldestFirst, fromCents, toCents } from "./fees-maths";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  GatewayPaymentInput,
  PaymentTransitionInput,
  RecordPaymentInput,
  RecordRefundInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  feeInstallments,
  feePayments,
  feeRefunds,
  financialTransactions,
  paymentAllocations,
  receiptNumberSequences,
  studentFeeAssignments,
  students,
} from "@repo/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

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
 * history) and write their own ledger row; `cancelPayment` re-opens too but
 * writes NO ledger row, because a cancelled payment moved no money — the
 * audit trail is the payment row's own status triple.
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

/** The modes that confirm money at the desk; everything else enters `pending`. */
const IMMEDIATE_MODES = new Set(["cash"]);

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
  ) {
    const schoolId = requireSchoolId(scope);
    const allocationCents = input.allocations.reduce(
      (acc, a) => acc + toCents(a.amount),
      0n,
    );
    if (allocationCents <= 0n) {
      throw new Error("A payment must allocate a positive amount.");
    }
    const lateFeeCents = input.lateFeeAmount ? toCents(input.lateFeeAmount) : 0n;

    return db.transaction(async (tx) => {
      // Idempotency first — before the receipt sequence is touched, so a
      // replayed retry cannot even burn a number.
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
        if (existing) return existing;
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

      // The installments, ROW-LOCKED IN DETERMINISTIC ID ORDER — the deadlock
      // prevention. Balances are re-checked INSIDE the transaction.
      const allocationIds = input.allocations.map((a) => a.installmentId);
      const locked = await tx
        .select({
          id: feeInstallments.id,
          studentId: feeInstallments.studentId,
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

      const paymentStatus = IMMEDIATE_MODES.has(input.paymentMode)
        ? "cleared"
        : "pending";

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
          paymentMode: input.paymentMode,
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

      await tx.insert(paymentAllocations).values(
        input.allocations.map((a) => ({
          organizationId: scope.organizationId,
          schoolId,
          paymentId: payment.id,
          installmentId: a.installmentId,
          amountAllocated: a.amount,
        })),
      );

      await this.applyToInstallments(tx, input.allocations);

      // The ledger: the principal, then the frozen late fee if any. Hard rule
      // 3: inserts only.
      await tx.insert(financialTransactions).values({
        organizationId: scope.organizationId,
        schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        transactionType: "fee_payment",
        direction: "credit",
        amount: fromCents(allocationCents),
        referenceId: payment.id,
        referenceTable: "fee_payments",
        receiptNumber,
        description: `Fee payment ${receiptNumber}`,
        transactionDate: input.paymentDate,
        createdBy: actorId ?? null,
      });
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
   * Adds each allocation to its installment's paid_amount and restates the
   * status. Caller holds the row locks; shared by record (adds) and the
   * transition operations' re-open path (negatives).
   */
  private async applyToInstallments(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
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
   * The common skeleton of bounce/reverse/cancel: validate the current
   * status, flip it with the audit triple, and re-open the installments the
   * payment's allocations had reduced (the allocations themselves stay —
   * history). `withLedger` decides whether an offsetting row is written:
   * a bounce and a reversal are money events; a cancellation is not.
   */
  private async transitionPayment(
    scope: DataScope,
    input: PaymentTransitionInput,
    actorId: string,
    opts: {
      from: ("pending" | "cleared")[];
      to: "bounced" | "reversed" | "cancelled";
      transactionType: "cheque_bounce_charge" | "fee_refund" | null;
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

      const allocations = await tx
        .select({
          installmentId: paymentAllocations.installmentId,
          amountAllocated: paymentAllocations.amountAllocated,
        })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, payment.id));

      // Re-open: every allocation's amount comes BACK OFF the installment.
      await this.applyToInstallments(
        tx,
        allocations.map((a) => ({
          installmentId: a.installmentId,
          amount: `-${a.amountAllocated}`,
        })),
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

      if (opts.transactionType) {
        await tx.insert(financialTransactions).values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: payment.studentId,
          academicYearId: payment.academicYearId,
          transactionType: opts.transactionType,
          direction: "debit",
          amount: payment.amount,
          referenceId: payment.id,
          referenceTable: "fee_payments",
          receiptNumber: payment.receiptNumber,
          description: `${input.reason} (${payment.receiptNumber})`,
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

  /** A pending payment withdrawn before confirmation. No ledger row: no money moved. */
  async cancelPayment(scope: DataScope, input: PaymentTransitionInput, actorId: string) {
    return this.transitionPayment(scope, input, actorId, {
      from: ["pending"],
      to: "cancelled",
      transactionType: null,
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

      const priorRefunds = await tx
        .select({ refundAmount: feeRefunds.refundAmount })
        .from(feeRefunds)
        .where(eq(feeRefunds.originalPaymentId, payment.id));
      const alreadyRefunded = priorRefunds.reduce(
        (acc, r) => acc + toCents(r.refundAmount),
        0n,
      );
      const refundable = toCents(payment.amount) - alreadyRefunded;
      if (refundCents > refundable) {
        throw new Error(
          `The refund exceeds what this payment still holds. Refundable: ${fromCents(refundable)}.`,
        );
      }

      const allocations = await tx
        .select({
          installmentId: paymentAllocations.installmentId,
          amountAllocated: paymentAllocations.amountAllocated,
        })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, payment.id));

      // Walk the allocations oldest-first, taking back up to the refund.
      let remaining = refundCents;
      const deltas: { installmentId: string; amount: string }[] = [];
      for (const a of allocations) {
        if (remaining <= 0n) break;
        const allocCents = toCents(a.amountAllocated);
        const take = allocCents < remaining ? allocCents : remaining;
        deltas.push({
          installmentId: a.installmentId,
          amount: `-${fromCents(take)}`,
        });
        remaining -= take;
      }
      await this.applyToInstallments(tx, deltas);

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
        paymentMode: "online_portal",
        allocations: allocations.map((a) => ({
          installmentId: a.installmentId,
          amount: fromCents(a.amountCents),
        })),
        clientReference: input.gatewayOrderId,
        remarks: "Portal payment (gateway webhook)",
      },
      null, // the system context is not a user row (ADR-009)
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
  ) {
    return db
      .select()
      .from(feePayments)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), PAYMENT_SCOPE),
          eq(feePayments.academicYearId, academicYearId),
          studentId ? eq(feePayments.studentId, studentId) : undefined,
        ),
      )
      .orderBy(asc(feePayments.paymentDate));
  }

  /** A payment with its allocations — the receipt's backing detail. */
  async getPaymentDetail(scope: DataScope, paymentId: string) {
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
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payment.id));

    return { payment, allocations };
  }

  /**
   * THE LEDGER READ (hard rule 3's reason for existing): the single table
   * accountants query, per year, optionally per student. Append-only, so
   * there is no "history" question here — every row is history.
   */
  async listLedger(
    scopes: DataScope[],
    academicYearId: string,
    studentId?: string,
  ) {
    return db
      .select()
      .from(financialTransactions)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), LEDGER_SCOPE),
          eq(financialTransactions.academicYearId, academicYearId),
          studentId ? eq(financialTransactions.studentId, studentId) : undefined,
        ),
      )
      .orderBy(asc(financialTransactions.transactionDate));
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
