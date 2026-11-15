import type {
  CalendarDayKind,
  HomeAttendanceToday,
  HomeAttendanceTodayInput,
  HomeBranch,
  HomeMyPapers,
  HomeMyPapersInput,
  HomeOrg,
} from "@repo/contracts";
import { getDataScopes, scopeWhere, type DataScope, type Permission, type UserAuthCache } from "@repo/authz";
import { db } from "@repo/db";
import {
  academicCalendar,
  academicYears,
  attendanceRecords,
  classes,
  dailyAttendanceStatus,
  examComponents,
  examSubjectSchedules,
  exams,
  schools,
  sectionTeacherAssignments as STA,
  sections,
  staff,
  studentComponentResults,
  studentEnrollments,
  subjects,
  user,
} from "@repo/db/schema";
import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";

import { assignmentIsCurrent } from "./assignment-access.service";
import { ENROLLED_STATUSES } from "./enrollment-status";
import { feesDashboardService } from "./fees-dashboard.service";
import { staffLoginService } from "./staff-login.service";

/**
 * STAFF HOME (ADR-072). The three reads Home needs that no other screen had:
 *
 * - `attendanceToday`: every section the caller may see in a branch, with
 *   its day (counts from `daily_attendance_status`, hard rule 5) and who
 *   marked it first. The "who" comes from `attendance_records.markedBy`:
 *   provenance of one row per section, never a count, so not the reporting
 *   read hard rule 5 forbids.
 * - `myPapers`: the caller's own subject pairs against open exams.
 * - `org`: per branch, only the figures the caller may read at that branch.
 */

const PRESENT_LIKE = ["present", "late", "half_day"] as const;
const OPEN_EXAM = ["marks_entry", "under_verification"] as const;
const UPCOMING_EXAM = ["scheduled", "ongoing", "marks_entry"] as const;

const SECTION_SCOPE = {
  organizationId: sections.organizationId,
  schoolId: sections.schoolId,
  classId: sections.classId,
  sectionId: sections.id,
};
const ENROLLMENT_SCOPE = {
  organizationId: studentEnrollments.organizationId,
  schoolId: studentEnrollments.schoolId,
  classId: studentEnrollments.classId,
  sectionId: studentEnrollments.sectionId,
};
const STAFF_SCOPE = { organizationId: staff.organizationId, schoolId: staff.schoolId };

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True when a grant covers the whole branch (or the org), not a class or section. */
export function coversWholeSchool(scopes: readonly DataScope[]): boolean {
  return scopes.some((s) => s.classId == null && s.sectionId == null);
}

async function enrolledBySection(sectionIds: string[], academicYearId: string) {
  if (sectionIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ sectionId: studentEnrollments.sectionId, n: sql<number>`count(*)::int` })
    .from(studentEnrollments)
    .where(
      and(
        inArray(studentEnrollments.sectionId, sectionIds),
        eq(studentEnrollments.academicYearId, academicYearId),
        inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
      ),
    )
    .groupBy(studentEnrollments.sectionId);
  return new Map(rows.map((r) => [r.sectionId ?? "", r.n]));
}

async function dayBySection(sectionIds: string[], date: string) {
  if (sectionIds.length === 0) return new Map<string, { marked: number; present: number }>();
  const rows = await db
    .select({
      sectionId: dailyAttendanceStatus.sectionId,
      marked: sql<number>`count(*)::int`,
      present: sql<number>`count(*) filter (where ${inArray(dailyAttendanceStatus.status, [...PRESENT_LIKE])})::int`,
    })
    .from(dailyAttendanceStatus)
    .where(and(inArray(dailyAttendanceStatus.sectionId, sectionIds), eq(dailyAttendanceStatus.date, date)))
    .groupBy(dailyAttendanceStatus.sectionId);
  return new Map(rows.map((r) => [r.sectionId, { marked: r.marked, present: r.present }]));
}

export class HomeService {
  async attendanceToday(
    scopes: DataScope[],
    schoolId: string,
    input: HomeAttendanceTodayInput,
  ): Promise<HomeAttendanceToday> {
    const sectionRows = await db
      .select({
        sectionId: sections.id,
        sectionName: sections.name,
        classId: classes.id,
        className: classes.name,
      })
      .from(sections)
      .innerJoin(classes, eq(sections.classId, classes.id))
      .where(
        and(
          eq(sections.schoolId, schoolId),
          eq(sections.academicYearId, input.academicYearId),
          eq(sections.status, "active"),
          scopeWhere(scopes, SECTION_SCOPE),
        ),
      )
      .orderBy(asc(classes.numericOrder), asc(sections.name));

    const ids = sectionRows.map((r) => r.sectionId);
    const [enrolled, days, firstMarks, calendarRows] = await Promise.all([
      enrolledBySection(ids, input.academicYearId),
      dayBySection(ids, input.date),
      ids.length === 0
        ? Promise.resolve([])
        : db
            .selectDistinctOn([attendanceRecords.sectionId], {
              sectionId: attendanceRecords.sectionId,
              userId: attendanceRecords.markedBy,
              name: user.name,
              at: attendanceRecords.createdAt,
            })
            .from(attendanceRecords)
            .innerJoin(user, eq(attendanceRecords.markedBy, user.id))
            .where(and(inArray(attendanceRecords.sectionId, ids), eq(attendanceRecords.date, input.date)))
            .orderBy(attendanceRecords.sectionId, asc(attendanceRecords.createdAt)),
      db
        .select({ date: academicCalendar.date, kind: academicCalendar.dayType, reason: academicCalendar.reason })
        .from(academicCalendar)
        .where(
          and(
            eq(academicCalendar.schoolId, schoolId),
            eq(academicCalendar.academicYearId, input.academicYearId),
            gte(academicCalendar.date, input.date),
            lte(academicCalendar.date, addDays(input.date, 30)),
          ),
        )
        .orderBy(asc(academicCalendar.date)),
    ]);

    const marker = new Map(firstMarks.map((m) => [m.sectionId, m]));
    const today = calendarRows.find((r) => r.date === input.date);

    return {
      date: input.date,
      day: today ? { kind: today.kind as CalendarDayKind, reason: today.reason } : null,
      wholeSchool: coversWholeSchool(scopes),
      sections: sectionRows.map((row) => {
        const day = days.get(row.sectionId);
        const m = marker.get(row.sectionId);
        return {
          ...row,
          students: enrolled.get(row.sectionId) ?? 0,
          marked: day?.marked ?? 0,
          present: day?.present ?? 0,
          markedBy: day && day.marked > 0 && m ? { userId: m.userId, name: m.name, at: m.at.toISOString() } : null,
        };
      }),
      upcoming: calendarRows
        .filter((r) => r.date > input.date && r.kind !== "working" && r.kind !== "weekend")
        .slice(0, 6)
        .map((r) => ({ date: r.date, kind: r.kind as CalendarDayKind, reason: r.reason })),
    };
  }

  /**
   * The caller's own subject pairs against the branch's exams. No permission
   * gate, like `assignment.mine`: it is the caller's own work, found from the
   * session's login, and only counts come back.
   */
  async myPapers(userId: string, input: HomeMyPapersInput): Promise<HomeMyPapers> {
    const pairs = await db
      .select({
        sectionId: sections.id,
        sectionName: sections.name,
        classId: sections.classId,
        className: classes.name,
        academicYearId: sections.academicYearId,
        subjectId: subjects.id,
        subjectName: subjects.name,
      })
      .from(STA)
      .innerJoin(staff, eq(STA.staffId, staff.id))
      .innerJoin(sections, eq(STA.sectionId, sections.id))
      .innerJoin(classes, eq(sections.classId, classes.id))
      .innerJoin(subjects, eq(STA.subjectId, subjects.id))
      .where(
        and(
          eq(STA.organizationId, input.organizationId),
          eq(STA.schoolId, input.schoolId),
          eq(staff.userId, userId),
          assignmentIsCurrent(),
        ),
      )
      .orderBy(asc(classes.numericOrder), asc(sections.name), asc(subjects.name));

    if (pairs.length === 0) return { open: [], upcoming: [] };

    const subjectIds = [...new Set(pairs.map((p) => p.subjectId))];
    const classIds = [...new Set(pairs.map((p) => p.classId))];
    const schedules = await db
      .select({
        scheduleId: examSubjectSchedules.id,
        examId: exams.id,
        examName: exams.name,
        status: exams.status,
        classId: examSubjectSchedules.classId,
        sectionId: examSubjectSchedules.sectionId,
        subjectId: examSubjectSchedules.subjectId,
        examDate: examSubjectSchedules.examDate,
      })
      .from(examSubjectSchedules)
      .innerJoin(exams, eq(examSubjectSchedules.examId, exams.id))
      .where(
        and(
          eq(exams.organizationId, input.organizationId),
          eq(exams.schoolId, input.schoolId),
          inArray(exams.status, [...new Set([...OPEN_EXAM, ...UPCOMING_EXAM])]),
          inArray(examSubjectSchedules.subjectId, subjectIds),
          inArray(examSubjectSchedules.classId, classIds),
        ),
      )
      .orderBy(asc(examSubjectSchedules.examDate));

    // A section paper wins over the class-wide one (ADR-052: they partition).
    const paperFor = (pair: (typeof pairs)[number], rows: typeof schedules) =>
      rows.find((s) => s.subjectId === pair.subjectId && s.sectionId === pair.sectionId) ??
      rows.find((s) => s.subjectId === pair.subjectId && s.sectionId === null && s.classId === pair.classId);

    const examIds = [...new Set(schedules.map((s) => s.examId))];
    const openPapers: Array<{ pair: (typeof pairs)[number]; paper: (typeof schedules)[number] }> = [];
    const upcoming: HomeMyPapers["upcoming"] = [];
    for (const examId of examIds) {
      const rows = schedules.filter((s) => s.examId === examId);
      for (const pair of pairs) {
        const paper = paperFor(pair, rows);
        if (!paper) continue;
        if ((OPEN_EXAM as readonly string[]).includes(paper.status)) {
          openPapers.push({ pair, paper });
        } else if (paper.examDate >= input.date && paper.examDate <= addDays(input.date, 30)) {
          upcoming.push({
            examName: paper.examName,
            examDate: paper.examDate,
            sectionName: pair.sectionName,
            className: pair.className,
            subjectName: pair.subjectName,
          });
        }
      }
    }

    if (openPapers.length === 0) {
      return { open: [], upcoming: upcoming.sort((a, b) => a.examDate.localeCompare(b.examDate)) };
    }

    const scheduleIds = [...new Set(openPapers.map((o) => o.paper.scheduleId))];
    const sectionIds = [...new Set(openPapers.map((o) => o.pair.sectionId))];
    const yearIds = [...new Set(openPapers.map((o) => o.pair.academicYearId))];

    const [componentRows, enrolledRows, enteredRows] = await Promise.all([
      db
        .select({ scheduleId: examComponents.scheduleId, n: sql<number>`count(*)::int` })
        .from(examComponents)
        .where(inArray(examComponents.scheduleId, scheduleIds))
        .groupBy(examComponents.scheduleId),
      db
        .select({ sectionId: studentEnrollments.sectionId, n: sql<number>`count(*)::int` })
        .from(studentEnrollments)
        .where(
          and(
            inArray(studentEnrollments.sectionId, sectionIds),
            inArray(studentEnrollments.academicYearId, yearIds),
            inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
          ),
        )
        .groupBy(studentEnrollments.sectionId),
      db
        .select({
          scheduleId: studentComponentResults.scheduleId,
          sectionId: studentEnrollments.sectionId,
          studentId: studentComponentResults.studentId,
          n: sql<number>`count(*)::int`,
        })
        .from(studentComponentResults)
        .innerJoin(
          studentEnrollments,
          and(
            eq(studentEnrollments.studentId, studentComponentResults.studentId),
            inArray(studentEnrollments.academicYearId, yearIds),
            inArray(studentEnrollments.sectionId, sectionIds),
            inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
          ),
        )
        .where(
          and(
            inArray(studentComponentResults.scheduleId, scheduleIds),
            ne(studentComponentResults.resultStatus, "draft"),
          ),
        )
        .groupBy(studentComponentResults.scheduleId, studentEnrollments.sectionId, studentComponentResults.studentId),
    ]);

    const components = new Map(componentRows.map((r) => [r.scheduleId, r.n]));
    const enrolled = new Map(enrolledRows.map((r) => [r.sectionId ?? "", r.n]));
    const entered = new Map<string, number>();
    for (const row of enteredRows) {
      const need = components.get(row.scheduleId) ?? 1;
      if (row.n < need) continue;
      const key = `${row.scheduleId}:${row.sectionId}`;
      entered.set(key, (entered.get(key) ?? 0) + 1);
    }

    return {
      open: openPapers.map(({ pair, paper }) => ({
        examId: paper.examId,
        examName: paper.examName,
        scheduleId: paper.scheduleId,
        sectionId: pair.sectionId,
        sectionName: pair.sectionName,
        className: pair.className,
        subjectId: pair.subjectId,
        subjectName: pair.subjectName,
        examDate: paper.examDate,
        students: enrolled.get(pair.sectionId) ?? 0,
        entered: entered.get(`${paper.scheduleId}:${pair.sectionId}`) ?? 0,
      })),
      upcoming: upcoming.sort((a, b) => a.examDate.localeCompare(b.examDate)),
    };
  }

  /**
   * The All branches view (ADR-072, built as ADR-067 point 2 foresaw). For
   * each branch the caller can see, each figure is read only under the
   * caller's own grants for that figure at that branch, and is null without
   * one. Branches can run different sessions; each uses its own running one.
   */
  async org(authCache: UserAuthCache, organizationId: string, visible: DataScope[], date: string): Promise<HomeOrg> {
    const branchRows = await db
      .select({ schoolId: schools.id, name: schools.name })
      .from(schools)
      .where(and(eq(schools.organizationId, organizationId), eq(schools.isActive, true)))
      .orderBy(asc(schools.name));

    const seeable = branchRows.filter((b) => visible.some((s) => s.schoolId == null || s.schoolId === b.schoolId));

    const branches = await Promise.all(
      seeable.map(async (b): Promise<HomeBranch> => {
        const at: DataScope = { organizationId, schoolId: b.schoolId, classId: null, sectionId: null };
        const grants = (p: Permission) => getDataScopes(authCache, p, at);

        const [session] = await db
          .select({ id: academicYears.id, name: academicYears.name })
          .from(academicYears)
          .where(and(eq(academicYears.schoolId, b.schoolId), eq(academicYears.isCurrent, true)));

        const studentScopes = grants("student:read");
        const attendanceScopes = grants("attendance:read");
        const feeScopes = grants("fee_report:read");
        const staffScopes = grants("staff:read");

        const [students, attendance, fees, staffFigures] = await Promise.all([
          session && studentScopes.length > 0 ? this.countStudents(studentScopes, session.id) : null,
          session && attendanceScopes.length > 0
            ? this.branchAttendance(attendanceScopes, b.schoolId, session.id, date)
            : null,
          session && feeScopes.length > 0
            ? feesDashboardService.overview(feeScopes, { organizationId, academicYearId: session.id }, false)
            : null,
          staffScopes.length > 0 ? this.staffFigures(staffScopes, b.schoolId) : null,
        ]);

        return {
          schoolId: b.schoolId,
          name: b.name,
          session: session ?? null,
          students,
          attendance,
          fees: fees
            ? {
                collectedToday: fees.collectedToday,
                receiptsToday: fees.receiptsToday,
                collectedThisMonth: fees.collectedThisMonth,
                billedThisMonth: fees.billedThisMonth,
                paidOnThisMonth: fees.paidOnThisMonth,
              }
            : null,
          staff: staffFigures,
        };
      }),
    );

    return { branches };
  }

  private async countStudents(scopes: DataScope[], academicYearId: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.academicYearId, academicYearId),
          inArray(studentEnrollments.enrollmentStatus, [...ENROLLED_STATUSES]),
          scopeWhere(scopes, ENROLLMENT_SCOPE),
        ),
      );
    return row?.n ?? 0;
  }

  private async branchAttendance(scopes: DataScope[], schoolId: string, academicYearId: string, date: string) {
    const sectionRows = await db
      .select({ id: sections.id })
      .from(sections)
      .where(
        and(
          eq(sections.schoolId, schoolId),
          eq(sections.academicYearId, academicYearId),
          eq(sections.status, "active"),
          scopeWhere(scopes, SECTION_SCOPE),
        ),
      );
    const ids = sectionRows.map((r) => r.id);
    const days = await dayBySection(ids, date);
    let present = 0;
    let marked = 0;
    for (const d of days.values()) {
      present += d.present;
      marked += d.marked;
    }
    return { present, marked, sectionsMarked: days.size, sections: ids.length };
  }

  private async staffFigures(scopes: DataScope[], schoolId: string) {
    const rows = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.schoolId, schoolId), eq(staff.status, "active"), scopeWhere(scopes, STAFF_SCOPE)));
    const states = await staffLoginService.joinStates(rows.map((r) => r.id));
    let notJoined = 0;
    for (const state of states.values()) if (state !== "joined") notJoined += 1;
    return { total: rows.length, notJoined };
  }
}

export const homeService = new HomeService();
