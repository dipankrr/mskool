/**
 * Money — the one place fee amounts are parsed, added and printed.
 *
 * Every amount on the wire is a decimal STRING (`"1234.50"`), because the
 * database stores `numeric(10,2)` and a float would eventually disagree with a
 * receipt (hard rule 4). The client therefore never does float maths: strings
 * become integer **paise** (bigint), arithmetic happens in paise, and the
 * result goes back to a 2-dp string before it is sent.
 *
 * Formatting is Indian grouping (last three digits, then pairs): ₹12,34,567.00.
 * `Intl` is deliberately not used — Hermes builds differ in which locale data
 * ships, and a receipt must look identical on every device.
 */

const MONEY_RE = /^-?\d{1,10}(\.\d{1,2})?$/;
const MAX_PAISE = 10n ** 12n;

export type Paise = bigint;

/**
 * Parse a wire amount into paise. Returns null for anything that is not a
 * plain decimal with at most two fraction digits — a silent `NaN` here would
 * become a wrong receipt.
 */
export function parseMoney(value: string | null | undefined): Paise | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!MONEY_RE.test(trimmed)) return null;

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const padded = (fraction + "00").slice(0, 2);
  const paise = BigInt(whole) * 100n + BigInt(padded);
  if (paise > MAX_PAISE) return null;
  return negative ? -paise : paise;
}

/** Paise back to the wire format the API expects: always two decimals. */
export function toMoneyString(paise: Paise): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Group an integer digit string the Indian way: 12,34,567. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const pairs: string[] = [];
  let index = rest.length;
  while (index > 0) {
    const start = Math.max(0, index - 2);
    pairs.unshift(rest.slice(start, index));
    index = start;
  }
  return `${pairs.join(",")},${last3}`;
}

/**
 * The display string. Whole rupees drop the ".00". `null`/undefined render as an em dash so a missing
 * amount is never mistaken for zero.
 */
export function formatMoney(value: string | null | undefined): string {
  const paise = parseMoney(value);
  if (paise === null) return "—";
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const whole = (absolute / 100n).toString();
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  // Whole rupees read as ₹5,000, not ₹5,000.00; paise always show both
  // digits (₹49.50), so an amount is never ambiguous.
  const tail = fraction === "00" ? "" : `.${fraction}`;
  return `${negative ? "−" : ""}₹${groupIndian(whole)}${tail}`;
}

/** The same grouping without the symbol — for inputs the user is typing. */
export function formatAmountDigits(value: string): string {
  const paise = parseMoney(value);
  if (paise === null) return value;
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const whole = (absolute / 100n).toString();
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${groupIndian(whole)}${fraction === "00" ? "" : `.${fraction}`}`;
}

/** Sum wire amounts exactly. Unparseable entries are ignored, never zeroed. */
export function sumMoney(values: (string | null | undefined)[]): string {
  let total = 0n;
  for (const value of values) {
    const paise = parseMoney(value);
    if (paise !== null) total += paise;
  }
  return toMoneyString(total);
}

/** True when the amount is a valid, positive wire string. */
export function isPositiveMoney(value: string | null | undefined): boolean {
  const paise = parseMoney(value);
  return paise !== null && paise > 0n;
}

/**
 * Clamp a requested allocation to the installment's outstanding balance.
 *
 * The server refuses an over-allocation outright; the client clamps first so
 * the cashier sees the corrected number instead of a rejected payment. A
 * negative or unparseable request becomes `"0.00"`.
 */
export function clampAllocation(requested: string, balance: string): string {
  const want = parseMoney(requested);
  const limit = parseMoney(balance);
  if (limit === null || limit <= 0n) return "0.00";
  if (want === null || want <= 0n) return "0.00";
  return toMoneyString(want > limit ? limit : want);
}

/** `a - b` in wire strings, floored at zero (balances never invert). */
export function subtractMoney(a: string, b: string): string {
  const left = parseMoney(a) ?? 0n;
  const right = parseMoney(b) ?? 0n;
  const diff = left - right;
  return toMoneyString(diff < 0n ? 0n : diff);
}

/** Percentage of a total, 0–100, for the desk's collection meter. */
export function paidPercent(paid: string, net: string): number {
  const paidPaise = parseMoney(paid) ?? 0n;
  const netPaise = parseMoney(net) ?? 0n;
  if (netPaise <= 0n) return 0;
  const percent = Number((paidPaise * 100n) / netPaise);
  return Math.max(0, Math.min(100, percent));
}

/**
 * Keystroke filter for an amount field: digits, one decimal point, at most
 * two fraction digits, ten whole digits. A third decimal never reaches the
 * field, so `parseMoney` is never handed an amount it has to throw away.
 */
export function sanitizeAmountInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned.slice(0, 10);
  const whole = cleaned.slice(0, dot).slice(0, 10);
  const fraction = cleaned
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, 2);
  return `${whole}.${fraction}`;
}

/**
 * A wire amount as an input field shows it: "5000" for 5000.00, "49.5" is
 * never produced — paise keep both digits ("49.50"). Unparseable values pass
 * through untouched so the field shows what is really there.
 */
export function toInputAmount(value: string | null | undefined): string {
  const paise = parseMoney(value);
  if (paise === null) return value ?? "";
  const text = toMoneyString(paise);
  return text.endsWith(".00") ? text.slice(0, -3) : text;
}
