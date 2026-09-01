/**
 * CALENDAR MONTH GRID — the pure layout maths behind the attendance calendar
 * screen.
 *
 * Weeks start MONDAY (India's convention; the west-first Sunday grid reads as
 * a mistake here). All arithmetic is UTC: a calendar date has no zone, and
 * letting the host's offset near a month boundary shift a day is exactly the
 * bug this file exists to make impossible. The walk mirrors the backend
 * generator's (attendance.service.ts), so what the server filled and what
 * the grid lays out agree by construction.
 *
 * Cells outside the month are `null` placeholders, so every row is a
 * 7-wide week and the grid never needs per-week special-casing.
 */

export type MonthGrid = (string | null)[][];

export function buildMonthGrid(year: number, month: number): MonthGrid {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  // JS getDay(): Sunday = 0 … Saturday = 6. Monday-first offset: Monday 0 … Sunday 6.
  const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7;

  const cells: (string | null)[] = Array(leadingBlanks).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: MonthGrid = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The Monday-first weekday order the grid and the generator both speak. */
export const GRID_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
