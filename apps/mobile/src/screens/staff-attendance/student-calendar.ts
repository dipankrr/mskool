import { daysInMonth, isoOf } from "./calendar-month";
import type { Status } from "./draft";

/**
 * The pure folds behind the student attendance map. Kept out of the sheet so
 * a month's date grid and a student's status lookup are testable without
 * React, the tRPC client, or a network.
 */

/** Monday-first month cells, padded to full weeks; null is a blank cell. */
export function monthCells(anchor: string): (string | null)[] {
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, index) =>
      isoOf(year, month, index + 1),
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * One student's status by date from a section history response. Other
 * students' rows are ignored; a duplicate date keeps the last row, matching
 * the server's one-status-per-student-per-day invariant.
 */
export function studentStatusByDate(
  rows: readonly { date: string; studentId: string; status: Status }[],
  studentId: string,
): Map<string, Status> {
  const byDate = new Map<string, Status>();
  for (const row of rows) {
    if (row.studentId === studentId) byDate.set(row.date, row.status);
  }
  return byDate;
}
