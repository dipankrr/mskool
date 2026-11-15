import { describe, expect, it } from "vitest";

import {
  applyRange,
  fitToSession,
  removeRange,
  weekAt,
  datesBetween,
  isFixedDate,
  patternDayType,
  patternFromWeekdays,
  sessionDateDiff,
  shiftYears,
} from "./calendar-tools";

describe("calendar tools", () => {
  it("walks dates inclusively across a month end", () => {
    expect(datesBetween("2027-01-30", "2027-02-02")).toEqual([
      "2027-01-30",
      "2027-01-31",
      "2027-02-01",
      "2027-02-02",
    ]);
    expect(datesBetween("2027-02-02", "2027-02-01")).toEqual([]);
  });

  it("reads a week pattern by weekday", () => {
    const week = patternFromWeekdays([1, 2, 3, 4, 5, 6], [6]);
    expect(week).toEqual(["weekend", "working", "working", "working", "working", "working", "half_day"]);
    expect(patternDayType(week, "2026-11-14")).toBe("half_day"); // Saturday
    expect(patternDayType(week, "2026-11-15")).toBe("weekend"); // Sunday
    expect(patternDayType(week, "2026-11-16")).toBe("working"); // Monday
  });

  it("shifts years and clamps 29 February", () => {
    expect(shiftYears("2026-10-20", 1)).toBe("2027-10-20");
    expect(shiftYears("2028-02-29", 1)).toBe("2029-02-28");
  });

  it("knows the fixed national dates", () => {
    expect(isFixedDate("2027-08-15")).toBe(true);
    expect(isFixedDate("2027-11-08")).toBe(false);
  });

  it("diffs a session's dates both ways", () => {
    const before = { startDate: "2026-04-01", endDate: "2027-03-31" };
    const longer = sessionDateDiff(before, { startDate: "2026-04-01", endDate: "2027-04-02" });
    expect(longer).toEqual({ added: ["2027-04-01", "2027-04-02"], removed: [] });
    const shorter = sessionDateDiff(before, { startDate: "2026-04-03", endDate: "2027-03-31" });
    expect(shorter).toEqual({ added: [], removed: ["2026-04-01", "2026-04-02"] });
  });
});

describe("week ranges", () => {
  const base = { from: "2026-04-01", to: "2027-03-31", weekdays: patternFromWeekdays([1, 2, 3, 4, 5, 6], [6]) };
  const satOff = patternFromWeekdays([1, 2, 3, 4, 5]);

  it("cuts a temporary change out of the base and goes back after it", () => {
    const ranges = applyRange([base], { from: "2026-12-01", to: "2027-02-28", weekdays: satOff });
    expect(ranges.map((r) => [r.from, r.to])).toEqual([
      ["2026-04-01", "2026-11-30"],
      ["2026-12-01", "2027-02-28"],
      ["2027-03-01", "2027-03-31"],
    ]);
    expect(weekAt(ranges, "2027-01-09")![6]).toBe("weekend");
    expect(weekAt(ranges, "2027-03-06")![6]).toBe("half_day");
  });

  it("removing the change restores one base range", () => {
    const ranges = applyRange([base], { from: "2026-12-01", to: "2027-02-28", weekdays: satOff });
    expect(removeRange(ranges, 1)).toEqual([base]);
  });

  it("a permanent change replaces what it covers", () => {
    const ranges = applyRange([base], { from: "2026-12-01", to: "2027-03-31", weekdays: satOff });
    expect(ranges).toHaveLength(2);
    expect(ranges[1]).toMatchObject({ from: "2026-12-01", to: "2027-03-31" });
  });

  it("fits ranges to new session dates", () => {
    const ranges = applyRange([base], { from: "2026-12-01", to: "2027-03-31", weekdays: satOff });
    const fitted = fitToSession(ranges, "2026-04-01", "2027-04-30");
    expect(fitted[1]!.to).toBe("2027-04-30");
    expect(fitToSession(ranges, "2026-12-15", "2027-03-31")).toEqual([
      { from: "2026-12-15", to: "2027-03-31", weekdays: satOff },
    ]);
  });
});
