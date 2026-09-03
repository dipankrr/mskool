/**
 * The fees area's visual vocabulary — status tints, the calendar's
 * DAY_TYPE_STYLES idiom: paired light/dark Tailwind utilities on plain
 * elements, tint strength rather than solid fills, never a theme token
 * invented for a mood. Money cells add `tabular-nums` so every column of
 * ₹ aligns on the decimal without a monospace font.
 */
import { cn } from "@/lib/utils";
import type {
  FeeInstallmentStatus,
  FeePaymentStatus,
  FeeSubscriptionStatus,
  LedgerDirection,
} from "./fee-enums";

/** Tint classes per payment status. */
const PAYMENT_STATUS_STYLES: Record<FeePaymentStatus, string> = {
  pending:
    "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100",
  cleared:
    "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  bounced:
    "border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/60 dark:text-red-100",
  reversed:
    "border-slate-200 bg-slate-50 text-slate-950 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-100",
  cancelled:
    "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400",
};

/** Tint classes per installment status (dues/counter rows). */
const INSTALLMENT_STATUS_STYLES: Record<FeeInstallmentStatus, string> = {
  unpaid:
    "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-100",
  partial:
    "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100",
  paid:
    "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  waived:
    "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-100",
  cancelled:
    "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400",
};

const SUBSCRIPTION_STATUS_STYLES: Record<FeeSubscriptionStatus, string> = {
  active:
    "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  cancelled:
    "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400",
  suspended:
    "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100",
};

/** The base badge shape every status tint composes onto. */
const BADGE_BASE = "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium";

export function paymentStatusClass(status: FeePaymentStatus): string {
  return cn(BADGE_BASE, PAYMENT_STATUS_STYLES[status]);
}

export function installmentStatusClass(status: FeeInstallmentStatus): string {
  return cn(BADGE_BASE, INSTALLMENT_STATUS_STYLES[status]);
}

export function subscriptionStatusClass(status: FeeSubscriptionStatus): string {
  return cn(BADGE_BASE, SUBSCRIPTION_STATUS_STYLES[status]);
}

/** Money table cells: right-aligned, tabular, never wrapping mid-amount. */
export const moneyCellClass = "text-right tabular-nums whitespace-nowrap";
export const moneyHeaderClass = "text-right whitespace-nowrap";

/** Ledger rows: credit (money in) vs debit (money out). */
const DIRECTION_STYLES: Record<LedgerDirection, string> = {
  credit: "text-emerald-700 dark:text-emerald-300",
  debit: "text-rose-700 dark:text-rose-300",
};

export function directionClass(direction: LedgerDirection): string {
  return cn("tabular-nums", DIRECTION_STYLES[direction]);
}
