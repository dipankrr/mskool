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
  daysOnLeave: number;
  /** Generated stored column: never null in practice, nullable in the API. */
  attendancePercentage: string | null;
};

/** The row a student's summary line renders from, or nothing when unmarked. */
export function summaryByStudent(
  rows: readonly SummaryRow[],
): Map<string, SummaryRow> {
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

export type SectionTotals = {
  /** Σ daysPresent over students with rows. */
  present: number;
  /** Σ workingDays over students with rows. */
  working: number;
  /**
   * Days the section has attendance for: the most-covered student's
   * marked-day count (every bucket plus on-leave). Marking writes a status
   * for every student on a marked day, so the fullest student's count is the
   * section's coverage; a day where every student was `half_day` fills no
   * bucket and is the one edge this glance number misses. The server's
   * percentage stays the audited figure.
   */
  markedDays: number;
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
  let working = 0;
  let markedDays = 0;
  let noData = 0;
  let workingDays: number | null = null;

  for (const studentId of rosterIds) {
    const row = byStudent.get(studentId);
    if (!row) {
      noData += 1;
      continue;
    }
    present += row.daysPresent;
    working += row.workingDays;
    markedDays = Math.max(
      markedDays,
      row.daysPresent + row.daysAbsent + row.daysLate + row.daysOnLeave,
    );
    workingDays =
      workingDays === null ? row.workingDays : Math.max(workingDays, row.workingDays);
  }

  return { present, working, markedDays, noData, workingDays };
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
