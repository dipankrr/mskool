/**
 * FEES — the pure money and bucket maths. NO DATABASE IMPORTS.
 *
 * This module exists so the phase's test core (fees-billing.test.ts) can run
 * hermetically: `pnpm test` must never need Postgres or an env, and every
 * function here is deterministic — ISO date strings in, BigInt paise out.
 * The service wrappers that load facts and call these live in
 * fees-billing.service.ts.
 *
 * Money arithmetic is BigInt paise end to end (hard rule 4). Every division
 * FLOORS, so the school never over-discounts by a rounding artefact.
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
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${sign}${whole}.${frac.toString().padStart(2, "0")}`;
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
// Pure schedule maths: what a fee line charges, one row per period
// ---------------------------------------------------------------------------

export type LineFrequency = "monthly" | "quarterly" | "half_yearly" | "term_wise" | "once";

/** One period a line could charge, before anyone has priced it. */
export interface PeriodOption {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  termId: string | null;
}

export interface SessionShape {
  startDate: string;
  endDate: string;
  terms: { id: string; name: string; startDate: string; endDate: string }[];
}

const MONTH_NAMES = [
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
];

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** `dueDay` in a month, using the last day when the month is shorter. */
export function dueDateIn(year: number, month: number, dueDay: number): string {
  return isoOf(year, month, Math.min(dueDay, daysInMonth(year, month)));
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Every period a line of this frequency could charge in a session. Quarters and
 * half-years count from the session's first month, so a June to May session
 * gets June to August as its first quarter. A due date falls on `dueDay` of the
 * period's first month and is never before the session starts.
 */
export function periodOptions(
  frequency: LineFrequency,
  session: SessionShape,
  dueDay: number,
): PeriodOption[] {
  const months = monthsBetween(session.startDate, session.endDate);

  if (frequency === "once") {
    return [
      {
        key: "once",
        label: "Once",
        startDate: session.startDate,
        endDate: session.endDate,
        dueDate: session.startDate,
        termId: null,
      },
    ];
  }

  if (frequency === "term_wise") {
    return session.terms.map((term) => ({
      key: `term:${term.id}`,
      label: term.name,
      startDate: later(term.startDate, session.startDate),
      endDate: earlier(term.endDate, session.endDate),
      dueDate: later(term.startDate, session.startDate),
      termId: term.id,
    }));
  }

  if (frequency === "monthly") {
    return months.map(({ year, month }) => ({
      key: monthKey(year, month),
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      startDate: later(isoOf(year, month, 1), session.startDate),
      endDate: earlier(isoOf(year, month, daysInMonth(year, month)), session.endDate),
      dueDate: later(dueDateIn(year, month, dueDay), session.startDate),
      termId: null,
    }));
  }

  const size = frequency === "quarterly" ? 3 : 6;
  const prefix = frequency === "quarterly" ? "q" : "h";
  const out: PeriodOption[] = [];
  for (let i = 0; i < months.length; i += size) {
    const first = months[i];
    const last = months[Math.min(i + size - 1, months.length - 1)];
    if (!first || !last) continue;
    const firstName = MONTH_NAMES[first.month - 1] ?? "";
    const lastName = MONTH_NAMES[last.month - 1] ?? "";
    out.push({
      key: `${prefix}:${monthKey(first.year, first.month)}`,
      label: `${firstName.slice(0, 3)} to ${lastName.slice(0, 3)} ${last.year}`,
      startDate: later(isoOf(first.year, first.month, 1), session.startDate),
      endDate: earlier(
        isoOf(last.year, last.month, daysInMonth(last.year, last.month)),
        session.endDate,
      ),
      dueDate: later(dueDateIn(first.year, first.month, dueDay), session.startDate),
      termId: null,
    });
  }
  return out;
}

/** The months of a session a period spans, used when a student joins part-way. */
function monthsIn(startDate: string, endDate: string) {
  return monthsBetween(startDate, endDate).length;
}

// ---------------------------------------------------------------------------
// Pure dues planning: one student's dues, from the schedule
// ---------------------------------------------------------------------------

/** One schedule row, as the planner needs it. */
export interface ScheduleRow {
  feeHeadId: string;
  headName: string;
  frequency: LineFrequency;
  whoPays: "everyone" | "new_students";
  periodKey: string;
  label: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  amountCents: bigint;
  termId: string | null;
}

export interface PlanInput {
  rows: ScheduleRow[];
  /** Nothing before this date is billed. */
  effectiveFrom: string;
  joiningMonthFullCharge: boolean;
  isNewStudent: boolean;
  /** No due is late before billing started: earlier due dates move up to it. */
  billingStartedOn: string | null;
  /** Spans the student was away (left, then rejoined). Periods inside are skipped. */
  awayRanges: { from: string; to: string }[];
}

/** One due this student should have, before the database sees it. */
export interface PlannedDue {
  feeHeadId: string;
  periodKey: string;
  description: string;
  amountCents: bigint;
  dueDate: string;
  periodMonth: number | null;
  periodYear: number | null;
  termId: string | null;
  /** Services are priced outside concessions (a recorded trade-off). */
  concessionEligible: boolean;
}

/**
 * A student's full set of dues for the session. A period's price never depends
 * on when the student joined (ADR-050): the schedule holds the price, and a
 * joiner just starts part-way down it.
 *
 * - `once`: owed whole whenever the student joins.
 * - `monthly`: from the joining month. The joining month is charged in full
 *   unless the school prorates it by remaining days.
 * - `quarterly` / `half_yearly`: a period joined part-way is charged for the
 *   months attended, floored.
 * - `term_wise`: a term that ended before they joined is not theirs to pay; the
 *   term they join in is charged in full.
 */
export function planDues(input: PlanInput): PlannedDue[] {
  const out: PlannedDue[] = [];
  const floorDue = input.billingStartedOn
    ? later(input.effectiveFrom, input.billingStartedOn)
    : input.effectiveFrom;

  for (const row of input.rows) {
    if (row.whoPays === "new_students" && !input.isNewStudent) continue;

    const base = {
      feeHeadId: row.feeHeadId,
      periodKey: row.periodKey,
      termId: row.termId,
      concessionEligible: true,
    };

    if (row.frequency === "once") {
      out.push({
        ...base,
        description: row.headName,
        amountCents: row.amountCents,
        dueDate: later(row.dueDate, floorDue),
        periodMonth: null,
        periodYear: null,
      });
      continue;
    }

    if (row.endDate < input.effectiveFrom) continue;
    if (input.awayRanges.some((r) => r.from < row.startDate && row.endDate < r.to)) continue;

    let amountCents = row.amountCents;
    if (input.effectiveFrom > row.startDate) {
      if (row.frequency === "monthly" && !input.joiningMonthFullCharge) {
        const days = daysBetweenInclusive(row.startDate, row.endDate);
        const remaining = daysBetweenInclusive(input.effectiveFrom, row.endDate);
        amountCents = (amountCents * BigInt(remaining)) / BigInt(days);
      } else if (row.frequency === "quarterly" || row.frequency === "half_yearly") {
        const total = monthsIn(row.startDate, row.endDate);
        const attended = monthsIn(input.effectiveFrom, row.endDate);
        if (attended < total) amountCents = (amountCents * BigInt(attended)) / BigInt(total);
      }
    }

    const isMonth = row.frequency === "monthly";
    const start = parseIso(row.startDate);
    out.push({
      ...base,
      description: isMonth
        ? `${row.headName} — ${monthKey(start.year, start.month)}`
        : `${row.headName} — ${row.label}`,
      amountCents,
      dueDate: later(row.dueDate, floorDue),
      periodMonth: isMonth ? start.month : null,
      periodYear: isMonth ? start.year : null,
    });
  }
  return out.sort((a, b) =>
    a.dueDate === b.dueDate
      ? a.feeHeadId === b.feeHeadId
        ? a.periodKey.localeCompare(b.periodKey)
        : a.feeHeadId.localeCompare(b.feeHeadId)
      : a.dueDate.localeCompare(b.dueDate),
  );
}

// ---------------------------------------------------------------------------
// Pure concession rules
// ---------------------------------------------------------------------------

/** A due's stable name inside a concession's covered list. */
export function concessionKey(feeHeadId: string, periodKey: string): string {
  return `${feeHeadId}:${periodKey}`;
}

export interface ConcessionRule {
  calculationType: "flat" | "percentage";
  /** Paise for flat. For percentage, the percent in paise: 10% is 1000n. */
  valueCents: bigint;
  coveredPeriods: string[];
}

/**
 * What every due gets off, across all of a student's concessions, in the order
 * they were granted. A percentage is that share of each covered due, rounding
 * down. A flat amount is spread over its covered dues in proportion to their
 * amounts, floored, the last covered due absorbing the rest. Stacked
 * concessions can never take a due below zero.
 *
 * Because each concession fixes its covered periods when it is created, this
 * gives the same answer however many months have been created or paid since.
 */
export function concessionShares(
  rules: ConcessionRule[],
  dues: { key: string; amountCents: bigint }[],
): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  const amountOf = new Map(dues.map((d) => [d.key, d.amountCents]));

  for (const rule of rules) {
    const covered = rule.coveredPeriods.filter((key) => amountOf.has(key));
    if (covered.length === 0) continue;

    const parts = new Map<string, bigint>();
    if (rule.calculationType === "percentage") {
      for (const key of covered) {
        parts.set(key, ((amountOf.get(key) ?? 0n) * rule.valueCents) / 10000n);
      }
    } else {
      const total = covered.reduce((acc, key) => acc + (amountOf.get(key) ?? 0n), 0n);
      if (total <= 0n) continue;
      const budget = rule.valueCents < total ? rule.valueCents : total;
      let given = 0n;
      covered.forEach((key, index) => {
        const part =
          index === covered.length - 1
            ? budget - given
            : (budget * (amountOf.get(key) ?? 0n)) / total;
        parts.set(key, part);
        given += part;
      });
    }

    for (const [key, part] of parts) {
      const room = (amountOf.get(key) ?? 0n) - (shares.get(key) ?? 0n);
      const take = part < room ? part : room;
      if (take > 0n) shares.set(key, (shares.get(key) ?? 0n) + take);
    }
  }
  return shares;
}

/** The dues a new concession covers: eligible, in its window, not already paid. */
export function coveredPeriodsFor(
  dues: PlannedDue[],
  frozenKeys: Set<string>,
  concession: { feeHeadId: string | null; validFrom: string; validTo: string | null },
): string[] {
  return dues
    .filter(
      (d) =>
        d.concessionEligible &&
        (concession.feeHeadId === null || d.feeHeadId === concession.feeHeadId) &&
        concession.validFrom <= d.dueDate &&
        (concession.validTo === null || d.dueDate <= concession.validTo) &&
        !frozenKeys.has(concessionKey(d.feeHeadId, d.periodKey)),
    )
    .map((d) => concessionKey(d.feeHeadId, d.periodKey));
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
  /** One late fee per due, or one per month across a student's dues. */
  applyPer?: "fee" | "month";
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * The rule for a due: the one in effect when it FELL DUE, so a rule added today
 * never reaches a due that was already late. Among candidates the latest
 * effective_from wins, and a structure-named rule breaks a tie.
 */
export function pickLateFeeRule(
  rules: LateFeeRuleLike[],
  structureId: string | null,
  dueDate: string,
): LateFeeRuleLike | null {
  const candidates = rules
    .filter((r) => r.feeStructureId === null || r.feeStructureId === structureId)
    .filter((r) => r.effectiveFrom <= dueDate && (!r.effectiveTo || r.effectiveTo >= dueDate))
    .sort((a, b) => {
      if (a.effectiveFrom !== b.effectiveFrom) {
        return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
      }
      return (b.feeStructureId ? 1 : 0) - (a.feeStructureId ? 1 : 0);
    });
  return candidates[0] ?? null;
}

/**
 * The full late fee a rule asks for on a balance, as of a date.
 *
 * - flat: the value, once, after the grace window.
 * - percentage: that share of the balance.
 * - per_day: the value for each day past the grace window. Uncapped, this is a
 *   policy accident, which is why the rule screen urges a cap.
 */
export function lateFeeOwed(
  rule: LateFeeRuleLike,
  dueDate: string,
  balanceCents: bigint,
  asOf: string,
): bigint {
  const lateDays = daysLateOf(dueDate, asOf) - rule.gracePeriodDays;
  if (lateDays <= 0 || balanceCents <= 0n) return 0n;

  let fee = 0n;
  if (rule.calculationType === "flat") {
    fee = rule.valueCents;
  } else if (rule.calculationType === "percentage") {
    fee = (balanceCents * rule.valueCents) / 10000n;
  } else {
    fee = rule.valueCents * BigInt(lateDays);
  }
  if (rule.maxLateFeeCents !== null && fee > rule.maxLateFeeCents) {
    fee = rule.maxLateFeeCents;
  }
  return fee;
}

/** The late fee one due would owe today, ignoring what was already charged. */
export function computeLateFee(
  installment: { dueDate: string; balanceCents: bigint },
  rules: LateFeeRuleLike[],
  structureId: string | null,
  asOf: string,
): bigint {
  const rule = pickLateFeeRule(rules, structureId, installment.dueDate);
  return rule ? lateFeeOwed(rule, installment.dueDate, installment.balanceCents, asOf) : 0n;
}

/** One of a student's dues, as the late-fee pricing needs it. */
export interface LateFeeDue {
  id: string;
  dueDate: string;
  balanceCents: bigint;
  chargedCents: bigint;
  waivedCents: bigint;
  exempt: boolean;
  /** This payment puts money on it, which is what triggers a charge. */
  beingPaid: boolean;
}

/**
 * THE LATE FEE IS CHARGED ONCE. What a payment owes is what the rule asks for,
 * less what was already charged or forgiven, so paying a due in parts cannot
 * charge it again. A per-day rule still charges the days added since.
 *
 * Rules are per fee or per month. Per month treats a student's overdue dues in
 * one calendar month as one: April's tuition and lab fee cost one late fee, and
 * the charge lands on the first due being paid in that month.
 *
 * Returns what to charge on each due being paid. Dues not being paid are read
 * only to see what their month has already been charged.
 */
export function priceLateFees(
  dues: LateFeeDue[],
  rules: LateFeeRuleLike[],
  structureId: string | null,
  asOf: string,
): Map<string, bigint> {
  const charges = new Map<string, bigint>();
  const months = new Map<string, LateFeeDue[]>();

  for (const due of dues) {
    if (due.exempt) continue;
    const rule = pickLateFeeRule(rules, structureId, due.dueDate);
    if (!rule) continue;

    if ((rule.applyPer ?? "month") === "fee") {
      if (!due.beingPaid) continue;
      const owed = lateFeeOwed(rule, due.dueDate, due.balanceCents, asOf);
      const charge = owed - due.chargedCents - due.waivedCents;
      if (charge > 0n) charges.set(due.id, charge);
      continue;
    }

    const key = due.dueDate.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), due]);
  }

  for (const group of months.values()) {
    const target = group.find((d) => d.beingPaid);
    if (!target) continue;
    const oldest = group.reduce((a, b) => (a.dueDate < b.dueDate ? a : b));
    const rule = pickLateFeeRule(rules, structureId, oldest.dueDate);
    if (!rule) continue;
    const balance = group.reduce((acc, d) => acc + d.balanceCents, 0n);
    const owed = lateFeeOwed(rule, oldest.dueDate, balance, asOf);
    const already = group.reduce((acc, d) => acc + d.chargedCents + d.waivedCents, 0n);
    const charge = owed - already;
    if (charge > 0n) charges.set(target.id, charge);
  }
  return charges;
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
