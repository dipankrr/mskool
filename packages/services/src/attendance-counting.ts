/**
 * How attendance is counted (ADR-061). Pure: no database, so the rules are
 * unit-tested on their own and every caller counts the same way.
 *
 * Three rules live here and nowhere else:
 *
 * 1. **A student's working days start when they joined.** Days before the
 *    enrolment date, and the gap between leaving and rejoining, are not
 *    working days for that student. A student who has left stops counting on
 *    the day they left.
 * 2. **Late counts as attended when the school says so** (the policy's
 *    `lateCountsAsPresent`). Half day never counts as attended.
 * 3. **"So far" stops at a date** (normally today in IST). The stored summary
 *    rows count the whole period; decisions read the so-far figure.
 */

/** The calendar day types that count as working days. */
export const WORKING_DAY_TYPES: ReadonlySet<string> = new Set(["working", "exam_day", "half_day"]);

export type AttendanceStatusValue = "present" | "absent" | "late" | "half_day" | "on_leave";

/** One enrolment row's dates, as `student_enrollments` stores them. */
export type EnrollmentSpan = {
  enrollmentDate: string;
  /** Set while the student is away: the first day they were no longer at school. */
  leftOn: string | null;
  leavingHistory: readonly { leftOn: string | null; rejoinedOn: string }[];
};

/** A half-open range of ISO dates: from `from`, up to but not including `until`. */
export type DateRange = { from: string; until: string | null };

/**
 * The ranges a student was on the books. Each enrolment runs from its
 * enrolment date, minus every [leftOn, rejoinedOn) gap in its history, and
 * ends at a current `leftOn`.
 *
 * `firstMarkedOn` guards data that predates the rule: when a student was
 * marked before the recorded enrolment date (a school that onboarded and
 * typed the admission date later, or a fixture), the range starts at the
 * first mark, so marked days are never outside their own denominator.
 */
export function enrolledRanges(
  spans: readonly EnrollmentSpan[],
  firstMarkedOn: string | null,
): DateRange[] {
  const ranges: DateRange[] = [];
  for (const span of spans) {
    const gaps = span.leavingHistory
      .filter((g): g is { leftOn: string; rejoinedOn: string } => g.leftOn != null)
      .map((g) => ({ from: g.leftOn, until: g.rejoinedOn }))
      .sort((a, b) => (a.from < b.from ? -1 : 1));
    let cursor = span.enrollmentDate;
    for (const gap of gaps) {
      if (gap.from > cursor) ranges.push({ from: cursor, until: gap.from });
      if (gap.until > cursor) cursor = gap.until;
    }
    if (span.leftOn == null || span.leftOn > cursor) {
      ranges.push({ from: cursor, until: span.leftOn });
    }
  }
  ranges.sort((a, b) => (a.from < b.from ? -1 : 1));
  if (firstMarkedOn && ranges.length > 0 && firstMarkedOn < ranges[0]!.from) {
    ranges[0] = { ...ranges[0]!, from: firstMarkedOn };
  }
  if (firstMarkedOn && ranges.length === 0) {
    // Marked but no enrolment row read: count from the first mark.
    ranges.push({ from: firstMarkedOn, until: null });
  }
  return ranges;
}

export function isOnBooks(ranges: readonly DateRange[], iso: string): boolean {
  return ranges.some((r) => iso >= r.from && (r.until == null || iso < r.until));
}

export type AttendanceCounts = {
  workingDays: number;
  daysPresent: number;
  daysAbsent: number;
  daysLate: number;
  daysHalfDay: number;
  daysOnLeave: number;
  /** Present, plus late when the school counts late as attended. */
  daysAttended: number;
};

/**
 * One student's counts over [from, to], both inclusive. `asOf` caps the
 * period at that date (the "so far" figure); omit it for the whole period.
 * `workingDates` are the calendar's working days, any order.
 */
export function countAttendance(input: {
  workingDates: readonly string[];
  statuses: readonly { date: string; status: AttendanceStatusValue }[];
  ranges: readonly DateRange[];
  from: string;
  to: string;
  asOf?: string;
  lateCountsAsPresent: boolean;
}): AttendanceCounts {
  const end = input.asOf && input.asOf < input.to ? input.asOf : input.to;
  const inPeriod = (iso: string) => iso >= input.from && iso <= end;

  let workingDays = 0;
  for (const date of input.workingDates) {
    if (inPeriod(date) && isOnBooks(input.ranges, date)) workingDays += 1;
  }

  const counts: AttendanceCounts = {
    workingDays,
    daysPresent: 0,
    daysAbsent: 0,
    daysLate: 0,
    daysHalfDay: 0,
    daysOnLeave: 0,
    daysAttended: 0,
  };
  for (const row of input.statuses) {
    if (!inPeriod(row.date)) continue;
    if (row.status === "present") counts.daysPresent += 1;
    else if (row.status === "absent") counts.daysAbsent += 1;
    else if (row.status === "late") counts.daysLate += 1;
    else if (row.status === "half_day") counts.daysHalfDay += 1;
    else if (row.status === "on_leave") counts.daysOnLeave += 1;
  }
  counts.daysAttended = counts.daysPresent + (input.lateCountsAsPresent ? counts.daysLate : 0);
  return counts;
}

/**
 * Whether anything was marked in the period. A student (or a school) with no
 * marks has no attendance figure at all - never a 0% that would fail a
 * minimum-attendance rule at a school that does not take attendance.
 */
export function hasAttendanceMarks(c: AttendanceCounts): boolean {
  return c.daysPresent + c.daysAbsent + c.daysLate + c.daysHalfDay + c.daysOnLeave > 0;
}

/**
 * The percentage as the database's generated column computes it: two
 * decimals, rounded half away from zero, "0.00" when there are no working
 * days. Integer maths, so no float drift.
 */
export function attendancePercent(attended: number, workingDays: number): string {
  if (workingDays <= 0) return "0.00";
  const hundredths = Math.round((attended * 10000) / workingDays);
  return (hundredths / 100).toFixed(2);
}

/** First and last ISO date of a "YYYY-MM" month. */
export function monthBounds(key: string): { from: string; to: string } {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}
