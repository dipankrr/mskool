/**
 * Fees — the vocabulary and the rules every fee screen shares.
 *
 * Three things live here and nowhere else:
 *
 * 1. **Labels.** Statuses are database enums; the screens never print a raw
 *    enum, and they never invent a status either.
 * 2. **Legality.** Which payment transitions may render is a function of the
 *    current status AND the caller's permissions. A transition the server
 *    would refuse is not shown as a disabled button — it is not shown at all.
 * 3. **Money flow.** Oldest-due-first ordering, what is payable, what a
 *    balance sums to, and the receipt text. Amounts stay decimal strings and
 *    are summed through `lib/money` — never `Number`.
 *
 * The wire types are structural (`{ paymentStatus, balanceAmount, … }`) so
 * this module is unit-testable without a router output. Screens pass their
 * inferred rows in directly; the shapes match by construction.
 */

import { formatReadableDate } from "./format";
import { formatMoney, parseMoney, sumMoney, toMoneyString } from "./money";

// ---------------------------------------------------------------------------
// Payment modes
// ---------------------------------------------------------------------------

/** The counter wire. `online_portal` is written by the gateway, never by staff. */
export const PAYMENT_MODES = [
  "cash",
  "upi",
  "cheque",
  "neft_rtgs",
  "card",
  "dd",
] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  cheque: "Cheque",
  neft_rtgs: "NEFT / RTGS",
  card: "Card",
  dd: "Demand draft",
};

/** Refunds cannot go back through the gateway — it refunds through itself. */
export const REFUND_MODES = [
  "cash",
  "upi",
  "cheque",
  "neft_rtgs",
  "dd",
] as const;
export type RefundMode = (typeof REFUND_MODES)[number];

export const REFUND_MODE_LABEL: Record<RefundMode, string> = {
  cash: "Cash",
  upi: "UPI",
  cheque: "Cheque",
  neft_rtgs: "NEFT / RTGS",
  dd: "Demand draft",
};

export type ReferenceFields = {
  /** A transaction reference is required before the form may submit. */
  reference: boolean;
  /** Bank name is required. */
  bank: boolean;
  /** Cheque date is required (post-dated cheques are normal). */
  chequeDate: boolean;
  /** The hint above the reference field. */
  hint: string | null;
  /** Placeholder for the reference field. */
  placeholder: string;
};

/**
 * Which provenance fields a mode needs. Cash needs nothing; every instrument
 * needs something that can be reconciled against a bank statement later.
 */
export function referenceFields(mode: PaymentMode): ReferenceFields {
  switch (mode) {
    case "cash":
      return {
        reference: false,
        bank: false,
        chequeDate: false,
        hint: null,
        placeholder: "",
      };
    case "upi":
      return {
        reference: true,
        bank: false,
        chequeDate: false,
        hint: "The UPI reference from the payer's app.",
        placeholder: "UPI reference",
      };
    case "cheque":
      return {
        reference: true,
        bank: true,
        chequeDate: true,
        hint: "Cheque number, issuing bank and cheque date.",
        placeholder: "Cheque number",
      };
    case "neft_rtgs":
      return {
        reference: true,
        bank: true,
        chequeDate: false,
        hint: "The bank's UTR for this transfer.",
        placeholder: "UTR",
      };
    case "card":
      return {
        reference: true,
        bank: false,
        chequeDate: false,
        hint: "The last four digits and the approval code.",
        placeholder: "Card reference",
      };
    case "dd":
      return {
        reference: true,
        bank: true,
        chequeDate: false,
        hint: "Demand-draft number and issuing bank.",
        placeholder: "DD number",
      };
  }
}

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

export const INSTALLMENT_STATUSES = [
  "unpaid",
  "partial",
  "paid",
  "waived",
  "cancelled",
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
  waived: "Waived",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUSES = [
  "pending",
  "cleared",
  "bounced",
  "reversed",
  "cancelled",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Pending",
  cleared: "Cleared",
  bounced: "Bounced",
  reversed: "Reversed",
  cancelled: "Cancelled",
};

/** Why a payment is in a non-cleared state — used as the detail's explainer. */
export const PAYMENT_STATUS_NOTE: Partial<Record<PaymentStatus, string>> = {
  pending: "Money is not confirmed yet. Clear it when the bank confirms.",
  bounced: "The money did not arrive. The installments it paid are open again.",
  reversed: "The money went back. The installments it paid are open again.",
  cancelled: "Withdrawn before confirmation. No money moved.",
};

/**
 * The wire's direction, as the console prints it.
 */
export const LEDGER_DIRECTION_LABEL: Record<string, string> = {
  credit: "In",
  debit: "Out",
};

export type LedgerTotals = {
  credit: string;
  debit: string;
  net: string;
};

/**
 * The ledger's three figures. Credits are money in, debits money out — the
 * same reading the web console uses. The net is computed in paise rather than
 * through `subtractMoney`, because a refund-heavy year may legitimately net
 * negative and the balance helpers floor at zero.
 */
export function ledgerTotals(
  rows: { cashEffect: string; amount: string }[],
): LedgerTotals {
  // Money in/out is cash only (ADR-049): an opening balance, concession or
  // waiver changes what is owed and carries `cashEffect: "none"`.
  let credit = 0n;
  let debit = 0n;
  for (const row of rows) {
    const amount = parseMoney(row.amount);
    if (amount === null) continue;
    if (row.cashEffect === "in") credit += amount;
    else if (row.cashEffect === "out") debit += amount;
  }
  return {
    credit: toMoneyString(credit),
    debit: toMoneyString(debit),
    net: toMoneyString(credit - debit),
  };
}

/**
 * A payment mode as printed. The counter modes are the only ones a cashier
 * may choose, but history also contains `online_portal` rows written by the
 * gateway — a receipt must name them, not show an enum.
 */
const PAYMENT_MODE_LABEL_ALL: Record<string, string> = {
  ...PAYMENT_MODE_LABEL,
  online_portal: "Online",
};

export function paymentModeLabel(mode: string): string {
  return PAYMENT_MODE_LABEL_ALL[mode] ?? mode;
}

export const CONCESSION_TYPES = [
  "sibling_discount",
  "staff_ward",
  "merit_scholarship",
  "need_based",
  "rte_waiver",
  "management_discount",
  "other",
] as const;
export type ConcessionType = (typeof CONCESSION_TYPES)[number];

export const CONCESSION_TYPE_LABEL: Record<ConcessionType, string> = {
  sibling_discount: "Sibling discount",
  staff_ward: "Staff ward",
  merit_scholarship: "Merit scholarship",
  need_based: "Need based",
  rte_waiver: "RTE waiver",
  management_discount: "Management discount",
  other: "Other",
};

export const CONCESSION_CALCULATIONS = ["flat", "percentage"] as const;
export type ConcessionCalculation = (typeof CONCESSION_CALCULATIONS)[number];

export const CONCESSION_CALCULATION_LABEL: Record<
  ConcessionCalculation,
  string
> = {
  flat: "Flat amount",
  percentage: "Percentage",
};

export const INSTALLMENT_MODE_LABEL: Record<string, string> = {
  upfront: "Upfront",
  term_wise: "Term-wise",
  monthly: "Monthly",
};

export const ASSIGNMENT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  cancelled: "Cancelled",
  unassigned: "Not assigned",
};

export const GENERATION_STATE_LABEL: Record<string, string> = {
  not_assigned: "No fee assignment",
  not_generated: "Installments not generated",
  generated: "Installments generated",
};

export const OPENING_BALANCE_STATUS_LABEL: Record<string, string> = {
  none: "None",
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
  waived: "Waived",
};

export const LEDGER_TYPE_LABEL: Record<string, string> = {
  fee_payment: "Fee payment",
  fee_refund: "Refund",
  late_fee_charged: "Late fee",
  concession_applied: "Concession",
  waiver_applied: "Waiver",
  opening_balance: "Opening balance",
  opening_balance_payment: "Opening balance paid",
  advance_payment: "Advance",
  cheque_bounce_charge: "Bounced payment",
  payment_cancelled: "Payment cancelled",
  security_deposit_received: "Security deposit",
  security_deposit_refunded: "Deposit refunded",
};

/** A ledger row's type as printed; a future enum member stays readable. */
export function ledgerTypeLabel(type: string): string {
  return LEDGER_TYPE_LABEL[type] ?? type;
}

export const MATRIX_VIEW_LABEL: Record<string, string> = {
  all: "Everyone",
  attention: "Needs attention",
  unpaid: "Unpaid",
  partial: "Part paid",
  overdue: "Overdue",
  paid: "Settled",
  notGenerated: "Not generated",
};

export const MATRIX_VIEW_HINT: Record<string, string> = {
  all: "Every student in the class.",
  attention: "Overdue dues, opening balances and ungenerated assignments.",
  unpaid: "Nothing has been paid yet this year.",
  partial: "Some money received, a balance remains.",
  overdue: "At least one installment is past its due date.",
  paid: "Fully settled for the year.",
  notGenerated: "Assigned but no installments yet — run the generator.",
};

export const MATRIX_PAYMENT_STATE_LABEL: Record<string, string> = {
  no_fee: "No fee",
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
  conceded: "Conceded",
};

export const MATRIX_TIMING_STATE_LABEL: Record<string, string> = {
  none: "",
  upcoming: "Upcoming",
  due: "Due",
  overdue: "Overdue",
};

// ---------------------------------------------------------------------------
// Transition legality
// ---------------------------------------------------------------------------

/**
 * The actions a payment may offer. `refund` is here because it is the same
 * decision point on the detail screen, but it is gated by `fee_refund:create`
 * and only exists for a cleared payment.
 */
export type PaymentAction =
  "clear" | "bounce" | "reverse" | "cancel" | "refund";

export type PaymentActionSpec = {
  action: PaymentAction;
  label: string;
  /** What the confirmation sheet warns will happen. */
  warning: string;
  /** True for destructive/irreversible-feeling actions (styled as such). */
  destructive: boolean;
};

const PAYMENT_ACTION_SPEC: Record<PaymentAction, PaymentActionSpec> = {
  clear: {
    action: "clear",
    label: "Clear payment",
    warning: "Confirms the money arrived. The receipt stays as issued.",
    destructive: false,
  },
  bounce: {
    action: "bounce",
    label: "Record bounce",
    warning:
      "The money did not arrive (cheque returned, transfer failed). The installments this payment covered re-open and a bounce charge is posted to the ledger.",
    destructive: true,
  },
  reverse: {
    action: "reverse",
    label: "Reverse payment",
    warning:
      "The money went back. The installments this payment covered re-open and a debit is posted to the ledger.",
    destructive: true,
  },
  cancel: {
    action: "cancel",
    label: "Cancel payment",
    warning:
      "Withdraws a pending payment. No money moved, so the ledger is untouched.",
    destructive: true,
  },
  refund: {
    action: "refund",
    label: "Refund",
    warning:
      "Money goes back to the payer and the installments it covered re-open. The original receipt is not edited.",
    destructive: true,
  },
};

/**
 * Which transitions are legal from this status AND allowed by these
 * permissions. Mirrors `feesCollectionService` exactly:
 *
 *   pending  → clear, cancel, bounce     (fee_payment:approve)
 *   cleared  → bounce, reverse           (fee_payment:approve)
 *   cleared  → refund                    (fee_refund:create)
 *   anything else → nothing
 *
 * The accountant holds `fee_refund:create` but NOT `fee_payment:approve`, so
 * on their device a cleared payment offers only Refund. The principal holds
 * the reverse. That separation is the backend's, not a UI preference.
 */
export function paymentActions(
  status: string,
  can: (permission: string) => boolean,
): PaymentActionSpec[] {
  const actions: PaymentAction[] = [];

  if (status === "pending") {
    if (can("fee_payment:approve")) actions.push("clear", "cancel", "bounce");
  } else if (status === "cleared") {
    if (can("fee_payment:approve")) actions.push("bounce", "reverse");
    if (can("fee_refund:create")) actions.push("refund");
  }

  return actions.map((action) => PAYMENT_ACTION_SPEC[action]);
}

/**
 * A waiver is a management act on a never-paid installment: it needs
 * `fee_waiver:approve` (principal), not the accountant's create grant.
 */
export function canWaiveInstallment(
  installment: { paymentStatus: string; paidAmount: string },
  can: (permission: string) => boolean,
): boolean {
  return (
    can("fee_waiver:approve") &&
    installment.paymentStatus === "unpaid" &&
    !(parseMoney(installment.paidAmount) ?? 0n)
  );
}

// ---------------------------------------------------------------------------
// Payability and time
// ---------------------------------------------------------------------------

export type PayableInstallment = {
  paymentStatus: string;
  balanceAmount: string | null;
};

/** Only an open balance can take money; waived/cancelled/paid rows cannot. */
export function isPayable(installment: PayableInstallment): boolean {
  if (
    installment.paymentStatus !== "unpaid" &&
    installment.paymentStatus !== "partial"
  ) {
    return false;
  }
  const balance = parseMoney(installment.balanceAmount);
  return balance !== null && balance > 0n;
}

/**
 * What an installment is called on screen. The generator writes a human
 * description ("April 2026 Tuition Fee"); a row without one still needs a
 * name, and "Installment 4" is better than a UUID.
 */
export function installmentTitle(row: {
  description?: string | null;
  installmentNumber?: number | null;
}): string {
  const description = row.description?.trim();
  if (description) return description;
  return row.installmentNumber
    ? `Installment ${row.installmentNumber}`
    : "Installment";
}

/**
 * A receipt line for an installment, from the server's labelled allocation:
 * its description ("Lab Fee — 2025-05"), else the fee head and number.
 */
export function allocationLabel(row: {
  description: string | null;
  feeHeadName: string;
  installmentNumber: number;
}): string {
  const description = row.description?.trim();
  if (description) return description;
  return `${row.feeHeadName} · Installment ${row.installmentNumber}`;
}

/** A receipt line for a carried-forward balance. */
export function openingBalanceLabel(row: {
  originAcademicYearName: string;
}): string {
  return `Carried forward from ${row.originAcademicYearName}`;
}

/**
 * The concession form's value check, before the server sees it. A flat value
 * is rupees; a percentage is 0–100 with at most two decimals. The message is
 * the field's error line, so it says what to type, not what went wrong.
 */
export function concessionValueError(
  calculation: string,
  value: string,
): string | null {
  const amount = parseMoney(value);
  if (amount === null || amount <= 0n) {
    return "Enter a value above zero.";
  }
  if (calculation === "percentage" && amount > 10_000n) {
    return "A percentage cannot be more than 100.";
  }
  return null;
}

/** Whole days between two `YYYY-MM-DD` calendar dates (UTC counters only). */
export function daysBetweenIso(from: string, to: string): number | null {
  const start = calendarDay(from);
  const end = calendarDay(to);
  if (start === null || end === null) return null;
  return Math.round((end - start) / 86_400_000);
}

function calendarDay(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamp = Date.UTC(year, month - 1, day);
  const probe = new Date(stamp);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return stamp;
}

export type DueTiming = "none" | "upcoming" | "due" | "overdue";

/**
 * The same three states the matrix uses. "due" is today; "overdue" is a day or
 * more late. A missing or unparseable date is "none", never "overdue".
 */
export function dueTiming(
  dueDate: string | null | undefined,
  today: string,
): DueTiming {
  if (!dueDate) return "none";
  const days = daysBetweenIso(dueDate, today);
  if (days === null) return "none";
  if (days < 0) return "upcoming";
  if (days === 0) return "due";
  return "overdue";
}

/** "12 days overdue" / "Due today" / "Due 05/11/2026". */
export function dueLabel(
  dueDate: string | null | undefined,
  today: string,
): string {
  const timing = dueTiming(dueDate, today);
  if (timing === "none") return "No due date";
  if (timing === "due") return "Due today";
  if (timing === "overdue") {
    const days = daysBetweenIso(dueDate ?? "", today) ?? 0;
    return days === 1 ? "1 day overdue" : `${days} days overdue`;
  }
  return `Due ${formatReadableDate(dueDate)}`;
}

// ---------------------------------------------------------------------------
// Outstanding maths
// ---------------------------------------------------------------------------

export type InstallmentAmounts = {
  netAmount: string;
  paidAmount: string;
  /** A generated column: Drizzle types it nullable even though it never is. */
  balanceAmount: string | null;
  lateFeeApplicable?: string | null;
};

export type OutstandingTotals = {
  /** What the year assessed, before concessions. */
  assessed: string;
  concession: string;
  net: string;
  paid: string;
  balance: string;
  /** Accruing late fee — display only; the server freezes the charge. */
  lateFee: string;
  count: number;
};

/**
 * Totals for a set of installments. Sums run through `sumMoney`, so the
 * result is exact even when the rows come back as `"1000.00"` strings.
 */
export function outstandingTotals(
  rows: (InstallmentAmounts & { amount?: string; concessionAmount?: string })[],
): OutstandingTotals {
  return {
    assessed: sumMoney(rows.map((row) => row.amount ?? row.netAmount)),
    concession: sumMoney(rows.map((row) => row.concessionAmount ?? "0")),
    net: sumMoney(rows.map((row) => row.netAmount)),
    paid: sumMoney(rows.map((row) => row.paidAmount)),
    balance: sumMoney(rows.map((row) => row.balanceAmount)),
    lateFee: sumMoney(rows.map((row) => row.lateFeeApplicable ?? "0")),
    count: rows.length,
  };
}

/**
 * Oldest due first, then by installment number — the counter's working order,
 * and the order the collect screen prefills. Stable for equal dates so a
 * re-render never reshuffles rows under a finger.
 */
export function oldestFirst<
  T extends { dueDate: string; installmentNumber?: number | null; id?: string },
>(rows: T[]): T[] {
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      if (left.row.dueDate !== right.row.dueDate) {
        return left.row.dueDate < right.row.dueDate ? -1 : 1;
      }
      const leftNumber = left.row.installmentNumber ?? 0;
      const rightNumber = right.row.installmentNumber ?? 0;
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

/** True when every open row is settled — the desk's "nothing outstanding". */
export function isSettled(totals: Pick<OutstandingTotals, "balance">): boolean {
  return (parseMoney(totals.balance) ?? 0n) <= 0n;
}

// ---------------------------------------------------------------------------
// Idempotency and receipt text
// ---------------------------------------------------------------------------

/**
 * A fresh idempotency key for one collect attempt. Generated once when the
 * review sheet opens, reused on retry: the server returns the original
 * receipt instead of writing a second payment. Not a security token — just
 * unique per school.
 */
export function nextClientReference(
  now = Date.now(),
  random = Math.random,
): string {
  const time = now.toString(36);
  const noise = Math.floor(random() * 0xffffffff)
    .toString(36)
    .padStart(6, "0");
  return `mob-${time}-${noise}`;
}

export type ReceiptLine = {
  label: string;
  amount: string;
};

export type ReceiptInput = {
  schoolName: string;
  receiptNumber: string;
  paymentDate: string;
  studentName: string;
  className: string;
  lines: ReceiptLine[];
  amount: string;
  lateFee: string;
  total: string;
  modeLabel: string;
  reference?: string | null;
  collectedBy?: string | null;
  status?: string;
};

/**
 * The shareable receipt, as plain text. There is no PDF endpoint, so this is
 * what a parent can be sent on WhatsApp. Only server-issued values appear —
 * the receipt number in particular is never composed on the client.
 */
export function buildReceiptText(input: ReceiptInput): string {
  const rows: string[] = [
    input.schoolName,
    "FEE RECEIPT",
    "",
    `Receipt: ${input.receiptNumber}`,
    `Date: ${formatReadableDate(input.paymentDate)}`,
    `Student: ${input.studentName}`,
    `Class: ${input.className}`,
    "",
  ];

  for (const line of input.lines) {
    rows.push(`${line.label}  ${formatMoney(line.amount)}`);
  }

  rows.push("", `Amount: ${formatMoney(input.amount)}`);
  if ((parseMoney(input.lateFee) ?? 0n) > 0n) {
    rows.push(`Late fee: ${formatMoney(input.lateFee)}`);
  }
  rows.push(
    `Total paid: ${formatMoney(input.total)}`,
    `Mode: ${input.modeLabel}`,
  );
  if (input.reference) rows.push(`Reference: ${input.reference}`);
  if (input.collectedBy) rows.push(`Collected by: ${input.collectedBy}`);
  if (input.status && input.status !== "cleared") {
    rows.push(
      "",
      `Status: ${PAYMENT_STATUS_LABEL[input.status as PaymentStatus] ?? input.status}`,
    );
  }

  rows.push(
    "",
    "This receipt was issued by the school. Corrections are offsetting entries, never edits.",
  );
  return rows.join("\n");
}

/**
 * Month names for the fee configuration forms. Hand-rolled for the same
 * reason as the date formats: a fee line's "April – March" range must not
 * depend on which ICU data a device build happens to ship.
 */
const MONTH_NAME = [
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

export function monthLabel(month: number): string {
  return MONTH_NAME[month - 1] ?? String(month);
}

/**
 * A fee line's applicable window in calendar months: "June – September", one
 * month alone, or "All year" for 1–12 — "January – December" would read as a
 * calendar year against an April–March session.
 */
export function monthRangeLabel(from: number, to: number): string {
  if (from === 1 && to === 12) return "All year";
  return from === to
    ? monthLabel(from)
    : `${monthLabel(from)} – ${monthLabel(to)}`;
}
