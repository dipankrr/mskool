/**
 * Small date maths for the calendar surfaces (the day picker and chunk 3's
 * manage-calendar): ISO in, ISO out, string slicing only.
 *
 * Same central rule as `lib/format`: **a calendar date never round-trips
 * through `new Date(iso)`** — `"2026-03-31"` parses as UTC midnight, so
 * `.getDate()` west of Greenwich returns 30. Only whole-month arithmetic
 * happens here; day maths stays string concatenation.
 */

/** `2026`, `3`, `7` → `2026-03-07`. Callers walk real days. */
export function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `anchor` is any ISO day in a month; `delta` shifts whole months. */
export function shiftMonth(anchor: string, delta: number): string {
  const index = monthIndex(anchor) + delta;
  return isoOf(Math.floor(index / 12), (index % 12) + 1, 1);
}

/** A month's ordinal (`year * 12 + monthIndex`) — for comparisons and bounds. */
export function monthIndex(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + (Number(iso.slice(5, 7)) - 1);
}

/**
 * Whole-day arithmetic on an ISO date, returned as ISO. UTC parts keep DST and
 * local-midnight parsing out of the result; callers use this for history
 * windows, never for display formatting.
 */
export function shiftIsoDays(iso: string, delta: number): string {
  const shifted = new Date(
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10)) + delta,
    ),
  );
  return isoOf(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** Days in a month — the day lists' length. Leap years included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Clamps `iso` into `[minIso, maxIso]` by MONTH (bounds are any days in the
 * allowed months — the academic year's start and end), returning that month's
 * first day, which every calendar surface uses as its anchor.
 */
export function clampMonth(
  iso: string,
  minIso: string,
  maxIso: string,
): string {
  const value = monthIndex(iso);
  if (value < monthIndex(minIso)) return shiftMonth(minIso, 0);
  if (value > monthIndex(maxIso)) return shiftMonth(maxIso, 0);
  return shiftMonth(iso, 0);
}
