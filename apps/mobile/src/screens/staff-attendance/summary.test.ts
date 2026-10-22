import {
  averagePercent,
  coveragePercent,
  formatPercent,
  sectionTotals,
  summaryByStudent,
} from "./summary";
import type { SummaryRow } from "./summary";

function row(
  studentId: string,
  periodType: SummaryRow["periodType"],
  overrides: Partial<SummaryRow> = {},
): SummaryRow {
  return {
    studentId,
    periodType,
    workingDays: 100,
    daysPresent: 80,
    daysAbsent: 15,
    daysLate: 3,
    daysOnLeave: 2,
    attendancePercentage: "80.00",
    ...overrides,
  };
}

describe("summaryByStudent", () => {
  it("prefers the annual row when present", () => {
    const map = summaryByStudent([
      row("a", "term", { workingDays: 40, daysPresent: 36 }),
      row("a", "annual", { workingDays: 100, daysPresent: 80 }),
      row("a", "monthly", { workingDays: 20, daysPresent: 20 }),
    ]);
    expect(map.get("a")?.periodType).toBe("annual");
    expect(map.get("a")?.daysPresent).toBe(80);
  });

  it("falls back to the term with the most working days, ignoring monthly", () => {
    const map = summaryByStudent([
      row("a", "term", { workingDays: 40, daysPresent: 30 }),
      row("a", "term", { workingDays: 61, daysPresent: 50 }),
      row("a", "monthly", { workingDays: 90, daysPresent: 90 }),
    ]);
    expect(map.get("a")?.workingDays).toBe(61);
    expect(map.get("a")?.daysPresent).toBe(50);
  });

  it("keys by student and leaves unmarked students absent from the map", () => {
    const map = summaryByStudent([
      row("a", "annual"),
      row("b", "annual", { daysPresent: 10 }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("b")?.daysPresent).toBe(10);
    expect(map.has("c")).toBe(false);
    expect(summaryByStudent([]).size).toBe(0);
  });
});

describe("sectionTotals", () => {
  it("sums only students with rows and counts the rest as no-data", () => {
    const byStudent = summaryByStudent([
      row("a", "annual", { workingDays: 100, daysPresent: 80 }),
      row("b", "annual", { workingDays: 100, daysPresent: 50 }),
    ]);
    const totals = sectionTotals(byStudent, ["a", "b", "c", "d"]);
    expect(totals).toEqual({
      present: 130,
      working: 200,
      // Buckets: a = 80+15+3+2 = 100, b = 50+15+3+2 = 70 → fullest student.
      markedDays: 100,
      noData: 2,
      workingDays: 100,
    });
    expect(averagePercent(totals)).toBe(65);
  });

  it("counts marked days from the fullest student, never the sum", () => {
    const byStudent = summaryByStudent([
      row("a", "annual", { daysPresent: 12, daysAbsent: 2, daysLate: 1, daysOnLeave: 0 }),
      row("b", "annual", { daysPresent: 9, daysAbsent: 1, daysLate: 0, daysOnLeave: 0 }),
    ]);
    const totals = sectionTotals(byStudent, ["a", "b"]);
    expect(totals.markedDays).toBe(15);
  });

  it("treats a bucket-empty row as data, not as no-data", () => {
    const byStudent = summaryByStudent([
      row("a", "annual", {
        daysPresent: 0,
        daysAbsent: 0,
        daysLate: 0,
        daysOnLeave: 0,
      }),
    ]);
    const totals = sectionTotals(byStudent, ["a", "b"]);
    expect(totals.noData).toBe(1);
    expect(totals.markedDays).toBe(0);
  });

  it("reports no working days when nobody has rows", () => {
    const totals = sectionTotals(summaryByStudent([]), ["a", "b"]);
    expect(totals).toEqual({
      present: 0,
      working: 0,
      markedDays: 0,
      noData: 2,
      workingDays: null,
    });
    expect(averagePercent(totals)).toBeNull();
  });

  it("does not divide by zero for all-zero counts", () => {
    const byStudent = summaryByStudent([
      row("a", "annual", { workingDays: 0, daysPresent: 0 }),
    ]);
    const totals = sectionTotals(byStudent, ["a"]);
    expect(totals.workingDays).toBe(0);
    expect(averagePercent(totals)).toBeNull();
  });
});

describe("coveragePercent", () => {
  it("fills proportional to marked days over working days", () => {
    const byStudent = summaryByStudent([
      row("a", "annual", {
        workingDays: 200,
        daysPresent: 30,
        daysAbsent: 8,
        daysLate: 2,
        daysOnLeave: 0,
      }),
    ]);
    expect(coveragePercent(sectionTotals(byStudent, ["a"]))).toBe(20);
  });

  it("shows a sliver once the year has any marked day", () => {
    const byStudent = summaryByStudent([
      row("a", "annual", {
        workingDays: 311,
        daysPresent: 1,
        daysAbsent: 0,
        daysLate: 0,
        daysOnLeave: 0,
      }),
    ]);
    // 0.32% would render as an empty dot; the floor keeps "started" legible.
    expect(coveragePercent(sectionTotals(byStudent, ["a"]))).toBe(4);
  });

  it("fills nothing before the first marked day", () => {
    const byStudent = summaryByStudent([
      row("a", "annual", {
        workingDays: 311,
        daysPresent: 0,
        daysAbsent: 0,
        daysLate: 0,
        daysOnLeave: 0,
      }),
    ]);
    expect(coveragePercent(sectionTotals(byStudent, ["a"]))).toBe(0);
  });

  it("fills nothing when the section has no rows at all", () => {
    expect(coveragePercent(sectionTotals(summaryByStudent([]), ["a"]))).toBe(0);
  });

  it("clamps when buckets exceed the calendar (defensive)", () => {
    const byStudent = summaryByStudent([
      row("a", "annual", {
        workingDays: 10,
        daysPresent: 8,
        daysAbsent: 5,
        daysLate: 0,
        daysOnLeave: 0,
      }),
    ]);
    expect(coveragePercent(sectionTotals(byStudent, ["a"]))).toBe(100);
  });
});

describe("formatPercent", () => {
  it("rounds server strings to one decimal, dropping .0", () => {
    expect(formatPercent("72.73")).toBe("72.7%");
    expect(formatPercent("75.00")).toBe("75%");
    expect(formatPercent("0.00")).toBe("0%");
    expect(formatPercent("99.95")).toBe("100%");
    expect(formatPercent("87.5")).toBe("87.5%");
  });

  it("accepts computed numbers and guards non-finite input", () => {
    expect(formatPercent(65)).toBe("65%");
    expect(formatPercent((130 / 200) * 100)).toBe("65%");
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent("")).toBe("—");
    expect(formatPercent(null)).toBe("—");
  });
});
