import { atSchoolLevel, requireSchoolId } from "./academic.service";
import {
  fromCents,
  isoOf,
  monthsBetween,
  splitIntoBuckets,
  toCents,
  windowedConcessionShares,
} from "./fees-maths";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  AssignFeeStructureInput,
  BillClassInput,
  BillClassOutput,
  CreateOpeningBalanceInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  feeConcessions,
  feeHeads,
  feeInstallments,
  feeStructureLines,
  feeStructures,
  financialTransactions,
  openingBalances,
  sections,
  studentEnrollments,
  studentFeeAssignments,
  studentOptionalFeeSubscriptions,
  students,
  terms,
} from "@repo/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The pool or an open transaction — billClass runs each student in one. */
type Executor = typeof db | Tx;

/** Enrollment states that mean the student has left the class for the year. */
const NOT_ENROLLED_REASONS: Record<string, string> = {
  transferred_out: "Not enrolled: transferred out.",
  withdrawn: "Not enrolled: withdrawn.",
  passed_out: "Not enrolled: passed out.",
};

/** Postgres unique_violation, wherever drizzle nested it in the cause chain. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

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
    exec: Executor = db,
  ) {
    const schoolId = requireSchoolId(scope);

    const [enrollment] = await exec
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

    const [structure] = await exec
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

    const lines = await exec
      .select({ annualAmount: feeStructureLines.annualAmount })
      .from(feeStructureLines)
      .where(eq(feeStructureLines.feeStructureId, structure.id));
    const baseCents = lines.reduce((acc, l) => acc + toCents(l.annualAmount), 0n);

    const effectiveFrom =
      input.feeEffectiveFrom ?? (await this.enrollmentEffectiveFrom(enrollment.id, exec));

    const [assignment] = await exec
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

  /**
   * "Bill all students in this class" — the bulk form of assign + generate.
   * Class, year and section are RE-READ through the caller's school first
   * (their FKs never mention school_id), so a caller cannot bill another
   * branch's class. Then every enrollment of the class (and section) in the
   * year is sorted into exactly one bucket:
   *
   *   skipped   it already has an active assignment — a second run bills
   *             nobody, which is what makes the button safe to press twice
   *   refused   it has left (transferred out / withdrawn / passed out), or
   *             its assignment is suspended or cancelled (the one-per-year
   *             index forbids a second; restoring it is a per-student call)
   *   billed    assign + generate in ONE transaction, so a student is never
   *             left assigned without dues
   *
   * A class with no active structure refuses as a whole. A concurrent run
   * that billed a student first trips the unique index; that student rolls
   * back and is reported as skipped.
   */
  async billClass(
    scope: DataScope,
    input: BillClassInput,
    actorId: string,
  ): Promise<BillClassOutput> {
    const schoolId = requireSchoolId(scope);

    const [klass] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, input.classId), eq(classes.schoolId, schoolId)));
    if (!klass) {
      throw new Error("Class not found in this school.");
    }

    const [year] = await db
      .select({ id: academicYears.id })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, input.academicYearId),
          eq(academicYears.schoolId, schoolId),
        ),
      );
    if (!year) {
      throw new Error("Academic year not found in this school.");
    }

    if (input.sectionId) {
      const [section] = await db
        .select({ classId: sections.classId })
        .from(sections)
        .where(and(eq(sections.id, input.sectionId), eq(sections.schoolId, schoolId)));
      if (!section) {
        throw new Error("Section not found in this school.");
      }
      if (section.classId !== input.classId) {
        throw new Error("The section is not in the class being billed.");
      }
    }

    const result: BillClassOutput = {
      feeStructureId: null,
      refusal: null,
      billedCount: 0,
      skippedCount: 0,
      refusedCount: 0,
      billed: [],
      skipped: [],
      refused: [],
    };

    const [structure] = await db
      .select({ id: feeStructures.id })
      .from(feeStructures)
      .where(
        and(
          eq(feeStructures.schoolId, schoolId),
          eq(feeStructures.academicYearId, input.academicYearId),
          eq(feeStructures.classId, input.classId),
          eq(feeStructures.isActive, true),
        ),
      );
    if (!structure) {
      result.refusal =
        "No active fee chart for this class this session, so there is nothing to bill.";
      return result;
    }
    result.feeStructureId = structure.id;

    const enrollments = await db
      .select({
        enrollmentId: studentEnrollments.id,
        studentId: studentEnrollments.studentId,
        enrollmentStatus: studentEnrollments.enrollmentStatus,
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
        admissionNumber: students.admissionNumber,
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          eq(studentEnrollments.schoolId, schoolId),
          eq(studentEnrollments.academicYearId, input.academicYearId),
          eq(studentEnrollments.classId, input.classId),
          input.sectionId ? eq(studentEnrollments.sectionId, input.sectionId) : undefined,
        ),
      )
      .orderBy(asc(students.firstName), asc(students.lastName));

    const existing =
      enrollments.length === 0
        ? []
        : await db
            .select({
              id: studentFeeAssignments.id,
              studentId: studentFeeAssignments.studentId,
              status: studentFeeAssignments.status,
            })
            .from(studentFeeAssignments)
            .where(
              and(
                eq(studentFeeAssignments.schoolId, schoolId),
                eq(studentFeeAssignments.academicYearId, input.academicYearId),
                inArray(
                  studentFeeAssignments.studentId,
                  enrollments.map((e) => e.studentId),
                ),
              ),
            );
    const assignmentOf = new Map(existing.map((a) => [a.studentId, a]));

    for (const e of enrollments) {
      const who = {
        studentId: e.studentId,
        enrollmentId: e.enrollmentId,
        studentName: [e.firstName, e.middleName, e.lastName]
          .filter((part): part is string => Boolean(part))
          .join(" "),
        admissionNumber: e.admissionNumber,
      };

      const notEnrolled = NOT_ENROLLED_REASONS[e.enrollmentStatus];
      if (notEnrolled) {
        result.refused.push({ ...who, reason: notEnrolled });
        continue;
      }

      const prior = assignmentOf.get(e.studentId);
      if (prior?.status === "active") {
        result.skipped.push({ ...who, assignmentId: prior.id });
        continue;
      }
      if (prior) {
        result.refused.push({
          ...who,
          reason: `Fee billing is ${prior.status} for this student. Restore it from the student's page.`,
        });
        continue;
      }

      try {
        const billed = await db.transaction(async (tx) => {
          const assignment = await this.assignFeeStructure(
            scope,
            { enrollmentId: e.enrollmentId },
            actorId,
            tx,
          );
          const { inserted } = await this.generateInstallments(scope, assignment.id, tx);
          return { assignmentId: assignment.id, installmentsCreated: inserted };
        });
        result.billed.push({ ...who, ...billed });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Billed by a concurrent run between our read and our insert.
        const [winner] = await db
          .select({ id: studentFeeAssignments.id })
          .from(studentFeeAssignments)
          .where(
            and(
              eq(studentFeeAssignments.schoolId, schoolId),
              eq(studentFeeAssignments.studentId, e.studentId),
              eq(studentFeeAssignments.academicYearId, input.academicYearId),
            ),
          );
        if (!winner) throw error;
        result.skipped.push({ ...who, assignmentId: winner.id });
      }
    }

    result.billedCount = result.billed.length;
    result.skippedCount = result.skipped.length;
    result.refusedCount = result.refused.length;
    return result;
  }

  private async enrollmentEffectiveFrom(
    enrollmentId: string,
    exec: Executor = db,
  ): Promise<string> {
    const [row] = await exec
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
  async generateInstallments(
    scope: DataScope,
    assignmentId: string,
    exec: Executor = db,
  ) {
    const schoolId = requireSchoolId(scope);

    const [assignment] = await exec
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

    const [structure] = await exec
      .select()
      .from(feeStructures)
      .where(eq(feeStructures.id, assignment.feeStructureId));
    if (!structure) {
      throw new Error("The assigned fee structure no longer exists.");
    }

    const lines = await exec
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

    const [year] = await exec
      .select()
      .from(academicYears)
      .where(eq(academicYears.id, assignment.academicYearId));
    if (!year) {
      throw new Error("The assignment's academic year no longer exists.");
    }

    const yearTerms = await exec
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

    const concessions = await exec
      .select({
        feeHeadId: feeConcessions.feeHeadId,
        concessionAmount: feeConcessions.concessionAmount,
        validFrom: feeConcessions.validFrom,
        validTo: feeConcessions.validTo,
      })
      .from(feeConcessions)
      .where(eq(feeConcessions.studentFeeAssignmentId, assignment.id))
      .orderBy(asc(feeConcessions.createdAt));

    const subscriptions = await exec
      .select()
      .from(studentOptionalFeeSubscriptions)
      .where(
        and(
          eq(studentOptionalFeeSubscriptions.studentId, assignment.studentId),
          eq(studentOptionalFeeSubscriptions.academicYearId, assignment.academicYearId),
          eq(studentOptionalFeeSubscriptions.status, "active"),
        ),
      );

    // Per-head annuals for the windowed apportionment (S2/F5).
    const headAnnuals = lines.map((l) => ({
      feeHeadId: l.feeHeadId,
      annualCents: toCents(l.annualAmount),
    }));
    const concessionInputs = concessions.map((c) => ({
      feeHeadId: c.feeHeadId,
      amountCents: toCents(c.concessionAmount),
      validFrom: c.validFrom,
      validTo: c.validTo,
    }));

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
      const shares = windowedConcessionShares(
        concessionInputs,
        line.feeHeadId,
        buckets.map((b) => ({ dueDate: b.dueDate, amountCents: b.amountCents })),
        headAnnuals,
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

    const inserted = await exec
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
        validFrom: feeConcessions.validFrom,
        validTo: feeConcessions.validTo,
      })
      .from(feeConcessions)
      .where(eq(feeConcessions.studentFeeAssignmentId, assignment.id))
      .orderBy(asc(feeConcessions.createdAt));

    const headAnnuals = lines.map((l) => ({
      feeHeadId: l.feeHeadId,
      annualCents: toCents(l.annualAmount),
    }));
    const concessionInputs = concessions.map((c) => ({
      feeHeadId: c.feeHeadId,
      amountCents: toCents(c.concessionAmount),
      validFrom: c.validFrom,
      validTo: c.validTo,
    }));

    const installments = await db
      .select({
        id: feeInstallments.id,
        feeHeadId: feeInstallments.feeHeadId,
        installmentNumber: feeInstallments.installmentNumber,
        amount: feeInstallments.amount,
        dueDate: feeInstallments.dueDate,
        paidAmount: feeInstallments.paidAmount,
        paymentStatus: feeInstallments.paymentStatus,
      })
      .from(feeInstallments)
      .where(eq(feeInstallments.studentFeeAssignmentId, assignment.id))
      .orderBy(asc(feeInstallments.installmentNumber));

    // Share PLANNING is pure math from the pre-tx reads; the WRITE decision
    // comes from locked rows inside the transaction (S2/F6). Grouped by head
    // over ALL installments (not just current lines) so a mid-year deleted
    // line's rows still count toward the restated net (F7's drift, audited
    // rather than dropped); heads outside the lines plan to zero shares.
    const headGroups = new Map<
      string,
      { id: string; dueDate: string; amountCents: bigint }[]
    >();
    for (const i of installments) {
      const group = headGroups.get(i.feeHeadId) ?? [];
      group.push({
        id: i.id,
        dueDate: i.dueDate,
        amountCents: toCents(i.amount),
      });
      headGroups.set(i.feeHeadId, group);
    }
    const planned = new Map<string, bigint>();
    for (const [headId, headBuckets] of [...headGroups.entries()].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const shares = windowedConcessionShares(
        concessionInputs,
        headId,
        headBuckets,
        headAnnuals,
      );
      headBuckets.forEach((b, k) => planned.set(b.id, shares[k] ?? 0n));
    }

    await db.transaction(async (tx) => {
      // S2 (F6): re-derive frozen-ness from LOCKED rows. A payment committing
      // between the pre-tx read and this write can no longer be restated
      // under — the 0012 paid_capped CHECK stays as the loud backstop.
      let totalApplied = 0n;
      for (const headId of [...headGroups.keys()].sort()) {
        const locked = await tx
          .select({
            id: feeInstallments.id,
            amount: feeInstallments.amount,
            concessionAmount: feeInstallments.concessionAmount,
            paidAmount: feeInstallments.paidAmount,
            paymentStatus: feeInstallments.paymentStatus,
          })
          .from(feeInstallments)
          .where(
            and(
              eq(feeInstallments.studentFeeAssignmentId, assignment.id),
              eq(feeInstallments.feeHeadId, headId),
            ),
          )
          .orderBy(asc(feeInstallments.installmentNumber))
          .for("update");
        for (const row of locked) {
          const frozen =
            row.paymentStatus !== "unpaid" || row.paidAmount !== "0.00";
          if (frozen) {
            totalApplied += toCents(row.concessionAmount);
            continue;
          }
          const amountCents = toCents(row.amount);
          const raw = planned.get(row.id) ?? 0n;
          const share = raw > amountCents ? amountCents : raw;
          totalApplied += share;
          await tx
            .update(feeInstallments)
            .set({
              concessionAmount: fromCents(share),
              netAmount: fromCents(amountCents - share),
            })
            .where(eq(feeInstallments.id, row.id));
        }
      }

      // The header tracks what the installments actually carry (windowed and
      // frozen-aware), not the window-ignorant head totals — with windows, a
      // concession can cover fewer buckets than its full amount.
      const baseCents = toCents(assignment.baseAnnualAmount);
      const net = totalApplied > baseCents ? 0n : baseCents - totalApplied;
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
