import {
  collectShortcuts,
  coverRows,
  distributeAmount,
  feeNameOf,
  focusAmounts,
  focusLabel,
  groupDues,
  type CollectLine,
} from "./fees";
import { sumMoney } from "./money";

/**
 * Aditi Sharma (DEMO-0001) on 2 Nov 2026, the demo school's real figures:
 * ₹4,500 carried from 2025–26, April's ₹5,000 admission fee and ₹400 left of
 * tuition (lab fee paid), then ₹1,000 tuition and ₹200 lab every month, a
 * ₹420 one-off in November, and December to March already created.
 */
function month(key: string, extra: { name: string; balance: string }[] = []): (CollectLine & { id: string })[] {
  return [
    ...extra.map((line, index) => ({
      key: `${key}-x${index}`,
      id: `${key}-x${index}`,
      month: key,
      name: line.name,
      balance: line.balance,
    })),
    { key: `${key}-lab`, id: `${key}-lab`, month: key, name: "Lab Fee", balance: "200.00" },
    { key: `${key}-tuition`, id: `${key}-tuition`, month: key, name: "Tuition Fee", balance: "1000.00" },
  ];
}

const ADITI: (CollectLine & { id: string })[] = [
  { key: "opening:1", id: "1", month: null, name: "Previous dues", balance: "4500.00" },
  { key: "apr-admission", id: "apr-admission", month: "2026-04", name: "Admission Fee", balance: "5000.00" },
  { key: "apr-tuition", id: "apr-tuition", month: "2026-04", name: "Tuition Fee", balance: "400.00" },
  ...["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].flatMap((key) => month(key)),
  ...month("2026-11", [{ name: "bookd", balance: "420.00" }]),
  ...["2026-12", "2027-01", "2027-02", "2027-03"].flatMap((key) => month(key)),
];
const DUE_NOW = ADITI.filter((line) => line.month === null || line.month <= "2026-11");
const NOW = "2026-11";

const total = (rows: { amount: string }[]) => sumMoney(rows.map((row) => row.amount));

describe("coverRows", () => {
  it("shows what ₹10,000 pays, oldest first, and that May is only part paid", () => {
    const rows = coverRows(DUE_NOW, distributeAmount("10000", DUE_NOW));
    expect(rows.map((row) => [row.label, row.detail, row.amount, row.full])).toEqual([
      ["Previous dues", null, "4500.00", true],
      ["April", null, "5400.00", true],
      ["May", "₹100 of ₹1,200", "100.00", false],
    ]);
    expect(total(rows)).toBe("10000.00");
  });

  it("folds months paid in full into one range, and adds up to all due now", () => {
    const rows = coverRows(DUE_NOW, distributeAmount("18720", DUE_NOW));
    expect(rows.map((row) => [row.label, row.detail, row.amount])).toEqual([
      ["Previous dues", null, "4500.00"],
      ["April – November", "8 months", "14220.00"],
    ]);
    expect(total(rows)).toBe("18720.00");
  });

  it("lists each fee when the money is all inside one month", () => {
    const rows = coverRows(ADITI, focusAmounts(ADITI, "month:2026-04"));
    expect(rows.map((row) => [row.label, row.detail, row.amount])).toEqual([
      ["Admission Fee", "April", "5000.00"],
      ["Tuition Fee", "April", "400.00"],
    ]);
  });

  it("never counts more than a line's balance", () => {
    const rows = coverRows(DUE_NOW, { "opening:1": "9999" });
    expect(rows).toEqual([
      { key: "opening:1", label: "Previous dues", detail: null, amount: "4500.00", full: true },
    ]);
  });

  it("shows a one-off charge by its own name, not as part of its month", () => {
    const lines = ADITI.map((line) =>
      line.name === "bookd" ? { ...line, oneOff: true } : line,
    );
    const bookd = lines.find((line) => line.name === "bookd");
    const rows = coverRows(lines, focusAmounts(lines, `due:${bookd?.id}`));
    expect(rows.map((row) => [row.label, row.detail, row.amount, row.full])).toEqual([
      ["bookd", null, "420.00", true],
    ]);
    expect(focusLabel(lines, `due:${bookd?.id}`)).toBe("bookd");
  });

  it("names the one fee when a single due inside a month is paid", () => {
    const rows = coverRows(ADITI, focusAmounts(ADITI, "due:2026-05-lab"));
    expect(rows.map((row) => [row.label, row.detail, row.amount])).toEqual([
      ["Lab Fee", "May", "200.00"],
    ]);
  });

  it("is empty when nothing is entered", () => {
    expect(coverRows(DUE_NOW, {})).toEqual([]);
  });
});

describe("collectShortcuts", () => {
  it("offers all due, up to last month, previous dues and the next months ahead", () => {
    expect(collectShortcuts(ADITI, NOW)).toEqual([
      { id: "all", label: "All due", amount: "18720.00" },
      { id: "before", label: "Up to Oct", amount: "17100.00" },
      { id: "previous", label: "Previous dues", amount: "4500.00" },
      { id: "ahead:2026-12", label: "Up to Dec", amount: "19920.00" },
      { id: "ahead:2027-01", label: "Up to Jan", amount: "21120.00" },
      { id: "ahead:2027-02", label: "Up to Feb", amount: "22320.00" },
    ]);
  });

  it("each shortcut pays exactly what it says when spread oldest first", () => {
    for (const shortcut of collectShortcuts(ADITI, NOW)) {
      const rows = coverRows(ADITI, distributeAmount(shortcut.amount, ADITI));
      expect(total(rows)).toBe(shortcut.amount);
    }
  });

  it("names the first month ahead when nothing is due now", () => {
    expect(collectShortcuts(month("2026-12"), NOW)).toEqual([
      { id: "ahead:2026-12", label: "December", amount: "1200.00" },
    ]);
  });

  it("does not offer the same amount twice", () => {
    const onlyPrevious = ADITI.filter((line) => line.month === null);
    expect(collectShortcuts(onlyPrevious, NOW)).toEqual([
      { id: "all", label: "All due", amount: "4500.00" },
    ]);
  });
});

describe("focusAmounts and focusLabel", () => {
  it("fills one month, one due, or the previous dues, and nothing else", () => {
    expect(focusAmounts(ADITI, "month:2026-04")).toEqual({
      "apr-admission": "5000",
      "apr-tuition": "400",
    });
    expect(focusAmounts(ADITI, "due:2026-05-lab")).toEqual({ "2026-05-lab": "200" });
    expect(focusAmounts(ADITI, "previous")).toEqual({ "opening:1": "4500" });
    expect(focusAmounts(ADITI, "nonsense")).toEqual({});
    // A fee type pays only what is due up to now, never the months ahead.
    const tuition = focusAmounts(ADITI, "fee:Tuition Fee", "2026-11");
    expect(Object.keys(tuition)).toHaveLength(8);
    expect(sumMoney(Object.values(tuition))).toBe("7400.00");
  });

  it("says what was picked", () => {
    expect(focusLabel(ADITI, "month:2026-04")).toBe("April 2026");
    expect(focusLabel(ADITI, "due:2026-05-lab")).toBe("Lab Fee, May");
    expect(focusLabel(ADITI, "previous")).toBe("Previous dues");
    expect(focusLabel(ADITI, "fee:Tuition Fee")).toBe("Tuition Fee");
    expect(focusLabel(ADITI, "due:missing")).toBeNull();
  });
});

describe("feeNameOf and groupDues", () => {
  it("drops the month from a due's name", () => {
    expect(feeNameOf("Tuition Fee — 2026-04")).toBe("Tuition Fee");
    expect(feeNameOf("Admission Fee — once")).toBe("Admission Fee");
    expect(feeNameOf("bookd")).toBe("bookd");
    expect(feeNameOf(null)).toBe("Due");
  });

  const dues = [
    { id: "a", dueDate: "2026-05-01", description: "Tuition Fee — 2026-05", balanceAmount: "1000.00" },
    { id: "b", dueDate: "2026-04-01", description: "Admission Fee — once", balanceAmount: "5000.00" },
    { id: "c", dueDate: "2026-04-01", description: "Tuition Fee — 2026-04", balanceAmount: "400.00" },
    { id: "d", dueDate: "2026-05-01", description: "Lab Fee — 2026-05", balanceAmount: "200.00" },
  ];

  it("groups by month, oldest first, with what is open in each", () => {
    expect(
      groupDues(dues, "month").map((group) => [group.label, group.balance, group.rows.map((row) => row.id)]),
    ).toEqual([
      ["April 2026", "5400.00", ["b", "c"]],
      ["May 2026", "1200.00", ["d", "a"]],
    ]);
  });

  it("groups by fee type, in the order each fee first falls due", () => {
    expect(
      groupDues(dues, "fee").map((group) => [group.label, group.balance, group.rows.map((row) => row.id)]),
    ).toEqual([
      ["Admission Fee", "5000.00", ["b"]],
      ["Tuition Fee", "1400.00", ["c", "a"]],
      ["Lab Fee", "200.00", ["d"]],
    ]);
  });
});
