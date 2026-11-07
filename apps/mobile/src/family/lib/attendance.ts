/**
 * Pure rules for the family Attendance screen: month keys, the calendar
 * grid, and what each day looks like. Kept out of the screen so they are
 * tested, and so a redesign only touches the drawing.
 */

export type DayStatus = "present" | "absent" | "late" | "half_day" | "on_leave" | "not_marked";
export type DayType = "working" | "holiday" | "half_day" | "weekend" | "exam_day" | null;

export type MonthDay = {
  date: string;
  dayType: DayType;
  label: string | null;
  enrolled: boolean;
  status: DayStatus | null;
};

/** What a calendar cell shows. Screens map these to theme tones. */
export type DayLook =
  | "present"
  | "absent"
  | "late"
  | "halfDay"
  | "leave"
  | "holiday"
  | "notMarked"
  | "upcoming"
  | "notEnrolled"
  | "none";

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

/** "2026-11-07" → "2026-11". */
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/** "2026-11" ± n months. */
export function shiftMonth(key: string, by: number): string {
  const match = MONTH_KEY.exec(key);
  if (!match) return key;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + by;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Month keys may be compared as strings. */
export function clampMonth(key: string, first: string, last: string): string {
  if (key < first) return first;
  if (key > last) return last;
  return key;
}

/**
 * The months the screen lets a family step through: from the first term's
 * start (or 11 months back) to the month of `asOf`.
 */
export function monthBounds(asOf: string, termStarts: readonly string[]): { first: string; last: string } {
  const last = monthKeyOf(asOf);
  const starts = [...termStarts].sort();
  const first = starts[0] ? monthKeyOf(starts[0]) : shiftMonth(last, -11);
  return { first: first > last ? last : first, last };
}

/** One cell: a day of the month, or a blank before the 1st / after the last. */
export type GridCell = { kind: "blank" } | { kind: "day"; day: number; info: MonthDay | null };

/**
 * The month as weeks, Monday first, padded with blanks. Days the server did
 * not send still appear (with `info: null`) so the grid never has holes.
 */
export function monthGrid(key: string, days: readonly MonthDay[]): GridCell[][] {
  const match = MONTH_KEY.exec(key);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const length = new Date(year, month, 0).getDate();
  // getDay: Sunday 0 … Saturday 6. Monday-first offset:
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const cells: GridCell[] = Array.from({ length: offset }, () => ({ kind: "blank" }) as const);
  for (let day = 1; day <= length; day += 1) {
    const iso = `${key}-${String(day).padStart(2, "0")}`;
    cells.push({ kind: "day", day, info: byDate.get(iso) ?? null });
  }
  while (cells.length % 7 !== 0) cells.push({ kind: "blank" });
  const weeks: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** How a day reads to a family. `today` decides "upcoming". */
export function dayLook(info: MonthDay | null, iso: string, today: string): DayLook {
  if (!info) return iso > today ? "upcoming" : "none";
  if (!info.enrolled) return "notEnrolled";
  if (info.dayType === "holiday" || info.dayType === "weekend") return "holiday";
  // The counts stop at today, so the calendar does too: a mark stored for a
  // future date (a data-entry slip) never shows as attendance.
  if (iso > today) return "upcoming";
  switch (info.status) {
    case "present":
      return "present";
    case "absent":
      return "absent";
    case "late":
      return "late";
    case "half_day":
      return "halfDay";
    case "on_leave":
      return "leave";
    default:
      return iso > today ? "upcoming" : "notMarked";
  }
}

/** True when the rank deserves a cheer: in the visible top list. */
export function isTopRank(rank: number | null, topSize = 10): boolean {
  return rank !== null && rank <= topSize;
}
