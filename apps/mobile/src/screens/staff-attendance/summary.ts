import type { RosterEntry } from "./roster";

/**
 * The summary panel's pure maths — reading `attendance.summary` rows the way
 * the web report does, never recomputing what the server already aggregated
 * (hard rule 5's read-model has exactly one writer: the mark transaction).
 *
 * Slice selection follows `apps/web/.../attendance/reports/page.tsx`: the
 * annual row is the report; monthly rows are the register's job and are
 * ignored. The term fallback exists for schools where annual has not been
 * recomputed; every mark writes both, so it is defensive — when it fires, one
 * row per student is kept (the term with the most working days) because a
 * phone list repeating a student twice would read as a bug.
 *
 * `attendancePercentage` arrives as a server string (numeric column, generated
 * stored) — formatting parses it once for display and never does arithmetic on
 * it beyond that.
 */

export type SummaryRow = {
  studentId: string;
  periodType: "monthly" | "term" | "annual";
  workingDays: number;
  daysPresent: number;
  daysAbsent: number;
  daysLate: number;
  daysHalfDay: number;
  daysOnLeave: number;
  /** Generated stored column: never null in practice, nullable in the API. */
  attendancePercentage: string | null;
};

/** The row a student's summary line renders from, or nothing when unmarked. */
export function summaryByStudent(rows: readonly SummaryRow[]): Map<string, SummaryRow> {
  const term = new Map<string, SummaryRow>();
  const annual = new Map<string, SummaryRow>();

  for (const row of rows) {
    if (row.periodType === "annual") {
      annual.set(row.studentId, row);
    } else if (row.periodType === "term") {
      const previous = term.get(row.studentId);
      if (!previous || row.workingDays > previous.workingDays) {
        term.set(row.studentId, row);
      }
    }
  }

  const byStudent = new Map(term);
  for (const [studentId, row] of annual) {
    byStudent.set(studentId, row);
  }
  return byStudent;
}

export type SummarySort = "roll" | "top" | "mostAbsent";

/**
 * The summary list's client-side order. Roll is the roster's own order and the
 * default; the other two are reads over the same summary rows, never a new
 * endpoint. Students with no summary row always sink to the bottom so a
 * "top present" sort cannot put missing data first. Ties fall back to the
 * student's name for a stable, predictable list.
 */
export function sortSummaryRoster(
  roster: readonly RosterEntry[],
  byStudent: ReadonlyMap<string, SummaryRow>,
  sort: SummarySort,
): RosterEntry[] {
  const copy = [...roster];
  if (sort === "roll") return copy;

  return copy.sort((a, b) => {
    const rowA = byStudent.get(a.studentId);
    const rowB = byStudent.get(b.studentId);
    if (!rowA && !rowB) return a.name.localeCompare(b.name);
    if (!rowA) return 1;
    if (!rowB) return -1;

    if (sort === "top") {
      const shareA = presentSharePercent(rowA) ?? 0;
      const shareB = presentSharePercent(rowB) ?? 0;
      if (shareA !== shareB) return shareB - shareA;
      if (rowA.daysPresent !== rowB.daysPresent) {
        return rowB.daysPresent - rowA.daysPresent;
      }
    } else {
      if (rowA.daysAbsent !== rowB.daysAbsent) {
        return rowB.daysAbsent - rowA.daysAbsent;
      }
      const shareA = presentSharePercent(rowA) ?? 0;
      const shareB = presentSharePercent(rowB) ?? 0;
      if (shareA !== shareB) return shareA - shareB;
    }
    return a.name.localeCompare(b.name);
  });
}

export type SectionTotals = {
  /** Σ daysPresent over students with rows. */
  present: number;
  /** Σ daysAbsent over students with rows. */
  absent: number;
  /** Σ daysLate over students with rows. */
  late: number;
  /** Σ daysHalfDay over students with rows. */
  halfDay: number;
  /** Σ daysOnLeave over students with rows. */
  onLeave: number;
  /** Σ workingDays over students with rows. */
  working: number;
  /**
   * Days the section has attendance for: the most-covered student's
   * marked-day count (every bucket, including half day). Marking writes a
   * status for every student on a marked day, so the fullest student's count
   * is the section's coverage. The server's percentage stays the audited
   * figure and does not treat half day as present.
   */
  markedDays: number;
  /** Σ every bucket over students with rows — the status strip's base. */
  markedStatusDays: number;
  /** Roster students with no summary row at all ("no attendance yet"). */
  noData: number;
  /** The section's working-day count (calendar truth; same for all students). */
  workingDays: number | null;
};

export function sectionTotals(
  byStudent: ReadonlyMap<string, SummaryRow>,
  rosterIds: readonly string[],
): SectionTotals {
  let present = 0;
  let absent = 0;
  let late = 0;
  let halfDay = 0;
  let onLeave = 0;
  let working = 0;
  let markedDays = 0;
  let markedStatusDays = 0;
  let noData = 0;
  let workingDays: number | null = null;

  for (const studentId of rosterIds) {
    const row = byStudent.get(studentId);
    if (!row) {
      noData += 1;
      continue;
    }
    present += row.daysPresent;
    absent += row.daysAbsent;
    late += row.daysLate;
    halfDay += row.daysHalfDay;
    onLeave += row.daysOnLeave;
    working += row.workingDays;
    const studentMarkedDays = markedDaysForRow(row);
    markedStatusDays += studentMarkedDays;
    markedDays = Math.max(markedDays, studentMarkedDays);
    workingDays = workingDays === null ? row.workingDays : Math.max(workingDays, row.workingDays);
  }

  return {
    present,
    absent,
    late,
    halfDay,
    onLeave,
    working,
    markedDays,
    markedStatusDays,
    noData,
    workingDays,
  };
}

/** One student's marked-day count, using the same buckets as the summary. */
export function markedDaysForRow(row: SummaryRow): number {
  return (
    row.daysPresent +
    row.daysAbsent +
    row.daysLate +
    row.daysHalfDay +
    row.daysOnLeave
  );
}

/** Present days ÷ all marked statuses for one student; null before any mark. */
export function presentSharePercent(row: SummaryRow): number | null {
  const marked = markedDaysForRow(row);
  if (marked === 0) return null;
  return (row.daysPresent / marked) * 100;
}

/** Present days ÷ all marked statuses across the section; null before any mark. */
export function presentSharePercentForTotals(totals: SectionTotals): number | null {
  if (totals.markedStatusDays === 0) return null;
  return (totals.present / totals.markedStatusDays) * 100;
}

/** Σpresent ÷ Σworking as a percentage, or null when nothing is marked. */
export function averagePercent(totals: SectionTotals): number | null {
  if (totals.working === 0) return null;
  return (totals.present / totals.working) * 100;
}

/**
 * The coverage bar's fill, 0–100: marked days over the section's working
 * days. A started year always shows at least a readable sliver (4) so "1 of
 * 311" cannot render as an empty bar; buckets that exceed the calendar clamp
 * at 100 (defensive — the calendar can change after a mark); a section with
 * no rows fills nothing and the caption carries the words instead.
 */
export function coveragePercent(totals: SectionTotals): number {
  if (totals.workingDays === null || totals.workingDays <= 0) return 0;
  const percent = (totals.markedDays / totals.workingDays) * 100;
  if (percent <= 0) return 0;
  return Math.min(100, Math.max(percent, 4));
}

/**
 * `"72.73"` → `"72.7%"`, `"75.00"` → `"75%"`, `"0.00"` → `"0%"`. One decimal,
 * trailing `.0` dropped; null or unparseable input keeps the em dash the rest
 * of the app uses for absent values.
 */
export function formatPercent(value: number | string | null): string {
  if (value === null) return "—";
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return "—";
  const rounded = Math.round(parsed * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}%`;
}
