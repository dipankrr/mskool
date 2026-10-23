import type { Status } from "./draft";

/**
 * The pure fold behind the recent-day strip: one bounded history response in,
 * the last few distinct marked dates out. Kept separate from the hook so it is
 * testable without React, the tRPC client, or a network.
 */

export const RECENT_DAY_LIMIT = 5;

export type RecentDay = {
  date: string;
  /** studentId → status for that date. Missing means no mark. */
  statuses: Map<string, Status>;
};

/**
 * Fold ascending status rows into the last `limit` distinct marked dates.
 * Rows already arrive sorted by date, but sorting again makes the function
 * total and testable without relying on the transport. The result is
 * chronological (oldest first), so a row's squares read left-to-right.
 */
export function collectRecentDays(
  rows: readonly { date: string; studentId: string; status: Status }[],
  limit = RECENT_DAY_LIMIT,
): RecentDay[] {
  const byDate = new Map<string, Map<string, Status>>();
  for (const row of rows) {
    const day = byDate.get(row.date) ?? new Map<string, Status>();
    day.set(row.studentId, row.status);
    byDate.set(row.date, day);
  }
  const dates = [...byDate.keys()].sort().slice(-limit);
  return dates.map((date) => ({
    date,
    statuses: byDate.get(date) ?? new Map<string, Status>(),
  }));
}
