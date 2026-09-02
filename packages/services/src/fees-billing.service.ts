import { atSchoolLevel, requireSchoolId } from "./academic.service";
import {
  apportionHeadTotal,
  fromCents,
  headConcessionTotals,
  isoOf,
  monthsBetween,
  splitIntoBuckets,
  toCents,
} from "./fees-maths";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  AssignFeeStructureInput,
  CreateOpeningBalanceInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  feeConcessions,
  feeHeads,
  feeInstallments,
  feeStructureLines,
  feeStructures,
  financialTransactions,
  openingBalances,
  studentEnrollments,
  studentFeeAssignments,
  studentOptionalFeeSubscriptions,
  terms,
} from "@repo/db/schema";
import { and, asc, eq } from "drizzle-orm";

/**
 * FEES — the billing engine. Phase 4, chunk F4.
 *
 * The engine that turns a class's fee template into a student's concrete
 * dues. Three movements, in order:
 *
 *   assignFeeStructure      resolve a structure onto an enrollment —
 *                           snapshot the totals (DOMAIN.md §5's opening
 *                           promise: October's revision must not touch
 *                           already-raised invoices)
 *   generateInstallments    split each line's annual amount into buckets
 *                           (term-wise / monthly / quarterly / …), slice off
 *                           anything before the mid-session effective date,
 *                           apportion the concessions, write installments
 *                           IDEMPOTENTLY (re-runs fill what is missing)
 *   recomputeAssignmentConcessions
 *                           concessions added after generation re-apportion
 *                           the FUTURE (never-paid) installments only —
 *                           money already received is not renegotiated
 *
 * The MATHS is pure, in `fees-maths.ts` (no database imports) and unit-tested
 * there hermetically; the methods here are thin wrappers that load facts and
 * call it. Concurrency and the ledger's payment rows are F5's; idempotency
 * here is the generator's own (ON CONFLICT DO NOTHING on the installment
 * triple — re-runs fill what is missing, never duplicate).
 *
 * Money arithmetic is BigInt paise end to end (hard rule 4).
 */

const ASSIGNMENT_SCOPE: ScopeColumns = {
  organizationId: studentFeeAssignments.organizationId,
  schoolId: studentFeeAssignments.schoolId,
};
const OPENING_BALANCE_SCOPE: ScopeColumns = {
  organizationId: openingBalances.organizationId,
  schoolId: openingBalances.schoolId,
};

export class FeesBillingService {
  /**
   * Resolves the enrollment's class structure onto the student: the unique
   * active structure for (school, year, class) is found — not named — so a
   * caller cannot assign a structure of another class or branch. Totals are
   * SNAPSHOTTED from the lines; later structure edits never reach this row.
   * `net_annual_amount` starts equal to the base: concessions are recorded
   * against the assignment afterwards and recompute the net.
   */
  async assignFeeStructure(
    scope: DataScope,
    input: AssignFeeStructureInput,
    actorId: string,
  ) {
    const schoolId = requireSchoolId(scope);

    const [enrollment] = await db
      .select({
        id: studentEnrollments.id,
        studentId: studentEnrollments.studentId,
        academicYearId: studentEnrollments.academicYearId,
        classId: studentEnrollments.classId,
      })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.id, input.enrollmentId),
          eq(studentEnrollments.schoolId, schoolId),
        ),
      );
    if (!enrollment) {
      throw new Error("Enrollment not found in this school.");
    }

    const [structure] = await db
      .select({ id: feeStructures.id })
      .from(feeStructures)
      .where(
        and(
          eq(feeStructures.schoolId, schoolId),
          eq(feeStructures.academicYearId, enrollment.academicYearId),
          eq(feeStructures.classId, enrollment.classId),
          eq(feeStructures.isActive, true),
        ),
      );
    if (!structure) {
      throw new Error(
        "This class has no active fee structure for the year, so there is nothing to assign.",
      );
    }

    const lines = await db
      .select({ annualAmount: feeStructureLines.annualAmount })
      .from(feeStructureLines)
      .where(eq(feeStructureLines.feeStructureId, structure.id));
    const baseCents = lines.reduce((acc, l) => acc + toCents(l.annualAmount), 0n);

    const effectiveFrom =
      input.feeEffectiveFrom ?? (await this.enrollmentEffectiveFrom(enrollment.id));

    const [assignment] = await db
      .insert(studentFeeAssignments)
      .values({
        organizationId: scope.organizationId,
        schoolId,
        studentId: enrollment.studentId,
        enrollmentId: enrollment.id,
        academicYearId: enrollment.academicYearId,
        feeStructureId: structure.id,
        baseAnnualAmount: fromCents(baseCents),
        netAnnualAmount: fromCents(baseCents),
        feeEffectiveFrom: effectiveFrom,
        joiningMonthFullCharge: input.joiningMonthFullCharge ?? true,
        createdBy: actorId,
      })
      .returning();

    if (!assignment) {
      throw new Error("Failed to create fee assignment.");
    }
    return assignment;
  }

  private async enrollmentEffectiveFrom(enrollmentId: string): Promise<string> {
    const [row] = await db
      .select({ enrollmentDate: studentEnrollments.enrollmentDate })
      .from(studentEnrollments)
      .where(eq(studentEnrollments.id, enrollmentId));
    return row?.enrollmentDate ?? new Date().toISOString().slice(0, 10);
  }

  /**
   * THE GENERATOR — idempotent by construction: it derives the full desired
   * installment set and inserts with ON CONFLICT DO NOTHING on the
   * (assignment, head, number) triple, so re-runs fill what is missing and
   * never duplicate or rewrite what exists. A structure or concession change
   * reaches the student through `recomputeAssignmentConcessions` (for money)
   * — never by silent regeneration.
   */
  async generateInstallments(scope: DataScope, assignmentId: string) {
    const schoolId = requireSchoolId(scope);

    const [assignment] = await db
      .select()
      .from(studentFeeAssignments)
      .where(
        and(
          eq(studentFeeAssignments.id, assignmentId),
          scopeWhere(atSchoolLevel(scope), ASSIGNMENT_SCOPE),
        ),
      );
    if (!assignment) {
      throw new Error("Fee assignment not found in this school.");
    }

    const [structure] = await db
      .select()
      .from(feeStructures)
      .where(eq(feeStructures.id, assignment.feeStructureId));
    if (!structure) {
      throw new Error("The assigned fee structure no longer exists.");
    }

    const lines = await db
      .select({
        feeHeadId: feeStructureLines.feeHeadId,
        annualAmount: feeStructureLines.annualAmount,
        installmentFrequency: feeStructureLines.installmentFrequency,
        applicableFromMonth: feeStructureLines.applicableFromMonth,
        applicableToMonth: feeStructureLines.applicableToMonth,
        headName: feeHeads.name,
      })
      .from(feeStructureLines)
      .innerJoin(feeHeads, eq(feeHeads.id, feeStructureLines.feeHeadId))
      .where(eq(feeStructureLines.feeStructureId, structure.id));

    const [year] = await db
      .select()
      .from(academicYears)
      .where(eq(academicYears.id, assignment.academicYearId));
    if (!year) {
      throw new Error("The assignment's academic year no longer exists.");
    }

    const yearTerms = await db
      .select({
        id: terms.id,
        name: terms.name,
        startDate: terms.startDate,
        endDate: terms.endDate,
        weightage: terms.weightage,
      })
      .from(terms)
      .where(eq(terms.academicYearId, year.id))
      .orderBy(asc(terms.sequenceNumber));

    const concessions = await db
      .select({
        feeHeadId: feeConcessions.feeHeadId,
        concessionAmount: feeConcessions.concessionAmount,
      })
      .from(feeConcessions)
      .where(eq(feeConcessions.studentFeeAssignmentId, assignment.id));

    const subscriptions = await db
      .select()
      .from(studentOptionalFeeSubscriptions)
      .where(
        and(
          eq(studentOptionalFeeSubscriptions.studentId, assignment.studentId),
          eq(studentOptionalFeeSubscriptions.academicYearId, assignment.academicYearId),
          eq(studentOptionalFeeSubscriptions.status, "active"),
        ),
      );

    // Per-head concession totals across the lines' annuals.
    const headAnnuals = lines.map((l) => ({
      feeHeadId: l.feeHeadId,
      annualCents: toCents(l.annualAmount),
    }));
    const concessionTotals = headConcessionTotals(
      concessions.map((c) => ({
        feeHeadId: c.feeHeadId,
        amountCents: toCents(c.concessionAmount),
      })),
      headAnnuals,
    );

    type Desired = {
      feeHeadId: string;
      installmentNumber: number;
      amount: string;
      concessionAmount: string;
      netAmount: string;
      dueDate: string;
      description: string;
      periodMonth: number | null;
      periodYear: number | null;
      termId: string | null;
    };
    const desired: Desired[] = [];

    for (const line of lines) {
      const annualCents = toCents(line.annualAmount);
      const buckets = splitIntoBuckets({
        annualAmountCents: annualCents,
        frequency: line.installmentFrequency,
        structureMode: structure.installmentMode,
        applicableFromMonth: line.applicableFromMonth,
        applicableToMonth: line.applicableToMonth,
        yearStart: year.startDate,
        yearEnd: year.endDate,
        effectiveFrom: assignment.feeEffectiveFrom,
        joiningMonthFullCharge: assignment.joiningMonthFullCharge,
        feeHeadId: line.feeHeadId,
        headName: line.headName,
        terms: yearTerms,
      });
      const headTotal = concessionTotals.get(line.feeHeadId) ?? 0n;
      const shares = apportionHeadTotal(
        headTotal,
        buckets.map((b) => b.amountCents),
      );
      buckets.forEach((b, i) => {
        const concessionCents = shares[i] ?? 0n;
        desired.push({
          feeHeadId: line.feeHeadId,
          installmentNumber: b.installmentNumber,
          amount: fromCents(b.amountCents),
          concessionAmount: fromCents(concessionCents),
          netAmount: fromCents(b.amountCents - concessionCents),
          dueDate: b.dueDate,
          description: b.description,
          periodMonth: b.periodMonth,
          periodYear: b.periodYear,
          termId: b.termId,
        });
      });
    }

    // Subscriptions bill monthly at their own price, from their own window
    // (clamped to the year and the assignment's effective date).
    for (const sub of subscriptions) {
      const from = [sub.subscribedFrom, year.startDate, assignment.feeEffectiveFrom]
        .sort()
        .pop();
      const to =
        sub.subscribedTo && sub.subscribedTo < year.endDate
          ? sub.subscribedTo
          : year.endDate;
      if (!from || from > to) continue;
      const months = monthsBetween(from, to);
      const monthlyCents = toCents(sub.monthlyAmount);
      months.forEach((m, i) => {
        desired.push({
          feeHeadId: sub.feeHeadId,
          installmentNumber: i + 1,
          amount: fromCents(monthlyCents),
          concessionAmount: "0.00",
          netAmount: fromCents(monthlyCents),
          dueDate: isoOf(m.year, m.month, 1),
          description: `${sub.serviceDetail ?? "Optional service"} — ${isoOf(m.year, m.month, 1).slice(0, 7)}`,
          periodMonth: m.month,
          periodYear: m.year,
          termId: null,
        });
      });
    }

    if (desired.length === 0) return { inserted: 0 };

    const inserted = await db
      .insert(feeInstallments)
      .values(
        desired.map((d) => ({
          organizationId: assignment.organizationId,
          schoolId: assignment.schoolId,
          studentFeeAssignmentId: assignment.id,
          studentId: assignment.studentId,
          academicYearId: assignment.academicYearId,
          feeHeadId: d.feeHeadId,
          installmentNumber: d.installmentNumber,
          description: d.description,
          amount: d.amount,
          concessionAmount: d.concessionAmount,
          netAmount: d.netAmount,
          dueDate: d.dueDate,
          periodMonth: d.periodMonth,
          periodYear: d.periodYear,
          termId: d.termId,
        })),
      )
      .onConflictDoNothing({
        target: [
          feeInstallments.studentFeeAssignmentId,
          feeInstallments.feeHeadId,
          feeInstallments.installmentNumber,
        ],
      })
      .returning({ id: feeInstallments.id });

    return { inserted: inserted.length };
  }

  /**
   * Re-apportions concessions AFTER generation. The rule that makes this
   * legal: only NEVER-PAID installments are recomputed (paid_amount = 0 AND
   * status = 'unpaid') — money already received is not renegotiated, and a
   * partially-paid installment keeps its historical concession share. The
   * assignment's `net_annual_amount` is restated to the base minus the
   * concession totals, whether or not every installment could move.
   */
  async recomputeAssignmentConcessions(scope: DataScope, assignmentId: string) {
    const schoolId = requireSchoolId(scope);

    const [assignment] = await db
      .select()
      .from(studentFeeAssignments)
      .where(
        and(
          eq(studentFeeAssignments.id, assignmentId),
          scopeWhere(atSchoolLevel(scope), ASSIGNMENT_SCOPE),
        ),
      );
    if (!assignment) {
      throw new Error("Fee assignment not found in this school.");
    }

    const lines = await db
      .select({
        feeHeadId: feeStructureLines.feeHeadId,
        annualAmount: feeStructureLines.annualAmount,
      })
      .from(feeStructureLines)
      .where(eq(feeStructureLines.feeStructureId, assignment.feeStructureId));

    const concessions = await db
      .select({
        feeHeadId: feeConcessions.feeHeadId,
        concessionAmount: feeConcessions.concessionAmount,
      })
      .from(feeConcessions)
      .where(eq(feeConcessions.studentFeeAssignmentId, assignment.id));

    const headAnnuals = lines.map((l) => ({
      feeHeadId: l.feeHeadId,
      annualCents: toCents(l.annualAmount),
    }));
    const concessionTotals = headConcessionTotals(
      concessions.map((c) => ({
        feeHeadId: c.feeHeadId,
        amountCents: toCents(c.concessionAmount),
      })),
      headAnnuals,
    );

    const installments = await db
      .select({
        id: feeInstallments.id,
        feeHeadId: feeInstallments.feeHeadId,
        installmentNumber: feeInstallments.installmentNumber,
        amount: feeInstallments.amount,
        paidAmount: feeInstallments.paidAmount,
        paymentStatus: feeInstallments.paymentStatus,
      })
      .from(feeInstallments)
      .where(eq(feeInstallments.studentFeeAssignmentId, assignment.id))
      .orderBy(asc(feeInstallments.installmentNumber));

    await db.transaction(async (tx) => {
      for (const line of lines) {
        const headInstallments = installments.filter((i) => i.feeHeadId === line.feeHeadId);
        const headTotal = concessionTotals.get(line.feeHeadId) ?? 0n;
        const shares = apportionHeadTotal(
          headTotal,
          headInstallments.map((i) => toCents(i.amount)),
        );
        for (let idx = 0; idx < headInstallments.length; idx++) {
          const inst = headInstallments[idx];
          const share = shares[idx] ?? 0n;
          if (!inst) continue;
          const frozen = inst.paymentStatus !== "unpaid" || inst.paidAmount !== "0.00";
          if (frozen) continue;
          const amountCents = toCents(inst.amount);
          await tx
            .update(feeInstallments)
            .set({
              concessionAmount: fromCents(share),
              netAmount: fromCents(amountCents - share),
            })
            .where(eq(feeInstallments.id, inst.id));
        }
      }

      const totalConcessions = [...concessionTotals.values()].reduce((a, b) => a + b, 0n);
      const baseCents = toCents(assignment.baseAnnualAmount);
      const net = totalConcessions > baseCents ? 0n : baseCents - totalConcessions;
      await tx
        .update(studentFeeAssignments)
        .set({ netAnnualAmount: fromCents(net) })
        .where(eq(studentFeeAssignments.id, assignment.id));
    });

    return { recomputed: true };
  }

  // -------------------------------------------------------------------------
  // Opening balances
  // -------------------------------------------------------------------------

  /**
   * Carries dues into a year, tagged with the year they came FROM, and writes
   * the `opening_balance` ledger row in the SAME transaction — every money
   * movement hits the ledger, and a balance without its ledger row is the
   * kind of drift the accountants' reconciliation exists to catch.
   */
  async createOpeningBalance(
    scope: DataScope,
    input: CreateOpeningBalanceInput,
    actorId: string,
  ) {
    const schoolId = requireSchoolId(scope);

    if (input.academicYearId === input.originAcademicYearId) {
      throw new Error("An opening balance cannot originate from the year it lands in.");
    }

    return db.transaction(async (tx) => {
      const [balance] = await tx
        .insert(openingBalances)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: input.studentId,
          academicYearId: input.academicYearId,
          originAcademicYearId: input.originAcademicYearId,
          amount: input.amount,
          description: input.description ?? null,
          createdBy: actorId,
        })
        .returning();

      if (!balance) {
        throw new Error("Failed to record opening balance.");
      }

      await tx.insert(financialTransactions).values({
        organizationId: scope.organizationId,
        schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        transactionType: "opening_balance",
        direction: "credit",
        amount: input.amount,
        referenceId: balance.id,
        referenceTable: "opening_balances",
        description: input.description ?? "Opening balance carried forward",
        transactionDate: new Date().toISOString().slice(0, 10),
        createdBy: actorId,
      });

      return balance;
    });
  }

  /** The year's opening balances — the accountant's carry-forward view. */
  async listOpeningBalances(
    scopes: DataScope[],
    academicYearId: string,
    studentId?: string,
  ) {
    return db
      .select()
      .from(openingBalances)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), OPENING_BALANCE_SCOPE),
          eq(openingBalances.academicYearId, academicYearId),
          studentId ? eq(openingBalances.studentId, studentId) : undefined,
        ),
      )
      .orderBy(asc(openingBalances.createdAt));
  }
}

export const feesBillingService = new FeesBillingService();
