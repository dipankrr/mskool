import { parseMoney } from "../../lib/money";

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
