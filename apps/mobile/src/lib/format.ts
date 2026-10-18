/**
 * Port of apps/web's `lib/format.ts`, same wire format and the same central
 * rule: **a calendar date never round-trips through `new Date(iso)`** —
 * `"2026-03-31"` parses as UTC midnight, so `.getDate()` west of Greenwich
 * returns 30. String slicing has no timezone to get wrong; local-parts
 * construction is used only for the weekday lookup, where no other option
 * exists.
 *
 * The headline formats are the approved probe's (`"Wednesday, 15 Oct"` on
 * Home, `"Wed 15 Oct"` on attendance). Weekday and month names are
 * hand-rolled, not `Intl`: Hermes' ICU data varies by platform build, and a
 * date header is not the place to discover that.
 */

/** Shown where a value is absent. An em dash reads as "nothing here". */
const EMPTY_VALUE = "—";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Is this a day that exists? `2026-02-31` passes a regex and fails reality. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const monthLength = month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
  return monthLength !== undefined && day <= monthLength;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** A well-formed ISO calendar date that also names a day that exists. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  return isRealDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** ISO `2026-03-31` → `31/03/2026`. Anything unparseable renders as the em dash. */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!isIsoDate(iso)) return EMPTY_VALUE;
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const day = iso.slice(8, 10);
  return `${day}/${month}/${year}`;
}

/**
 * Today, in the reader's own calendar.
 *
 * Local parts, not `toISOString().slice(0, 10)`: in India that would return
 * yesterday's date for the five and a half hours after midnight — exactly
 * when a teacher marking the morning register would notice.
 */
export function todayIso(): string {
  const now = new Date();
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 0 = Sunday … 6 = Saturday, or null when the string is not a real date. */
function weekdayIndex(iso: string): number | null {
  if (!isIsoDate(iso)) return null;
  // Local-parts construction only — never `new Date(isoString)`.
  return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay();
}

/** `Wednesday, 15 Oct` — Home's day line. Unparseable input → empty value. */
export function formatLongWeekday(iso: string | null | undefined): string {
  if (!isIsoDate(iso)) return EMPTY_VALUE;
  const weekday = WEEKDAYS_LONG[weekdayIndex(iso) ?? 0];
  const day = Number(iso.slice(8, 10));
  const month = MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];
  return `${weekday}, ${day} ${month}`;
}

/** `Wed 15 Oct` — the attendance header's day line. */
export function formatShortWeekday(iso: string | null | undefined): string {
  if (!isIsoDate(iso)) return EMPTY_VALUE;
  const weekday = WEEKDAYS_SHORT[weekdayIndex(iso) ?? 0];
  const day = Number(iso.slice(8, 10));
  const month = MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];
  return `${weekday} ${day} ${month}`;
}

/** `Wed` — the day picker's leading column. Unparseable input → empty value. */
export function weekdayShort(iso: string | null | undefined): string {
  if (!isIsoDate(iso)) return EMPTY_VALUE;
  return WEEKDAYS_SHORT[weekdayIndex(iso) ?? 0] ?? EMPTY_VALUE;
}

/** `October 2025` — the day picker's month header, from any date in it. */
export function formatMonthLong(iso: string | null | undefined): string {
  if (!isIsoDate(iso)) return EMPTY_VALUE;
  const month = MONTHS_LONG[Number(iso.slice(5, 7)) - 1];
  return `${month} ${Number(iso.slice(0, 4))}`;
}
