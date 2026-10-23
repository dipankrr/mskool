import { MARKABLE_DAY_TYPES } from "../status-meta";

export type CalendarSummaryRow = {
  date: string;
  dayType: string;
  reason: string | null;
};

export type CalendarSummary = {
  /** Markable days in the session (working, half day, exam day). */
  workingDays: number;
  /** Days in the current month with no calendar row at all. */
  missingThisMonth: number;
  /** The next holiday on or after today, with its reason when set. */
  nextHoliday: { date: string; reason: string | null } | null;
};

const markable = new Set(MARKABLE_DAY_TYPES);

/**
 * The manage hub's calendar glance. The calendar is the source of truth for
 * both the working-day denominator and the marking gate, so this helper only
 * reads the rows it is given: no expected-weekday assumptions, no synthetic
 * holidays. Missing means "no row", which is exactly what the marking gate
 * refuses.
 */
export function summarizeCalendar(
  rows: readonly CalendarSummaryRow[],
  today: string,
  sessionStart?: string,
  sessionEnd?: string,
): CalendarSummary {
  if (rows.length === 0) {
    return { workingDays: 0, missingThisMonth: 0, nextHoliday: null };
  }

  const workingDays = rows.reduce((sum, row) => (markable.has(row.dayType) ? sum + 1 : sum), 0);

  // The current month can sit outside the session (a school opens the app in
  // the summer break or after the year closed). Do not warn about dates the
  // calendar was never meant to cover.
  const monthPrefix = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const daysInCurrentMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStart = `${monthPrefix}-01`;
  const monthEnd = `${monthPrefix}-${String(daysInCurrentMonth).padStart(2, "0")}`;
  const expectedFrom = sessionStart && sessionStart > monthStart ? sessionStart : monthStart;
  const expectedTo = sessionEnd && sessionEnd < monthEnd ? sessionEnd : monthEnd;
  const expectedDays =
    expectedFrom <= expectedTo ? isoDayDistance(expectedFrom, expectedTo) + 1 : 0;
  const monthRows = rows.filter(
    (row) => row.date.startsWith(monthPrefix) && row.date >= expectedFrom && row.date <= expectedTo,
  );
  const missingThisMonth = Math.max(0, expectedDays - monthRows.length);

  const next = rows
    .filter((row) => row.dayType === "holiday" && row.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  return {
    workingDays,
    missingThisMonth,
    nextHoliday: next ? { date: next.date, reason: next.reason } : null,
  };
}

/** Whole days between two ISO dates; UTC keeps DST out of the arithmetic. */
function isoDayDistance(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}
