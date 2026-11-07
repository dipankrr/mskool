import { db } from "@repo/db";
import {
  academicCalendar,
  attendancePolicies,
  studentEnrollments,
  students,
  terms,
} from "@repo/db/schema";
import { and, asc, between, eq, inArray } from "drizzle-orm";

import {
  attendancePercent,
  countAttendance,
  hasAttendanceMarks,
  isOnBooks,
  monthBounds,
  type AttendanceCounts,
  type AttendanceStatusValue,
} from "./attendance-counting";
import {
  MIN_DAYS_LONG_PERIOD,
  minDaysForMonth,
  rankEntries,
  topList,
  type RankingEntry,
} from "./attendance-ranking";
import { loadCountingInputs, type CountingInputs } from "./attendance-to-date";
import { ENROLLED_STATUSES, todayInIst } from "./enrollment-status";
import { fullName, resolvePortalChild, type PortalChild } from "./portal-child";
import { refuse } from "./service-error";

/**
 * The family attendance reads (ADR-062): `portalAttendance.month`,
 * `.overview` and `.ranking`. Every figure is the "so far" count (ADR-061),
 * read from `daily_attendance_status` (hard rule 5), never the stored
 * whole-period summary.
 */

export type PortalCounts = AttendanceCounts & { percentage: string };

export type PortalDayStatus = AttendanceStatusValue | "not_marked";

export type PortalMonthDay = {
  date: string;
  /** Null when the school's calendar has no row for the day. */
  dayType: "working" | "holiday" | "half_day" | "weekend" | "exam_day" | null;
  /** The holiday's name ("Diwali"), on non-working days only. */
  label: string | null;
  /** False before the child joined, while away, and after leaving. */
  enrolled: boolean;
  /** The child's mark. "not_marked" on a past working day with no mark;
   *  null on non-working days, future days and days not enrolled. */
  status: PortalDayStatus | null;
};

export type PortalRankingPeriod =
  | { kind: "month"; month: string }
  | { kind: "term"; termId: string }
  | { kind: "year" };

export type PortalRankingReason =
  | "no_section"
  | "not_enrolled"
  | "not_started"
  | "no_marks"
  | "too_few_days";

const WORKING = new Set(["working", "half_day", "exam_day"]);

function soFar(
  inputs: CountingInputs,
  studentId: string,
  from: string,
  to: string,
  asOf: string,
): PortalCounts | null {
  const counts = countAttendance({
    workingDates: inputs.workingDates,
    statuses: inputs.statusesByStudent.get(studentId) ?? [],
    ranges: inputs.rangesByStudent.get(studentId) ?? [],
    from,
    to,
    asOf,
    lateCountsAsPresent: inputs.lateCountsAsPresent,
  });
  if (!hasAttendanceMarks(counts)) return null;
  return { ...counts, percentage: attendancePercent(counts.daysAttended, counts.workingDays) };
}

function inputsFor(child: PortalChild, studentIds: readonly string[]) {
  return loadCountingInputs(db, {
    schoolId: child.schoolId,
    academicYearId: child.academicYearId,
    studentIds,
  });
}

function assertMonthInYear(child: PortalChild, month: string) {
  const { from, to } = monthBounds(month);
  if (to < child.year.startDate || from > child.year.endDate) {
    throw refuse("BAD_REQUEST", "That month is outside the session.");
  }
  return { from, to };
}

function loadTerms(child: PortalChild) {
  return db
    .select({
      id: terms.id,
      name: terms.name,
      startDate: terms.startDate,
      endDate: terms.endDate,
    })
    .from(terms)
    .where(and(eq(terms.schoolId, child.schoolId), eq(terms.academicYearId, child.academicYearId)))
    .orderBy(asc(terms.sequenceNumber));
}

class PortalAttendanceService {
  async month(
    ownedStudentIds: readonly string[],
    input: { studentId: string; month: string; academicYearId?: string },
  ) {
    const child = await resolvePortalChild(ownedStudentIds, input.studentId, input.academicYearId);
    const { from, to } = assertMonthInYear(child, input.month);
    const today = todayInIst();

    const [inputs, calendar] = await Promise.all([
      inputsFor(child, [child.studentId]),
      db
        .select({
          date: academicCalendar.date,
          dayType: academicCalendar.dayType,
          reason: academicCalendar.reason,
        })
        .from(academicCalendar)
        .where(
          and(
            eq(academicCalendar.schoolId, child.schoolId),
            eq(academicCalendar.academicYearId, child.academicYearId),
            between(academicCalendar.date, from, to),
          ),
        ),
    ]);

    const dayByDate = new Map(calendar.map((d) => [d.date, d]));
    const statusByDate = new Map(
      (inputs.statusesByStudent.get(child.studentId) ?? []).map((s) => [s.date, s.status]),
    );
    const ranges = inputs.rangesByStudent.get(child.studentId) ?? [];

    const days: PortalMonthDay[] = [];
    const last = Number(to.slice(8, 10));
    for (let d = 1; d <= last; d += 1) {
      const date = `${input.month}-${String(d).padStart(2, "0")}`;
      const day = dayByDate.get(date);
      const dayType = day?.dayType ?? null;
      const working = dayType != null && WORKING.has(dayType);
      const enrolled = isOnBooks(ranges, date);
      const mark = statusByDate.get(date) ?? null;
      let status: PortalDayStatus | null = null;
      if (mark) status = mark;
      else if (working && enrolled && date <= today) status = "not_marked";
      days.push({
        date,
        dayType,
        label: working ? null : (day?.reason ?? null),
        enrolled,
        status,
      });
    }

    return {
      month: input.month,
      asOf: today,
      lateCountsAsPresent: inputs.lateCountsAsPresent,
      days,
      counts: soFar(inputs, child.studentId, from, to, today),
    };
  }

  async overview(
    ownedStudentIds: readonly string[],
    input: { studentId: string; academicYearId?: string },
  ) {
    const child = await resolvePortalChild(ownedStudentIds, input.studentId, input.academicYearId);
    const today = todayInIst();
    const [inputs, termRows] = await Promise.all([
      inputsFor(child, [child.studentId]),
      loadTerms(child),
    ]);

    const thisMonth = today.slice(0, 7);
    const monthInYear =
      today >= child.year.startDate && today <= child.year.endDate ? thisMonth : null;
    const month = monthInYear
      ? (() => {
          const { from, to } = monthBounds(monthInYear);
          return {
            month: monthInYear,
            counts: soFar(inputs, child.studentId, from, to, today),
          };
        })()
      : null;

    return {
      academicYear: { id: child.academicYearId, name: child.year.name, isCurrent: child.year.isCurrent },
      asOf: today,
      lateCountsAsPresent: inputs.lateCountsAsPresent,
      month,
      terms: termRows.map((t) => ({
        id: t.id,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
        counts:
          t.startDate > today
            ? null
            : soFar(inputs, child.studentId, t.startDate, t.endDate, today),
      })),
      year: soFar(inputs, child.studentId, child.year.startDate, child.year.endDate, today),
    };
  }

  async ranking(
    ownedStudentIds: readonly string[],
    input: { studentId: string; academicYearId?: string; period: PortalRankingPeriod },
  ) {
    const child = await resolvePortalChild(ownedStudentIds, input.studentId, input.academicYearId);
    const today = todayInIst();

    // The period's dates.
    let from: string;
    let to: string;
    if (input.period.kind === "month") {
      ({ from, to } = assertMonthInYear(child, input.period.month));
    } else if (input.period.kind === "term") {
      const termId = input.period.termId;
      const term = (await loadTerms(child)).find((t) => t.id === termId);
      if (!term) throw refuse("NOT_FOUND", "Term not found.");
      ({ startDate: from, endDate: to } = term);
    } else {
      from = child.year.startDate;
      to = child.year.endDate;
    }
    const period = { ...input.period, from, to, isRunning: from <= today && today <= to };

    const policy = await db
      .select({ visible: attendancePolicies.familyRankingVisible })
      .from(attendancePolicies)
      .where(eq(attendancePolicies.schoolId, child.schoolId))
      .limit(1);
    const topVisible = policy[0]?.visible ?? true;

    const empty = (reason: PortalRankingReason, minWorkingDays: number | null = null) => ({
      period,
      topVisible,
      top: [] as { rank: number; name: string; percentage: string; isYou: boolean }[],
      you: { rank: null, percentage: null, workingDays: 0, daysAttended: 0, reason },
      rankedCount: 0,
      sectionSize: 0,
      minWorkingDays,
    });

    // A5: no ranking without a section. Leavers are not ranked.
    if (!child.sectionId) return empty("no_section");
    if (!(ENROLLED_STATUSES as readonly string[]).includes(child.enrollmentStatus)) {
      return empty("not_enrolled");
    }
    if (from > today) return empty("not_started");

    const roster = await db
      .select({
        studentId: studentEnrollments.studentId,
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          eq(studentEnrollments.schoolId, child.schoolId),
          eq(studentEnrollments.academicYearId, child.academicYearId),
          eq(studentEnrollments.sectionId, child.sectionId),
          inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
        ),
      );
    const names = new Map(roster.map((r) => [r.studentId, fullName(r)]));
    const ids = [...names.keys()];
    if (!names.has(child.studentId)) return empty("not_enrolled");

    const inputs = await inputsFor(child, ids);

    const minWorkingDays =
      input.period.kind === "month"
        ? minDaysForMonth(
            inputs.workingDates.filter((d) => d >= from && d <= to && d <= today).length,
          )
        : MIN_DAYS_LONG_PERIOD;

    const entries: RankingEntry[] = ids.map((studentId) => {
      const counts = soFar(inputs, studentId, from, to, today);
      return {
        studentId,
        name: names.get(studentId)!,
        workingDays: counts?.workingDays ?? 0,
        daysAttended: counts?.daysAttended ?? 0,
        percentage: counts?.percentage ?? null,
      };
    });
    const ranked = rankEntries(entries, minWorkingDays);
    const mine = entries.find((e) => e.studentId === child.studentId)!;
    const myRank = ranked.find((e) => e.studentId === child.studentId) ?? null;

    let reason: PortalRankingReason | null = null;
    if (!myRank) reason = mine.percentage == null ? "no_marks" : "too_few_days";

    return {
      period,
      topVisible,
      // A6: switch off shows the child's own rank only. No other child's
      // data ever leaves beyond this list: no ids, no counts.
      top: topVisible
        ? topList(ranked).map((e) => ({
            rank: e.rank,
            name: e.name,
            percentage: e.percentage,
            isYou: e.studentId === child.studentId,
          }))
        : [],
      you: {
        rank: myRank?.rank ?? null,
        percentage: mine.percentage,
        workingDays: mine.workingDays,
        daysAttended: mine.daysAttended,
        reason,
      },
      rankedCount: ranked.length,
      sectionSize: ids.length,
      minWorkingDays,
    };
  }
}

export const portalAttendanceService = new PortalAttendanceService();
