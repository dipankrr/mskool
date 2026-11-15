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

// ---------------------------------------------------------------------------
// Week structures as date ranges (ADR-069)
// ---------------------------------------------------------------------------

/** One week structure in force over [from, to]. Ranges never overlap. */
export type WeekRange = { from: string; to: string; weekdays: PatternDay[] };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const sameWeek = (a: readonly PatternDay[], b: readonly PatternDay[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Joins touching ranges that carry the same week. */
function merge(ranges: readonly WeekRange[]): WeekRange[] {
  const sorted = [...ranges].sort((a, b) => (a.from < b.from ? -1 : 1));
  const out: WeekRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && sameWeek(last.weekdays, range.weekdays) && addDays(last.to, 1) >= range.from) {
      if (range.to > last.to) last.to = range.to;
    } else {
      out.push({ ...range, weekdays: [...range.weekdays] });
    }
  }
  return out;
}

/** The week in force on a date; outside every range, the nearest one's. */
export function weekAt(ranges: readonly WeekRange[], iso: string): PatternDay[] | null {
  if (ranges.length === 0) return null;
  const hit = ranges.find((r) => r.from <= iso && iso <= r.to);
  if (hit) return hit.weekdays;
  const before = [...ranges].reverse().find((r) => r.to < iso);
  return (before ?? ranges[0]!).weekdays;
}

/** Lays a new week over [from, to]; what it covers is cut out of the others. */
export function applyRange(ranges: readonly WeekRange[], next: WeekRange): WeekRange[] {
  const kept: WeekRange[] = [];
  for (const r of ranges) {
    if (r.to < next.from || r.from > next.to) {
      kept.push(r);
      continue;
    }
    if (r.from < next.from) kept.push({ ...r, to: addDays(next.from, -1) });
    if (r.to > next.to) kept.push({ ...r, from: addDays(next.to, 1) });
  }
  return merge([...kept, next]);
}

/** Removes one range; its days go back to the week before it (or after it). */
export function removeRange(ranges: readonly WeekRange[], index: number): WeekRange[] {
  const sorted = [...ranges].sort((a, b) => (a.from < b.from ? -1 : 1));
  const gone = sorted[index];
  if (!gone || sorted.length < 2) return sorted;
  const rest = sorted.filter((_, i) => i !== index);
  const before = index > 0 ? rest[index - 1] : undefined;
  if (before) before.to = gone.to > before.to ? gone.to : before.to;
  else rest[0]!.from = gone.from;
  return merge(rest);
}

/** Stretches or trims the ranges to exactly cover the session. */
export function fitToSession(ranges: readonly WeekRange[], start: string, end: string): WeekRange[] {
  const inside = merge(ranges)
    .filter((r) => r.to >= start && r.from <= end)
    .map((r) => ({ ...r, from: r.from < start ? start : r.from, to: r.to > end ? end : r.to }));
  if (inside.length === 0) {
    const fallback = ranges[ranges.length - 1];
    return fallback ? [{ ...fallback, from: start, to: end }] : [];
  }
  inside[0]!.from = start;
  inside[inside.length - 1]!.to = end;
  return inside;
}
