import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { parseMoney, toMoneyString } from "../../lib/money";

export type FeeSummary = inferRouterOutputs<AppRouter>["portalFees"]["summary"];

/**
 * Pure rules for the family Fees screen: which dues are open, in what order,
 * and what tone a status wears. Money stays in wire strings ("1250.00") and
 * is compared through `parseMoney`, never floats.
 */

export type DueStatus = "unpaid" | "partial" | "paid" | "waived" | "cancelled";
export type PaymentStatus = "pending" | "cleared" | "bounced" | "reversed" | "cancelled";
export type MonthState = "overdue" | "due" | "upcoming" | "paid" | "none";
export type Tone = "positive" | "caution" | "critical" | "info" | "neutral";

export type Due = {
  id: string;
  dueDate: string;
  balance: string;
  status: DueStatus;
};

export function isPositive(value: string | null | undefined): boolean {
  const paise = parseMoney(value);
  return paise !== null && paise > 0n;
}

/** Open dues: something left to pay, not waived or cancelled. */
export function isOpen(due: Due): boolean {
  return (due.status === "unpaid" || due.status === "partial") && isPositive(due.balance);
}

/** Open dues, oldest due date first (overdue ones lead by nature). */
export function openDues<T extends Due>(dues: readonly T[]): T[] {
  return dues.filter(isOpen).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

/** All dues of one month (by due date), oldest first: the month filter. */
export function duesInMonth<T extends Due>(dues: readonly T[], month: string): T[] {
  return dues
    .filter((due) => due.dueDate.startsWith(month) && due.status !== "cancelled")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

export function isOverdue(due: Due, today: string): boolean {
  return isOpen(due) && due.dueDate < today;
}

export const MONTH_TONE: Record<MonthState, Tone> = {
  overdue: "critical",
  due: "caution",
  upcoming: "neutral",
  paid: "positive",
  none: "neutral",
};

export const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  pending: "caution",
  cleared: "positive",
  bounced: "critical",
  reversed: "critical",
  cancelled: "neutral",
};

/** Payment modes the language file names; anything else reads as "other". */
const MODES = ["cash", "upi", "cheque", "neft_rtgs", "card", "dd", "online"] as const;
export type ModeKey = (typeof MODES)[number] | "other";
export function modeKey(mode: string): ModeKey {
  return (MODES as readonly string[]).includes(mode) ? (mode as ModeKey) : "other";
}

const CONCESSIONS = [
  "sibling_discount",
  "staff_ward",
  "merit_scholarship",
  "need_based",
  "rte_waiver",
  "management_discount",
  "other",
] as const;
export type ConcessionKey = (typeof CONCESSIONS)[number];
export function concessionKey(type: string): ConcessionKey {
  return (CONCESSIONS as readonly string[]).includes(type) ? (type as ConcessionKey) : "other";
}

/** "2026-11" from a month row key, tolerant of "2026-11-01". */
export function monthOf(key: string): string {
  return key.slice(0, 7);
}

/**
 * How a due is named. A monthly due is its fee head and month ("Tuition Fee
 * · May"); a one-off charge keeps the name the school gave it; anything else
 * is the fee head alone.
 */
export function dueName(due: { feeHeadName: string; description: string | null; periodKey: string }):
  | { kind: "monthly"; head: string; month: string }
  | { kind: "named"; name: string } {
  if (/^\d{4}-\d{2}$/.test(due.periodKey)) return { kind: "monthly", head: due.feeHeadName, month: due.periodKey };
  if (due.periodKey.startsWith("one:") && due.description) return { kind: "named", name: due.description };
  return { kind: "named", name: due.feeHeadName };
}

const paise = (value: string | null | undefined) => parseMoney(value) ?? 0n;

/** Adds wire amounts in paise. */
export function sumMoney(values: readonly (string | null | undefined)[]): string {
  return toMoneyString(values.reduce((total, value) => total + paise(value), 0n));
}

/**
 * Open dues in two piles by today's month: to pay now (this month and
 * earlier) and later. The same line the school's totals draw.
 */
export function splitDues<T extends Due>(dues: readonly T[], today: string): { now: T[]; later: T[] } {
  const month = today.slice(0, 7);
  const open = openDues(dues);
  return {
    now: open.filter((due) => monthOf(due.dueDate) <= month),
    later: open.filter((due) => monthOf(due.dueDate) > month),
  };
}

export type NextUp = { month: string; date: string; amount: string; count: number };

/** The first month with something to pay after this one, as one line. */
export function nextUp(later: readonly Due[]): NextUp | null {
  const first = later[0];
  if (!first) return null;
  const month = monthOf(first.dueDate);
  const inMonth = later.filter((due) => monthOf(due.dueDate) === month);
  return { month, date: first.dueDate, amount: sumMoney(inMonth.map((due) => due.balance)), count: inMonth.length };
}

export type FeeTotals = {
  dueNow: string;
  thisMonth: string;
  overdue: string;
  previousDues: string;
  later: string;
  paid: string;
};

/** How much of this session's fee is paid. `ratio` is 0 to 1. */
export function yearProgress(totals: FeeTotals): { paid: string; total: string; ratio: number } {
  const paid = paise(totals.paid);
  const total = paid + paise(totals.thisMonth) + paise(totals.overdue) + paise(totals.later);
  const ratio = total > 0n ? Number((paid * 1000n) / total) / 1000 : 0;
  return { paid: toMoneyString(paid), total: toMoneyString(total), ratio };
}

export type FeesMood = "overdue" | "due" | "clear" | "yearPaid";

/**
 * The one thing the top of the screen says: something is late, something is
 * due this month, nothing is due, or the whole session is paid.
 */
export function feesMood(totals: FeeTotals): FeesMood {
  if (isPositive(totals.overdue) || isPositive(totals.previousDues)) return "overdue";
  if (isPositive(totals.dueNow)) return "due";
  if (!isPositive(totals.later) && isPositive(totals.paid)) return "yearPaid";
  return "clear";
}

export type DuePart = "overdue" | "thisMonth" | "previousDues";

/** What "to pay now" is made of. Empty when it is one thing: the line under the number says it. */
export function dueParts(totals: FeeTotals): { part: DuePart; amount: string }[] {
  const parts = (["previousDues", "overdue", "thisMonth"] as const)
    .filter((part) => isPositive(totals[part]))
    .map((part) => ({ part, amount: totals[part] }));
  return parts.length > 1 ? parts : [];
}
