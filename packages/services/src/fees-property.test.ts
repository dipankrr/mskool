import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  allocateOldestFirst,
  computeLateFee,
  daysBetweenInclusive,
  daysInMonth,
  isoOf,
  monthsBetween,
  splitIntoBuckets,
  windowedConcessionShares,
  type SplitLineInput,
} from "./fees-maths";

/**
 * S6 — property-based money maths. The example-based suite
 * (fees-billing.test.ts) pins KNOWN cases; these properties pin the
 * INVARIANTS over random inputs: exactness, clamps, windows, monotonicity,
 * allocator discipline. Pure and hermetic — no database.
 *
 * Money is generated as integer paise and kept BigInt end to end (hard
 * rule 4): no float is ever constructed, not even in the test.
 */

const YEAR_START = "2030-04-01";
const YEAR_END = "2031-03-31";

/** An ISO date `days` after 2030-04-01 (UTC calendar arithmetic only). */
function plusDays(days: number): string {
  const t = Date.UTC(2030, 3, 1) + days * 86_400_000;
  const d = new Date(t);
  return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const arbPaise = (min: number, max: number) =>
  fc.integer({ min, max }).map((n) => BigInt(n));

describe("fees property: installment splits are exact", () => {
  it("monthly/quarterly/half-yearly/upfront/annual buckets sum EXACTLY to the annual", () => {
    fc.assert(
      fc.property(
        arbPaise(1, 100_000_000),
        fc.constantFrom("monthly", "quarterly", "half_yearly", "upfront", "annual") as fc.Arbitrary<
          SplitLineInput["frequency"]
        >,
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        (annual, frequency, fromM, toM) => {
          const from = Math.min(fromM, toM);
          const to = Math.max(fromM, toM);
          const buckets = splitIntoBuckets({
            annualAmountCents: annual,
            frequency,
            structureMode: "monthly",
            applicableFromMonth: from,
            applicableToMonth: to,
            yearStart: YEAR_START,
            yearEnd: YEAR_END,
            effectiveFrom: YEAR_START,
            joiningMonthFullCharge: true,
            feeHeadId: "h",
            headName: "H",
            terms: [],
          });
          const sum = buckets.reduce((a, b) => a + b.amountCents, 0n);
          expect(sum).toBe(annual);
        },
      ),
    );
  });

  it("a prorated joining month shrinks by exactly floor(base * remaining/dim)", () => {
    fc.assert(
      fc.property(
        arbPaise(12_00, 100_000_000),
        fc.integer({ min: 4, max: 12 }),
        fc.integer({ min: 2, max: 27 }),
        (annual, effMonth, effDay) => {
          const effYear = 2030;
          const effective = isoOf(effYear, effMonth, effDay);
          const buckets = splitIntoBuckets({
            annualAmountCents: annual,
            frequency: "monthly",
            structureMode: "monthly",
            applicableFromMonth: 1,
            applicableToMonth: 12,
            yearStart: YEAR_START,
            yearEnd: YEAR_END,
            effectiveFrom: effective,
            joiningMonthFullCharge: false,
            feeHeadId: "h",
            headName: "H",
            terms: [],
          });
          // One bucket per month from the joining month to March.
          const expectedCount =
            monthsBetween(effective, YEAR_END).length;
          expect(buckets).toHaveLength(expectedCount);
          const base = annual / BigInt(expectedCount);
          const dim = daysInMonth(effYear, effMonth);
          const remaining = daysBetweenInclusive(
            effective,
            isoOf(effYear, effMonth, dim),
          );
          const joining = buckets.find(
            (b) => b.periodMonth === effMonth && b.periodYear === effYear,
          );
          expect(joining).toBeTruthy();
          expect(joining?.amountCents).toBe(
            (base * BigInt(remaining)) / BigInt(dim),
          );
          // The documented shrink: the shortfall is foregone, never inflated.
          const sum = buckets.reduce((a, b) => a + b.amountCents, 0n);
          expect(sum <= annual).toBe(true);
        },
      ),
    );
  });
});

describe("fees property: concession clamps and windows", () => {
  it("stacked concessions clamp at the head annual; shares stay within buckets", () => {
    fc.assert(
      fc.property(
        arbPaise(100_00, 1_200_000),
        fc.array(
          fc.record({
            named: fc.boolean(),
            ratioBp: fc.integer({ min: 0, max: 20000 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        (headAnnual, specs) => {
          const heads = [{ feeHeadId: "tuition", annualCents: headAnnual }];
          const buckets = splitIntoBuckets({
            annualAmountCents: headAnnual,
            frequency: "monthly",
            structureMode: "monthly",
            applicableFromMonth: 1,
            applicableToMonth: 12,
            yearStart: YEAR_START,
            yearEnd: YEAR_END,
            effectiveFrom: YEAR_START,
            joiningMonthFullCharge: true,
            feeHeadId: "tuition",
            headName: "T",
            terms: [],
          }).map((b) => ({ dueDate: b.dueDate, amountCents: b.amountCents }));
          const concessions = specs.map((s) => ({
            feeHeadId: s.named ? "tuition" : null,
            // Up to 2x the annual: the stacking the H1 clamp exists for.
            amountCents: (headAnnual * BigInt(s.ratioBp)) / 10000n,
            validFrom: YEAR_START,
            validTo: null as string | null,
          }));
          const shares = windowedConcessionShares(
            concessions,
            "tuition",
            buckets,
            heads,
          );
          expect(shares.reduce((a, b) => a + b, 0n) <= headAnnual).toBe(true);
          shares.forEach((s, i) => {
            expect(s >= 0n).toBe(true);
            expect(s <= (buckets[i]?.amountCents ?? 0n)).toBe(true);
          });
        },
      ),
    );
  });

  it("a bucket is discounted ONLY inside some concession window", () => {
    const dues = Array.from({ length: 12 }, (_, i) => {
      const month = ((3 + i) % 12) + 1;
      const year = month >= 4 ? 2030 : 2031;
      return {
        dueDate: `${year}-${String(month).padStart(2, "0")}-01`,
        amountCents: 100_000n,
      };
    });
    const heads = [{ feeHeadId: "tuition", annualCents: 1_200_000n }];
    fc.assert(
      fc.property(
        fc.array(
          fc
            .tuple(fc.integer({ min: 0, max: 11 }), fc.integer({ min: 0, max: 11 }), fc.boolean())
            .map(([a, b, open]) => ({
              feeHeadId: "tuition" as string | null,
              amountCents: 50_000n,
              validFrom: dues[Math.min(a, b)]?.dueDate ?? YEAR_START,
              validTo: open ? null : (dues[Math.max(a, b)]?.dueDate ?? YEAR_END),
            })),
          { minLength: 1, maxLength: 3 },
        ),
        (concessions) => {
          const shares = windowedConcessionShares(
            concessions,
            "tuition",
            dues,
            heads,
          );
          const covered = (dueDate: string) =>
            concessions.some(
              (c) =>
                c.validFrom <= dueDate &&
                (c.validTo === null || dueDate <= c.validTo),
            );
          dues.forEach((bucket, i) => {
            if (!covered(bucket.dueDate)) {
              expect(shares[i]).toBe(0n);
            }
          });
        },
      ),
    );
  });
});

describe("fees property: late-fee shape", () => {
  it("flat fires once past grace; per-day is monotonic under its cap; percentage never exceeds balance share", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("flat", "percentage", "per_day") as fc.Arbitrary<
          "flat" | "percentage" | "per_day"
        >,
        arbPaise(1, 50_000),
        fc.integer({ min: 0, max: 10 }),
        arbPaise(100_00, 1_000_000),
        fc.integer({ min: -5, max: 30 }),
        fc.boolean(),
        (kind, value, grace, balance, dayOffset, capped) => {
          const rule = {
            feeStructureId: null,
            gracePeriodDays: grace,
            calculationType: kind,
            valueCents: value,
            maxLateFeeCents: capped ? value : null,
            effectiveFrom: "2030-01-01",
            effectiveTo: null as string | null,
          };
          const feeAt = (days: number) =>
            computeLateFee(
              { dueDate: "2030-04-01", balanceCents: balance },
              [rule],
              null,
              plusDays(days),
            );
          // plusDays(0) is 2030-04-01 = the due date: days-late 0.
          const late = dayOffset - grace;
          const fee = feeAt(dayOffset);
          if (late <= 0) {
            expect(fee).toBe(0n);
            return;
          }
          if (kind === "flat") {
            // The value once — the cap equals the value here by construction.
            expect(fee).toBe(value);
          } else if (kind === "percentage") {
            // balance × pct, floored — the cap can only shrink it.
            expect(fee * 10000n <= balance * value).toBe(true);
          } else {
            // Monotonic non-decreasing past grace, never above the cap.
            expect(feeAt(dayOffset + 1) >= fee).toBe(true);
            if (capped) expect(fee <= value).toBe(true);
            expect(fee).toBe(feeAt(dayOffset));
          }
        },
      ),
    );
  });
});

describe("fees property: the gateway allocator", () => {
  it("sums exactly to min(total, available), oldest-first, or refuses", () => {
    const duePool = ["2030-04-01", "2030-05-01", "2030-06-01", "2030-04-01"];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            due: fc.constantFrom(...duePool),
            balance: arbPaise(1, 50_000),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        arbPaise(1, 300_000),
        (rows, totalRaw) => {
          const outstanding = rows.map((r, k) => ({
            installmentId: `i-${k}`,
            dueDate: r.due,
            balanceCents: r.balance,
          }));
          const available = outstanding.reduce((a, o) => a + o.balanceCents, 0n);
          const total = (totalRaw % (available + 50_000n)) + 1n;
          const result = allocateOldestFirst(total, outstanding);
          if (total > available) {
            expect(result).toBeNull();
            return;
          }
          expect(result).not.toBeNull();
          const allocs = result ?? [];
          expect(allocs.reduce((a, x) => a + x.amountCents, 0n)).toBe(total);
          const byId = new Map(outstanding.map((o) => [o.installmentId, o]));
          for (const a of allocs) {
            const o = byId.get(a.installmentId);
            expect(o).toBeTruthy();
            expect(a.amountCents <= (o?.balanceCents ?? 0n)).toBe(true);
          }
          // Oldest-due-first, id tiebreak on equal due dates.
          const keys = allocs.map((a) => {
            const o = byId.get(a.installmentId);
            return `${o?.dueDate ?? ""}|${a.installmentId}`;
          });
          expect([...keys].sort()).toEqual(keys);
        },
      ),
    );
  });
});
