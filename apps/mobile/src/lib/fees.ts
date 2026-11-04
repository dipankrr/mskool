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
import { formatMoney, parseMoney, sumMoney, toInputAmount, toMoneyString } from "./money";

// ---------------------------------------------------------------------------
// Payment modes
// ---------------------------------------------------------------------------

/** The counter wire. `online_portal` is written by the gateway, never by staff. */
export const PAYMENT_MODES = ["cash", "upi", "cheque", "neft_rtgs", "card", "dd"] as const;
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
export const REFUND_MODES = ["cash", "upi", "cheque", "neft_rtgs", "dd"] as const;
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

export const INSTALLMENT_STATUSES = ["unpaid", "partial", "paid", "waived", "cancelled"] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
  waived: "Waived",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUSES = ["pending", "cleared", "bounced", "reversed", "cancelled"] as const;
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
export function ledgerTotals(rows: { cashEffect: string; amount: string }[]): LedgerTotals {
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

export const CONCESSION_CALCULATION_LABEL: Record<ConcessionCalculation, string> = {
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
export type PaymentAction = "clear" | "bounce" | "reverse" | "cancel" | "refund";

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
      "Withdraws a pending payment. No money moved. The installments it covered re-open and the ledger entry is offset.",
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
  if (installment.paymentStatus !== "unpaid" && installment.paymentStatus !== "partial") {
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
/**
 * One amount across dues, oldest first. Returns the box value for each line that
 * gets money, so the cashier types what the parent handed over and the split
 * follows. Anything above the total owed is simply not placed; the caller shows
 * the amount as capped.
 */
export function distributeAmount(
  amount: string,
  lines: { key: string; balance: string }[],
): Record<string, string> {
  let remaining = parseMoney(amount) ?? 0n;
  const out: Record<string, string> = {};
  for (const line of lines) {
    if (remaining <= 0n) break;
    const balance = parseMoney(line.balance) ?? 0n;
    const take = balance < remaining ? balance : remaining;
    if (take > 0n) out[line.key] = toInputAmount(toMoneyString(take));
    remaining -= take;
  }
  return out;
}

/**
 * Takes a discount off the money going on dues, newest due first, so the oldest
 * dues stay paid in full. Previous dues are left alone: only dues can carry a
 * discount. Returns what to collect on each line, and the discount on each.
 */
export function applyDiscount<T extends { key: string; id: string; kind: string; amount: string }>(
  lines: T[],
  discount: string,
): {
  lines: (T & { cash: string })[];
  discounts: { installmentId: string; amount: string }[];
  appliedDiscount: string;
} {
  let remaining = parseMoney(discount) ?? 0n;
  const taken = new Map<string, bigint>();
  for (const line of [...lines].reverse()) {
    if (remaining <= 0n) break;
    if (line.kind !== "installment") continue;
    const amount = parseMoney(line.amount) ?? 0n;
    const take = amount < remaining ? amount : remaining;
    if (take > 0n) taken.set(line.key, take);
    remaining -= take;
  }
  const applied = [...taken.values()].reduce((acc, value) => acc + value, 0n);
  return {
    lines: lines.map((line) => ({
      ...line,
      cash: toMoneyString((parseMoney(line.amount) ?? 0n) - (taken.get(line.key) ?? 0n)),
    })),
    discounts: lines
      .filter((line) => taken.has(line.key))
      .map((line) => ({
        installmentId: line.id,
        amount: toMoneyString(taken.get(line.key) ?? 0n),
      })),
    appliedDiscount: toMoneyString(applied),
  };
}

/** Whether a payment mode waits to be cleared. UPI and card do not. */
export function isHeldMode(mode: string): boolean {
  return mode === "cheque" || mode === "dd" || mode === "neft_rtgs";
}

export function installmentTitle(row: { description?: string | null }): string {
  const description = row.description?.trim();
  return description ? friendlyDueName(description) : "Due";
}

/**
 * A receipt line for an installment, from the server's labelled allocation:
 * its description ("Lab Fee — 2025-05"), else the fee head and number.
 */
export function allocationLabel(row: { description: string | null; feeHeadName: string }): string {
  const description = row.description?.trim();
  if (description) return friendlyDueName(description);
  return row.feeHeadName;
}

/** A receipt line for a carried-forward balance. */
export function openingBalanceLabel(row: { originAcademicYearName: string | null }): string {
  return `Carried forward from ${row.originAcademicYearName}`;
}

/**
 * The concession form's value check, before the server sees it. A flat value
 * is rupees; a percentage is 0–100 with at most two decimals. The message is
 * the field's error line, so it says what to type, not what went wrong.
 */
export function concessionValueError(calculation: string, value: string): string | null {
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
export function dueTiming(dueDate: string | null | undefined, today: string): DueTiming {
  if (!dueDate) return "none";
  const days = daysBetweenIso(dueDate, today);
  if (days === null) return "none";
  if (days < 0) return "upcoming";
  if (days === 0) return "due";
  return "overdue";
}

/** "12 days overdue" / "Due today" / "Due 05/11/2026". */
export function dueLabel(dueDate: string | null | undefined, today: string): string {
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
 * Oldest due first, then by name — the counter's working order, and the order
 * the collect screen fills a typed amount. A month's fees share a due date, so
 * the name keeps them in one order on every screen and every load.
 */
export function oldestFirst<
  T extends { dueDate: string; description?: string | null; id?: string },
>(rows: T[]): T[] {
  return [...rows]
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      if (left.row.dueDate !== right.row.dueDate) {
        return left.row.dueDate < right.row.dueDate ? -1 : 1;
      }
      const byName = (left.row.description ?? "").localeCompare(right.row.description ?? "");
      return byName !== 0 ? byName : left.index - right.index;
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
export function nextClientReference(now = Date.now(), random = Math.random): string {
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
  discount?: string | null;
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
  rows.push(`Total paid: ${formatMoney(input.total)}`);
  if ((parseMoney(input.discount) ?? 0n) > 0n) {
    rows.push(`Discount given: ${formatMoney(input.discount)}`);
  }
  rows.push(`Mode: ${input.modeLabel}`);
  if (input.reference) rows.push(`Reference: ${input.reference}`);
  if (input.collectedBy) rows.push(`Collected by: ${input.collectedBy}`);
  if (input.status && input.status !== "cleared") {
    rows.push("", `Status: ${PAYMENT_STATUS_LABEL[input.status as PaymentStatus] ?? input.status}`);
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
  return from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;
}

// ---------------------------------------------------------------------------
// Month view — what a counter asks: "what is due up to now?"
// ---------------------------------------------------------------------------

/** "2026-10" for an ISO date. */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export type MonthSplit = {
  /** Unpaid in months before the current one. */
  overdue: string;
  /** Unpaid in the current month. */
  thisMonth: string;
  /** Unpaid in months after the current one — not yet due. */
  later: string;
  /** Carried in from an earlier session, always due. */
  previous: string;
  /** overdue + thisMonth + previous: what a parent should pay today. */
  dueNow: string;
  /** How many earlier months still have something unpaid. */
  overdueMonths: number;
};

/**
 * Split a student's (or the cohort's) per-month balances around the current
 * month. The year is still generated in full; this only decides what the
 * screens lead with.
 */
export function splitByMonth(
  cells: { month: string; balanceAmount: string | null }[],
  currentMonth: string,
  previousDues: string | null = "0.00",
): MonthSplit {
  const before: string[] = [];
  const now: string[] = [];
  const after: string[] = [];
  let overdueMonths = 0;
  for (const cell of cells) {
    const balance = cell.balanceAmount ?? "0.00";
    if (cell.month < currentMonth) {
      before.push(balance);
      if ((parseMoney(balance) ?? 0n) > 0n) overdueMonths += 1;
    } else if (cell.month === currentMonth) {
      now.push(balance);
    } else {
      after.push(balance);
    }
  }
  const overdue = sumMoney(before);
  const thisMonth = sumMoney(now);
  const previous = sumMoney([previousDues]);
  return {
    overdue,
    thisMonth,
    later: sumMoney(after),
    previous,
    dueNow: sumMoney([overdue, thisMonth, previous]),
    overdueMonths,
  };
}

/**
 * The generator names monthly dues "Tuition Fee — 2026-11"; people say
 * "Tuition Fee — November 2026". Only a trailing year-month is rewritten.
 */
export type YearMonthState = "paid" | "due" | "partial" | "upcoming" | "none";

/**
 * The year view's "Nov: 7 of 12 cleared": of the students with a fee in the
 * current month, how many have nothing left in it. Null when the current month
 * isn't shown or nobody has a fee in it.
 */
export function clearedInMonth(
  months: { current: boolean }[],
  rows: { monthStates?: YearMonthState[] }[],
): { cleared: number; total: number } | null {
  const index = months.findIndex((month) => month.current);
  if (index < 0) return null;
  let cleared = 0;
  let total = 0;
  for (const row of rows) {
    const state = row.monthStates?.[index] ?? "none";
    if (state === "none") continue;
    total += 1;
    if (state === "paid") cleared += 1;
  }
  return total > 0 ? { cleared, total } : null;
}

/**
 * What a screen reader says for one student's boxes: the months grouped by
 * state, so "April, May due. June cleared." instead of twelve words in a row.
 */
export function yearRowSpoken(
  months: { label: string }[],
  states: YearMonthState[] | undefined,
  words: Record<YearMonthState, string>,
): string {
  const groups = new Map<YearMonthState, string[]>();
  months.forEach((month, index) => {
    const state = states?.[index] ?? "none";
    if (state === "none") return;
    groups.set(state, [...(groups.get(state) ?? []), month.label]);
  });
  return (["due", "partial", "paid", "upcoming"] as const)
    .filter((state) => groups.has(state))
    .map((state) => `${(groups.get(state) ?? []).join(", ")} ${words[state]}`)
    .join(". ");
}

export function friendlyDueName(description: string): string {
  return description
    .replace(/ — once$/, "")
    .replace(
      /(\d{4})-(0[1-9]|1[0-2])$/,
      (_, year: string, month: string) => `${monthLabel(Number(month))} ${year}`,
    );
}

// ---------------------------------------------------------------------------
// Collect and the student page: what an amount pays, and the dues in groups
// ---------------------------------------------------------------------------

/** "Tuition Fee — 2026-04" → "Tuition Fee": the fee without its month. */
export function feeNameOf(description: string | null | undefined): string {
  const text = description?.trim() ?? "";
  if (!text) return "Due";
  return text.replace(/ — once$/, "").replace(/ — \d{4}-(0[1-9]|1[0-2])$/, "");
}

/** "2026-04" → "Apr". */
export function monthShortOf(key: string): string {
  return monthLabel(Number(key.slice(5, 7))).slice(0, 3);
}

/** "2026-04" → "April". */
export function monthNameOf(key: string): string {
  return monthLabel(Number(key.slice(5, 7)));
}

/**
 * One payable line as collect sees it. `month` is the due's month, or null for
 * a balance carried in from an earlier session.
 */
export type CollectLine = {
  key: string;
  month: string | null;
  name: string;
  balance: string;
  /** A one-off charge: it has a due date, but belongs to no month's fees. */
  oneOff?: boolean;
};

/** One line of "This pays". */
export type CoverRow = {
  key: string;
  label: string;
  detail: string | null;
  amount: string;
  /** Pays all of it, or only part of it. */
  full: boolean;
};

type CoverEntry = { line: CollectLine; amount: bigint; balance: bigint };
type CoverGroup = { key: string; month: string | null; entries: CoverEntry[] };

/**
 * What the amounts on collect pay, oldest first, in the fewest rows that are
 * still exact. Months paid in full in a row fold into one range ("April –
 * October, 7 months"); a month paid in part says how much of it. When the
 * money lands inside one month only, each fee gets its own row, because then
 * the cashier picked fees, not months.
 */
export function coverRows(lines: CollectLine[], amounts: Record<string, string>): CoverRow[] {
  const groups: CoverGroup[] = [];
  for (const line of lines) {
    const raw = parseMoney(amounts[line.key] ?? "") ?? 0n;
    const balance = parseMoney(line.balance) ?? 0n;
    const amount = raw > balance ? balance : raw < 0n ? 0n : raw;
    const key = line.month ?? "previous";
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      group = { key, month: line.month, entries: [] };
      groups.push(group);
    }
    group.entries.push({ line, amount, balance });
  }

  const paid = groups
    .map((group) => ({
      group,
      amount: group.entries.reduce((sum, entry) => sum + entry.amount, 0n),
      balance: group.entries.reduce((sum, entry) => sum + entry.balance, 0n),
    }))
    .filter((entry) => entry.amount > 0n);

  const only = paid.length === 1 ? paid[0] : undefined;
  const picked = only ? only.group.entries.filter((entry) => entry.amount > 0n) : [];
  const allOneOff = paid.every((entry) =>
    entry.group.entries.filter((line) => line.amount > 0n).every((line) => line.line.oneOff),
  );
  if (
    only &&
    (picked.length > 1 ||
      only.group.month === null ||
      allOneOff ||
      picked.length < only.group.entries.length)
  ) {
    return picked.map((entry) => ({
      key: entry.line.key,
      label: entry.line.name,
      detail:
        entry.amount < entry.balance
          ? `${formatMoney(toMoneyString(entry.amount))} of ${formatMoney(toMoneyString(entry.balance))}`
          : only.group.month && !entry.line.oneOff
            ? monthNameOf(only.group.month)
            : null,
      amount: toMoneyString(entry.amount),
      full: entry.amount >= entry.balance,
    }));
  }

  const rows: CoverRow[] = [];
  let run: typeof paid = [];
  const flush = () => {
    const first = run[0]?.group.month;
    const last = run[run.length - 1]?.group.month;
    if (!first || !last) return;
    rows.push({
      key: `${first}..${last}`,
      label: run.length === 1 ? monthNameOf(first) : `${monthNameOf(first)} – ${monthNameOf(last)}`,
      detail: run.length === 1 ? null : `${run.length} months`,
      amount: toMoneyString(run.reduce((sum, entry) => sum + entry.amount, 0n)),
      full: true,
    });
    run = [];
  };
  for (const entry of paid) {
    const full = entry.amount >= entry.balance;
    if (entry.group.month !== null && full) {
      run.push(entry);
      continue;
    }
    flush();
    rows.push({
      key: entry.group.key,
      label: entry.group.month ? monthNameOf(entry.group.month) : "Previous dues",
      detail: full
        ? null
        : `${formatMoney(toMoneyString(entry.amount))} of ${formatMoney(toMoneyString(entry.balance))}`,
      amount: toMoneyString(entry.amount),
      full,
    });
  }
  flush();
  return rows;
}

/** A one-tap amount on collect. */
export type CollectShortcut = { id: string; label: string; amount: string };

/**
 * The amounts a parent usually means, each a running total oldest first, so
 * tapping one is the same as typing it. "All due" is everything up to this
 * month; "Up to Oct" stops before this month; "Previous dues" is the earlier
 * session's balance alone; later months are paying ahead, and only months
 * whose dues already exist. An amount already offered is not offered twice.
 */
export function collectShortcuts(
  lines: CollectLine[],
  currentMonth: string,
  aheadLimit = 3,
): CollectShortcut[] {
  const sum = (rows: CollectLine[]) =>
    rows.reduce((total, line) => total + (parseMoney(line.balance) ?? 0n), 0n);
  const previous = lines.filter((line) => line.month === null);
  const before = lines.filter((line) => line.month !== null && line.month < currentMonth);
  const now = lines.filter((line) => line.month === currentMonth);
  const ahead = lines.filter((line) => line.month !== null && line.month > currentMonth);

  const out: { id: string; label: string; amount: bigint }[] = [];
  const dueNow = sum(previous) + sum(before) + sum(now);
  if (dueNow > 0n) out.push({ id: "all", label: "All due", amount: dueNow });
  const lastBefore = before[before.length - 1]?.month;
  if (now.length > 0 && lastBefore) {
    out.push({
      id: "before",
      label: `Up to ${monthShortOf(lastBefore)}`,
      amount: sum(previous) + sum(before),
    });
  }
  if (previous.length > 0) {
    out.push({ id: "previous", label: "Previous dues", amount: sum(previous) });
  }

  const aheadMonths = [...new Set(ahead.map((line) => line.month ?? ""))]
    .sort()
    .slice(0, aheadLimit);
  aheadMonths.forEach((month, index) => {
    const through = ahead.filter((line) => (line.month ?? "") <= month);
    out.push({
      id: `ahead:${month}`,
      label: dueNow === 0n && index === 0 ? monthNameOf(month) : `Up to ${monthShortOf(month)}`,
      amount: dueNow + sum(through),
    });
  });

  const seen = new Set<bigint>();
  const unique: CollectShortcut[] = [];
  for (const entry of out) {
    if (entry.amount <= 0n || seen.has(entry.amount)) continue;
    seen.add(entry.amount);
    unique.push({ id: entry.id, label: entry.label, amount: toMoneyString(entry.amount) });
  }
  return unique;
}

/**
 * Collect opened from "Pay" on a month or on one due: only those lines are
 * filled, each with its whole balance. `month:2026-04`, `fee:Tuition Fee`,
 * `due:<id>` or `previous`; anything else fills nothing. Only lines due up to
 * `through` (a month key) count for a fee, so paying a fee never pays ahead.
 */
export function focusAmounts(
  lines: (CollectLine & { id: string })[],
  focus: string,
  through = "9999-12",
): Record<string, string> {
  const match = (line: CollectLine & { id: string }) => {
    if (focus === "previous") return line.month === null;
    if (focus.startsWith("fee:")) {
      return line.name === focus.slice(4) && line.month !== null && line.month <= through;
    }
    if (focus.startsWith("month:")) return line.month === focus.slice(6);
    if (focus.startsWith("due:")) return line.id === focus.slice(4);
    return false;
  };
  const out: Record<string, string> = {};
  for (const line of lines) {
    if (match(line) && (parseMoney(line.balance) ?? 0n) > 0n) {
      out[line.key] = toInputAmount(line.balance);
    }
  }
  return out;
}

/** "Paying April 2026", "Paying previous dues", "Paying Tuition Fee". */
export function focusLabel(lines: (CollectLine & { id: string })[], focus: string): string | null {
  if (focus === "previous") return "Previous dues";
  if (focus.startsWith("fee:")) return focus.slice(4);
  if (focus.startsWith("month:")) {
    const key = focus.slice(6);
    return `${monthNameOf(key)} ${key.slice(0, 4)}`;
  }
  if (focus.startsWith("due:")) {
    const line = lines.find((entry) => entry.id === focus.slice(4));
    if (!line) return null;
    return line.month && !line.oneOff ? `${line.name}, ${monthNameOf(line.month)}` : line.name;
  }
  return null;
}

/** A student's dues, grouped for "Every due". */
export type DueGroup<T> = { key: string; label: string; balance: string; rows: T[] };

/**
 * Dues under their month (oldest first) or under their fee (in the order each
 * fee first falls due). A group's balance is what is still open in it.
 */
export function groupDues<
  T extends {
    dueDate: string;
    description?: string | null;
    balanceAmount: string | null;
  },
>(rows: T[], by: "month" | "fee"): DueGroup<T>[] {
  const groups: DueGroup<T>[] = [];
  for (const row of oldestFirst(rows)) {
    const key = by === "month" ? monthKeyOf(row.dueDate) : feeNameOf(row.description);
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      const label = by === "month" ? `${monthNameOf(key)} ${key.slice(0, 4)}` : key;
      group = { key, label, balance: "0.00", rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
    group.balance = sumMoney([group.balance, row.balanceAmount ?? "0.00"]);
  }
  return groups;
}
