import { describe, expect, it } from "vitest";
import {
  allocateOldestFirst,
  computeLateFee,
  concessionKey,
  concessionShares,
  coveredPeriodsFor,
  daysInMonth,
  dueDateIn,
  fromCents,
  monthsBetween,
  periodOptions,
  pickLateFeeRule,
  planDues,
  priceLateFees,
  toCents,
  type LateFeeRuleLike,
  type LineFrequency,
  type PlanInput,
  type ScheduleRow,
} from "./fees-maths";

const APRIL_SESSION = {
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  terms: [
    { id: "t1", name: "Term 1", startDate: "2026-04-01", endDate: "2026-09-30" },
    { id: "t2", name: "Term 2", startDate: "2026-10-01", endDate: "2027-03-31" },
  ],
};

function schedule(
  frequency: LineFrequency,
  amountCents: bigint,
  overrides: Partial<ScheduleRow> = {},
  session = APRIL_SESSION,
  keep?: (key: string) => boolean,
): ScheduleRow[] {
  return periodOptions(frequency, session, 1)
    .filter((o) => (keep ? keep(o.key) : true))
    .map((o) => ({
      feeHeadId: "tuition",
      headName: "Tuition Fee",
      frequency,
      whoPays: "everyone",
      periodKey: o.key,
      label: o.label,
      startDate: o.startDate,
      endDate: o.endDate,
      dueDate: o.dueDate,
      amountCents,
      termId: o.termId,
      ...overrides,
    }));
}

function plan(rows: ScheduleRow[], overrides: Partial<PlanInput> = {}) {
  return planDues({
    rows,
    effectiveFrom: "2026-04-01",
    joiningMonthFullCharge: true,
    isNewStudent: false,
    billingStartedOn: null,
    awayRanges: [],
    ...overrides,
  });
}

describe("date helpers", () => {
  it("knows leap February and walks months across a year end", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(monthsBetween("2026-11-15", "2027-02-01").map((m) => m.month)).toEqual([11, 12, 1, 2]);
  });

  it("uses the month's last day when the due day does not exist", () => {
    expect(dueDateIn(2026, 2, 31)).toBe("2026-02-28");
    expect(dueDateIn(2026, 4, 31)).toBe("2026-04-30");
    expect(dueDateIn(2026, 4, 10)).toBe("2026-04-10");
  });
});

describe("periodOptions", () => {
  it("monthly: one row per session month, due on the due day", () => {
    const rows = periodOptions("monthly", APRIL_SESSION, 10);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ key: "2026-04", label: "April 2026", dueDate: "2026-04-10" });
    expect(rows[11]).toMatchObject({ key: "2027-03", label: "March 2027", dueDate: "2027-03-10" });
  });

  it("works for any session, not just April to March", () => {
    const june = { startDate: "2026-06-01", endDate: "2027-05-31", terms: [] };
    expect(periodOptions("monthly", june, 1)[0]?.key).toBe("2026-06");
    expect(periodOptions("quarterly", june, 1).map((o) => o.key)).toEqual([
      "q:2026-06",
      "q:2026-09",
      "q:2026-12",
      "q:2027-03",
    ]);
    const calendar = { startDate: "2026-01-01", endDate: "2026-12-31", terms: [] };
    expect(periodOptions("half_yearly", calendar, 1).map((o) => o.key)).toEqual([
      "h:2026-01",
      "h:2026-07",
    ]);
  });

  it("handles a short session and never dates a due before it starts", () => {
    const short = { startDate: "2026-10-15", endDate: "2027-03-31", terms: [] };
    const rows = periodOptions("monthly", short, 1);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ startDate: "2026-10-15", dueDate: "2026-10-15" });
  });

  it("term rows come from the session's terms; once is one row", () => {
    expect(periodOptions("term_wise", APRIL_SESSION, 1).map((o) => o.key)).toEqual([
      "term:t1",
      "term:t2",
    ]);
    expect(periodOptions("once", APRIL_SESSION, 1).map((o) => o.key)).toEqual(["once"]);
  });
});

describe("planDues: which months charge", () => {
  it("December off and April off are just rows that are not there", () => {
    const rows = schedule("monthly", 100000n, {}, APRIL_SESSION, (key) =>
      !["2026-04", "2026-12"].includes(key),
    );
    const dues = plan(rows);
    expect(dues).toHaveLength(10);
    expect(dues.map((d) => d.periodKey)).not.toContain("2026-12");
    expect(dues.map((d) => d.periodKey)).not.toContain("2026-04");
  });

  it("April to February crosses the new year", () => {
    const rows = schedule("monthly", 100000n, {}, APRIL_SESSION, (key) => key !== "2027-03");
    const dues = plan(rows);
    expect(dues).toHaveLength(11);
    expect(dues.at(-1)?.periodKey).toBe("2027-02");
  });

  it("a mid-session school ticks October to March and nothing earlier exists", () => {
    const rows = schedule("monthly", 100000n, {}, APRIL_SESSION, (key) => key >= "2026-10");
    expect(plan(rows).map((d) => d.periodKey)[0]).toBe("2026-10");
    expect(plan(rows)).toHaveLength(6);
  });

  it("an edited row wins over the line's amount", () => {
    const rows = schedule("monthly", 100000n).map((row) =>
      row.periodKey >= "2026-10" ? { ...row, amountCents: 120000n } : row,
    );
    const dues = plan(rows);
    expect(dues.find((d) => d.periodKey === "2026-09")?.amountCents).toBe(100000n);
    expect(dues.find((d) => d.periodKey === "2026-10")?.amountCents).toBe(120000n);
  });
});

describe("planDues: joining part-way", () => {
  it("a period's price never depends on when the student joined (ADR-050)", () => {
    const dues = plan(schedule("monthly", 100000n), { effectiveFrom: "2026-10-15" });
    expect(dues).toHaveLength(6);
    expect(dues.every((d) => d.amountCents === 100000n)).toBe(true);
    expect(dues[0]?.periodKey).toBe("2026-10");
  });

  it("prorates the joining month by remaining days only when told to", () => {
    const dues = plan(schedule("monthly", 310000n), {
      effectiveFrom: "2026-10-16",
      joiningMonthFullCharge: false,
    });
    expect(dues[0]?.amountCents).toBe(160000n);
    expect(dues[1]?.amountCents).toBe(310000n);
  });

  it("a quarter joined part-way is charged for months attended", () => {
    const dues = plan(schedule("quarterly", 300000n), { effectiveFrom: "2026-05-10" });
    expect(dues[0]).toMatchObject({ periodKey: "q:2026-04", amountCents: 200000n });
    expect(dues[1]).toMatchObject({ periodKey: "q:2026-07", amountCents: 300000n });
  });

  it("a term that ended is not theirs to pay; the term they join in is full", () => {
    const dues = plan(schedule("term_wise", 500000n), { effectiveFrom: "2026-11-01" });
    expect(dues).toHaveLength(1);
    expect(dues[0]).toMatchObject({ periodKey: "term:t2", amountCents: 500000n });
  });

  it("a one-time fee is owed whole whenever they join, due that day", () => {
    const dues = plan(schedule("once", 500000n), { effectiveFrom: "2026-11-20" });
    expect(dues[0]).toMatchObject({ amountCents: 500000n, dueDate: "2026-11-20" });
  });

  it("never dates a due before the student joined", () => {
    const dues = plan(schedule("monthly", 100000n), { effectiveFrom: "2026-10-15" });
    expect(dues[0]?.dueDate).toBe("2026-10-15");
    expect(dues[1]?.dueDate).toBe("2026-11-01");
  });
});

describe("planDues: rules", () => {
  it("no due is late before billing started", () => {
    const dues = plan(schedule("monthly", 100000n), { billingStartedOn: "2026-10-15" });
    const october = dues.find((d) => d.periodKey === "2026-10");
    const november = dues.find((d) => d.periodKey === "2026-11");
    expect(october?.dueDate).toBe("2026-10-15");
    expect(november?.dueDate).toBe("2026-11-01");
  });

  it("new-students-only fees skip everyone else", () => {
    const rows = schedule("once", 500000n, { whoPays: "new_students" });
    expect(plan(rows, { isNewStudent: false })).toHaveLength(0);
    expect(plan(rows, { isNewStudent: true })).toHaveLength(1);
  });

  it("months a student was away are not billed; the months around them are", () => {
    const dues = plan(schedule("monthly", 100000n), {
      awayRanges: [{ from: "2026-07-20", to: "2026-10-05" }],
    });
    const keys = dues.map((d) => d.periodKey);
    expect(keys).toContain("2026-07");
    expect(keys).not.toContain("2026-08");
    expect(keys).not.toContain("2026-09");
    expect(keys).toContain("2026-10");
  });

  it("names a month's due so the app can read it", () => {
    expect(plan(schedule("monthly", 100000n))[0]?.description).toBe("Tuition Fee — 2026-04");
    expect(plan(schedule("term_wise", 100000n))[0]?.description).toBe("Tuition Fee — Term 1");
  });
});

describe("concessionShares", () => {
  const twelve = plan(schedule("monthly", 100000n));
  const dues = twelve.map((d) => ({
    key: concessionKey(d.feeHeadId, d.periodKey),
    amountCents: d.amountCents,
  }));
  const covered = dues.map((d) => d.key);

  it("flat: spreads over its covered dues and gives exactly the amount", () => {
    const shares = concessionShares(
      [{ calculationType: "flat", valueCents: 120000n, coveredPeriods: covered }],
      dues,
    );
    expect(shares.get(covered[0] ?? "")).toBe(10000n);
    const total = [...shares.values()].reduce((a, b) => a + b, 0n);
    expect(total).toBe(120000n);
  });

  it("the regression: monthly billing no longer over-discounts", () => {
    // The old code spread ₹1,200 over the 8 months created so far (₹150 each),
    // then gave later months ₹100, for ₹1,600. The covered list is fixed now,
    // so the answer is the same however many months exist.
    const rule = { calculationType: "flat" as const, valueCents: 120000n, coveredPeriods: covered };
    const allYear = concessionShares([rule], dues);
    const eightMonths = concessionShares([rule], dues.slice(0, 8));
    expect(allYear.get(covered[0] ?? "")).toBe(10000n);
    // Rows not created yet are left out of `dues`; the plan always passes all of them.
    expect([...allYear.values()].reduce((a, b) => a + b, 0n)).toBe(120000n);
    expect(eightMonths.size).toBe(8);
  });

  it("percent: that share of each due, rounding down", () => {
    const shares = concessionShares(
      [{ calculationType: "percentage", valueCents: 3333n, coveredPeriods: [covered[0] ?? ""] }],
      [{ key: covered[0] ?? "", amountCents: 100n }],
    );
    expect(shares.get(covered[0] ?? "")).toBe(33n);
  });

  it("stacked concessions can never take a due below zero", () => {
    const shares = concessionShares(
      [
        { calculationType: "percentage", valueCents: 6000n, coveredPeriods: covered },
        { calculationType: "percentage", valueCents: 6000n, coveredPeriods: covered },
      ],
      dues,
    );
    for (const key of covered) expect(shares.get(key)).toBe(100000n);
  });

  it("leaves paid months out when it is created, so the full flat amount lands", () => {
    const frozen = new Set(covered.slice(0, 7));
    const open = coveredPeriodsFor(twelve, frozen, {
      feeHeadId: null,
      validFrom: "2026-04-01",
      validTo: null,
    });
    expect(open).toHaveLength(5);
    const shares = concessionShares(
      [{ calculationType: "flat", valueCents: 120000n, coveredPeriods: open }],
      dues,
    );
    expect([...shares.values()].reduce((a, b) => a + b, 0n)).toBe(120000n);
  });

  it("respects its dates and a named head, and skips services", () => {
    const rows = [
      ...twelve,
      { ...twelve[0], feeHeadId: "bus", periodKey: "2026-05", concessionEligible: false },
    ] as typeof twelve;
    const open = coveredPeriodsFor(rows, new Set(), {
      feeHeadId: null,
      validFrom: "2026-10-01",
      validTo: "2026-11-30",
    });
    expect(open).toEqual([
      concessionKey("tuition", "2026-10"),
      concessionKey("tuition", "2026-11"),
    ]);
    expect(
      coveredPeriodsFor(rows, new Set(), {
        feeHeadId: "other",
        validFrom: "2026-04-01",
        validTo: null,
      }),
    ).toEqual([]);
  });
});

describe("late fee", () => {
  const rule = (overrides: Partial<LateFeeRuleLike> = {}): LateFeeRuleLike => ({
    feeStructureId: null,
    gracePeriodDays: 0,
    calculationType: "flat",
    valueCents: 10000n,
    maxLateFeeCents: null,
    applyPer: "month",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    ...overrides,
  });
  const due = (overrides: Partial<Parameters<typeof priceLateFees>[0][number]> = {}) => ({
    id: "a",
    dueDate: "2026-04-01",
    balanceCents: 100000n,
    chargedCents: 0n,
    waivedCents: 0n,
    exempt: false,
    beingPaid: true,
    ...overrides,
  });

  it("flat, percent and per day still compute what they always did", () => {
    expect(
      computeLateFee({ dueDate: "2026-04-01", balanceCents: 100000n }, [rule()], null, "2026-04-02"),
    ).toBe(10000n);
    expect(
      computeLateFee(
        { dueDate: "2026-04-01", balanceCents: 100000n },
        [rule({ calculationType: "percentage", valueCents: 500n })],
        null,
        "2026-04-02",
      ),
    ).toBe(5000n);
    expect(
      computeLateFee(
        { dueDate: "2026-04-01", balanceCents: 100000n },
        [rule({ calculationType: "per_day", valueCents: 1000n, maxLateFeeCents: 5000n })],
        null,
        "2026-04-30",
      ),
    ).toBe(5000n);
  });

  it("nothing before the grace ends, on the due date, or on a zero balance", () => {
    expect(
      computeLateFee(
        { dueDate: "2026-04-01", balanceCents: 100000n },
        [rule({ gracePeriodDays: 5 })],
        null,
        "2026-04-06",
      ),
    ).toBe(0n);
    expect(
      computeLateFee({ dueDate: "2026-04-01", balanceCents: 0n }, [rule()], null, "2026-05-01"),
    ).toBe(0n);
  });

  it("the regression: paying in parts charges a flat late fee once", () => {
    const first = priceLateFees([due()], [rule()], null, "2026-11-01");
    expect(first.get("a")).toBe(10000n);
    const second = priceLateFees(
      [due({ balanceCents: 99900n, chargedCents: 10000n })],
      [rule()],
      null,
      "2026-11-01",
    );
    expect(second.size).toBe(0);
  });

  it("a part payment's lower balance never charges a percent fee again", () => {
    const percent = rule({ calculationType: "percentage", valueCents: 1000n });
    expect(priceLateFees([due()], [percent], null, "2026-11-01").get("a")).toBe(10000n);
    const second = priceLateFees(
      [due({ balanceCents: 50000n, chargedCents: 10000n })],
      [percent],
      null,
      "2026-11-01",
    );
    expect(second.size).toBe(0);
  });

  it("per day keeps charging only for the days added since", () => {
    const perDay = rule({ calculationType: "per_day", valueCents: 1000n, applyPer: "fee" });
    const later = priceLateFees(
      [due({ chargedCents: 5000n })],
      [perDay],
      null,
      "2026-04-11",
    );
    expect(later.get("a")).toBe(5000n);
  });

  it("per month: April's tuition and lab fee cost one late fee", () => {
    const charges = priceLateFees(
      [due({ id: "tuition" }), due({ id: "lab", balanceCents: 20000n })],
      [rule()],
      null,
      "2026-11-01",
    );
    expect(charges.get("tuition")).toBe(10000n);
    expect(charges.has("lab")).toBe(false);
  });

  it("per month: paying the other fee later does not charge the month again", () => {
    const charges = priceLateFees(
      [
        due({ id: "tuition", chargedCents: 10000n, beingPaid: false, balanceCents: 0n }),
        due({ id: "lab", balanceCents: 20000n }),
      ],
      [rule()],
      null,
      "2026-11-01",
    );
    expect(charges.size).toBe(0);
  });

  it("per fee: each overdue fee is charged", () => {
    const charges = priceLateFees(
      [due({ id: "tuition" }), due({ id: "lab", balanceCents: 20000n })],
      [rule({ applyPer: "fee" })],
      null,
      "2026-11-01",
    );
    expect(charges.get("tuition")).toBe(10000n);
    expect(charges.get("lab")).toBe(10000n);
  });

  it("separate months are charged separately, and only if being paid", () => {
    const charges = priceLateFees(
      [due({ id: "apr" }), due({ id: "may", dueDate: "2026-05-01", beingPaid: false })],
      [rule()],
      null,
      "2026-11-01",
    );
    expect(charges.get("apr")).toBe(10000n);
    expect(charges.has("may")).toBe(false);
  });

  it("a one-off charge never attracts a late fee, and forgiven stays forgiven", () => {
    expect(priceLateFees([due({ exempt: true })], [rule()], null, "2026-11-01").size).toBe(0);
    expect(priceLateFees([due({ waivedCents: 10000n })], [rule()], null, "2026-11-01").size).toBe(0);
  });

  it("a rule added today does not reach a due that was already late", () => {
    const newRule = rule({ effectiveFrom: "2026-11-01" });
    expect(pickLateFeeRule([newRule], null, "2026-04-01")).toBeNull();
    expect(pickLateFeeRule([newRule], null, "2026-12-01")).toBe(newRule);
  });

  it("the latest rule in effect wins, and a structure's rule breaks a tie", () => {
    const school = rule({ effectiveFrom: "2026-01-01" });
    const newer = rule({ effectiveFrom: "2026-03-01" });
    const named = rule({ effectiveFrom: "2026-03-01", feeStructureId: "s1" });
    expect(pickLateFeeRule([school, newer], null, "2026-04-01")).toBe(newer);
    expect(pickLateFeeRule([newer, named], "s1", "2026-04-01")).toBe(named);
    expect(pickLateFeeRule([named], "s2", "2026-04-01")).toBeNull();
  });
});

describe("money helpers", () => {
  it("round-trips paise exactly", () => {
    expect(toCents("1250.50")).toBe(125050n);
    expect(toCents("12")).toBe(1200n);
    expect(fromCents(125050n)).toBe("1250.50");
    expect(fromCents(5n)).toBe("0.05");
  });

  it("carries a sign instead of corrupting a negative", () => {
    expect(fromCents(-5n)).toBe("-0.05");
    expect(fromCents(-125050n)).toBe("-1250.50");
    expect(toCents("-0.05")).toBe(-5n);
  });

  it("refuses a third decimal", () => {
    expect(() => toCents("1.234")).toThrow();
  });
});

describe("allocateOldestFirst", () => {
  const dues = [
    { installmentId: "b", dueDate: "2026-05-01", balanceCents: 1000n },
    { installmentId: "a", dueDate: "2026-04-01", balanceCents: 1000n },
  ];

  it("fills oldest first and stops at the total", () => {
    expect(allocateOldestFirst(1500n, dues)).toEqual([
      { installmentId: "a", amountCents: 1000n },
      { installmentId: "b", amountCents: 500n },
    ]);
  });

  it("refuses more than is owed, or nothing", () => {
    expect(allocateOldestFirst(2001n, dues)).toBeNull();
    expect(allocateOldestFirst(0n, dues)).toBeNull();
  });
});
