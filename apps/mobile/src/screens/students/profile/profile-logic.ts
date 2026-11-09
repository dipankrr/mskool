import type { Status } from "../../staff-attendance/draft";

/**
 * The pure folds behind the staff student profile: what today's chip says, which
 * Heads up lines appear and in what order, the To finish steps, and how the glance
 * tiles lay out. Kept out of the screen so each rule is testable without React or
 * the network. Nothing here decides permissions: callers pass what is allowed.
 */

export type HistoryRow = {
  studentId: string;
  date: string;
  status: Status;
  createdAt: string;
};

export type MarkedDay = { date: string; status: Status };

/** The student's marked days, newest first. */
function markedDays(rows: readonly HistoryRow[], studentId: string): HistoryRow[] {
  return rows
    .filter((row) => row.studentId === studentId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** The last `count` marked days, oldest first, so a strip reads left to right. */
export function lastMarkedDays(
  rows: readonly HistoryRow[],
  studentId: string,
  count: number,
): MarkedDay[] {
  return markedDays(rows, studentId)
    .slice(0, count)
    .reverse()
    .map(({ date, status }) => ({ date, status }));
}

/** Today's mark and when it was made, or null when today isn't marked. */
export function todayMark(
  rows: readonly HistoryRow[],
  studentId: string,
  today: string,
): { status: Status; markedAt: string } | null {
  const row = rows.find((r) => r.studentId === studentId && r.date === today);
  return row ? { status: row.status, markedAt: row.createdAt } : null;
}

/** "9:05" in the phone's own clock, from a server timestamp. */
export function clockOf(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
}

/** Absences among the last seven marked days; flagged from two. */
export function absenceRun(
  rows: readonly HistoryRow[],
  studentId: string,
): { count: number; of: number; dates: string[] } | null {
  const lastSeven = markedDays(rows, studentId).slice(0, 7);
  const absent = lastSeven.filter((row) => row.status === "absent");
  if (absent.length < 2) return null;
  return {
    count: absent.length,
    of: lastSeven.length,
    dates: absent.map((row) => row.date).reverse(),
  };
}

export type FeeTotals = { dueNow: string; overdue: string };

/** Paise from a decimal string, without floats. */
function paise(value: string): bigint {
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  const digits = whole.replace("-", "") || "0";
  return sign * (BigInt(digits) * 100n + BigInt((fraction + "00").slice(0, 2)));
}

/**
 * The fee line, if any: overdue money is critical; money due this month that
 * isn't late yet is a caution. Nothing owed is no line at all.
 */
export function feeFlag(
  totals: FeeTotals,
): { tone: "critical" | "caution"; amount: string } | null {
  if (paise(totals.overdue) > 0n) return { tone: "critical", amount: totals.overdue };
  if (paise(totals.dueNow) > 0n) return { tone: "caution", amount: totals.dueNow };
  return null;
}

export type MonthState = "overdue" | "due" | "upcoming" | "paid" | "none";

/** Paid months over months that bill anything, for "7 of 12 months paid". */
export function monthsPaid(months: readonly { state: MonthState }[]): {
  paid: number;
  total: number;
} {
  const billed = months.filter((m) => m.state !== "none");
  return { paid: billed.filter((m) => m.state === "paid").length, total: billed.length };
}

/** Whole-point change between two percentages ("78.50" against "84.00" is -6). */
export function percentDelta(latest: string | null, previous: string | null): number | null {
  if (latest == null || previous == null) return null;
  return Math.round(Number(latest) - Number(previous));
}

export type ResultGlance = {
  termName: string;
  percentage: string | null;
  previousPercentage: string | null;
  failedSubjects: readonly string[];
};

/** Failed subjects first; otherwise a drop of five points or more. */
export function resultFlag(
  result: ResultGlance,
): { kind: "failed"; subjects: readonly string[] } | { kind: "dropped"; points: number } | null {
  if (result.failedSubjects.length > 0) return { kind: "failed", subjects: result.failedSubjects };
  const delta = percentDelta(result.percentage, result.previousPercentage);
  if (delta !== null && delta <= -5) return { kind: "dropped", points: -delta };
  return null;
}

export type StepKey = "enrol" | "place" | "parent" | "fees";

/**
 * What's left of an admission, in the order the office does it: a class, a
 * section, a parent, then fees. Each step says whether this viewer may do it;
 * the ones they can't are counted, not hidden, so nobody thinks it's finished.
 */
export function finishSteps(input: {
  enrolled: boolean;
  hasSection: boolean;
  hasParent: boolean;
  /** Null when the viewer can't read fees: then fees aren't judged at all. */
  hasFeePlan: boolean | null;
  can: Record<StepKey, boolean>;
}): { mine: StepKey[]; others: number } {
  const open: StepKey[] = [];
  if (!input.enrolled) open.push("enrol");
  else if (!input.hasSection) open.push("place");
  if (!input.hasParent) open.push("parent");
  if (input.enrolled && input.hasFeePlan === false) open.push("fees");
  const mine = open.filter((step) => input.can[step]);
  return { mine, others: open.length - mine.length };
}

/** Tiles fill two to a row; an odd last tile spans the row. */
export function tileSpans(count: number): ("half" | "full")[] {
  return Array.from({ length: count }, (_, index) =>
    count % 2 === 1 && index === count - 1 ? "full" : "half",
  );
}

/** Up to four actions in a fixed order of usefulness; the row draws what's left. */
export function visibleActions<T extends string>(candidates: readonly (T | false | null)[]): T[] {
  return candidates.filter((c): c is T => Boolean(c)).slice(0, 4);
}
