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

/** The last day of the month an ISO date falls in: "2026-10-26" → "2026-10-31". */
export function endOfMonthIso(isoDate: string): string {
  const { year, month } = parseIso(isoDate);
  return isoOf(year, month, daysInMonth(year, month));
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
 * Splits one line's annual amount into installment buckets.
 *
 * **A period's price never depends on when the student joined.** Each
 * period's share is worked out over the WHOLE year (floored shares, the last
 * period absorbing the remainder, so a full-year student's buckets sum to the
 * annual amount exactly), and a student who joins mid-session is billed only
 * the periods they are enrolled for. A Class 6 child joining in October pays
 * October–March at the same ₹1,000 a month as everyone else — not the year's
 * ₹12,000 squeezed into six months (DOMAIN.md §5: "mid-session admission
 * generates only remaining installments").
 *
 * - `upfront` / `annual`: one bucket for the full amount at the effective
 *   date. These are one-time charges (admission, annual fees) and are owed in
 *   full whenever the student joins.
 * - `monthly`: one bucket per applicable month from the effective date; the
 *   joining month is prorated by remaining days unless
 *   `joiningMonthFullCharge` (the common Indian full-month rule).
 * - `quarterly` / `half_yearly`: the year's applicable months grouped into
 *   consecutive 3-/6-month buckets anchored at the year's first month; a
 *   bucket the student joins part-way through is charged for the months they
 *   attend (floored).
 * - `term_wise`: the terms overlapping the applicable window, weighted by
 *   their weightage share; terms that ended before the student joined are not
 *   billed, and the term they join in is billed in full.
 *
 * `installmentNumber` counts the student's own buckets from 1, as before
 * this rule changed, so regenerating an assignment billed earlier matches its
 * existing rows instead of adding a second set.
 */
export function splitIntoBuckets(input: SplitLineInput): Bucket[] {
  const resolved =
    input.frequency === "inherit" ? input.structureMode : input.frequency;
  const effective = input.effectiveFrom > input.yearStart ? input.effectiveFrom : input.yearStart;
  const eff = parseIso(effective);
  const inWindow = (month: number) =>
    month >= input.applicableFromMonth && month <= input.applicableToMonth;
  const attended = (m: { year: number; month: number }) =>
    m.year > eff.year || (m.year === eff.year && m.month >= eff.month);

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

  /** Equal floored shares of the annual amount; the last absorbs the rest. */
  const equalShares = (count: number): bigint[] => {
    const base = input.annualAmountCents / BigInt(count);
    return Array.from({ length: count }, (_, i) =>
      i === count - 1 ? input.annualAmountCents - base * BigInt(count - 1) : base,
    );
  };

  const yearMonths = monthsBetween(input.yearStart, input.yearEnd).filter((m) =>
    inWindow(m.month),
  );

  if (resolved === "upfront" || resolved === "annual" || yearMonths.length === 0) {
    // One bucket, full amount, due at the effective date: a one-time charge
    // is owed whole whenever the student joins.
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
    const shares = equalShares(yearMonths.length);
    const out: Bucket[] = [];
    yearMonths.forEach((m, i) => {
      if (!attended(m)) return;
      let cents = shares[i] ?? 0n;
      const isJoiningMonth = m.year === eff.year && m.month === eff.month;
      if (isJoiningMonth && !input.joiningMonthFullCharge) {
        // Prorate the joining month by its remaining days, floored. The
        // shortfall is the school's choice, never a rounding drift.
        const dim = daysInMonth(m.year, m.month);
        const remaining = daysBetweenInclusive(effective, isoOf(m.year, m.month, dim));
        cents = (cents * BigInt(remaining)) / BigInt(dim);
      }
      out.push(
        make(
          out.length + 1,
          cents,
          isoOf(m.year, m.month, 1),
          `${input.headName} — ${isoOf(m.year, m.month, 1).slice(0, 7)}`,
          { month: m.month, year: m.year },
          null,
        ),
      );
    });
    return out;
  }

  if (resolved === "term_wise") {
    // Terms overlapping the applicable window, weighted by their share of
    // the window — the head's money follows the window's terms, not the year's.
    const windowTerms = input.terms.filter((t) =>
      monthsBetween(
        t.startDate > input.yearStart ? t.startDate : input.yearStart,
        t.endDate < input.yearEnd ? t.endDate : input.yearEnd,
      ).some((m) => inWindow(m.month)),
    );
    if (windowTerms.length === 0) {
      // No terms configured for the window: the money is still owed once.
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
    const totalWeightCents = windowTerms.reduce((acc, t) => acc + toCents(t.weightage), 0n);
    // Floored weightage shares; the LAST term absorbs the remainder.
    const shares = windowTerms.map(
      (t) => (input.annualAmountCents * toCents(t.weightage)) / totalWeightCents,
    );
    const distributed = shares.reduce((a, b) => a + b, 0n);
    shares[shares.length - 1] =
      (shares[shares.length - 1] ?? 0n) + (input.annualAmountCents - distributed);
    const out: Bucket[] = [];
    windowTerms.forEach((t, i) => {
      // A term that ended before the student joined is not theirs to pay.
      if (t.endDate < effective) return;
      out.push(
        make(
          out.length + 1,
          shares[i] ?? 0n,
          t.startDate > effective ? t.startDate : effective,
          `${input.headName} — ${t.name}`,
          { month: null, year: null },
          t.id,
        ),
      );
    });
    return out;
  }

  // quarterly / half_yearly: group the year's applicable months into
  // consecutive buckets anchored at the year's first month. Every non-empty
  // bucket gets an equal share of the year; the last absorbs the remainder.
  const size = resolved === "quarterly" ? 3 : 6;
  const yearStartMonth = parseIso(input.yearStart);
  const anchor = yearStartMonth.year * 12 + (yearStartMonth.month - 1);
  const groups = new Map<number, { year: number; month: number }[]>();
  for (const m of yearMonths) {
    const idx = Math.floor((m.year * 12 + (m.month - 1) - anchor) / size);
    const bucket = groups.get(idx) ?? [];
    bucket.push(m);
    groups.set(idx, bucket);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a - b);
  const shares = equalShares(ordered.length);
  const out: Bucket[] = [];
  ordered.forEach(([, months], i) => {
    const present = months.filter(attended);
    if (present.length === 0) return;
    const full = shares[i] ?? 0n;
    // Joined part-way through the period: pay for the months attended.
    const cents =
      present.length === months.length
        ? full
        : (full * BigInt(present.length)) / BigInt(months.length);
    const first = present[0] ?? months[0] ?? yearStartMonth;
    out.push(
      make(
        out.length + 1,
        cents,
        isoOf(first.year, first.month, 1),
        `${input.headName} — ${resolved} ${i + 1}`,
        { month: null, year: null },
        null,
      ),
    );
  });
  return out;
}

/** What a line actually bills this student: the sum of their buckets. */
export function billedAmountCents(input: SplitLineInput): bigint {
  return splitIntoBuckets(input).reduce((acc, b) => acc + b.amountCents, 0n);
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
 * **The stacked-concession clamp:** each head's TOTAL is capped at that
 * head's annual amount. `createConcession` validates each concession against
 * its base individually, but two individually-valid concessions can sum past
 * the fee (a 60% merit scholarship plus a 50% staff-ward discount past 100%),
 * and without this cap the apportionment would hand installments concession
 * shares exceeding their amounts — negative net dues. The cap is applied HERE
 * so every caller (generation, recompute, the gateway path) inherits it.
 *
 * Returns the per-head concession totals. A head absent from the map
 * conceded nothing.
 */
export function headConcessionTotals(
  concessionRows: ConcessionRow[],
  headAnnuals: { feeHeadId: string; annualCents: bigint }[],
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  const annualOf = new Map(headAnnuals.map((h) => [h.feeHeadId, h.annualCents]));
  const totalAnnual = headAnnuals.reduce((acc, h) => acc + h.annualCents, 0n);
  if (totalAnnual === 0n) return totals;

  const add = (headId: string, cents: bigint) => {
    const current = totals.get(headId) ?? 0n;
    const cap = annualOf.get(headId);
    // Clamp at the head's annual: discounts can zero a fee, never invert it.
    const next = cap !== undefined && current + cents > cap ? cap : current + cents;
    totals.set(headId, next);
  };

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
 * S2 (F5) — per-bucket concession shares honoring validity windows. A
 * concession contributes to a bucket iff `validFrom <= bucket.dueDate` AND
 * (`validTo == null` OR `bucket.dueDate <= validTo`): a Jun–Aug sibling
 * discount silently discounting the whole year was the finding.
 *
 * Two stages, both exact:
 * 1. Resolve each concession to THIS head's amount — a named-head
 *    concession counts whole for its head only; an all-heads concession is
 *    split proportionally to head annuals (floored, remainder to the largest
 *    head), the same split `headConcessionTotals` performs, kept
 *    per-concession so windows stay attached.
 * 2. Spread each resolved amount over its COVERED buckets proportionally to
 *    bucket amounts (floored, remainder to the last covered bucket), capped
 *    per bucket at the bucket's amount, against a head-annual budget shared
 *    across concessions (the H1 clamp, composed with windows): stacked
 *    concessions zero a fee, never invert it.
 *
 * A concession whose window covers NO bucket contributes nothing — it stays
 * a recorded audit row, not a discount. With full-year windows the spread is
 * the old `headConcessionTotals` + `apportionHeadTotal` pairing (modulo the
 * per-bucket cap, which only ever bites where the old code would have
 * written a negative net for the 0012 CHECK to refuse).
 */
export interface WindowedConcession {
  feeHeadId: string | null;
  amountCents: bigint;
  validFrom: string;
  validTo: string | null;
}

export interface WindowedBucket {
  dueDate: string;
  amountCents: bigint;
}

export function windowedConcessionShares(
  concessions: WindowedConcession[],
  headId: string,
  buckets: WindowedBucket[],
  headAnnuals: { feeHeadId: string; annualCents: bigint }[],
): bigint[] {
  const zero = buckets.map(() => 0n);
  if (buckets.length === 0) return zero;
  const totalAnnual = headAnnuals.reduce((acc, h) => acc + h.annualCents, 0n);
  if (totalAnnual <= 0n) return zero;
  const headAnnual =
    headAnnuals.find((h) => h.feeHeadId === headId)?.annualCents ?? 0n;
  const largest = headAnnuals.reduce((a, b) =>
    b.annualCents > a.annualCents ? b : a,
  );

  // Stage 1 — this head's per-concession amounts.
  type Resolved = { amountCents: bigint; validFrom: string; validTo: string | null };
  const resolved: Resolved[] = [];
  for (const c of concessions) {
    if (c.amountCents <= 0n) continue;
    if (c.feeHeadId) {
      if (c.feeHeadId === headId) {
        resolved.push({
          amountCents: c.amountCents,
          validFrom: c.validFrom,
          validTo: c.validTo,
        });
      }
      continue;
    }
    const parts = headAnnuals.map((h) => ({
      headId: h.feeHeadId,
      share: (h.annualCents * c.amountCents) / totalAnnual,
    }));
    const distributed = parts.reduce((acc, p) => acc + p.share, 0n);
    const remainder = c.amountCents - distributed;
    for (const p of parts) {
      if (p.headId !== headId) continue;
      const share = p.share + (remainder > 0n && p.headId === largest.feeHeadId ? remainder : 0n);
      if (share > 0n) {
        resolved.push({
          amountCents: share,
          validFrom: c.validFrom,
          validTo: c.validTo,
        });
      }
    }
  }

  // Stage 2 — sequential spread against the head-annual budget.
  const out = buckets.map(() => 0n);
  let budget = headAnnual;
  for (const s of resolved) {
    if (budget <= 0n) break;
    const covered: { idx: number; amountCents: bigint }[] = [];
    buckets.forEach((b, idx) => {
      if (s.validFrom <= b.dueDate && (s.validTo === null || b.dueDate <= s.validTo)) {
        covered.push({ idx, amountCents: b.amountCents });
      }
    });
    if (covered.length === 0) continue;
    const effective = s.amountCents < budget ? s.amountCents : budget;
    const weightTotal = covered.reduce((acc, b) => acc + b.amountCents, 0n);
    let parts: bigint[];
    if (weightTotal <= 0n) {
      parts = covered.map(() => 0n);
    } else {
      parts = covered.map((b) => (effective * b.amountCents) / weightTotal);
      const distributed = parts.reduce((acc, p) => acc + p, 0n);
      const last = parts.length - 1;
      parts[last] = (parts[last] ?? 0n) + (effective - distributed);
    }
    let spent = 0n;
    covered.forEach((b, k) => {
      const part = parts[k] ?? 0n;
      const room = b.amountCents - (out[b.idx] ?? 0n);
      let capped = 0n;
      if (part > 0n && room > 0n) {
        capped = part < room ? part : room;
      }
      out[b.idx] = (out[b.idx] ?? 0n) + capped;
      spent += capped;
    });
    budget -= spent;
  }
  return out;
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
