import { db } from "@repo/db";
import {
  academicCalendar,
  academicYears,
  attendancePolicies,
  dailyAttendanceStatus,
  studentEnrollments,
  terms,
} from "@repo/db/schema";
import { sql } from "drizzle-orm";

import {
  WORKING_DAY_TYPES,
  attendancePercent,
  hasAttendanceMarks,
  countAttendance,
  enrolledRanges,
  type AttendanceCounts,
  type AttendanceStatusValue,
  type DateRange,
} from "./attendance-counting";
import { todayInIst } from "./enrollment-status";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Accepts an open transaction or the root db. */
export type AttendanceExecutor = Tx | typeof db;

/** Everything the counting rules need for a set of students in one school year. */
export type CountingInputs = {
  workingDates: string[];
  lateCountsAsPresent: boolean;
  statusesByStudent: Map<string, { date: string; status: AttendanceStatusValue }[]>;
  rangesByStudent: Map<string, DateRange[]>;
  /** The year's dates; null when the year is not this school's. */
  year: { startDate: string; endDate: string } | null;
  terms: { id: string; startDate: string; endDate: string }[];
};

type LoadedRow = {
  working: string[] | null;
  late: boolean | null;
  year: { startDate: string; endDate: string } | null;
  terms: { id: string; startDate: string; endDate: string }[] | null;
  enrollments:
    | {
        studentId: string;
        enrollmentDate: string;
        leftOn: string | null;
        leavingHistory: { leftOn: string | null; rejoinedOn: string }[] | null;
      }[]
    | null;
  statuses: [string, string, AttendanceStatusValue][] | null;
};

/**
 * ONE statement, whatever the number of students: the year's working days,
 * the school's late rule, the year and its terms, the students' enrolment
 * rows and their daily statuses (hard rule 5: never `attendance_records`).
 * One statement because each separate query inside a transaction costs a
 * full round trip to the database (about 0.2 s remote), and this read sits
 * on every attendance save. Every part is pinned to the school, the year
 * and the named students.
 */
export async function loadCountingInputs(
  exec: AttendanceExecutor,
  input: { schoolId: string; academicYearId: string; studentIds: readonly string[] },
): Promise<CountingInputs> {
  const studentIds = [...new Set(input.studentIds)];
  const ids = studentIds.length
    ? sql.join(
        studentIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )
    : sql`NULL::uuid`;
  const working = [...WORKING_DAY_TYPES].map((t) => sql`${t}`);

  const rows = (await exec.execute(sql`
    SELECT
      (SELECT json_agg(c.date ORDER BY c.date)
         FROM ${academicCalendar} c
        WHERE c.school_id = ${input.schoolId}
          AND c.academic_year_id = ${input.academicYearId}
          AND c.day_type::text IN (${sql.join(working, sql`, `)})) AS working,
      (SELECT p.late_counts_as_present
         FROM ${attendancePolicies} p
        WHERE p.school_id = ${input.schoolId}) AS late,
      (SELECT json_build_object('startDate', y.start_date, 'endDate', y.end_date)
         FROM ${academicYears} y
        WHERE y.id = ${input.academicYearId}
          AND y.school_id = ${input.schoolId}) AS year,
      (SELECT json_agg(json_build_object('id', t.id, 'startDate', t.start_date, 'endDate', t.end_date))
         FROM ${terms} t
        WHERE t.academic_year_id = ${input.academicYearId}
          AND t.school_id = ${input.schoolId}) AS terms,
      (SELECT json_agg(json_build_object(
                'studentId', e.student_id,
                'enrollmentDate', e.enrollment_date,
                'leftOn', e.left_on,
                'leavingHistory', e.leaving_history))
         FROM ${studentEnrollments} e
        WHERE e.school_id = ${input.schoolId}
          AND e.academic_year_id = ${input.academicYearId}
          AND e.student_id IN (${ids})) AS enrollments,
      (SELECT json_agg(json_build_array(d.student_id, d.date, d.status))
         FROM ${dailyAttendanceStatus} d
        WHERE d.school_id = ${input.schoolId}
          AND d.academic_year_id = ${input.academicYearId}
          AND d.student_id IN (${ids})) AS statuses
  `)) as unknown as LoadedRow[];
  const row = rows[0];
  const enrollments = row?.enrollments ?? [];
  const statuses = (row?.statuses ?? []).map(([studentId, date, status]) => ({
    studentId,
    date,
    status,
  }));

  const statusesByStudent = new Map<string, { date: string; status: AttendanceStatusValue }[]>();
  for (const row of statuses) {
    const list = statusesByStudent.get(row.studentId) ?? [];
    list.push({ date: row.date, status: row.status as AttendanceStatusValue });
    statusesByStudent.set(row.studentId, list);
  }

  const spansByStudent = new Map<string, (typeof enrollments)[number][]>();
  for (const row of enrollments) {
    const list = spansByStudent.get(row.studentId) ?? [];
    list.push(row);
    spansByStudent.set(row.studentId, list);
  }

  const rangesByStudent = new Map<string, DateRange[]>();
  for (const studentId of studentIds) {
    const marks = statusesByStudent.get(studentId) ?? [];
    let first: string | null = null;
    for (const m of marks) if (first == null || m.date < first) first = m.date;
    rangesByStudent.set(
      studentId,
      enrolledRanges(
        (spansByStudent.get(studentId) ?? []).map((s) => ({
          enrollmentDate: s.enrollmentDate,
          leftOn: s.leftOn,
          leavingHistory: s.leavingHistory ?? [],
        })),
        first,
      ),
    );
  }

  return {
    workingDates: row?.working ?? [],
    lateCountsAsPresent: row?.late ?? true,
    statusesByStudent,
    rangesByStudent,
    year: row?.year ?? null,
    terms: row?.terms ?? [],
  };
}

export type AttendanceToDate = AttendanceCounts & { percentage: string };

/**
 * The "so far" figure (ADR-061): each student's counts over [from, to],
 * stopping at `asOf` (today in IST by default) and at the days they were on
 * the books. This is the number decisions read: term results, exam
 * eligibility, report cards and the family screens. With no `from`/`to`,
 * the whole school year.
 */
export async function attendanceToDate(
  exec: AttendanceExecutor,
  input: {
    schoolId: string;
    academicYearId: string;
    studentIds: readonly string[];
    from?: string;
    to?: string;
    asOf?: string;
  },
): Promise<Map<string, AttendanceToDate>> {
  const out = new Map<string, AttendanceToDate>();
  if (input.studentIds.length === 0) return out;

  const inputs = await loadCountingInputs(exec, input);
  // The year must be this school's; its dates are the default period.
  if (!inputs.year) return out;
  const from = input.from ?? inputs.year.startDate;
  const to = input.to ?? inputs.year.endDate;
  const asOf = input.asOf ?? todayInIst();
  for (const studentId of new Set(input.studentIds)) {
    const counts = countAttendance({
      workingDates: inputs.workingDates,
      statuses: inputs.statusesByStudent.get(studentId) ?? [],
      ranges: inputs.rangesByStudent.get(studentId) ?? [],
      from,
      to,
      asOf,
      lateCountsAsPresent: inputs.lateCountsAsPresent,
    });
    // Nothing marked in the period: no figure, as when no summary row existed.
    if (!hasAttendanceMarks(counts)) continue;
    out.set(studentId, {
      ...counts,
      percentage: attendancePercent(counts.daysAttended, counts.workingDays),
    });
  }
  return out;
}
