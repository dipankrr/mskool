import { atSchoolLevel, requireSchoolId } from "./academic.service";
import { ENROLLED_STATUSES, todayInIst } from "./enrollment-status";
import {
  concessionKey,
  concessionShares,
  dueDateIn,
  endOfMonthIso,
  fromCents,
  monthKey,
  monthsBetween,
  planDues,
  toCents,
  type ConcessionRule,
  type LineFrequency,
  type PlannedDue,
  type ScheduleRow,
} from "./fees-maths";
import { refuse } from "./service-error";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  AssignFeeStructureInput,
  BillClassInput,
  BillClassOutput,
  CreateOneOffChargeInput,
  CreateOpeningBalanceInput,
  StartFeeDuesRunInput,
  VoidOpeningBalanceInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  feeConcessions,
  feeDuesRuns,
  feeHeads,
  feeInstallments,
  feeLinePeriods,
  feeSessionSettings,
  feeStructureLines,
  feeStructureSections,
  feeStructures,
  financialTransactions,
  openingBalances,
  receiptNumberSequences,
  schools,
  sections,
  studentEnrollments,
  studentFeeAssignments,
  studentOptionalFeeSubscriptions,
  students,
} from "@repo/db/schema";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getRedis } from "@repo/authz";

/**
 * FEES: the billing engine.
 *
 *   A fee line's schedule (`fee_line_periods`) says what is charged and when.
 *   Billing gives a student a fee record, which names their structure and the
 *   date billing starts from. The generator turns that into dues, creating
 *   only what is missing, as far ahead as the school's timing setting says.
 *
 * A created due never changes because of a structure edit: it carries its own
 * amount. The MATHS is pure, in `fees-maths.ts`, and unit-tested there; the
 * methods here load facts and call it. Idempotency is the generator's own (ON
 * CONFLICT DO NOTHING on assignment, head and period).
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
const INSTALLMENT_SCOPE: ScopeColumns = {
  organizationId: feeInstallments.organizationId,
  schoolId: feeInstallments.schoolId,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The pool or an open transaction. */
type Executor = typeof db | Tx;

/** Enrollment states that mean the student has left the class for the year. */
const NOT_ENROLLED_REASONS: Record<string, string> = {
  transferred_out: "Not enrolled: transferred out.",
  withdrawn: "Not enrolled: withdrawn.",
  expelled: "Not enrolled: expelled.",
  graduated: "Not enrolled: graduated.",
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

/** Redis lease for the monthly sweep (ADR-051), as the homework sweeper. */
const FEES_SWEEP_LEASE_KEY = "lock:fees-monthly-sweep";
const FEES_SWEEP_LEASE_TTL_MS = 10 * 60_000;
/** A run still "running" after this was cut off by a restart. */
const DUES_RUN_STALE_MS = 30 * 60_000;

export type FeeGenerationMode = "monthly_auto" | "monthly_manual";

type AssignmentRow = typeof studentFeeAssignments.$inferSelect;

/**
 * Refuses a fee write in a closed session. Reads stay open, and so do bounce,
 * reverse and refund: money that went wrong has to be recorded whenever it is
 * found out, whichever session it belonged to.
 */
export async function assertSessionOpen(exec: Executor, academicYearId: string) {
  const [year] = await exec
    .select({ status: academicYears.status })
    .from(academicYears)
    .where(eq(academicYears.id, academicYearId));
  if (year?.status === "closed") {
    throw refuse(
      "CONFLICT",
      "This session is closed. Fees can be viewed, but nothing new can be collected, billed or changed.",
    );
  }
}

export class FeesBillingService {
  // -------------------------------------------------------------------------
  // Which structure a student is on
  // -------------------------------------------------------------------------

  /**
   * The live structures of a class this session, with the sections each covers.
   */
  private async structuresOfClass(
    exec: Executor,
    schoolId: string,
    academicYearId: string,
    classId: string,
  ) {
    const rows = await exec
      .select({
        id: feeStructures.id,
        billingStartedAt: feeStructures.billingStartedAt,
      })
      .from(feeStructures)
      .where(
        and(
          eq(feeStructures.schoolId, schoolId),
          eq(feeStructures.academicYearId, academicYearId),
          eq(feeStructures.classId, classId),
          eq(feeStructures.isActive, true),
        ),
      )
      .orderBy(asc(feeStructures.createdAt));
    if (rows.length === 0) return [];
    const links = await exec
      .select({
        feeStructureId: feeStructureSections.feeStructureId,
        sectionId: feeStructureSections.sectionId,
      })
      .from(feeStructureSections)
      .where(
        inArray(
          feeStructureSections.feeStructureId,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((row) => ({
      ...row,
      sectionIds: new Set(
        links.filter((l) => l.feeStructureId === row.id).map((l) => l.sectionId),
      ),
    }));
  }

  /**
   * One structure for a student, or null when staff have to pick. A section
   * linked to a structure decides it. Otherwise the class's one unlinked
   * structure decides it. Two unlinked structures, or a linked class and a
   * student with no section yet, is a question automatic billing cannot answer.
   */
  private pickStructure<T extends { id: string; sectionIds: Set<string> }>(
    structures: T[],
    sectionId: string | null,
  ): T | null {
    if (sectionId) {
      const linked = structures.find((s) => s.sectionIds.has(sectionId));
      if (linked) return linked;
    }
    const unlinked = structures.filter((s) => s.sectionIds.size === 0);
    return unlinked.length === 1 ? (unlinked[0] ?? null) : null;
  }

  // -------------------------------------------------------------------------
  // Billing a student
  // -------------------------------------------------------------------------

  /**
   * Gives a student a fee record. The structure is found rather than trusted,
   * so a caller cannot put a student on another class's or branch's structure.
   *
   * Billing starts from the session's start for anyone present at Start
   * billing: which months actually charge is the schedule's business. Someone
   * admitted later starts from their enrollment date.
   */
  async assignFeeStructure(
    scope: DataScope,
    input: AssignFeeStructureInput,
    actorId: string | null,
    exec: Executor = db,
  ) {
    const schoolId = requireSchoolId(scope);

    const [enrollment] = await exec
      .select({
        id: studentEnrollments.id,
        studentId: studentEnrollments.studentId,
        academicYearId: studentEnrollments.academicYearId,
        classId: studentEnrollments.classId,
        sectionId: studentEnrollments.sectionId,
        enrollmentDate: studentEnrollments.enrollmentDate,
        enrollmentStatus: studentEnrollments.enrollmentStatus,
        createdAt: studentEnrollments.createdAt,
      })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.id, input.enrollmentId),
          eq(studentEnrollments.schoolId, schoolId),
        ),
      );
    if (!enrollment) {
      throw refuse("NOT_FOUND", "Enrollment not found in this school.");
    }
    await assertSessionOpen(exec, enrollment.academicYearId);
    const notEnrolled = NOT_ENROLLED_REASONS[enrollment.enrollmentStatus];
    if (notEnrolled) {
      throw refuse("CONFLICT", `This student cannot be billed. ${notEnrolled}`);
    }

    const structures = await this.structuresOfClass(
      exec,
      schoolId,
      enrollment.academicYearId,
      enrollment.classId,
    );
    if (structures.length === 0) {
      throw refuse(
        "CONFLICT",
        "This class has no active fee structure for the session, so there is nothing to bill.",
      );
    }
    const structure = input.feeStructureId
      ? structures.find((s) => s.id === input.feeStructureId)
      : this.pickStructure(structures, enrollment.sectionId);
    if (!structure) {
      throw refuse(
        input.feeStructureId ? "BAD_REQUEST" : "CONFLICT",
        input.feeStructureId
          ? "That fee structure is not for this student's class."
          : "This class has more than one fee structure. Choose which one this student is on.",
      );
    }

    const [year] = await exec
      .select({ startDate: academicYears.startDate })
      .from(academicYears)
      .where(eq(academicYears.id, enrollment.academicYearId));

    const startedAt = structure.billingStartedAt;
    const admittedAfterStart = Boolean(startedAt && enrollment.createdAt > startedAt);
    const effectiveFrom =
      input.feeEffectiveFrom ??
      (admittedAfterStart ? enrollment.enrollmentDate : (year?.startDate ?? enrollment.enrollmentDate));
    const joiningMonthFullCharge = input.joiningMonthFullCharge ?? true;

    const isNewStudent = await this.isNewStudent(exec, {
      schoolId,
      studentId: enrollment.studentId,
      academicYearId: enrollment.academicYearId,
      admittedAfterStart,
    });

    const [assignment] = await exec
      .insert(studentFeeAssignments)
      .values({
        organizationId: scope.organizationId,
        schoolId,
        studentId: enrollment.studentId,
        enrollmentId: enrollment.id,
        academicYearId: enrollment.academicYearId,
        feeStructureId: structure.id,
        feeEffectiveFrom: effectiveFrom,
        joiningMonthFullCharge,
        isNewStudent,
        createdBy: actorId,
      })
      .returning();

    if (!assignment) {
      throw new Error("Failed to create fee assignment.");
    }
    return assignment;
  }

  /**
   * New means no earlier enrollment at this school. In the school's first
   * billed session everyone looks that way, so there it also takes being
   * admitted after Start billing: the students already there are not new just
   * because the app is. Next April they have an earlier enrollment anyway.
   */
  private async isNewStudent(
    exec: Executor,
    args: {
      schoolId: string;
      studentId: string;
      academicYearId: string;
      admittedAfterStart: boolean;
    },
  ): Promise<boolean> {
    const [earlierEnrollment] = await exec
      .select({ id: studentEnrollments.id })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.schoolId, args.schoolId),
          eq(studentEnrollments.studentId, args.studentId),
          ne(studentEnrollments.academicYearId, args.academicYearId),
        ),
      )
      .limit(1);
    if (earlierEnrollment) return false;
    if (args.admittedAfterStart) return true;

    const [billedBefore] = await exec
      .select({ id: studentFeeAssignments.id })
      .from(studentFeeAssignments)
      .where(
        and(
          eq(studentFeeAssignments.schoolId, args.schoolId),
          ne(studentFeeAssignments.academicYearId, args.academicYearId),
        ),
      )
      .limit(1);
    return Boolean(billedBefore);
  }

  /** Fee record and dues together, so a student is never left half billed. */
  async billEnrollment(scope: DataScope, input: AssignFeeStructureInput, actorId: string | null) {
    return db.transaction(async (tx) => {
      const assignment = await this.assignFeeStructure(scope, input, actorId, tx);
      const { inserted } = await this.generateInstallments(scope, assignment.id, tx);
      return { assignment, inserted };
    });
  }

  /**
   * Automatic billing for a new admission, once their structure has started
   * billing. It never fails the admission: anything it cannot decide stays on
   * the "not billed" list, and the sweep tries again.
   */
  async billIfReady(scope: DataScope, enrollmentId: string, actorId: string | null) {
    const schoolId = requireSchoolId(scope);
    const [enrollment] = await db
      .select({
        academicYearId: studentEnrollments.academicYearId,
        classId: studentEnrollments.classId,
        sectionId: studentEnrollments.sectionId,
      })
      .from(studentEnrollments)
      .where(
        and(eq(studentEnrollments.id, enrollmentId), eq(studentEnrollments.schoolId, schoolId)),
      );
    if (!enrollment) return null;

    const [existing] = await db
      .select({ id: studentFeeAssignments.id })
      .from(studentFeeAssignments)
      .where(eq(studentFeeAssignments.enrollmentId, enrollmentId));
    if (existing) return null;

    const structures = await this.structuresOfClass(
      db,
      schoolId,
      enrollment.academicYearId,
      enrollment.classId,
    );
    const structure = this.pickStructure(structures, enrollment.sectionId);
    if (!structure?.billingStartedAt) return null;

    try {
      return await this.billEnrollment(scope, { enrollmentId }, actorId);
    } catch (error) {
      console.error("[fees] automatic billing skipped:", error);
      return null;
    }
  }

  /**
   * "Start billing" for a structure: switches it on and bills everyone it
   * covers. Safe to press twice. From here on, admissions are billed on their
   * own.
   */
  async startBilling(scope: DataScope, feeStructureId: string, actorId: string) {
    const schoolId = requireSchoolId(scope);
    const [structure] = await db
      .select({
        id: feeStructures.id,
        academicYearId: feeStructures.academicYearId,
        classId: feeStructures.classId,
        isActive: feeStructures.isActive,
      })
      .from(feeStructures)
      .where(and(eq(feeStructures.id, feeStructureId), eq(feeStructures.schoolId, schoolId)));
    if (!structure || !structure.isActive) {
      throw refuse("NOT_FOUND", "Fee structure not found in this school.");
    }
    await assertSessionOpen(db, structure.academicYearId);
    const [line] = await db
      .select({ id: feeStructureLines.id })
      .from(feeStructureLines)
      .where(eq(feeStructureLines.feeStructureId, structure.id))
      .limit(1);
    if (!line) {
      throw refuse("CONFLICT", "Add at least one fee to this structure before billing starts.");
    }
    return this.billCohort(
      scope,
      {
        academicYearId: structure.academicYearId,
        classId: structure.classId,
        feeStructureId: structure.id,
      },
      actorId,
    );
  }

  /**
   * "Bill all students in this class": sorts every enrollment into exactly one
   * bucket.
   *
   *   skipped   already has a fee record, which is what makes it safe to press
   *             twice
   *   refused   has left, is suspended or cancelled, or the class has several
   *             structures and nothing says which is theirs
   *   billed    fee record and dues in ONE transaction
   *
   * A class with no active structure refuses as a whole.
   */
  async billClass(
    scope: DataScope,
    input: BillClassInput,
    actorId: string,
  ): Promise<BillClassOutput> {
    return this.billCohort(scope, input, actorId);
  }

  private async billCohort(
    scope: DataScope,
    input: BillClassInput & { feeStructureId?: string },
    actorId: string,
  ): Promise<BillClassOutput> {
    const schoolId = requireSchoolId(scope);

    const [klass] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, input.classId), eq(classes.schoolId, schoolId)));
    if (!klass) {
      throw refuse("BAD_REQUEST", "Class not found in this school.");
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
      throw refuse("BAD_REQUEST", "Academic year not found in this school.");
    }
    await assertSessionOpen(db, year.id);

    if (input.sectionId) {
      const [section] = await db
        .select({ classId: sections.classId })
        .from(sections)
        .where(and(eq(sections.id, input.sectionId), eq(sections.schoolId, schoolId)));
      if (!section) {
        throw refuse("BAD_REQUEST", "Section not found in this school.");
      }
      if (section.classId !== input.classId) {
        throw refuse("BAD_REQUEST", "The section is not in the class being billed.");
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

    const structures = await this.structuresOfClass(
      db,
      schoolId,
      input.academicYearId,
      input.classId,
    );
    if (structures.length === 0) {
      result.refusal =
        "No active fee structure for this class this session, so there is nothing to bill.";
      return result;
    }
    const only = input.feeStructureId ?? (structures.length === 1 ? structures[0]?.id : null);
    result.feeStructureId = only ?? null;

    const enrollments = await db
      .select({
        enrollmentId: studentEnrollments.id,
        studentId: studentEnrollments.studentId,
        sectionId: studentEnrollments.sectionId,
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

    // Billing starts now for every structure this run bills. Stamped first, so
    // the first month's due date can't already be past. Everyone here was enrolled
    // before the stamp, so they count as existing.
    const toStart = new Set<string>(input.feeStructureId ? [input.feeStructureId] : []);
    if (!input.feeStructureId) {
      for (const e of enrollments) {
        if (NOT_ENROLLED_REASONS[e.enrollmentStatus]) continue;
        const picked = this.pickStructure(structures, e.sectionId);
        const id = picked?.id ?? (structures.length === 1 ? structures[0]?.id : null);
        if (id) toStart.add(id);
      }
    }
    if (toStart.size > 0) {
      await db
        .update(feeStructures)
        .set({ billingStartedAt: new Date() })
        .where(and(inArray(feeStructures.id, [...toStart]), isNull(feeStructures.billingStartedAt)));
    }

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
        if (!input.feeStructureId) result.refused.push({ ...who, reason: notEnrolled });
        continue;
      }

      const picked = this.pickStructure(structures, e.sectionId);
      if (input.feeStructureId && picked && picked.id !== input.feeStructureId) continue;

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

      const structureId = picked?.id ?? (structures.length === 1 ? structures[0]?.id : null);
      if (!structureId) {
        if (!input.feeStructureId) {
          result.refused.push({
            ...who,
            reason: "This class has more than one fee structure. Choose which one this student is on.",
          });
        }
        continue;
      }

      try {
        const billed = await db.transaction(async (tx) => {
          const assignment = await this.assignFeeStructure(
            scope,
            { enrollmentId: e.enrollmentId, feeStructureId: structureId },
            actorId,
            tx,
          );
          const { inserted } = await this.generateInstallments(scope, assignment.id, tx);
          return { assignmentId: assignment.id, installmentsCreated: inserted };
        });
        result.billed.push({ ...who, ...billed });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const [concurrent] = await db
            .select({ id: studentFeeAssignments.id })
            .from(studentFeeAssignments)
            .where(
              and(
                eq(studentFeeAssignments.schoolId, schoolId),
                eq(studentFeeAssignments.studentId, e.studentId),
                eq(studentFeeAssignments.academicYearId, input.academicYearId),
              ),
            );
          if (concurrent) {
            result.skipped.push({ ...who, assignmentId: concurrent.id });
            continue;
          }
        }
        const reason =
          error instanceof Error && error.name === "ServiceRefusal"
            ? error.message
            : "Could not be billed. Try again.";
        result.refused.push({ ...who, reason });
      }
    }

    result.billedCount = result.billed.length;
    result.skippedCount = result.skipped.length;
    result.refusedCount = result.refused.length;
    return result;
  }

  // -------------------------------------------------------------------------
  // What a student owes: the plan
  // -------------------------------------------------------------------------

  /**
   * The cut-off date for a generation run (ADR-051): an explicit date, or
   * `null` for the whole session, from `"all"` or from the school's mode. The
   * monthly modes generate up to the end of the current month.
   */
  resolveThrough(
    requested: string | "all" | undefined,
  ): string | null {
    if (requested === "all") return null;
    return requested ?? endOfMonthIso(todayInIst());
  }

  /**
   * A due can't be late before it existed. Once billing has started, a due
   * created after its date (automatic was paused, or the student was missed) is
   * due the day it was made, or the session's last day if that has passed.
   */
  private async notLateBefore(exec: Executor, assignment: AssignmentRow): Promise<string | null> {
    const [row] = await exec
      .select({
        startedAt: feeStructures.billingStartedAt,
        sessionEnd: academicYears.endDate,
      })
      .from(feeStructures)
      .innerJoin(academicYears, eq(academicYears.id, feeStructures.academicYearId))
      .where(eq(feeStructures.id, assignment.feeStructureId));
    if (!row?.startedAt) return null;
    const today = todayInIst();
    return today < row.sessionEnd ? today : row.sessionEnd;
  }

  /**
   * THE ONE LOADER for what a student owes: their whole session, written or not.
   * Generation, concessions and the screens all read through this, so they
   * cannot disagree.
   */
  async planFor(exec: Executor, assignment: AssignmentRow): Promise<PlannedDue[]> {
    const rows = await exec
      .select({
        feeHeadId: feeStructureLines.feeHeadId,
        headName: feeHeads.name,
        frequency: feeStructureLines.frequency,
        whoPays: feeStructureLines.whoPays,
        periodKey: feeLinePeriods.periodKey,
        label: feeLinePeriods.label,
        startDate: feeLinePeriods.startDate,
        endDate: feeLinePeriods.endDate,
        dueDate: feeLinePeriods.dueDate,
        amount: feeLinePeriods.amount,
        termId: feeLinePeriods.termId,
      })
      .from(feeLinePeriods)
      .innerJoin(feeStructureLines, eq(feeStructureLines.id, feeLinePeriods.feeStructureLineId))
      .innerJoin(feeHeads, eq(feeHeads.id, feeStructureLines.feeHeadId))
      .where(eq(feeStructureLines.feeStructureId, assignment.feeStructureId));

    const [structure] = await exec
      .select({ billingStartedAt: feeStructures.billingStartedAt })
      .from(feeStructures)
      .where(eq(feeStructures.id, assignment.feeStructureId));

    const [enrollment] = await exec
      .select({ leavingHistory: studentEnrollments.leavingHistory })
      .from(studentEnrollments)
      .where(eq(studentEnrollments.id, assignment.enrollmentId));

    const awayRanges = (enrollment?.leavingHistory ?? []).flatMap((entry) =>
      entry.leftOn && entry.rejoinedOn ? [{ from: entry.leftOn, to: entry.rejoinedOn }] : [],
    );

    const startedAt = structure?.billingStartedAt ?? null;
    const planned = planDues({
      rows: rows.map(
        (row): ScheduleRow => ({
          ...row,
          frequency: row.frequency as LineFrequency,
          amountCents: toCents(row.amount),
        }),
      ),
      effectiveFrom: assignment.feeEffectiveFrom,
      joiningMonthFullCharge: assignment.joiningMonthFullCharge,
      isNewStudent: assignment.isNewStudent,
      billingStartedOn: startedAt ? istDateOf(startedAt) : null,
      awayRanges,
    });

    return [...planned, ...(await this.subscriptionDues(exec, assignment))];
  }

  /** Services bill monthly at their own price, from their own window. */
  private async subscriptionDues(
    exec: Executor,
    assignment: AssignmentRow,
  ): Promise<PlannedDue[]> {
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
    if (subscriptions.length === 0) return [];

    const [year] = await exec
      .select({ startDate: academicYears.startDate, endDate: academicYears.endDate })
      .from(academicYears)
      .where(eq(academicYears.id, assignment.academicYearId));
    if (!year) return [];
    const dueDay = await this.dueDayOf(exec, assignment.schoolId, assignment.academicYearId);

    const out: PlannedDue[] = [];
    for (const sub of subscriptions) {
      const from = [sub.subscribedFrom, year.startDate, assignment.feeEffectiveFrom].sort().pop();
      const to = sub.subscribedTo && sub.subscribedTo < year.endDate ? sub.subscribedTo : year.endDate;
      if (!from || from > to) continue;
      for (const m of monthsBetween(from, to)) {
        const key = monthKey(m.year, m.month);
        out.push({
          feeHeadId: sub.feeHeadId,
          periodKey: key,
          description: `${sub.serviceDetail ?? "Optional service"} — ${key}`,
          amountCents: toCents(sub.monthlyAmount),
          dueDate: dueDateIn(m.year, m.month, dueDay),
          periodMonth: m.month,
          periodYear: m.year,
          termId: null,
          concessionEligible: false,
        });
      }
    }
    return out;
  }

  async dueDayOf(exec: Executor, schoolId: string, academicYearId: string): Promise<number> {
    const [settings] = await exec
      .select({ dueDay: feeSessionSettings.dueDay })
      .from(feeSessionSettings)
      .where(
        and(
          eq(feeSessionSettings.schoolId, schoolId),
          eq(feeSessionSettings.academicYearId, academicYearId),
        ),
      );
    return settings?.dueDay ?? 1;
  }

  /** A student's concession rules, oldest first. Voided ones stop applying. */
  async concessionRulesOf(exec: Executor, assignmentId: string): Promise<ConcessionRule[]> {
    const rows = await exec
      .select({
        calculationType: feeConcessions.calculationType,
        value: feeConcessions.value,
        coveredPeriods: feeConcessions.coveredPeriods,
      })
      .from(feeConcessions)
      .where(
        and(
          eq(feeConcessions.studentFeeAssignmentId, assignmentId),
          eq(feeConcessions.status, "active"),
        ),
      )
      .orderBy(asc(feeConcessions.createdAt));
    return rows.map((row) => ({
      calculationType: row.calculationType,
      valueCents: toCents(row.value),
      coveredPeriods: row.coveredPeriods,
    }));
  }

  // -------------------------------------------------------------------------
  // The generator
  // -------------------------------------------------------------------------

  /**
   * Idempotent by construction: it works out the student's whole set of dues
   * and inserts with ON CONFLICT DO NOTHING on assignment, head and period, so
   * re-runs fill what is missing and never rewrite what exists.
   *
   * `through` limits which dues are written: only those due on or before that
   * date. Left out, it follows the school's mode. `"all"` forces the whole
   * session. A student who has left, or whose billing is suspended, gets
   * nothing new.
   */
  async generateInstallments(
    scope: DataScope,
    assignmentId: string,
    exec: Executor = db,
    options: { through?: string | "all" } = {},
  ) {
    const schoolId = requireSchoolId(scope);
    const through = this.resolveThrough(options.through);

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
      throw refuse("NOT_FOUND", "Fee assignment not found in this school.");
    }
    if (assignment.status !== "active") return { inserted: 0, through };

    const [enrollment] = await exec
      .select({ status: studentEnrollments.enrollmentStatus })
      .from(studentEnrollments)
      .where(eq(studentEnrollments.id, assignment.enrollmentId));
    if (enrollment && !(ENROLLED_STATUSES as readonly string[]).includes(enrollment.status)) {
      return { inserted: 0, through };
    }

    const plan = await this.planFor(exec, assignment);
    const shares = concessionShares(
      await this.concessionRulesOf(exec, assignment.id),
      plan.map((d) => ({
        key: concessionKey(d.feeHeadId, d.periodKey),
        amountCents: d.amountCents,
      })),
    );

    const due = through ? plan.filter((d) => d.dueDate <= through) : plan;
    if (due.length === 0) return { inserted: 0, through };

    const floor = await this.notLateBefore(exec, assignment);
    const inserted = await exec
      .insert(feeInstallments)
      .values(
        due.map((d) => {
          const share = shares.get(concessionKey(d.feeHeadId, d.periodKey)) ?? 0n;
          return {
            organizationId: assignment.organizationId,
            schoolId: assignment.schoolId,
            studentFeeAssignmentId: assignment.id,
            studentId: assignment.studentId,
            academicYearId: assignment.academicYearId,
            feeHeadId: d.feeHeadId,
            periodKey: d.periodKey,
            description: d.description,
            amount: fromCents(d.amountCents),
            concessionAmount: fromCents(share),
            netAmount: fromCents(d.amountCents - share),
            dueDate: floor && d.dueDate < floor ? floor : d.dueDate,
            periodMonth: d.periodMonth,
            periodYear: d.periodYear,
            termId: d.termId,
          };
        }),
      )
      .onConflictDoNothing({
        target: [
          feeInstallments.studentFeeAssignmentId,
          feeInstallments.feeHeadId,
          feeInstallments.periodKey,
        ],
      })
      .returning({ id: feeInstallments.id });

    return { inserted: inserted.length, through };
  }

  /**
   * Writes every concession's share onto dues that have never been paid. Money
   * already received is not renegotiated, so a due with any payment, or that is
   * waived or cancelled, keeps what it has. A due already created keeps its own
   * amount, so shares are worked out from that amount, not today's schedule.
   */
  async recomputeAssignmentConcessions(
    scope: DataScope,
    assignmentId: string,
    exec?: Tx,
  ): Promise<{ recomputed: true }> {
    const run = async (tx: Tx) => {
      const [assignment] = await tx
        .select()
        .from(studentFeeAssignments)
        .where(
          and(
            eq(studentFeeAssignments.id, assignmentId),
            scopeWhere(atSchoolLevel(scope), ASSIGNMENT_SCOPE),
          ),
        );
      if (!assignment) {
        throw refuse("NOT_FOUND", "Fee assignment not found in this school.");
      }

      const locked = await tx
        .select({
          id: feeInstallments.id,
          feeHeadId: feeInstallments.feeHeadId,
          periodKey: feeInstallments.periodKey,
          amount: feeInstallments.amount,
          discountAmount: feeInstallments.discountAmount,
          paidAmount: feeInstallments.paidAmount,
          paymentStatus: feeInstallments.paymentStatus,
        })
        .from(feeInstallments)
        .where(eq(feeInstallments.studentFeeAssignmentId, assignment.id))
        .orderBy(asc(feeInstallments.id))
        .for("update");

      const plan = await this.planFor(tx, assignment);
      const amounts = new Map(
        plan.map((d) => [concessionKey(d.feeHeadId, d.periodKey), d.amountCents]),
      );
      for (const row of locked) {
        amounts.set(concessionKey(row.feeHeadId, row.periodKey), toCents(row.amount));
      }
      const shares = concessionShares(
        await this.concessionRulesOf(tx, assignment.id),
        [...amounts.entries()].map(([key, amountCents]) => ({ key, amountCents })),
      );

      for (const row of locked) {
        if (row.paymentStatus !== "unpaid" || toCents(row.paidAmount) !== 0n) continue;
        const amountCents = toCents(row.amount);
        const discountCents = toCents(row.discountAmount);
        const room = amountCents - discountCents;
        const raw = shares.get(concessionKey(row.feeHeadId, row.periodKey)) ?? 0n;
        const share = raw > room ? room : raw;
        await tx
          .update(feeInstallments)
          .set({
            concessionAmount: fromCents(share),
            netAmount: fromCents(room - share),
          })
          .where(eq(feeInstallments.id, row.id));
      }
    };

    if (exec) await run(exec);
    else await db.transaction(run);
    return { recomputed: true };
  }

  // -------------------------------------------------------------------------
  // Previous dues
  // -------------------------------------------------------------------------

  /**
   * Records dues from before this session: from an earlier session, or with no
   * origin when they predate the school's use of the app. Writes the
   * `opening_balance` ledger row in the SAME transaction. The student and the
   * sessions are re-read through the caller's scope, because a foreign key
   * proves a row exists, not that it belongs here.
   */
  async createOpeningBalance(
    scope: DataScope,
    input: CreateOpeningBalanceInput,
    actorId: string,
  ) {
    const schoolId = requireSchoolId(scope);
    const originId = input.originAcademicYearId ?? null;

    if (input.academicYearId === originId) {
      throw refuse("BAD_REQUEST", "An opening balance cannot originate from the year it lands in.");
    }
    if (toCents(input.amount) <= 0n) {
      throw refuse("BAD_REQUEST", "Enter an amount above zero.");
    }

    return db.transaction(async (tx) => {
      const [student] = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.id, input.studentId), eq(students.schoolId, schoolId)));
      if (!student) {
        throw refuse("BAD_REQUEST", "Student not found in this school.");
      }
      const yearIds = originId ? [input.academicYearId, originId] : [input.academicYearId];
      const years = await tx
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(and(inArray(academicYears.id, yearIds), eq(academicYears.schoolId, schoolId)));
      if (years.length !== yearIds.length) {
        throw refuse("BAD_REQUEST", "Academic year not found in this school.");
      }
      await assertSessionOpen(tx, input.academicYearId);

      const [existing] = await tx
        .select({ id: openingBalances.id, status: openingBalances.status })
        .from(openingBalances)
        .where(
          and(
            eq(openingBalances.studentId, input.studentId),
            eq(openingBalances.academicYearId, input.academicYearId),
            originId
              ? eq(openingBalances.originAcademicYearId, originId)
              : isNull(openingBalances.originAcademicYearId),
          ),
        );
      if (existing && existing.status !== "cancelled") {
        throw refuse(
          "CONFLICT",
          "This student already has previous dues recorded. Cancel that entry to correct it.",
        );
      }

      const values = {
        amount: input.amount,
        description: input.description ?? null,
        paidAmount: "0",
        status: "unpaid" as const,
      };
      const [balance] = existing
        ? await tx
            .update(openingBalances)
            .set(values)
            .where(eq(openingBalances.id, existing.id))
            .returning()
        : await tx
            .insert(openingBalances)
            .values({
              ...values,
              organizationId: scope.organizationId,
              schoolId,
              studentId: input.studentId,
              academicYearId: input.academicYearId,
              originAcademicYearId: originId,
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
        transactionDate: todayInIst(),
        createdBy: actorId,
      });

      return balance;
    });
  }

  /**
   * Cancels previous dues entered by mistake, so the right amount can be
   * entered. Only when nothing has been paid on it: money received is corrected
   * through a refund first. The ledger gets an offsetting row (hard rule 3).
   */
  async cancelOpeningBalance(
    scope: DataScope,
    input: VoidOpeningBalanceInput & { id: string },
    actorId: string,
  ) {
    return db.transaction(async (tx) => {
      const [balance] = await tx
        .select()
        .from(openingBalances)
        .where(
          and(
            eq(openingBalances.id, input.id),
            scopeWhere(atSchoolLevel(scope), OPENING_BALANCE_SCOPE),
          ),
        )
        .for("update");
      if (!balance) {
        throw refuse("NOT_FOUND", "Previous dues entry not found.");
      }
      if (balance.status === "cancelled") {
        throw refuse("CONFLICT", "This entry was already cancelled.");
      }
      if (toCents(balance.paidAmount) !== 0n) {
        throw refuse(
          "CONFLICT",
          "Money was already paid on this entry. Refund that payment before cancelling it.",
        );
      }
      const [updated] = await tx
        .update(openingBalances)
        .set({ status: "cancelled" })
        .where(eq(openingBalances.id, balance.id))
        .returning();
      await tx.insert(financialTransactions).values({
        organizationId: balance.organizationId,
        schoolId: balance.schoolId,
        studentId: balance.studentId,
        academicYearId: balance.academicYearId,
        transactionType: "opening_balance",
        direction: "debit",
        amount: balance.amount,
        referenceId: balance.id,
        referenceTable: "opening_balances",
        description: `Previous dues cancelled: ${input.reason}`,
        transactionDate: todayInIst(),
        createdBy: actorId,
      });
      return updated ?? null;
    });
  }

  /** The year's opening balances: the accountant's carry-forward view. */
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
          ne(openingBalances.status, "cancelled"),
        ),
      )
      .orderBy(asc(openingBalances.createdAt));
  }

  // -------------------------------------------------------------------------
  // One-off charges and due corrections
  // -------------------------------------------------------------------------

  /**
   * A bill that is not part of any fee structure: a dress, a notebook, a
   * damage fine. It is an ordinary due, so it collects on an ordinary receipt,
   * but it never attracts a late fee. The student needs no fee record.
   */
  async createOneOffCharge(
    scope: DataScope,
    input: Omit<CreateOneOffChargeInput, "paid">,
    exec: Tx | typeof db = db,
  ) {
    const schoolId = requireSchoolId(scope);
    if (toCents(input.amount) <= 0n) {
      throw refuse("BAD_REQUEST", "Enter an amount above zero.");
    }
    return exec.transaction(async (tx) => {
      const [student] = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.id, input.studentId), eq(students.schoolId, schoolId)));
      if (!student) {
        throw refuse("BAD_REQUEST", "Student not found in this school.");
      }
      const headId = input.feeHeadId ?? (await this.oneOffHeadOf(tx, scope));
      const [head] = await tx
        .select({ id: feeHeads.id })
        .from(feeHeads)
        .where(
          and(
            eq(feeHeads.id, headId),
            eq(feeHeads.schoolId, schoolId),
            eq(feeHeads.isActive, true),
          ),
        );
      if (!head) {
        throw refuse("BAD_REQUEST", "Fee type not found in this school.");
      }
      const [year] = await tx
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(
          and(eq(academicYears.id, input.academicYearId), eq(academicYears.schoolId, schoolId)),
        );
      if (!year) {
        throw refuse("BAD_REQUEST", "Academic year not found in this school.");
      }
      await assertSessionOpen(tx, year.id);

      const [assignment] = await tx
        .select({ id: studentFeeAssignments.id })
        .from(studentFeeAssignments)
        .where(
          and(
            eq(studentFeeAssignments.studentId, input.studentId),
            eq(studentFeeAssignments.academicYearId, year.id),
          ),
        );

      const dueDate = input.dueDate ?? todayInIst();
      const [due] = await tx
        .insert(feeInstallments)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          studentFeeAssignmentId: assignment?.id ?? null,
          studentId: input.studentId,
          academicYearId: year.id,
          feeHeadId: head.id,
          periodKey: `one:${randomUUID()}`,
          description: input.description,
          amount: input.amount,
          netAmount: input.amount,
          dueDate,
          lateFeeExempt: true,
        })
        .returning();
      return due ?? null;
    });
  }

  /**
   * The hidden fee type one-off charges go under: every due needs a fee type, but
   * staff only say what the charge is for. Made the first time a school needs it.
   */
  private async oneOffHeadOf(tx: Tx, scope: DataScope): Promise<string> {
    const schoolId = requireSchoolId(scope);
    const find = async () => {
      const [row] = await tx
        .select({ id: feeHeads.id })
        .from(feeHeads)
        .where(and(eq(feeHeads.schoolId, schoolId), eq(feeHeads.isSystem, true)));
      return row?.id ?? null;
    };
    const existing = await find();
    if (existing) return existing;
    // A school may already have its own type by this name, so the hidden one
    // tries a second name rather than taking theirs over.
    for (const name of ["One-off charges", "One-off charges (app)"]) {
      const [made] = await tx
        .insert(feeHeads)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          name,
          category: "fine",
          isSystem: true,
        })
        .onConflictDoNothing()
        .returning({ id: feeHeads.id });
      if (made) return made.id;
      // Another request may have just made the hidden one.
      const raced = await find();
      if (raced) return raced;
    }
    throw refuse("CONFLICT", "Couldn't set up one-off charges for this school. Please try again.");
  }

  /**
   * Cancels a due created by mistake. Never-paid only: money received is
   * corrected through a refund. Unlike a waiver, nothing was forgiven, so the
   * ledger is not involved.
   */
  async cancelDue(scope: DataScope, installmentId: string) {
    return db.transaction(async (tx) => {
      const [due] = await tx
        .select()
        .from(feeInstallments)
        .where(
          and(
            eq(feeInstallments.id, installmentId),
            scopeWhere(atSchoolLevel(scope), INSTALLMENT_SCOPE),
          ),
        )
        .for("update");
      if (!due) {
        throw refuse("NOT_FOUND", "Due not found in this school.");
      }
      if (due.paymentStatus !== "unpaid" || toCents(due.paidAmount) !== 0n) {
        throw refuse(
          "CONFLICT",
          "Only a due with no payment on it can be cancelled. Refund the payment first.",
        );
      }
      const [updated] = await tx
        .update(feeInstallments)
        .set({ paymentStatus: "cancelled" })
        .where(eq(feeInstallments.id, due.id))
        .returning();
      return updated ?? null;
    });
  }

  // -------------------------------------------------------------------------
  // Leaving, rejoining, suspending
  // -------------------------------------------------------------------------

  /**
   * A student left: their never-paid dues after the leaving date stop being
   * owed. Dues up to that date stay, and part-paid ones stay too, because money
   * on them still has to be settled.
   */
  async cancelDuesAfterLeaving(exec: Executor, enrollmentId: string, leftOn: string) {
    const [assignment] = await exec
      .select({ id: studentFeeAssignments.id })
      .from(studentFeeAssignments)
      .where(eq(studentFeeAssignments.enrollmentId, enrollmentId));
    if (!assignment) return;
    await exec
      .update(feeInstallments)
      .set({ paymentStatus: "cancelled" })
      .where(
        and(
          eq(feeInstallments.studentFeeAssignmentId, assignment.id),
          eq(feeInstallments.paymentStatus, "unpaid"),
          eq(feeInstallments.paidAmount, "0"),
          gt(feeInstallments.dueDate, leftOn),
        ),
      );
  }

  /**
   * A student came back: dues from today on are owed again, and the generator
   * adds any month not created while they were away. Months away stay cancelled.
   */
  async reopenDuesOnRejoining(exec: Executor, scope: DataScope, enrollmentId: string) {
    const [assignment] = await exec
      .select({ id: studentFeeAssignments.id })
      .from(studentFeeAssignments)
      .where(eq(studentFeeAssignments.enrollmentId, enrollmentId));
    if (!assignment) return;
    const today = todayInIst();
    await exec
      .update(feeInstallments)
      .set({ paymentStatus: "unpaid" })
      .where(
        and(
          eq(feeInstallments.studentFeeAssignmentId, assignment.id),
          eq(feeInstallments.paymentStatus, "cancelled"),
          gte(feeInstallments.dueDate, today),
        ),
      );
    await this.generateInstallments(scope, assignment.id, exec);
  }

  /** Stops new dues for a student for a while, such as long medical leave. */
  async setAssignmentStatus(
    scope: DataScope,
    assignmentId: string,
    status: "active" | "suspended" | "cancelled",
  ) {
    return db.transaction(async (tx) => {
      const [assignment] = await tx
        .update(studentFeeAssignments)
        .set({ status })
        .where(
          and(
            eq(studentFeeAssignments.id, assignmentId),
            scopeWhere(atSchoolLevel(scope), ASSIGNMENT_SCOPE),
          ),
        )
        .returning();
      if (!assignment) {
        throw refuse("NOT_FOUND", "Fee assignment not found in this school.");
      }
      if (status === "active") {
        await this.generateInstallments(scope, assignment.id, tx);
      } else if (status === "cancelled") {
        await tx
          .update(feeInstallments)
          .set({ paymentStatus: "cancelled" })
          .where(
            and(
              eq(feeInstallments.studentFeeAssignmentId, assignment.id),
              eq(feeInstallments.paymentStatus, "unpaid"),
              eq(feeInstallments.paidAmount, "0"),
              gt(feeInstallments.dueDate, todayInIst()),
            ),
          );
      }
      return assignment;
    });
  }

  // -------------------------------------------------------------------------
  // School and session settings
  // -------------------------------------------------------------------------

  /** The school's fee generation mode. */
  async getFeeGenerationMode(scope: DataScope) {
    const schoolId = requireSchoolId(scope);
    const [school] = await db
      .select({ mode: schools.feeGenerationMode })
      .from(schools)
      .where(
        and(eq(schools.id, schoolId), eq(schools.organizationId, scope.organizationId)),
      );
    if (!school) throw refuse("NOT_FOUND", "School not found.");
    return { mode: school.mode };
  }

  /**
   * Pauses or resumes adding each month's dues. Neither removes or rewrites a
   * due. Resuming catches up on the next sweep, because it only fills what is
   * missing.
   */
  async setFeeGenerationMode(scope: DataScope, mode: FeeGenerationMode) {
    const schoolId = requireSchoolId(scope);
    const [school] = await db
      .update(schools)
      .set({ feeGenerationMode: mode })
      .where(
        and(eq(schools.id, schoolId), eq(schools.organizationId, scope.organizationId)),
      )
      .returning({ mode: schools.feeGenerationMode });
    if (!school) throw refuse("NOT_FOUND", "School not found.");
    return { mode: school.mode };
  }

  /** The months charged and the due day for a session, with their defaults. */
  async getSessionSettings(scope: DataScope, academicYearId: string) {
    const schoolId = requireSchoolId(scope);
    const [settings] = await db
      .select({
        chargedMonths: feeSessionSettings.chargedMonths,
        dueDay: feeSessionSettings.dueDay,
      })
      .from(feeSessionSettings)
      .where(
        and(
          eq(feeSessionSettings.schoolId, schoolId),
          eq(feeSessionSettings.academicYearId, academicYearId),
        ),
      );
    const [sequence] = await db
      .select({
        prefix: receiptNumberSequences.prefix,
        lastNumber: receiptNumberSequences.lastNumber,
      })
      .from(receiptNumberSequences)
      .where(
        and(
          eq(receiptNumberSequences.schoolId, schoolId),
          eq(receiptNumberSequences.academicYearId, academicYearId),
        ),
      );
    return {
      chargedMonths: settings?.chargedMonths ?? [],
      dueDay: settings?.dueDay ?? 1,
      receiptPrefix: sequence?.prefix ?? "RCP",
      nextReceiptNumber: (sequence?.lastNumber ?? 0) + 1,
    };
  }

  async setSessionSettings(
    scope: DataScope,
    academicYearId: string,
    input: {
      chargedMonths?: string[];
      dueDay?: number;
      receiptPrefix?: string;
      nextReceiptNumber?: number;
    },
  ) {
    const schoolId = requireSchoolId(scope);
    const [year] = await db
      .select({
        id: academicYears.id,
        startDate: academicYears.startDate,
        endDate: academicYears.endDate,
      })
      .from(academicYears)
      .where(and(eq(academicYears.id, academicYearId), eq(academicYears.schoolId, schoolId)));
    if (!year) {
      throw refuse("BAD_REQUEST", "Academic year not found in this school.");
    }
    await assertSessionOpen(db, year.id);

    if (input.chargedMonths) {
      const valid = new Set(
        monthsBetween(year.startDate, year.endDate).map((m) => monthKey(m.year, m.month)),
      );
      if (input.chargedMonths.some((key) => !valid.has(key))) {
        throw refuse("BAD_REQUEST", "Those months are not all in this session.");
      }
    }

    await db.transaction(async (tx) => {
      if (input.chargedMonths !== undefined || input.dueDay !== undefined) {
        await tx
          .insert(feeSessionSettings)
          .values({
            schoolId,
            academicYearId,
            organizationId: scope.organizationId,
            chargedMonths: input.chargedMonths ?? [],
            dueDay: input.dueDay ?? 1,
          })
          .onConflictDoUpdate({
            target: [feeSessionSettings.schoolId, feeSessionSettings.academicYearId],
            set: {
              ...(input.chargedMonths !== undefined
                ? { chargedMonths: input.chargedMonths }
                : {}),
              ...(input.dueDay !== undefined ? { dueDay: input.dueDay } : {}),
            },
          });
      }
      if (input.receiptPrefix !== undefined || input.nextReceiptNumber !== undefined) {
        await tx
          .insert(receiptNumberSequences)
          .values({ schoolId, academicYearId })
          .onConflictDoNothing();
        const [current] = await tx
          .select({ lastNumber: receiptNumberSequences.lastNumber })
          .from(receiptNumberSequences)
          .where(
            and(
              eq(receiptNumberSequences.schoolId, schoolId),
              eq(receiptNumberSequences.academicYearId, academicYearId),
            ),
          )
          .for("update");
        const nextLast =
          input.nextReceiptNumber !== undefined ? input.nextReceiptNumber - 1 : undefined;
        if (nextLast !== undefined && nextLast < (current?.lastNumber ?? 0)) {
          throw refuse(
            "CONFLICT",
            "Receipts have already been issued past that number. Choose a higher one.",
          );
        }
        await tx
          .update(receiptNumberSequences)
          .set({
            ...(input.receiptPrefix !== undefined ? { prefix: input.receiptPrefix } : {}),
            ...(nextLast !== undefined ? { lastNumber: nextLast } : {}),
          })
          .where(
            and(
              eq(receiptNumberSequences.schoolId, schoolId),
              eq(receiptNumberSequences.academicYearId, academicYearId),
            ),
          );
      }
    });

    return this.getSessionSettings(scope, academicYearId);
  }

  // -------------------------------------------------------------------------
  // Month-by-month generation (ADR-051)
  // -------------------------------------------------------------------------

  /**
   * "Generate dues up to {month}" for every billed student still with the
   * school, optionally one class. Each student runs in its own transaction, so
   * one refusal never rolls back the rest; the insert-only key makes a second
   * run a no-op.
   */
  async generateThrough(
    scope: DataScope,
    input: { academicYearId: string; through: string; classId?: string | null },
  ) {
    const schoolId = requireSchoolId(scope);
    const filters = [
      eq(studentFeeAssignments.schoolId, schoolId),
      eq(studentFeeAssignments.academicYearId, input.academicYearId),
      eq(studentFeeAssignments.status, "active"),
      inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
    ];
    if (input.classId) filters.push(eq(studentEnrollments.classId, input.classId));
    const rows = await db
      .select({ id: studentFeeAssignments.id })
      .from(studentFeeAssignments)
      .innerJoin(
        studentEnrollments,
        eq(studentEnrollments.id, studentFeeAssignments.enrollmentId),
      )
      .where(and(...filters));

    let inserted = 0;
    let studentsWithNewDues = 0;
    const failed: { assignmentId: string; reason: string }[] = [];
    for (const row of rows) {
      try {
        const result = await db.transaction((tx) =>
          this.generateInstallments(scope, row.id, tx, { through: input.through }),
        );
        inserted += result.inserted;
        if (result.inserted > 0) studentsWithNewDues += 1;
      } catch (error) {
        failed.push({
          assignmentId: row.id,
          reason: error instanceof Error ? error.message : "Unknown error.",
        });
      }
    }
    return {
      through: input.through,
      studentCount: rows.length,
      studentsWithNewDues,
      inserted,
      failed,
    };
  }

  /**
   * Starts creating dues for everyone in the background and returns at once. The
   * result lands on the run's row for `latestDuesRun` to read. `wait` is for tests.
   */
  async startDuesRun(
    scope: DataScope,
    input: StartFeeDuesRunInput,
    actorId: string | null,
    opts: { wait?: boolean } = {},
  ) {
    const schoolId = requireSchoolId(scope);
    const [year] = await db
      .select({ id: academicYears.id, endDate: academicYears.endDate })
      .from(academicYears)
      .where(and(eq(academicYears.id, input.academicYearId), eq(academicYears.schoolId, schoolId)));
    if (!year) throw refuse("BAD_REQUEST", "Academic year not found in this school.");
    await assertSessionOpen(db, year.id);

    // A server restart can strand a run. Nothing is lost, it just never finished.
    await db
      .update(feeDuesRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(
        and(
          eq(feeDuesRuns.schoolId, schoolId),
          eq(feeDuesRuns.academicYearId, year.id),
          eq(feeDuesRuns.status, "running"),
          lt(feeDuesRuns.startedAt, new Date(Date.now() - DUES_RUN_STALE_MS)),
        ),
      );

    const thisMonth = endOfMonthIso(todayInIst());
    const through =
      input.upTo === "rest" || year.endDate < thisMonth ? year.endDate : thisMonth;
    const [run] = await db
      .insert(feeDuesRuns)
      .values({
        organizationId: scope.organizationId,
        schoolId,
        academicYearId: year.id,
        classId: input.classId ?? null,
        through,
        startedBy: actorId,
      })
      .onConflictDoNothing()
      .returning();
    if (!run) {
      throw refuse("CONFLICT", "Dues are already being created. Wait for that to finish.");
    }

    const work = this.finishDuesRun(scope, run.id, {
      academicYearId: year.id,
      through,
      classId: input.classId ?? null,
    });
    if (opts.wait) await work;
    else void work;
    return run;
  }

  private async finishDuesRun(
    scope: DataScope,
    runId: string,
    input: { academicYearId: string; through: string; classId: string | null },
  ) {
    try {
      const out = await this.generateThrough(scope, input);
      await db
        .update(feeDuesRuns)
        .set({
          status: "done",
          studentCount: out.studentCount,
          studentsWithNewDues: out.studentsWithNewDues,
          insertedCount: out.inserted,
          failedCount: out.failed.length,
          finishedAt: new Date(),
        })
        .where(eq(feeDuesRuns.id, runId));
    } catch (error) {
      console.error("[fees] dues run failed", error);
      await db
        .update(feeDuesRuns)
        .set({ status: "failed", finishedAt: new Date() })
        .where(eq(feeDuesRuns.id, runId))
        .catch(() => undefined);
    }
  }

  async latestDuesRun(scope: DataScope, academicYearId: string) {
    const schoolId = requireSchoolId(scope);
    const [run] = await db
      .select()
      .from(feeDuesRuns)
      .where(and(eq(feeDuesRuns.schoolId, schoolId), eq(feeDuesRuns.academicYearId, academicYearId)))
      .orderBy(desc(feeDuesRuns.startedAt))
      .limit(1);
    if (!run) return null;
    const stranded =
      run.status === "running" && run.startedAt.getTime() < Date.now() - DUES_RUN_STALE_MS;
    return stranded ? { ...run, status: "failed" as const } : run;
  }

  /**
   * The sweep for `monthly_auto` schools: bills new admissions whose structure
   * has started billing, then brings every billed student of every open session
   * up to the end of this month. Safe to run any number of times, because it
   * only fills what is missing, so it catches up after downtime by itself.
   *
   * It covers every open session, not just the current one, so switching
   * sessions in mid-March cannot lose the old session's March dues.
   *
   * A best-effort Redis lease keeps N API instances from doing the same work at
   * once; if Redis is down it sweeps anyway, the homework sweeper's rule.
   *
   * `schoolIds` narrows the sweep to those schools for tests.
   */
  async runMonthlySweep(
    opts: { schoolIds?: string[] } = {},
  ): Promise<{ schools: number; inserted: number; failed: number; summary: string }> {
    const holder = `fees-${randomUUID().slice(0, 8)}`;
    let leaseHeld = false;
    let redisAvailable = true;
    try {
      leaseHeld =
        (await getRedis().set(FEES_SWEEP_LEASE_KEY, holder, "PX", FEES_SWEEP_LEASE_TTL_MS, "NX")) ===
        "OK";
    } catch {
      redisAvailable = false;
    }
    if (redisAvailable && !leaseHeld) {
      return {
        schools: 0,
        inserted: 0,
        failed: 0,
        summary: "skipped (another instance holds the lease)",
      };
    }

    try {
      const through = endOfMonthIso(todayInIst());
      const targets = await db
        .select({
          organizationId: schools.organizationId,
          schoolId: schools.id,
          academicYearId: academicYears.id,
        })
        .from(schools)
        .innerJoin(
          academicYears,
          and(
            eq(academicYears.schoolId, schools.id),
            or(
              eq(academicYears.isCurrent, true),
              inArray(academicYears.status, ["active", "closing"]),
            ),
          ),
        )
        .where(
          and(
            eq(schools.feeGenerationMode, "monthly_auto"),
            eq(schools.isActive, true),
            ne(academicYears.status, "closed"),
            opts.schoolIds ? inArray(schools.id, opts.schoolIds) : undefined,
          ),
        );

      let inserted = 0;
      let failed = 0;
      const schoolIds = new Set<string>();
      for (const target of targets) {
        schoolIds.add(target.schoolId);
        const scope: DataScope = {
          organizationId: target.organizationId,
          schoolId: target.schoolId,
          classId: null,
          sectionId: null,
        };
        await this.billUnbilledAdmissions(scope, target.academicYearId);
        const result = await this.generateThrough(scope, {
          academicYearId: target.academicYearId,
          through,
        });
        inserted += result.inserted;
        failed += result.failed.length;
        for (const failure of result.failed) {
          console.error(
            `[fees-worker] could not create dues for assignment ${failure.assignmentId}: ${failure.reason}`,
          );
        }
      }
      return {
        schools: schoolIds.size,
        inserted,
        failed,
        summary: `${schoolIds.size} monthly school(s), ${inserted} due(s) added through ${through}, ${failed} failed`,
      };
    } finally {
      if (leaseHeld) {
        try {
          const current = await getRedis().get(FEES_SWEEP_LEASE_KEY);
          if (current === holder) await getRedis().del(FEES_SWEEP_LEASE_KEY);
        } catch {
          // Lease expiry is the fallback release path.
        }
      }
    }
  }

  /** The retry for automatic billing, in case an admission's attempt missed. */
  private async billUnbilledAdmissions(scope: DataScope, academicYearId: string) {
    const schoolId = requireSchoolId(scope);
    const unbilled = await db
      .select({ id: studentEnrollments.id })
      .from(studentEnrollments)
      .innerJoin(
        feeStructures,
        and(
          eq(feeStructures.classId, studentEnrollments.classId),
          eq(feeStructures.academicYearId, studentEnrollments.academicYearId),
          eq(feeStructures.isActive, true),
          sql`${feeStructures.billingStartedAt} IS NOT NULL`,
        ),
      )
      .leftJoin(
        studentFeeAssignments,
        eq(studentFeeAssignments.enrollmentId, studentEnrollments.id),
      )
      .where(
        and(
          eq(studentEnrollments.schoolId, schoolId),
          eq(studentEnrollments.academicYearId, academicYearId),
          inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
          isNull(studentFeeAssignments.id),
        ),
      );
    for (const row of unbilled) {
      await this.billIfReady(scope, row.id, null);
    }
  }
}

/** The calendar date an instant falls on in India. */
function istDateOf(instant: Date): string {
  return new Date(instant.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const feesBillingService = new FeesBillingService();
