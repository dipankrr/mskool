import { describe, expect, it } from "vitest";

import { buildMonthGrid } from "./calendar-grid";

/**
 * The grid is pure, so these tests are exhaustive where it matters: the
 * weekday arithmetic that decides where a month starts, the UTC walk that
 * keeps the host's timezone out, and the week-shape invariant every consumer
 * relies on.
 */
describe("buildMonthGrid", () => {
  it("lays out July 2025 Monday-first: the 1st is a Tuesday", () => {
    const weeks = buildMonthGrid(2025, 7);
    expect(weeks[0]!).toEqual([
      null,
      "2025-07-01",
      "2025-07-02",
      "2025-07-03",
      "2025-07-04",
      "2025-07-05",
      "2025-07-06",
    ]);
  });

  it("pads a month ending mid-week to a full final row", () => {
    // July 2025: 1 leading blank + 31 days = 32 cells → 35 (5 weeks).
    const weeks = buildMonthGrid(2025, 7);
    expect(weeks).toHaveLength(5);
    expect(weeks.at(-1)!).toEqual([
      "2025-07-28",
      "2025-07-29",
      "2025-07-30",
      "2025-07-31",
      null,
      null,
      null,
    ]);
  });

  it("starts a Monday month with no leading blanks", () => {
    // 1 March 2027 is a Monday.
    const weeks = buildMonthGrid(2027, 3);
    expect(weeks[0]![0]).toBe("2027-03-01");
  });

  it("handles a Sunday-ending month that spills to a sixth week", () => {
    // 1 October 2022 is a Saturday → 6 leading blanks + 31 days = 37 → 42 cells.
    const weeks = buildMonthGrid(2022, 10);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]![0]).toBe(null);
    expect(weeks[0]![5]).toBe("2022-10-01");
  });

  it("keeps February's length honest across leap years", () => {
    expect(buildMonthGrid(2024, 2).flat().filter(Boolean)).toHaveLength(29);
    expect(buildMonthGrid(2025, 2).flat().filter(Boolean)).toHaveLength(28);
  });

  it("always returns 7-wide weeks of ISO dates or nulls, never other months", () => {
    for (const month of [1, 4, 12]) {
      const weeks = buildMonthGrid(2026, month);
      for (const week of weeks) {
        expect(week).toHaveLength(7);
        for (const cell of week) {
          if (cell !== null) {
            expect(cell).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(cell.startsWith(`2026-${String(month).padStart(2, "0")}`)).toBe(true);
          }
        }
      }
    }
  });
});
