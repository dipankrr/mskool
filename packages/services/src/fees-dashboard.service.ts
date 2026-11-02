import { atSchoolLevel, requireSchoolId, yearVisibilityWhere } from "./academic.service";
import { ENROLLED_STATUSES, todayInIst } from "./enrollment-status";
import { daysInMonth, fromCents, isoOf, monthKey, monthsBetween, parseIso, toCents } from "./fees-maths";
import { escapeLike, scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  FeeDashboardInput,
  FeeDashboardListInput,
  FeeDashboardListOutput,
  FeeDashboardOutput,
  FeeSetupStatus,
  FeeStudentSummary,
  FeeStudentSummaryInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  feeConcessions,
  feeHeads,
  feeInstallments,
  feeLinePeriods,
  feePayments,
  feeRefunds,
  feeStructureLines,
  feeStructureSections,
  feeStructures,
  openingBalances,
  schools,
  sections,
  studentEnrollments,
  studentFeeAssignments,
  students,
} from "@repo/db/schema";
import { and, asc, desc, eq, inArray, ne, or, sql, ilike } from "drizzle-orm";

/**
 * THE FEES DASHBOARD READS. Each figure has one definition, worked out in the
 * database, so the screens never add money up themselves and two screens can
 * never disagree. These replace loading a whole school's dues into memory.
 *
 * "Up to now" means up to the end of this calendar month: a month's fee is owed
 * from the day the month starts, even if its due date is later in the month.
 */

const INSTALLMENT_SCOPE: ScopeColumns = {
  organizationId: feeInstallments.organizationId,
  schoolId: feeInstallments.schoolId,
};
const OPENING_SCOPE: ScopeColumns = {
  organizationId: openingBalances.organizationId,
  schoolId: openingBalances.schoolId,
};
const PAYMENT_SCOPE: ScopeColumns = {
  organizationId: feePayments.organizationId,
  schoolId: feePayments.schoolId,
};
const REFUND_SCOPE: ScopeColumns = {
  organizationId: feeRefunds.organizationId,
  schoolId: feeRefunds.schoolId,
};
const ENROLLMENT_SCOPE: ScopeColumns = {
  organizationId: studentEnrollments.organizationId,
  schoolId: studentEnrollments.schoolId,
  classId: studentEnrollments.classId,
  sectionId: studentEnrollments.sectionId,
};
const ASSIGNMENT_SCOPE: ScopeColumns = {
  organizationId: studentFeeAssignments.organizationId,
  schoolId: studentFeeAssignments.schoolId,
};
const YEAR_SCOPE: ScopeColumns = {
  organizationId: academicYears.organizationId,
  schoolId: academicYears.schoolId,
};
const HEAD_SCOPE: ScopeColumns = {
  organizationId: feeHeads.organizationId,
  schoolId: feeHeads.schoolId,
};
const STRUCTURE_SCOPE: ScopeColumns = {
  organizationId: feeStructures.organizationId,
  schoolId: feeStructures.schoolId,
};

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function labelOf(key: string): string {
  const { year, month } = parseIso(`${key}-01`);
  return `${MONTH_LABELS[month - 1] ?? ""} ${year}`;
}

function endOfMonthOf(key: string): string {
  const { year, month } = parseIso(`${key}-01`);
  return isoOf(year, month, daysInMonth(year, month));
}

/** Waived and cancelled dues are not owed, and a due covered whole has no balance. */
const OPEN_DUE = sql`${feeInstallments.paymentStatus} IN ('unpaid', 'partial')`;
const BALANCE = sql`(${feeInstallments.netAmount} - ${feeInstallments.paidAmount})`;
const OPENING_OPEN = sql`${openingBalances.status} IN ('unpaid', 'partial')`;
const OPENING_BALANCE = sql`(${openingBalances.amount} - ${openingBalances.paidAmount})`;

export class FeesDashboardService {
  private async sessionOf(
    scopes: DataScope[],
    academicYearId: string,
    includeHistory: boolean,
  ) {
    const [year] = await db
      .select({
        id: academicYears.id,
        schoolId: academicYears.schoolId,
        startDate: academicYears.startDate,
        endDate: academicYears.endDate,
      })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, academicYearId),
          scopeWhere(scopes.map(atSchoolLevel), YEAR_SCOPE),
          yearVisibilityWhere(includeHistory),
        ),
      );
    return year ?? null;
  }

  /** This month inside the session; a session that ended reads as its last month. */
  private anchorMonth(session: { startDate: string; endDate: string }): string {
    const today = todayInIst();
    const clamped =
      today < session.startDate ? session.startDate : today > session.endDate ? session.endDate : today;
    const { year, month } = parseIso(clamped);
    return monthKey(year, month);
  }

  /**
   * While automatic is paused, how many dues should exist by now but don't. Null
   * when it isn't paused. It follows the same rules as the generator: enrolled
   * students, from their start date, and new-students-only lines for new students.
   */
  private async pausedDues(
    session: { id: string; schoolId: string },
    monthEnd: string,
  ): Promise<{ missingDues: number } | null> {
    const [school] = await db
      .select({ mode: schools.feeGenerationMode })
      .from(schools)
      .where(eq(schools.id, session.schoolId));
    if (school?.mode !== "monthly_manual") return null;
    const [missing] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(studentFeeAssignments)
      .innerJoin(studentEnrollments, eq(studentEnrollments.id, studentFeeAssignments.enrollmentId))
      .innerJoin(
        feeStructureLines,
        eq(feeStructureLines.feeStructureId, studentFeeAssignments.feeStructureId),
      )
      .innerJoin(feeLinePeriods, eq(feeLinePeriods.feeStructureLineId, feeStructureLines.id))
      .where(
        and(
          eq(studentFeeAssignments.academicYearId, session.id),
          eq(studentFeeAssignments.status, "active"),
          inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
          sql`${feeLinePeriods.dueDate} <= ${monthEnd}`,
          sql`${feeLinePeriods.endDate} >= ${studentFeeAssignments.feeEffectiveFrom}`,
          or(eq(feeStructureLines.whoPays, "everyone"), eq(studentFeeAssignments.isNewStudent, true)),
          sql`not exists (
            select 1 from ${feeInstallments}
            where ${feeInstallments.studentFeeAssignmentId} = ${studentFeeAssignments.id}
              and ${feeInstallments.feeHeadId} = ${feeStructureLines.feeHeadId}
              and ${feeInstallments.periodKey} = ${feeLinePeriods.periodKey}
          )`,
        ),
      );
    return { missingDues: missing?.count ?? 0 };
  }

  /** What the Fee setup screen needs to say what's done and what's waiting. */
  async setupStatus(scope: DataScope, academicYearId: string): Promise<FeeSetupStatus> {
    const schoolId = requireSchoolId(scope);
    const [classRows, structureRows, lineCounts, links, enrolled, assigned, previous] =
      await Promise.all([
        db
          .select({ id: classes.id, name: classes.name })
          .from(classes)
          .where(and(eq(classes.schoolId, schoolId), eq(classes.isActive, true)))
          .orderBy(asc(classes.numericOrder)),
        db
          .select({
            id: feeStructures.id,
            name: feeStructures.name,
            classId: feeStructures.classId,
            className: classes.name,
            startedAt: feeStructures.billingStartedAt,
          })
          .from(feeStructures)
          .innerJoin(classes, eq(classes.id, feeStructures.classId))
          .where(
            and(
              eq(feeStructures.schoolId, schoolId),
              eq(feeStructures.academicYearId, academicYearId),
              eq(feeStructures.isActive, true),
            ),
          )
          .orderBy(asc(classes.numericOrder), asc(feeStructures.name)),
        db
          .select({
            feeStructureId: feeStructureLines.feeStructureId,
            count: sql<number>`count(*)::int`,
          })
          .from(feeStructureLines)
          .where(eq(feeStructureLines.schoolId, schoolId))
          .groupBy(feeStructureLines.feeStructureId),
        db
          .select({
            feeStructureId: feeStructureSections.feeStructureId,
            sectionId: feeStructureSections.sectionId,
          })
          .from(feeStructureSections)
          .innerJoin(feeStructures, eq(feeStructures.id, feeStructureSections.feeStructureId))
          .where(
            and(
              eq(feeStructures.schoolId, schoolId),
              eq(feeStructures.academicYearId, academicYearId),
            ),
          ),
        db
          .select({
            studentId: studentEnrollments.studentId,
            classId: studentEnrollments.classId,
            sectionId: studentEnrollments.sectionId,
          })
          .from(studentEnrollments)
          .where(
            and(
              eq(studentEnrollments.schoolId, schoolId),
              eq(studentEnrollments.academicYearId, academicYearId),
              inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
            ),
          ),
        db
          .select({ studentId: studentFeeAssignments.studentId })
          .from(studentFeeAssignments)
          .where(
            and(
              eq(studentFeeAssignments.schoolId, schoolId),
              eq(studentFeeAssignments.academicYearId, academicYearId),
            ),
          ),
        db
          .select({ count: sql<number>`count(distinct ${openingBalances.studentId})::int` })
          .from(openingBalances)
          .where(
            and(
              eq(openingBalances.schoolId, schoolId),
              eq(openingBalances.academicYearId, academicYearId),
              ne(openingBalances.status, "cancelled"),
            ),
          ),
      ]);

    const lineCountOf = new Map(lineCounts.map((row) => [row.feeStructureId, row.count]));
    const billed = new Set(assigned.map((row) => row.studentId));
    const sectionsOf = new Map<string, Set<string>>();
    for (const link of links) {
      const set = sectionsOf.get(link.feeStructureId) ?? new Set<string>();
      set.add(link.sectionId);
      sectionsOf.set(link.feeStructureId, set);
    }
    const linkedInClass = new Map<string, Set<string>>();
    for (const row of structureRows) {
      const set = linkedInClass.get(row.classId) ?? new Set<string>();
      for (const sectionId of sectionsOf.get(row.id) ?? []) set.add(sectionId);
      linkedInClass.set(row.classId, set);
    }

    return {
      classes: classRows.map((row) => ({
        id: row.id,
        name: row.name,
        hasStructure: structureRows.some((structure) => structure.classId === row.id),
        billedStudents: enrolled.filter(
          (student) => student.classId === row.id && billed.has(student.studentId),
        ).length,
      })),
      structures: structureRows.map((row) => {
        const own = sectionsOf.get(row.id);
        const linked = linkedInClass.get(row.classId) ?? new Set<string>();
        // A structure with sections bills those; one without bills the rest of its class.
        const waitingStudents = enrolled.filter(
          (student) =>
            student.classId === row.classId &&
            !billed.has(student.studentId) &&
            (own
              ? Boolean(student.sectionId && own.has(student.sectionId))
              : !student.sectionId || !linked.has(student.sectionId)),
        ).length;
        return {
          id: row.id,
          name: row.name,
          className: row.className,
          started: row.startedAt !== null,
          lineCount: lineCountOf.get(row.id) ?? 0,
          waitingStudents,
        };
      }),
      previousDuesStudents: previous[0]?.count ?? 0,
    };
  }

  async overview(
    scopes: DataScope[],
    input: FeeDashboardInput,
    includeHistory: boolean,
  ): Promise<FeeDashboardOutput | null> {
    const session = await this.sessionOf(scopes, input.academicYearId, includeHistory);
    if (!session) return null;

    const month = this.anchorMonth(session);
    const monthStart = `${month}-01`;
    const monthEnd = endOfMonthOf(month);
    const today = todayInIst();
    const dueScope = scopeWhere(scopes.map(atSchoolLevel), INSTALLMENT_SCOPE);

    const [dues] = await db
      .select({
        dueThisMonth: sql<string>`coalesce(sum(${BALANCE}) filter (where ${OPEN_DUE} and ${feeInstallments.dueDate} between ${monthStart} and ${monthEnd}), 0)::text`,
        billedThisMonth: sql<string>`coalesce(sum(${feeInstallments.netAmount}) filter (where ${feeInstallments.paymentStatus} <> 'waived' and ${feeInstallments.dueDate} between ${monthStart} and ${monthEnd}), 0)::text`,
        paidOnThisMonth: sql<string>`coalesce(sum(${feeInstallments.paidAmount}) filter (where ${feeInstallments.paymentStatus} <> 'waived' and ${feeInstallments.dueDate} between ${monthStart} and ${monthEnd}), 0)::text`,
        upToNow: sql<string>`coalesce(sum(${BALANCE}) filter (where ${OPEN_DUE} and ${feeInstallments.dueDate} <= ${monthEnd}), 0)::text`,
        later: sql<string>`coalesce(sum(${BALANCE}) filter (where ${OPEN_DUE} and ${feeInstallments.dueDate} > ${monthEnd}), 0)::text`,
      })
      .from(feeInstallments)
      .where(
        and(
          eq(feeInstallments.academicYearId, session.id),
          ne(feeInstallments.paymentStatus, "cancelled"),
          dueScope,
        ),
      );

    const [previous] = await db
      .select({ balance: sql<string>`coalesce(sum(${OPENING_BALANCE}), 0)::text` })
      .from(openingBalances)
      .where(
        and(
          eq(openingBalances.academicYearId, session.id),
          OPENING_OPEN,
          scopeWhere(scopes.map(atSchoolLevel), OPENING_SCOPE),
        ),
      );

    const [withDue] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(
        sql`(
          select ${feeInstallments.studentId} as student_id from ${feeInstallments}
          where ${feeInstallments.academicYearId} = ${session.id}
            and ${OPEN_DUE} and ${BALANCE} > 0 and ${feeInstallments.dueDate} <= ${monthEnd}
            and ${dueScope}
          union
          select ${openingBalances.studentId} from ${openingBalances}
          where ${openingBalances.academicYearId} = ${session.id}
            and ${OPENING_OPEN} and ${OPENING_BALANCE} > 0
            and ${scopeWhere(scopes.map(atSchoolLevel), OPENING_SCOPE)}
        ) as owing`,
      );

    // Everyone who could owe: billed, or carrying previous dues with no fee record.
    // Counting only the billed could print "3 of 2".
    const [billed] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(
        sql`(
          select ${studentFeeAssignments.studentId} as student_id from ${studentFeeAssignments}
          where ${studentFeeAssignments.academicYearId} = ${session.id}
            and ${studentFeeAssignments.status} = 'active'
            and ${scopeWhere(scopes.map(atSchoolLevel), ASSIGNMENT_SCOPE)}
          union
          select ${openingBalances.studentId} from ${openingBalances}
          where ${openingBalances.academicYearId} = ${session.id}
            and ${OPENING_OPEN} and ${OPENING_BALANCE} > 0
            and ${scopeWhere(scopes.map(atSchoolLevel), OPENING_SCOPE)}
        ) as counted`,
      );

    const [notBilled] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(studentEnrollments)
      .leftJoin(
        studentFeeAssignments,
        eq(studentFeeAssignments.enrollmentId, studentEnrollments.id),
      )
      .where(
        and(
          eq(studentEnrollments.academicYearId, session.id),
          inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
          sql`${studentFeeAssignments.id} IS NULL`,
          scopeWhere(scopes, ENROLLMENT_SCOPE),
        ),
      );

    const paymentScope = scopeWhere(scopes.map(atSchoolLevel), PAYMENT_SCOPE);
    const [cash] = await db
      .select({
        month: sql<string>`coalesce(sum(${feePayments.totalAmount}) filter (where ${feePayments.paymentStatus} = 'cleared' and ${feePayments.paymentDate} between ${monthStart} and ${monthEnd}), 0)::text`,
        today: sql<string>`coalesce(sum(${feePayments.totalAmount}) filter (where ${feePayments.paymentStatus} in ('cleared', 'pending') and ${feePayments.paymentDate} = ${today}), 0)::text`,
        receiptsToday: sql<number>`(count(*) filter (where ${feePayments.paymentStatus} in ('cleared', 'pending') and ${feePayments.paymentDate} = ${today}))::int`,
        pendingCount: sql<number>`(count(*) filter (where ${feePayments.paymentStatus} = 'pending'))::int`,
        pendingAmount: sql<string>`coalesce(sum(${feePayments.totalAmount}) filter (where ${feePayments.paymentStatus} = 'pending'), 0)::text`,
      })
      .from(feePayments)
      .where(and(eq(feePayments.academicYearId, session.id), paymentScope));

    const [refunds] = await db
      .select({
        total: sql<string>`coalesce(sum(${feeRefunds.refundAmount}) filter (where ${feeRefunds.refundDate} between ${monthStart} and ${monthEnd}), 0)::text`,
      })
      .from(feeRefunds)
      .where(
        and(
          eq(feeRefunds.academicYearId, session.id),
          scopeWhere(scopes.map(atSchoolLevel), REFUND_SCOPE),
        ),
      );

    const sessionMonths = monthsBetween(session.startDate, session.endDate).map((m) =>
      monthKey(m.year, m.month),
    );
    const anchorIndex = sessionMonths.indexOf(month);
    const trendMonths = sessionMonths.slice(Math.max(0, anchorIndex - 5), anchorIndex + 1);
    const trendRows = await db
      .select({
        month: sql<string>`to_char(${feeInstallments.dueDate}, 'YYYY-MM')`,
        balance: sql<string>`coalesce(sum(${BALANCE}) filter (where ${OPEN_DUE}), 0)::text`,
      })
      .from(feeInstallments)
      .where(
        and(
          eq(feeInstallments.academicYearId, session.id),
          ne(feeInstallments.paymentStatus, "cancelled"),
          dueScope,
        ),
      )
      .groupBy(sql`to_char(${feeInstallments.dueDate}, 'YYYY-MM')`);
    const trendOf = new Map(trendRows.map((row) => [row.month, row.balance]));

    const [heads] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(feeHeads)
      .where(
        and(
          eq(feeHeads.isActive, true),
          eq(feeHeads.isSystem, false),
          scopeWhere(scopes.map(atSchoolLevel), HEAD_SCOPE),
        ),
      );
    const [structures] = await db
      .select({
        total: sql<number>`count(*)::int`,
        notStarted: sql<number>`(count(*) filter (where ${feeStructures.billingStartedAt} is null))::int`,
      })
      .from(feeStructures)
      .where(
        and(
          eq(feeStructures.academicYearId, session.id),
          eq(feeStructures.isActive, true),
          scopeWhere(scopes.map(atSchoolLevel), STRUCTURE_SCOPE),
        ),
      );

    const upToNow = toCents(normal(dues?.upToNow));
    const previousCents = toCents(normal(previous?.balance));
    const collected = toCents(normal(cash?.month)) - toCents(normal(refunds?.total));

    return {
      month,
      monthLabel: labelOf(month),
      dueThisMonth: normal(dues?.dueThisMonth),
      billedThisMonth: normal(dues?.billedThisMonth),
      paidOnThisMonth: normal(dues?.paidOnThisMonth),
      collectedThisMonth: fromCents(collected > 0n ? collected : 0n),
      collectedToday: normal(cash?.today),
      receiptsToday: cash?.receiptsToday ?? 0,
      allTimeDue: fromCents(upToNow + previousCents),
      laterThisSession: normal(dues?.later),
      studentsWithDue: withDue?.count ?? 0,
      studentsBilled: billed?.count ?? 0,
      studentsNotBilled: notBilled?.count ?? 0,
      paused: await this.pausedDues(session, monthEnd),
      pending: { count: cash?.pendingCount ?? 0, amount: normal(cash?.pendingAmount) },
      trend: trendMonths.map((key) => ({
        month: key,
        label: (MONTH_LABELS[parseIso(`${key}-01`).month - 1] ?? "").slice(0, 3),
        balance: normal(trendOf.get(key)),
      })),
      setup: {
        hasFeeTypes: (heads?.count ?? 0) > 0,
        structures: structures?.total ?? 0,
        structuresNotStarted: structures?.notStarted ?? 0,
      },
    };
  }

  async list(
    scopes: DataScope[],
    input: FeeDashboardListInput,
    includeHistory: boolean,
  ): Promise<FeeDashboardListOutput | null> {
    const session = await this.sessionOf(scopes, input.academicYearId, includeHistory);
    if (!session) return null;

    const month = this.anchorMonth(session);
    const monthStart = `${month}-01`;
    const monthEnd = endOfMonthOf(month);

    const dues = db
      .select({
        studentId: feeInstallments.studentId,
        upToNow:
          sql<string>`coalesce(sum(${BALANCE}) filter (where ${OPEN_DUE} and ${feeInstallments.dueDate} <= ${monthEnd}), 0)`.as(
            "up_to_now",
          ),
        thisMonth:
          sql<string>`coalesce(sum(${BALANCE}) filter (where ${OPEN_DUE} and ${feeInstallments.dueDate} between ${monthStart} and ${monthEnd}), 0)`.as(
            "this_month",
          ),
        overdue:
          sql<string>`coalesce(sum(${BALANCE}) filter (where ${OPEN_DUE} and ${feeInstallments.dueDate} < ${monthStart}), 0)`.as(
            "overdue",
          ),
        later:
          sql<string>`coalesce(sum(${BALANCE}) filter (where ${OPEN_DUE} and ${feeInstallments.dueDate} > ${monthEnd}), 0)`.as(
            "later",
          ),
        overdueMonths:
          sql<number>`count(distinct to_char(${feeInstallments.dueDate}, 'YYYY-MM')) filter (where ${OPEN_DUE} and ${BALANCE} > 0 and ${feeInstallments.dueDate} < ${monthStart})`.as(
            "overdue_months",
          ),
        oldest:
          sql<string | null>`min(${feeInstallments.dueDate}) filter (where ${OPEN_DUE} and ${BALANCE} > 0 and ${feeInstallments.dueDate} <= ${monthEnd})`.as(
            "oldest",
          ),
      })
      .from(feeInstallments)
      .where(eq(feeInstallments.academicYearId, session.id))
      .groupBy(feeInstallments.studentId)
      .as("dues");

    const opening = db
      .select({
        studentId: openingBalances.studentId,
        balance:
          sql<string>`coalesce(sum(${OPENING_BALANCE}) filter (where ${OPENING_OPEN}), 0)`.as(
            "opening_balance",
          ),
      })
      .from(openingBalances)
      .where(eq(openingBalances.academicYearId, session.id))
      .groupBy(openingBalances.studentId)
      .as("opening");

    const dueNow = sql`(coalesce(${dues.upToNow}, 0) + coalesce(${opening.balance}, 0))`;
    const billedFlag = sql`${studentFeeAssignments.id} IS NOT NULL`;

    const showWhere =
      input.show === "owes"
        ? sql`${dueNow} > 0`
        : input.show === "paid"
          ? sql`${billedFlag} AND ${dueNow} = 0`
          : input.show === "not_billed"
            ? sql`${studentFeeAssignments.id} IS NULL`
            : undefined;

    const search = input.search?.trim();
    const where = and(
      eq(studentEnrollments.academicYearId, session.id),
      input.classId ? eq(studentEnrollments.classId, input.classId) : undefined,
      input.sectionId ? eq(studentEnrollments.sectionId, input.sectionId) : undefined,
      search
        ? or(
            ilike(students.firstName, `%${escapeLike(search)}%`),
            ilike(students.middleName, `%${escapeLike(search)}%`),
            ilike(students.lastName, `%${escapeLike(search)}%`),
            ilike(students.admissionNumber, `%${escapeLike(search)}%`),
          )
        : undefined,
      // Someone who left only stays on the list while they owe.
      or(
        inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
        sql`${dueNow} > 0`,
      ),
      showWhere,
      scopeWhere(scopes, ENROLLMENT_SCOPE),
    );

    const order =
      input.sort === "highest"
        ? [desc(dueNow), asc(students.firstName)]
        : input.sort === "name"
          ? [asc(students.firstName), asc(students.lastName)]
          : [sql`${dues.oldest} ASC NULLS LAST`, desc(dueNow), asc(students.firstName)];

    const base = () =>
      db
        .select({
          studentId: students.id,
          firstName: students.firstName,
          middleName: students.middleName,
          lastName: students.lastName,
          admissionNumber: students.admissionNumber,
          className: classes.name,
          sectionName: sections.name,
          rollNumber: studentEnrollments.rollNumber,
          enrollmentStatus: studentEnrollments.enrollmentStatus,
          billed: sql<boolean>`${billedFlag}`,
          dueNow: sql<string>`${dueNow}::numeric(12,2)::text`,
          thisMonth: sql<string>`coalesce(${dues.thisMonth}, 0)::numeric(12,2)::text`,
          overdue: sql<string>`coalesce(${dues.overdue}, 0)::numeric(12,2)::text`,
          previousDues: sql<string>`coalesce(${opening.balance}, 0)::numeric(12,2)::text`,
          later: sql<string>`coalesce(${dues.later}, 0)::numeric(12,2)::text`,
          overdueMonths: sql<number>`coalesce(${dues.overdueMonths}, 0)::int`,
          oldestDueDate: sql<string | null>`${dues.oldest}`,
        })
        .from(studentEnrollments)
        .innerJoin(students, eq(students.id, studentEnrollments.studentId))
        .innerJoin(classes, eq(classes.id, studentEnrollments.classId))
        .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
        .leftJoin(
          studentFeeAssignments,
          eq(studentFeeAssignments.enrollmentId, studentEnrollments.id),
        )
        .leftJoin(dues, eq(dues.studentId, studentEnrollments.studentId))
        .leftJoin(opening, eq(opening.studentId, studentEnrollments.studentId))
        .where(where);

    const [counted] = await db
      .select({
        total: sql<number>`count(*)::int`,
        totalDue: sql<string>`coalesce(sum(${dueNow}), 0)::numeric(14,2)::text`,
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .leftJoin(
        studentFeeAssignments,
        eq(studentFeeAssignments.enrollmentId, studentEnrollments.id),
      )
      .leftJoin(dues, eq(dues.studentId, studentEnrollments.studentId))
      .leftJoin(opening, eq(opening.studentId, studentEnrollments.studentId))
      .where(where);

    const rows = await base()
      .orderBy(...order)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);

    const lastPayments = rows.length
      ? await db
          .select({
            studentId: feePayments.studentId,
            date: sql<string>`max(${feePayments.paymentDate})`,
            amount: sql<string>`(array_agg(${feePayments.totalAmount} order by ${feePayments.paymentDate} desc, ${feePayments.createdAt} desc))[1]::text`,
          })
          .from(feePayments)
          .where(
            and(
              eq(feePayments.academicYearId, session.id),
              inArray(
                feePayments.studentId,
                rows.map((row) => row.studentId),
              ),
              inArray(feePayments.paymentStatus, ["pending", "cleared"]),
              scopeWhere(scopes.map(atSchoolLevel), PAYMENT_SCOPE),
            ),
          )
          .groupBy(feePayments.studentId)
      : [];
    const lastOf = new Map(lastPayments.map((row) => [row.studentId, row]));

    const total = counted?.total ?? 0;
    return {
      rows: rows.map((row) => ({
        studentId: row.studentId,
        studentName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
        admissionNumber: row.admissionNumber,
        className: row.className,
        sectionName: row.sectionName,
        rollNumber: row.rollNumber,
        enrollmentStatus: row.enrollmentStatus,
        billed: row.billed,
        dueNow: row.dueNow,
        thisMonth: row.thisMonth,
        overdue: row.overdue,
        previousDues: row.previousDues,
        later: row.later,
        overdueMonths: row.overdueMonths,
        oldestDueDate: row.oldestDueDate,
        lastPaymentDate: lastOf.get(row.studentId)?.date ?? null,
        lastPaymentAmount: lastOf.get(row.studentId)?.amount ?? null,
      })),
      total,
      totalDue: counted?.totalDue ?? "0.00",
      page: input.page,
      totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    };
  }

  /** Everything the student fee page shows, in one call. */
  async studentSummary(
    scopes: DataScope[],
    input: FeeStudentSummaryInput,
    includeHistory: boolean,
  ): Promise<FeeStudentSummary | null> {
    const session = await this.sessionOf(scopes, input.academicYearId, includeHistory);
    if (!session) return null;

    const [enrollment] = await db
      .select({
        studentId: students.id,
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
        admissionNumber: students.admissionNumber,
        className: classes.name,
        classId: studentEnrollments.classId,
        sectionName: sections.name,
        rollNumber: studentEnrollments.rollNumber,
        enrollmentId: studentEnrollments.id,
        enrollmentStatus: studentEnrollments.enrollmentStatus,
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .innerJoin(classes, eq(classes.id, studentEnrollments.classId))
      .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
      .where(
        and(
          eq(studentEnrollments.studentId, input.studentId),
          eq(studentEnrollments.academicYearId, session.id),
          scopeWhere(scopes, ENROLLMENT_SCOPE),
        ),
      );
    if (!enrollment) return null;

    const [record] = await db
      .select({
        id: studentFeeAssignments.id,
        status: studentFeeAssignments.status,
        structureId: studentFeeAssignments.feeStructureId,
        structureName: feeStructures.name,
        effectiveFrom: studentFeeAssignments.feeEffectiveFrom,
        isNewStudent: studentFeeAssignments.isNewStudent,
      })
      .from(studentFeeAssignments)
      .innerJoin(feeStructures, eq(feeStructures.id, studentFeeAssignments.feeStructureId))
      .where(
        and(
          eq(studentFeeAssignments.enrollmentId, enrollment.enrollmentId),
          scopeWhere(scopes.map(atSchoolLevel), ASSIGNMENT_SCOPE),
        ),
      );

    const structureChoices = record
      ? []
      : await db
          .select({ id: feeStructures.id, name: feeStructures.name })
          .from(feeStructures)
          .where(
            and(
              eq(feeStructures.academicYearId, session.id),
              eq(feeStructures.classId, enrollment.classId),
              eq(feeStructures.isActive, true),
              scopeWhere(scopes.map(atSchoolLevel), STRUCTURE_SCOPE),
            ),
          )
          .orderBy(asc(feeStructures.name));

    const dues = await db
      .select()
      .from(feeInstallments)
      .where(
        and(
          eq(feeInstallments.studentId, input.studentId),
          eq(feeInstallments.academicYearId, session.id),
          ne(feeInstallments.paymentStatus, "cancelled"),
          scopeWhere(scopes.map(atSchoolLevel), INSTALLMENT_SCOPE),
        ),
      )
      .orderBy(asc(feeInstallments.dueDate), asc(feeInstallments.periodKey));

    const previousDues = await db
      .select()
      .from(openingBalances)
      .where(
        and(
          eq(openingBalances.studentId, input.studentId),
          eq(openingBalances.academicYearId, session.id),
          ne(openingBalances.status, "cancelled"),
          scopeWhere(scopes.map(atSchoolLevel), OPENING_SCOPE),
        ),
      )
      .orderBy(asc(openingBalances.createdAt));

    const recentPayments = await db
      .select()
      .from(feePayments)
      .where(
        and(
          eq(feePayments.studentId, input.studentId),
          eq(feePayments.academicYearId, session.id),
          scopeWhere(scopes.map(atSchoolLevel), PAYMENT_SCOPE),
        ),
      )
      .orderBy(desc(feePayments.paymentDate), desc(feePayments.createdAt))
      .limit(5);
    // A receipt keeps its full amount for ever, so the history says what came
    // back. Without it, "paid so far" can't be squared with the receipts.
    const refunded = recentPayments.length
      ? await db
          .select({
            paymentId: feeRefunds.originalPaymentId,
            total: sql<string>`coalesce(sum(${feeRefunds.refundAmount}), 0)::text`,
          })
          .from(feeRefunds)
          .where(
            and(
              inArray(
                feeRefunds.originalPaymentId,
                recentPayments.map((payment) => payment.id),
              ),
              scopeWhere(scopes.map(atSchoolLevel), REFUND_SCOPE),
            ),
          )
          .groupBy(feeRefunds.originalPaymentId)
      : [];
    const refundedOf = new Map(refunded.map((row) => [row.paymentId, row.total]));

    const concessions = record
      ? await db
          .select({
            id: feeConcessions.id,
            concessionType: feeConcessions.concessionType,
            calculationType: feeConcessions.calculationType,
            value: feeConcessions.value,
            concessionAmount: feeConcessions.concessionAmount,
            reason: feeConcessions.reason,
          })
          .from(feeConcessions)
          .where(
            and(
              eq(feeConcessions.studentFeeAssignmentId, record.id),
              eq(feeConcessions.status, "active"),
            ),
          )
          .orderBy(asc(feeConcessions.createdAt))
      : [];

    const month = this.anchorMonth(session);
    const monthStart = `${month}-01`;
    const monthEnd = endOfMonthOf(month);
    let thisMonth = 0n;
    let overdue = 0n;
    let later = 0n;
    let paid = 0n;
    let concession = 0n;
    let discount = 0n;
    const perMonth = new Map<string, { net: bigint; paid: bigint; balance: bigint }>();

    for (const due of dues) {
      const open = due.paymentStatus === "unpaid" || due.paymentStatus === "partial";
      const balance = open ? toCents(due.netAmount) - toCents(due.paidAmount) : 0n;
      if (due.dueDate < monthStart) overdue += balance;
      else if (due.dueDate <= monthEnd) thisMonth += balance;
      else later += balance;
      paid += toCents(due.paidAmount);
      concession += toCents(due.concessionAmount);
      discount += toCents(due.discountAmount);
      if (due.paymentStatus === "waived") continue;
      const key = due.dueDate.slice(0, 7);
      const entry = perMonth.get(key) ?? { net: 0n, paid: 0n, balance: 0n };
      entry.net += toCents(due.netAmount);
      entry.paid += toCents(due.paidAmount);
      entry.balance += balance;
      perMonth.set(key, entry);
    }
    const previousCents = previousDues.reduce(
      (acc, row) =>
        row.status === "unpaid" || row.status === "partial"
          ? acc + toCents(row.amount) - toCents(row.paidAmount)
          : acc,
      0n,
    );

    return {
      student: {
        id: enrollment.studentId,
        name: [enrollment.firstName, enrollment.middleName, enrollment.lastName]
          .filter(Boolean)
          .join(" "),
        admissionNumber: enrollment.admissionNumber,
        className: enrollment.className,
        sectionName: enrollment.sectionName,
        rollNumber: enrollment.rollNumber,
        enrollmentId: enrollment.enrollmentId,
        enrollmentStatus: enrollment.enrollmentStatus,
      },
      feeRecord: record ?? null,
      structureChoices,
      totals: {
        dueNow: fromCents(thisMonth + overdue + previousCents),
        thisMonth: fromCents(thisMonth),
        overdue: fromCents(overdue),
        previousDues: fromCents(previousCents),
        later: fromCents(later),
        paid: fromCents(paid),
        concession: fromCents(concession),
        discount: fromCents(discount),
      },
      months: monthsBetween(session.startDate, session.endDate).map((m) => {
        const key = monthKey(m.year, m.month);
        const entry = perMonth.get(key);
        const state = !entry
          ? ("none" as const)
          : entry.balance === 0n
            ? ("paid" as const)
            : key < month
              ? ("overdue" as const)
              : key === month
                ? ("due" as const)
                : ("upcoming" as const);
        return {
          month: key,
          label: (MONTH_LABELS[m.month - 1] ?? "").slice(0, 3),
          net: fromCents(entry?.net ?? 0n),
          paid: fromCents(entry?.paid ?? 0n),
          balance: fromCents(entry?.balance ?? 0n),
          state,
        };
      }),
      dues,
      previousDues,
      concessions,
      recentPayments: recentPayments.map((payment) => ({
        ...payment,
        refundedAmount: normal(refundedOf.get(payment.id)),
      })),
    };
  }
}

/** Postgres prints `0` for a zero sum; the contract's money reads `0.00`. */
function normal(value: string | null | undefined): string {
  return fromCents(toCents(value ?? "0"));
}

export const feesDashboardService = new FeesDashboardService();
