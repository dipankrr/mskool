/**
 * FEES — the pure money and bucket maths. NO DATABASE IMPORTS.
 *
 * This module exists so the phase's test core (fees-billing.test.ts) can run
 * hermetically: `pnpm test` must never need Postgres or an env, and every
 * function here is deterministic — ISO date strings in, BigInt paise out.
 * The service wrappers that load facts and call these live in
 * fees-billing.service.ts.
 *
 * Money arithmetic is BigInt paise end to end (hard rule 4). Every "share"
 * division FLOORS and the LAST bucket absorbs the remainder, so
 * `sum(installments) === net annual` holds exactly — asserted in the tests.
 */

// ---------------------------------------------------------------------------
// Money helpers — integer paise, never float (hard rule 4)
// ---------------------------------------------------------------------------

/**
 * "1250.50" → 125050n. Refuses anything the contracts' `money` would not.
 * A LEADING MINUS is accepted: the collection flow's re-open path sends
 * negative deltas (money coming back off an installment), and refusing them
 * here would push sign handling into every caller. Database columns stay
 * CHECKed non-negative themselves.
 */
export function toCents(amount: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) {
    throw new Error(`Invalid money amount: "${amount}".`);
  }
  const sign = amount.startsWith("-") ? -1n : 1n;
  const digits = amount.replace("-", "");
  const [whole, frac = ""] = digits.split(".");
  return sign * (BigInt(whole ?? "0") * 100n + BigInt((frac + "00").slice(0, 2)));
}

/** 125050n → "1250.50". */
export function fromCents(cents: bigint): string {
  const whole = cents / 100n;
  const frac = cents % 100n;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Pure date maths — ISO strings in, ISO strings out; Date used only for its
// UTC calendar arithmetic, never for "now".
// ---------------------------------------------------------------------------

/** "2030-04-15" → { year: 2030, month: 4, day: 15 } */
export function parseIso(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split("-").map((p) => Number.parseInt(p, 10));
  return { year: y ?? 0, month: m ?? 0, day: d ?? 0 };
}

export function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The (year, month) sequence a date span covers, oldest first. */
export function monthsBetween(
  startIso: string,
  endIso: string,
): { year: number; month: number }[] {
  const s = parseIso(startIso);
  const e = parseIso(endIso);
  const out: { year: number; month: number }[] = [];
  for (let y = s.year, m = s.month; y < e.year || (y === e.year && m <= e.month); ) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function daysBetweenInclusive(startIso: string, endIso: string): number {
  const a = Date.UTC(parseIso(startIso).year, parseIso(startIso).month - 1, parseIso(startIso).day);
  const b = Date.UTC(parseIso(endIso).year, parseIso(endIso).month - 1, parseIso(endIso).day);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Whole days from `dueDate` to `asOf`; negative when `asOf` is earlier. */
export function daysLateOf(dueDate: string, asOf: string): number {
  const a = Date.UTC(parseIso(dueDate).year, parseIso(dueDate).month - 1, parseIso(dueDate).day);
  const b = Date.UTC(parseIso(asOf).year, parseIso(asOf).month - 1, parseIso(asOf).day);
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Pure bucket maths — the installment split and its audit
// ---------------------------------------------------------------------------

/** One generated installment's shape, before the database sees it. */
export interface Bucket {
  installmentNumber: number;
  /** The head's share for the period, in paise. */
  amountCents: bigint;
  dueDate: string;
  description: string;
  periodMonth: number | null;
  periodYear: number | null;
  termId: string | null;
}

export interface SplitLineInput {
  annualAmountCents: bigint;
  frequency: "inherit" | "monthly" | "quarterly" | "half_yearly" | "annual" | "term_wise";
  structureMode: "upfront" | "term_wise" | "monthly";
  applicableFromMonth: number;
  applicableToMonth: number;
  yearStart: string;
  yearEnd: string;
  /** The mid-session boundary: no bucket may start before it. */
  effectiveFrom: string;
  joiningMonthFullCharge: boolean;
  feeHeadId: string;
  headName: string;
  terms: { id: string; name: string; startDate: string; endDate: string; weightage: string }[];
}

/**
 * Splits one line's annual amount into installment buckets. Guarantees the
 * phase's exactness invariant: the amounts sum to `annualAmountCents`, with
 * the LAST bucket absorbing every rounding remainder (floored shares).
 *
 * - `upfront` / `annual`: one bucket at the effective date.
 * - `monthly`: one bucket per applicable month, from the effective date;
 *   the joining month is prorated by remaining days unless
 *   `joiningMonthFullCharge` (the common Indian full-month rule).
 * - `term_wise`: the terms overlapping the applicable window, weighted by
 *   their weightage share (renormalised across the surviving terms).
 * - `quarterly` / `half_yearly`: the applicable months grouped into
 *   consecutive 3-/6-month buckets anchored at the year's first month.
 */
export function splitIntoBuckets(input: SplitLineInput): Bucket[] {
  const resolved =
    input.frequency === "inherit" ? input.structureMode : input.frequency;
  const effective = input.effectiveFrom > input.yearStart ? input.effectiveFrom : input.yearStart;
  const eff = parseIso(effective);
  const inWindow = (month: number) =>
    month >= input.applicableFromMonth && month <= input.applicableToMonth;

  const make = (
    n: number,
    amountCents: bigint,
    dueDate: string,
    describe: string,
    period: { month: number | null; year: number | null },
    termId: string | null,
  ): Bucket => ({
    installmentNumber: n,
    amountCents,
    dueDate,
    description: describe,
    periodMonth: period.month,
    periodYear: period.year,
    termId,
  });

  const yearMonths = monthsBetween(input.yearStart, input.yearEnd).filter((m) =>
    inWindow(m.month),
  );
  const effectiveMonths = yearMonths.filter(
    (m) => m.year > eff.year || (m.year === eff.year && m.month >= eff.month),
  );

  if (resolved === "upfront" || resolved === "annual" || effectiveMonths.length === 0) {
    // One bucket, full amount, due at the effective date. The empty-window
    // case (a range that misses the effective date entirely) still owes the
    // money once — collapsing to a single due bucket is the honest answer.
    return [
      make(
        1,
        input.annualAmountCents,
        effective,
        `${input.headName} — full year`,
        { month: null, year: null },
        null,
      ),
    ];
  }

  if (resolved === "monthly") {
    const n = effectiveMonths.length;
    const base = input.annualAmountCents / BigInt(n);
    return effectiveMonths.map((m, i) => {
      const isLast = i === n - 1;
      const isJoiningMonth = m.year === eff.year && m.month === eff.month;
      let cents = isLast ? input.annualAmountCents - base * BigInt(n - 1) : base;
      if (isJoiningMonth && !input.joiningMonthFullCharge) {
        // Prorate the joining month by its remaining days, floored. The
        // remainder-absorption above already ran; prorating only ever
        // SHRINKS a share, and the shortfall is the school's choice, not a
        // rounding drift — the annual total is thereby honestly reduced.
        const dim = daysInMonth(m.year, m.month);
        const remaining = daysBetweenInclusive(
          effective,
          isoOf(m.year, m.month, dim),
        );
        cents = (base * BigInt(remaining)) / BigInt(dim);
      }
      return make(
        i + 1,
        cents,
        isoOf(m.year, m.month, 1),
        `${input.headName} — ${isoOf(m.year, m.month, 1).slice(0, 7)}`,
        { month: m.month, year: m.year },
        null,
      );
    });
  }

  if (resolved === "term_wise") {
    // Terms overlapping the applicable window (and the effective date),
    // renormalised: the head's money follows the surviving terms' weightage
    // share, not the year's.
    const surviving = input.terms.filter((t) => {
      const overlap = monthsBetween(
        t.startDate > input.yearStart ? t.startDate : input.yearStart,
        t.endDate < input.yearEnd ? t.endDate : input.yearEnd,
      ).some((m) => inWindow(m.month));
      if (!overlap) return false;
      return t.endDate >= effective;
    });
    if (surviving.length === 0) {
      return [
        make(
          1,
          input.annualAmountCents,
          effective,
          `${input.headName} — full year`,
          { month: null, year: null },
          null,
        ),
      ];
    }
    const totalWeightCents = surviving.reduce(
      (acc, t) => acc + toCents(t.weightage),
      0n,
    );
    // Floored weightage shares; the LAST term absorbs the remainder so the
    // buckets sum to the annual amount exactly.
    const shares = surviving.map(
      (t) => (input.annualAmountCents * toCents(t.weightage)) / totalWeightCents,
    );
    const distributed = shares.reduce((a, b) => a + b, 0n);
    shares[shares.length - 1] =
      (shares[shares.length - 1] ?? 0n) + (input.annualAmountCents - distributed);
    return surviving.map((t, i) => {
      return make(
        i + 1,
        shares[i] ?? 0n,
        t.startDate,
        `${input.headName} — ${t.name}`,
        { month: null, year: null },
        t.id,
      );
    });
  }

  // quarterly / half_yearly: group the applicable months into consecutive
  // buckets anchored at the year's first month. Each non-empty bucket gets
  // an equal share; the last absorbs the remainder.
  const size = resolved === "quarterly" ? 3 : 6;
  const yearStartMonth = parseIso(input.yearStart);
  const anchor = yearStartMonth.year * 12 + (yearStartMonth.month - 1);
  const groups = new Map<number, { year: number; month: number }[]>();
  for (const m of effectiveMonths) {
    const idx = Math.floor((m.year * 12 + (m.month - 1) - anchor) / size);
    const bucket = groups.get(idx) ?? [];
    bucket.push(m);
    groups.set(idx, bucket);
  }
  const buckets = [...groups.entries()].sort(([a], [b]) => a - b);
  const n = buckets.length;
  const base = input.annualAmountCents / BigInt(n);
  return buckets.map(([, months], i) => {
    const isLast = i === n - 1;
    const cents = isLast ? input.annualAmountCents - base * BigInt(n - 1) : base;
    const first = months[0] ?? { year: parseIso(input.yearStart).year, month: parseIso(input.yearStart).month };
    return make(
      i + 1,
      cents,
      isoOf(first.year, first.month, 1),
      `${input.headName} — ${resolved} ${i + 1}`,
      { month: null, year: null },
      null,
    );
  });
}

// ---------------------------------------------------------------------------
// Pure concession apportionment
// ---------------------------------------------------------------------------

export interface ConcessionRow {
  feeHeadId: string | null;
  /** The stored audit amount, in paise. */
  amountCents: bigint;
}

/**
 * Distributes the assignment's concessions across its heads: a named-head
 * concession goes to that head whole; an all-heads concession is shared
 * proportionally to the heads' annual amounts (FLOORED — the school never
 * over-discounts), remainder to the largest head.
 *
 * Returns the per-head concession totals. A head absent from the map
 * conceded nothing.
 */
export function headConcessionTotals(
  concessionRows: ConcessionRow[],
  headAnnuals: { feeHeadId: string; annualCents: bigint }[],
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  const totalAnnual = headAnnuals.reduce((acc, h) => acc + h.annualCents, 0n);
  if (totalAnnual === 0n) return totals;

  const add = (headId: string, cents: bigint) =>
    totals.set(headId, (totals.get(headId) ?? 0n) + cents);

  for (const c of concessionRows) {
    if (c.feeHeadId) {
      add(c.feeHeadId, c.amountCents);
      continue;
    }
    // All-heads: proportional share per head, floor; remainder to the
    // largest head so the sum is exact.
    let distributed = 0n;
    const shares = headAnnuals.map((h) => ({
      headId: h.feeHeadId,
      share: (h.annualCents * c.amountCents) / totalAnnual,
    }));
    for (const s of shares) distributed += s.share;
    const remainder = c.amountCents - distributed;
    if (remainder > 0n) {
      const largest = headAnnuals.reduce((a, b) => (b.annualCents > a.annualCents ? b : a));
      const hit = shares.find((s) => s.headId === largest.feeHeadId);
      if (hit) hit.share += remainder;
    }
    for (const s of shares) add(s.headId, s.share);
  }
  return totals;
}

/**
 * Splits ONE head's concession total across that head's buckets: floored
 * proportional shares, the LAST bucket absorbing the remainder, so the
 * installments' concession sum equals the head total exactly.
 */
export function apportionHeadTotal(
  headTotalCents: bigint,
  bucketAmounts: bigint[],
): bigint[] {
  const total = bucketAmounts.reduce((a, b) => a + b, 0n);
  if (total === 0n) return bucketAmounts.map(() => 0n);
  const shares = bucketAmounts.map((a) => (headTotalCents * a) / total);
  const distributed = shares.reduce((a, b) => a + b, 0n);
  const remainder = headTotalCents - distributed;
  if (shares.length > 0 && remainder !== 0n) {
    shares[shares.length - 1] = (shares[shares.length - 1] ?? 0n) + remainder;
  }
  return shares;
}

// ---------------------------------------------------------------------------
// Pure late-fee maths
// ---------------------------------------------------------------------------

export interface LateFeeRuleLike {
  feeStructureId: string | null;
  gracePeriodDays: number;
  calculationType: "flat" | "percentage" | "per_day";
  /** In paise. */
  valueCents: bigint;
  /** Cap in paise, or null = uncapped. */
  maxLateFeeCents: bigint | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * LIVE late fee for display — never written to a payment; the collection
 * flow (F5) freezes what it charges. Selection: the structure-named rule
 * beats the school-wide rule; among candidates, the LATEST effective_from
 * covering `asOf` wins. Grace period shifts the clock, not the rule.
 *
 * - flat: the value once, after the grace window.
 * - percentage: that share of the CURRENT balance, once.
 * - per_day: the value × each day past the grace window, until paid —
 *   which is why an uncapped per_day rule is a policy accident (the
 *   contract allows it; the rule screen is where the cap is urged).
 */
export function computeLateFee(
  installment: { dueDate: string; balanceCents: bigint },
  rules: LateFeeRuleLike[],
  structureId: string | null,
  asOf: string,
): bigint {
  const candidates = rules
    .filter((r) => r.feeStructureId === null || r.feeStructureId === structureId)
    .filter((r) => r.effectiveFrom <= asOf && (!r.effectiveTo || r.effectiveTo >= asOf))
    .sort((a, b) => {
      if (a.effectiveFrom !== b.effectiveFrom) {
        return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
      }
      // A structure-named rule beats a school-wide one at the same start.
      return (b.feeStructureId ? 1 : 0) - (a.feeStructureId ? 1 : 0);
    });
  const rule = candidates[0];
  if (!rule) return 0n;

  const lateDays = daysLateOf(installment.dueDate, asOf) - rule.gracePeriodDays;
  if (lateDays <= 0) return 0n;
  if (installment.balanceCents <= 0n) return 0n;

  let fee = 0n;
  if (rule.calculationType === "flat") {
    fee = rule.valueCents;
  } else if (rule.calculationType === "percentage") {
    fee = (installment.balanceCents * rule.valueCents) / 10000n;
  } else {
    fee = rule.valueCents * BigInt(lateDays);
  }
  if (rule.maxLateFeeCents !== null && fee > rule.maxLateFeeCents) {
    fee = rule.maxLateFeeCents;
  }
  return fee;
}

// ---------------------------------------------------------------------------
// Pure gateway allocation (F5)
// ---------------------------------------------------------------------------

/**
 * Applies a gateway total to the student's outstanding balances,
 * OLDEST-DUE FIRST — the server decides where online money lands, because
 * the gateway knows only an amount. Returns the per-installment allocation
 * list; REFUSES (returns null) when the total exceeds the sum of
 * outstanding balances, because true surplus advance is a recorded deferral,
 * not a silent wallet.
 */
export function allocateOldestFirst(
  totalCents: bigint,
  outstanding: { installmentId: string; dueDate: string; balanceCents: bigint }[],
): { installmentId: string; amountCents: bigint }[] | null {
  const available = outstanding.reduce((acc, o) => acc + o.balanceCents, 0n);
  if (totalCents <= 0n || totalCents > available) return null;

  const ordered = [...outstanding]
    .filter((o) => o.balanceCents > 0n)
    .sort((a, b) =>
      a.dueDate === b.dueDate
        ? a.installmentId < b.installmentId
          ? -1
          : 1
        : a.dueDate < b.dueDate
          ? -1
          : 1,
    );

  const allocations: { installmentId: string; amountCents: bigint }[] = [];
  let remaining = totalCents;
  for (const o of ordered) {
    if (remaining <= 0n) break;
    const applied = o.balanceCents < remaining ? o.balanceCents : remaining;
    allocations.push({ installmentId: o.installmentId, amountCents: applied });
    remaining -= applied;
  }
  return allocations;
}
