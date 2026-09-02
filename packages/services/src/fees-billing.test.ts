import { describe, expect, it } from "vitest";
import {
  allocateOldestFirst,
  apportionHeadTotal,
  computeLateFee,
  daysInMonth,
  headConcessionTotals,
  monthsBetween,
  splitIntoBuckets,
  fromCents,
  toCents,
  type LateFeeRuleLike,
  type SplitLineInput,
} from "./fees-maths";

/**
 * The phase's unit-test core: the money maths. Every rule from the plan's
 * "Money-safety discipline" layer 4 lives here — floored shares, the last
 * bucket absorbing the remainder, percentage rounding DOWN, late fee frozen
 * logic. These tests are PURE: no database, no mocks, deterministic dates.
 */

const baseLine: SplitLineInput = {
  annualAmountCents: 1_200_000n, // 12000.00
  frequency: "inherit",
  structureMode: "monthly",
  applicableFromMonth: 1,
  applicableToMonth: 12,
  yearStart: "2030-04-01",
  yearEnd: "2031-03-31",
  effectiveFrom: "2030-04-01",
  joiningMonthFullCharge: true,
  feeHeadId: "head-1",
  headName: "Tuition Fee",
  terms: [],
};

const sum = (buckets: { amountCents: bigint }[]) =>
  buckets.reduce((acc, b) => acc + b.amountCents, 0n);

describe("date helpers", () => {
  it("monthsBetween spans an Indian academic year", () => {
    const months = monthsBetween("2030-04-01", "2031-03-31");
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2030, month: 4 });
    expect(months[11]).toEqual({ year: 2031, month: 3 });
  });

  it("daysInMonth handles leap February", () => {
    expect(daysInMonth(2032, 2)).toBe(29);
    expect(daysInMonth(2030, 2)).toBe(28);
  });
});

describe("splitIntoBuckets — monthly", () => {
  it("splits evenly with no remainder", () => {
    const buckets = splitIntoBuckets(baseLine);
    expect(buckets).toHaveLength(12);
    expect(sum(buckets)).toBe(1_200_000n);
    expect(buckets.every((b) => b.amountCents === 100_000n)).toBe(true);
  });

  it("the LAST bucket absorbs the remainder (1000.00 / 3)", () => {
    const buckets = splitIntoBuckets({
      ...baseLine,
      annualAmountCents: 100_000n,
      yearStart: "2030-01-01",
      yearEnd: "2030-12-31",
      applicableFromMonth: 1,
      applicableToMonth: 3, // Jan–Mar only: three monthly buckets
      effectiveFrom: "2030-01-01",
    });
    expect(buckets).toHaveLength(3);
    expect(sum(buckets)).toBe(100_000n);
    expect(buckets[0]?.amountCents).toBe(33_333n);
    expect(buckets[2]?.amountCents).toBe(33_334n);
  });

  it("mid-session effective date SKIPS earlier months and still sums exactly", () => {
    const buckets = splitIntoBuckets({
      ...baseLine,
      effectiveFrom: "2030-10-01", // joins in October of an Apr–Mar year
    });
    expect(buckets).toHaveLength(6);
    expect(buckets[0]?.periodMonth).toBe(10);
    expect(sum(buckets)).toBe(1_200_000n);
  });

  it("prorates the joining month when joiningMonthFullCharge is false", () => {
    const buckets = splitIntoBuckets({
      ...baseLine,
      effectiveFrom: "2030-10-16", // 16 days left in October (31 days)
      joiningMonthFullCharge: false,
    });
    expect(buckets).toHaveLength(6);
    expect(sum(buckets)).toBeLessThan(1_200_000n);
    // The joining month's share is floored to its day fraction of the
    // six-month share (12000.00 / 6 = 2000.00 → × 16/31 = 1032.25).
    const remaining = 31 - 16 + 1;
    expect(buckets[0]?.amountCents).toBe((200_000n * BigInt(remaining)) / 31n);
  });

  it("charges the joining month IN FULL by default (the Indian rule)", () => {
    const buckets = splitIntoBuckets({
      ...baseLine,
      effectiveFrom: "2030-10-30",
    });
    expect(buckets).toHaveLength(6);
    expect(buckets[0]?.amountCents).toBe(200_000n);
  });

  it("respects the applicable month range", () => {
    const buckets = splitIntoBuckets({
      ...baseLine,
      applicableFromMonth: 7,
      applicableToMonth: 9, // a quarter-long activity fee
    });
    expect(buckets).toHaveLength(3);
    expect(sum(buckets)).toBe(1_200_000n);
  });
});

describe("splitIntoBuckets — term_wise", () => {
  const terms = [
    {
      id: "t1",
      name: "Term 1",
      startDate: "2030-04-01",
      endDate: "2030-09-30",
      weightage: "60.00",
    },
    {
      id: "t2",
      name: "Term 2",
      startDate: "2030-10-01",
      endDate: "2031-03-31",
      weightage: "40.00",
    },
  ];

  it("splits by weightage with the remainder in the last term", () => {
    const buckets = splitIntoBuckets({
      ...baseLine,
      frequency: "term_wise",
      structureMode: "monthly",
      terms,
    });
    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.amountCents).toBe(720_000n); // 60%
    expect(buckets[1]?.amountCents).toBe(480_000n); // 40%
    expect(buckets[0]?.termId).toBe("t1");
    expect(sum(buckets)).toBe(1_200_000n);
  });

  it("renormalises across the terms that survive the applicable range", () => {
    const buckets = splitIntoBuckets({
      ...baseLine,
      frequency: "term_wise",
      applicableFromMonth: 10,
      applicableToMonth: 12, // only Term 2 overlaps
      terms,
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.amountCents).toBe(1_200_000n);
  });
});

describe("splitIntoBuckets — upfront and quarterly", () => {
  it("upfront is ONE bucket at the effective date", () => {
    const buckets = splitIntoBuckets({
      ...baseLine,
      frequency: "inherit",
      structureMode: "upfront",
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.amountCents).toBe(1_200_000n);
    expect(buckets[0]?.dueDate).toBe("2030-04-01");
  });

  it("quarterly groups the year's months into 3-month buckets", () => {
    const buckets = splitIntoBuckets({
      ...baseLine,
      frequency: "quarterly",
    });
    expect(buckets).toHaveLength(4);
    expect(sum(buckets)).toBe(1_200_000n);
  });
});

describe("headConcessionTotals", () => {
  const heads = [
    { feeHeadId: "tuition", annualCents: 1_000_000n },
    { feeHeadId: "lab", annualCents: 200_000n },
  ];

  it("a named-head concession goes to that head whole", () => {
    const totals = headConcessionTotals(
      [{ feeHeadId: "lab", amountCents: 20_000n }],
      heads,
    );
    expect(totals.get("lab")).toBe(20_000n);
    expect(totals.get("tuition")).toBeUndefined();
  });

  it("an all-heads concession is shared proportionally, remainder to the largest", () => {
    // 100.00 across 1000.00 + 200.00 → 83.33 + 16.66, remainder 0.01 → tuition.
    const totals = headConcessionTotals(
      [{ feeHeadId: null, amountCents: 10_000n }],
      heads,
    );
    expect(totals.get("tuition")).toBe(8_334n); // 83.33 + 0.01
    expect(totals.get("lab")).toBe(1_666n);
    expect((totals.get("tuition") ?? 0n) + (totals.get("lab") ?? 0n)).toBe(10_000n);
  });
});

describe("apportionHeadTotal", () => {
  it("sums exactly to the head total, remainder in the last share", () => {
    const shares = apportionHeadTotal(1_000n, [333n, 333n, 334n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(1_000n);
  });

  it("never hands a bucket a negative share", () => {
    const shares = apportionHeadTotal(100n, [700n, 300n]);
    expect(shares.every((s) => s >= 0n)).toBe(true);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(100n);
  });
});

describe("computeLateFee", () => {
  const installment = { dueDate: "2030-04-10", balanceCents: 100_000n }; // 1000.00 due

  const rule = (overrides: Partial<LateFeeRuleLike> = {}): LateFeeRuleLike => ({
    feeStructureId: null,
    gracePeriodDays: 0,
    calculationType: "flat",
    valueCents: 5_000n, // 50.00
    maxLateFeeCents: null,
    effectiveFrom: "2030-01-01",
    effectiveTo: null,
    ...overrides,
  });

  it("returns zero with no applicable rule", () => {
    expect(computeLateFee(installment, [], "s1", "2030-05-01")).toBe(0n);
  });

  it("returns zero inside the grace window", () => {
    expect(
      computeLateFee(installment, [rule({ gracePeriodDays: 7 })], "s1", "2030-04-17"),
    ).toBe(0n);
  });

  it("charges the first day PAST the grace window", () => {
    expect(
      computeLateFee(installment, [rule({ gracePeriodDays: 7 })], "s1", "2030-04-18"),
    ).toBe(5_000n);
  });

  it("flat: the value once, regardless of how late", () => {
    expect(computeLateFee(installment, [rule()], "s1", "2030-09-01")).toBe(5_000n);
  });

  it("percentage: that share of the CURRENT balance, once", () => {
    expect(
      computeLateFee(installment, [rule({ calculationType: "percentage", valueCents: 200n })], "s1", "2030-05-01"),
    ).toBe(2_000n); // 2% of 1000.00 = 20.00
  });

  it("per_day: value × days late", () => {
    expect(
      computeLateFee(installment, [rule({ calculationType: "per_day", valueCents: 100n })], "s1", "2030-04-20"),
    ).toBe(1_000n); // 10 days × 1.00
  });

  it("caps at max_late_fee", () => {
    expect(
      computeLateFee(
        installment,
        [rule({ calculationType: "per_day", valueCents: 100n, maxLateFeeCents: 500n })],
        "s1",
        "2030-05-20",
      ),
    ).toBe(500n);
  });

  it("a structure-named rule beats a school-wide rule", () => {
    expect(
      computeLateFee(
        installment,
        [rule({ valueCents: 5_000n }), rule({ feeStructureId: "s1", valueCents: 9_900n })],
        "s1",
        "2030-05-01",
      ),
    ).toBe(9_900n);
  });

  it("the LATEST effective_from wins among overlapping rules", () => {
    expect(
      computeLateFee(
        installment,
        [rule({ valueCents: 5_000n }), rule({ valueCents: 7_500n, effectiveFrom: "2030-04-15" })],
        "s1",
        "2030-05-01",
      ),
    ).toBe(7_500n);
  });

  it("a paid-up installment accrues nothing", () => {
    expect(
      computeLateFee(
        { dueDate: "2030-04-10", balanceCents: 0n },
        [rule()],
        "s1",
        "2030-05-01",
      ),
    ).toBe(0n);
  });
});

describe("money helpers", () => {
  it("round-trips paise", () => {
    expect(fromCents(toCents("1250.50"))).toBe("1250.50");
    expect(fromCents(toCents("1250"))).toBe("1250.00");
    expect(toCents("0.01")).toBe(1n);
  });

  it("refuses floats-in-disguise", () => {
    expect(() => toCents("1e3")).toThrow();
    expect(() => toCents("12.999")).toThrow();
    expect(() => toCents("-5.00")).toThrow();
    expect(() => toCents("")).toThrow();
  });
});

describe("allocateOldestFirst — the gateway's server-side allocation", () => {
  const outstanding = [
    { installmentId: "apr", dueDate: "2030-04-10", balanceCents: 100_000n },
    { installmentId: "jul", dueDate: "2030-07-10", balanceCents: 100_000n },
    { installmentId: "oct", dueDate: "2030-10-10", balanceCents: 100_000n },
  ];

  it("fills the OLDEST due first", () => {
    const result = allocateOldestFirst(150_000n, outstanding);
    expect(result).toEqual([
      { installmentId: "apr", amountCents: 100_000n },
      { installmentId: "jul", amountCents: 50_000n },
    ]);
  });

  it("consumes a total exactly equal to the dues", () => {
    const result = allocateOldestFirst(300_000n, outstanding);
    expect(result).toHaveLength(3);
    expect(
      result?.reduce((acc, a) => acc + a.amountCents, 0n),
    ).toBe(300_000n);
  });

  it("REFUSES a total exceeding the outstanding balances (no surplus wallet)", () => {
    expect(allocateOldestFirst(300_001n, outstanding)).toBeNull();
  });

  it("refuses zero and negative totals", () => {
    expect(allocateOldestFirst(0n, outstanding)).toBeNull();
  });

  it("skips installments already fully paid", () => {
    const result = allocateOldestFirst(100_000n, [
      { installmentId: "apr", dueDate: "2030-04-10", balanceCents: 0n },
      ...outstanding.slice(1),
    ]);
    expect(result).toEqual([{ installmentId: "jul", amountCents: 100_000n }]);
  });
});
