/**
 * Pure date helpers for the attendance calendar (ADR-069). Calendar dates
 * have no zone: every walk parses `T00:00:00Z` and reads UTC getters only.
 */

export type PatternDay = "working" | "half_day" | "weekend";

/** Every ISO date from `from` to `to`, both inclusive (empty when reversed). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** 0 = Sunday … 6 = Saturday, like `Date.getUTCDay()`. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** The normal week's answer for one date. */
export function patternDayType(weekdays: readonly PatternDay[], iso: string): PatternDay {
  return weekdays[weekdayOf(iso)] ?? "weekend";
}

/** The pattern the old generator input describes (working + half-day weekdays). */
export function patternFromWeekdays(
  working: readonly number[],
  halfDay: readonly number[] = [],
): PatternDay[] {
  return Array.from({ length: 7 }, (_, day) =>
    working.includes(day) ? (halfDay.includes(day) ? "half_day" : "working") : "weekend",
  );
}

/** Moves a date by whole years; 29 Feb lands on 28 Feb in a common year. */
export function shiftYears(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  const m = Number(iso.slice(5, 7));
  let d = Number(iso.slice(8, 10));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) d = last;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Holidays that fall on the same date every year in India. Anything else
 * copied from last session (festivals) is flagged for the admin to check.
 */
const FIXED_DATES = new Set(["01-01", "01-26", "05-01", "08-15", "10-02", "12-25"]);
export function isFixedDate(iso: string): boolean {
  return FIXED_DATES.has(iso.slice(5));
}

/** Days a session gains and loses when its dates move. */
export function sessionDateDiff(
  before: { startDate: string; endDate: string },
  after: { startDate: string; endDate: string },
): { added: string[]; removed: string[] } {
  const was = new Set(datesBetween(before.startDate, before.endDate));
  const now = datesBetween(after.startDate, after.endDate);
  const nowSet = new Set(now);
  return {
    added: now.filter((iso) => !was.has(iso)),
    removed: [...was].filter((iso) => !nowSet.has(iso)).sort(),
  };
}

/** School days: the types a teacher can mark and every % is out of. */
export const SCHOOL_DAY_TYPES: ReadonlySet<string> = new Set(["working", "half_day", "exam_day"]);
