/**
 * MONEY — the app's first currency helper, born with fees.
 *
 * Amounts travel as DECIMAL STRINGS (`"12000.00"`), because hard rule 4
 * (never store money as float) reaches all the way to the wire: Postgres
 * `numeric(10,2)` reads back as a string, the contracts' `money` regex
 * (`^\d+(\.\d{1,2})?$`) refuses everything else, and a float that cannot
 * represent ₹0.10 cannot be trusted to sum a fee ledger.
 *
 * **No float is ever constructed in this file — including in display
 * math.** Every operation parses the decimal string into BigInt PAISE
 * (2 decimal digits as an integer count), computes exactly, and formats
 * back. ₹1,000,000.01 needs 10 significant digits; a float gives 15–17
 * but silently misrounds the last ones on sums — in a fees app that is
 * a reconciliation discrepancy on every statement, not a curiosity.
 *
 * Rules for callers: INPUT fields and the wire are decimal strings
 * (`toMoneyString` produces wire format); ARITHMETIC goes through these
 * helpers only; RENDERING money is always `formatMoney` (₹, en-IN
 * grouping, tabular-nums is the caller's CSS). Never `Number()` an
 * amount — the regex-checked strings are the only trusted form.
 */

/** The wire format's shape, mirrored from the contracts' `money` helper. */
const MONEY_STRING = /^\d+(\.\d{1,2})?$/;

/** Shown where an amount is absent or unparseable — never "0", which reads as a price. */
const EMPTY_MONEY = "—";

/**
 * Is this a wire-format money string? Accepts `"12"`, `"12.5"`, `"12.50"`;
 * refuses `"12.505"`, `"1e3"`, `"-5"`, `" 12"`. Use before any conversion.
 */
export function isMoneyString(value: unknown): value is string {
  return typeof value === "string" && MONEY_STRING.test(value);
}

/**
 * Decimal string → BigInt paise. `"12000.00"` → `1200000n`, `"12.5"` →
 * `1250n`, `"12"` → `1200n`.
 *
 * Throws on anything else — every caller holds a value that either came
 * from the server (wire-format by construction) or was validated by a
 * form schema carrying the same regex. A silent `0n` on bad input would
 * make a garbled amount read as "free". Parse by string slicing; `parseInt`
 * on a float string would be the one float in the room.
 */
export function toPaise(value: string): bigint {
  if (!isMoneyString(value)) {
    throw new Error(`Not a wire-format money string: ${JSON.stringify(value)}`);
  }

  const [wholePart, maybeFraction] = value.split(".");
  // "12" → fraction "00"; "12.5" → "50". The regex guarantees a non-empty
  // whole part; `?? ""` only satisfies the tuple type (BigInt("") is 0n).
  const fraction = maybeFraction ? maybeFraction.padEnd(2, "0") : "0";

  return BigInt(wholePart ?? "0") * 100n + BigInt(fraction);
}

/** BigInt paise → wire-format string. `1250n` → `"12.50"`, `1200000n` → `"12000.00"`. */
export function fromPaise(paise: bigint): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Sum any number of wire strings, exactly. Returns wire format.
 * `addMoney()` → `"0.00"`; `addMoney("12.50")` → `"12.50"`;
 * `addMoney("0.01", "0.10")` → `"0.11"`.
 *
 * Nulls pass through as absent — drizzle-zod infers the GENERATED money
 * columns (balances, totals) as `string | null` even though Postgres
 * guarantees a value, so a sum over rows must tolerate the type without
 * pretending null is ₹0.00.
 */
export function addMoney(...values: ReadonlyArray<string | null | undefined>): string {
  return fromPaise(
    values.reduce<bigint>(
      (total, value) => (isMoneyString(value) ? total + toPaise(value) : total),
      0n,
    ),
  );
}

/** `a - b`, exactly, in wire format. A negative result is returned signed — callers decide what that means. */
export function subtractMoney(a: string, b: string): string {
  return fromPaise(toPaise(a) - toPaise(b));
}

/**
 * Negative (less), zero (equal), positive (greater) — BigInt's comparison
 * result, for sorting and guard checks: `compareMoney(a, b) <= 0` is "a is
 * at most b". Throws on non-wire input for the same reason `toPaise` does.
 */
export function compareMoney(a: string, b: string): number {
  const left = toPaise(a);
  const right = toPaise(b);

  return left < right ? -1 : left > right ? 1 : 0;
}

/** The lesser of two wire strings. */
export function minMoney(a: string, b: string): string {
  return compareMoney(a, b) <= 0 ? a : b;
}

/** The greater of two wire strings. */
export function maxMoney(a: string, b: string): string {
  return compareMoney(a, b) >= 0 ? a : b;
}

/**
 * `value` clamped into `[lower, upper]`. The counter uses this to cap a
 * typed allocation at an installment's balance without inventing money
 * past what is owed — the server re-checks under row locks regardless.
 */
export function clampMoney(value: string, lower: string, upper: string): string {
  return minMoney(maxMoney(value, lower), upper);
}

/**
 * Format for SCREEN: `₹12,50,000.00` — the rupee sign, en-IN lakh-crore
 * grouping, always two decimals so a money column never mixes `"₹12"`
 * and `"₹12.00"` widths in the same column. Unparseable or null input
 * renders as an em dash, never as ₹0.00.
 *
 * Negative amounts (offsetting ledger rows) render with a leading minus.
 * The grouping is computed by hand, not `Intl.NumberFormat` with
 * `useGrouping` on the float path: `Intl.format` accepts a number, and
 * the string→number→string hop is exactly the float this file refuses.
 * `Intl`'s formatting RULES (lakh/crore placement) are applied to digit
 * strings instead.
 */
/** en-IN grouping of the whole-rupee digits: last 3 together, then pairs — `1234567` → `12,34,567`. */
function groupIndian(wholeDigits: string): string {
  if (wholeDigits.length <= 3) return wholeDigits;

  const lastThree = wholeDigits.slice(-3);
  const rest = wholeDigits.slice(0, -3);

  // The remaining head groups in twos from the right: 1234567 → 12 | 34 | 567.
  const pairs: string[] = [];
  for (let end = rest.length; end > 0; end -= 2) {
    pairs.unshift(rest.slice(Math.max(0, end - 2), end));
  }

  return `${pairs.join(",")},${lastThree}`;
}

export function formatMoney(value: string | null | undefined): string {
  if (typeof value !== "string") return EMPTY_MONEY;

  /*
   * The wire never carries a signed amount — the money regex refuses "-5" —
   * but ledger math client-side can produce negative differences, so a
   * leading minus is accepted here for display only, stripped before the
   * wire-format check.
   */
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;

  if (!isMoneyString(unsigned)) return EMPTY_MONEY;

  const paise = toPaise(unsigned);
  const wholeDigits = (paise / 100n).toString();
  const fraction = (paise % 100n).toString().padStart(2, "0");

  return `${negative ? "−" : ""}₹${groupIndian(wholeDigits)}.${fraction}`;
}

/**
 * Plain formatting without the rupee sign or symbol — for sentences like
 * "₹" is already in the copy, or for concession percentages stored in a
 * money column. Same grouping and exactness as `formatMoney`.
 */
export function formatMoneyPlain(value: string | null | undefined): string {
  const formatted = formatMoney(value);

  return formatted === EMPTY_MONEY ? EMPTY_MONEY : formatted.replace("₹", "");
}
