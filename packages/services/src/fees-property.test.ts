import { describe, expect, it } from "vitest";
import {
  allocateOldestFirst,
  concessionKey,
  concessionShares,
  coveredPeriodsFor,
  periodOptions,
  planDues,
  priceLateFees,
  type LateFeeRuleLike,
  type LineFrequency,
  type ScheduleRow,
} from "./fees-maths";

/**
 * Seeded walks over many fee shapes. The named cases live in fees-billing.test.ts;
 * these assert what must hold for every shape, so a change to the maths cannot
 * quietly break one nobody thought to name.
 */
function rng(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % max;
  };
}

const SESSIONS = [
  { startDate: "2026-04-01", endDate: "2027-03-31" },
  { startDate: "2026-01-01", endDate: "2026-12-31" },
  { startDate: "2026-06-01", endDate: "2027-05-31" },
  { startDate: "2026-10-15", endDate: "2027-03-31" },
];

const FREQUENCIES: LineFrequency[] = ["monthly", "quarterly", "half_yearly", "term_wise", "once"];

function randomRows(next: (n: number) => number) {
  const base = SESSIONS[next(SESSIONS.length)] ?? SESSIONS[0];
  const start = new Date(`${base?.startDate}T00:00:00Z`);
  const mid = new Date(start.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
  const session = {
    startDate: base?.startDate ?? "",
    endDate: base?.endDate ?? "",
    terms: [
      { id: "t1", name: "Term 1", startDate: base?.startDate ?? "", endDate: mid },
      { id: "t2", name: "Term 2", startDate: mid, endDate: base?.endDate ?? "" },
    ],
  };
  const rows: ScheduleRow[] = [];
  const heads = 1 + next(3);
  for (let h = 0; h < heads; h++) {
    const frequency = FREQUENCIES[next(FREQUENCIES.length)] ?? "monthly";
    for (const option of periodOptions(frequency, session, 1 + next(31))) {
      if (next(5) === 0 && frequency !== "once") continue;
      rows.push({
        feeHeadId: `h${h}`,
        headName: `Head ${h}`,
        frequency,
        whoPays: "everyone",
        periodKey: option.key,
        label: option.label,
        startDate: option.startDate,
        endDate: option.endDate,
        dueDate: option.dueDate,
        amountCents: BigInt(1000 * (1 + next(500))),
        termId: option.termId,
      });
    }
  }
  return { rows, session };
}

describe("fees property: dues", () => {
  it("a student who joins on day one owes exactly the schedule", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = rng(seed);
      const { rows, session } = randomRows(next);
      const dues = planDues({
        rows,
        effectiveFrom: session.startDate,
        joiningMonthFullCharge: true,
        isNewStudent: false,
        billingStartedOn: null,
        awayRanges: [],
      });
      expect(dues).toHaveLength(rows.length);
      const owed = dues.reduce((acc, d) => acc + d.amountCents, 0n);
      const scheduled = rows.reduce((acc, r) => acc + r.amountCents, 0n);
      expect(owed).toBe(scheduled);
    }
  });

  it("joining later never raises a period's price, and no due predates joining", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = rng(seed);
      const { rows, session } = randomRows(next);
      const start = new Date(`${session.startDate}T00:00:00Z`).getTime();
      const end = new Date(`${session.endDate}T00:00:00Z`).getTime();
      const effectiveFrom = new Date(start + next(Math.floor((end - start) / 86_400_000)) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const dues = planDues({
        rows,
        effectiveFrom,
        joiningMonthFullCharge: next(2) === 0,
        isNewStudent: false,
        billingStartedOn: null,
        awayRanges: [],
      });
      const priceOf = new Map(rows.map((r) => [`${r.feeHeadId}:${r.periodKey}`, r.amountCents]));
      for (const due of dues) {
        expect(due.amountCents <= (priceOf.get(`${due.feeHeadId}:${due.periodKey}`) ?? 0n)).toBe(true);
        expect(due.dueDate >= effectiveFrom).toBe(true);
      }
    }
  });

  it("every due has a unique identity, whatever the shape", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { rows, session } = randomRows(rng(seed));
      const dues = planDues({
        rows,
        effectiveFrom: session.startDate,
        joiningMonthFullCharge: true,
        isNewStudent: true,
        billingStartedOn: null,
        awayRanges: [],
      });
      const keys = dues.map((d) => concessionKey(d.feeHeadId, d.periodKey));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("fees property: concessions", () => {
  it("shares stay within each due and never exceed a flat amount", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = rng(seed);
      const { rows, session } = randomRows(next);
      const dues = planDues({
        rows,
        effectiveFrom: session.startDate,
        joiningMonthFullCharge: true,
        isNewStudent: false,
        billingStartedOn: null,
        awayRanges: [],
      });
      const list = dues.map((d) => ({
        key: concessionKey(d.feeHeadId, d.periodKey),
        amountCents: d.amountCents,
      }));
      const covered = coveredPeriodsFor(dues, new Set(), {
        feeHeadId: null,
        validFrom: session.startDate,
        validTo: null,
      });
      const flat = BigInt(next(1_000_000));
      const shares = concessionShares(
        [
          { calculationType: "flat", valueCents: flat, coveredPeriods: covered },
          { calculationType: "percentage", valueCents: BigInt(next(10001)), coveredPeriods: covered },
        ],
        list,
      );
      for (const due of list) {
        const share = shares.get(due.key) ?? 0n;
        expect(share >= 0n && share <= due.amountCents).toBe(true);
      }
      const onlyFlat = concessionShares(
        [{ calculationType: "flat", valueCents: flat, coveredPeriods: covered }],
        list,
      );
      const total = [...onlyFlat.values()].reduce((a, b) => a + b, 0n);
      expect(total <= flat).toBe(true);
      const owed = list.reduce((a, b) => a + b.amountCents, 0n);
      expect(total).toBe(flat < owed ? flat : owed);
    }
  });

  it("the answer does not depend on which months exist yet or got paid", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const next = rng(seed);
      const { rows, session } = randomRows(next);
      const dues = planDues({
        rows,
        effectiveFrom: session.startDate,
        joiningMonthFullCharge: true,
        isNewStudent: false,
        billingStartedOn: null,
        awayRanges: [],
      });
      const list = dues.map((d) => ({
        key: concessionKey(d.feeHeadId, d.periodKey),
        amountCents: d.amountCents,
      }));
      const covered = coveredPeriodsFor(dues, new Set(), {
        feeHeadId: null,
        validFrom: session.startDate,
        validTo: null,
      });
      const rule = {
        calculationType: "percentage" as const,
        valueCents: BigInt(next(10001)),
        coveredPeriods: covered,
      };
      const whole = concessionShares([rule], list);
      const cut = next(list.length + 1);
      const part = concessionShares([rule], list.slice(0, cut));
      for (const due of list.slice(0, cut)) {
        expect(part.get(due.key) ?? 0n).toBe(whole.get(due.key) ?? 0n);
      }
    }
  });
});

describe("fees property: late fee", () => {
  it("however a due is paid in parts, the total charged never exceeds the rule's once", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = rng(seed);
      const rule: LateFeeRuleLike = {
        feeStructureId: null,
        gracePeriodDays: next(10),
        calculationType: (["flat", "percentage"] as const)[next(2)] ?? "flat",
        valueCents: BigInt(100 + next(5000)),
        maxLateFeeCents: null,
        applyPer: next(2) === 0 ? "fee" : "month",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      };
      let balance = BigInt(10000 + next(200000));
      const firstOwed = priceLateFees(
        [
          {
            id: "a",
            dueDate: "2026-04-01",
            balanceCents: balance,
            chargedCents: 0n,
            waivedCents: 0n,
            exempt: false,
            beingPaid: true,
          },
        ],
        [rule],
        null,
        "2026-11-01",
      ).get("a");
      let charged = 0n;
      for (let i = 0; i < 6 && balance > 0n; i++) {
        const charge =
          priceLateFees(
            [
              {
                id: "a",
                dueDate: "2026-04-01",
                balanceCents: balance,
                chargedCents: charged,
                waivedCents: 0n,
                exempt: false,
                beingPaid: true,
              },
            ],
            [rule],
            null,
            "2026-11-01",
          ).get("a") ?? 0n;
        charged += charge;
        balance -= BigInt(1 + next(Number(balance)));
      }
      expect(charged).toBe(firstOwed ?? 0n);
    }
  });
});

describe("fees property: the gateway allocator", () => {
  it("sums exactly to the total, oldest first, or refuses", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = rng(seed);
      const dues = Array.from({ length: 1 + next(12) }, (_, i) => ({
        installmentId: `i${i}`,
        dueDate: `2026-${String(1 + next(12)).padStart(2, "0")}-01`,
        balanceCents: BigInt(next(100000)),
      }));
      const available = dues.reduce((acc, d) => acc + d.balanceCents, 0n);
      const total = BigInt(next(Number(available) + 1000 + 1));
      const out = allocateOldestFirst(total, dues);
      if (total === 0n || total > available) {
        expect(out).toBeNull();
      } else {
        expect(out?.reduce((acc, a) => acc + a.amountCents, 0n)).toBe(total);
      }
    }
  });
});
