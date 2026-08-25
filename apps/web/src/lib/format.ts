/**
 * DATES ON THE WIRE VS DATES ON THE SCREEN.
 *
 * Calendar dates travel as ISO `YYYY-MM-DD`. That is what Postgres `date()`
 * columns accept, what `academic.contract.ts` validates, and what sorts
 * correctly as a plain string — `"2026-03-31" < "2026-04-01"` lexically and
 * chronologically agree.
 *
 * They are *shown* as `DD/MM/YYYY`, because every other convention is read wrong
 * here: `03/04/2026` is the 3rd of April to the user and the 4th of March to a
 * US-formatted screen, and nothing on the page would reveal which one a session
 * actually starts on. Session dates drive fee cycles and report cards, so this
 * is a data-integrity concern, not a preference.
 *
 * **A calendar date never becomes a `Date` in this file.** `new Date("2026-03-31")`
 * parses as UTC midnight, so `.getDate()` anywhere west of Greenwich returns 30.
 * A session ending 31 March would display as 30 March to a user in London. String
 * slicing has no timezone to get wrong.
 */

/** Shown where a value is absent. An em dash reads as "nothing here", not zero. */
const EMPTY_VALUE = "—";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Accepts `31/03/2026`, `31-03-2026`, `31.3.2026`, `1/4/26`. Deliberately loose
 * about separators and padding, because a parent or a clerk typing a date will
 * use whichever key is nearest, and rejecting `1/4/2026` teaches them the form
 * is hostile rather than that it is precise.
 */
const DISPLAY_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Is this a day that exists? `2026-02-31` passes a regex and fails reality;
 * Postgres would reject it with a message about date/time field values that is
 * of no use to anyone reading this screen.
 */
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

/** ISO `2026-03-31` → `31/03/2026`. Anything unparseable renders as EMPTY_VALUE. */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!isIsoDate(iso)) return EMPTY_VALUE;

  const [year, month, day] = iso.split("-");

  return `${day}/${month}/${year}`;
}

/**
 * `01/04/2025 – 31/03/2026`, with an en dash rather than a hyphen so it does not
 * read as part of either date.
 */
export function formatIsoDateRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  return `${formatIsoDate(startIso)} – ${formatIsoDate(endIso)}`;
}

/**
 * `31/03/2026` → `2026-03-31`, or null when it is not a date.
 *
 * Two-digit years resolve to 2000+, which is right for this application: a
 * school session in 1926 is not a case worth handling, and a typed `26`
 * unambiguously means 2026 to the person typing it.
 *
 * Returning null rather than throwing is deliberate — the caller is a form field
 * reacting to a half-typed value, and a partially entered date is normal input,
 * not an exception.
 */
export function parseDisplayDate(display: string): string | null {
  const match = DISPLAY_DATE.exec(display.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;

  if (!isRealDate(year, month, day)) return null;

  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Today, in the reader's own calendar.
 *
 * Local parts, not `toISOString().slice(0, 10)`: in India that would return
 * yesterday's date for the five and a half hours after midnight, which is
 * exactly when someone doing back-office work would notice.
 */
export function todayIso(): string {
  const now = new Date();

  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The four-digit year of an ISO date, or null. */
export function isoYear(iso: string | null | undefined): number | null {
  return isIsoDate(iso) ? Number(iso.slice(0, 4)) : null;
}

/**
 * The Indian academic session that starts in `startYear`: 1 April to 31 March,
 * named `2025-26`.
 *
 * This exists so that creating a session is one choice — a year — instead of two
 * dates. Typing two dates is where the overlapping-session mistake comes from,
 * and an overlap is refused by a database constraint the user cannot see.
 *
 * The name's second half is the last two digits of the following year, so
 * 2025 → `2025-26` and 2099 → `2099-00`. That final case is wrong, and
 * unreachable: the year picker offers a window around today.
 */
export function sessionFromStartYear(startYear: number): {
  name: string;
  startDate: string;
  endDate: string;
} {
  return {
    name: `${startYear}-${pad((startYear + 1) % 100)}`,
    startDate: `${pad(startYear, 4)}-04-01`,
    endDate: `${pad(startYear + 1, 4)}-03-31`,
  };
}

/**
 * Which academic year today falls in: April onwards belongs to this calendar
 * year, January to March to the previous one. Used to preselect the session
 * picker, so the common case — "set up the year we are in" — needs no thought.
 */
export function currentSessionStartYear(today: string = todayIso()): number {
  const year = isoYear(today) ?? new Date().getFullYear();
  const month = Number(today.slice(5, 7));

  return month >= 4 ? year : year - 1;
}

/**
 * A window of start years for the session picker, newest first: last year, this
 * one, and next. Enough to create the coming session in advance and to record one
 * that was missed, without offering a list nobody will scroll.
 */
export function sessionStartYearOptions(
  today: string = todayIso(),
): number[] {
  const current = currentSessionStartYear(today);

  return [current + 1, current, current - 1];
}
