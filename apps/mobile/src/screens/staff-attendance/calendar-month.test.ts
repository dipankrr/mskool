import {
  clampMonth,
  daysInMonth,
  isoOf,
  monthIndex,
  shiftMonth,
} from "./calendar-month";

describe("isoOf", () => {
  it("pads month and day", () => {
    expect(isoOf(2026, 3, 7)).toBe("2026-03-07");
    expect(isoOf(2025, 12, 31)).toBe("2025-12-31");
  });
});

describe("shiftMonth", () => {
  it("shifts within a year", () => {
    expect(shiftMonth("2026-03-15", 1)).toBe("2026-04-01");
    expect(shiftMonth("2026-03-15", -1)).toBe("2026-02-01");
  });

  it("crosses year boundaries both ways", () => {
    expect(shiftMonth("2025-01-20", -1)).toBe("2024-12-01");
    expect(shiftMonth("2025-12-01", 2)).toBe("2026-02-01");
  });

  it("returns the first of the target month", () => {
    expect(shiftMonth("2026-03-31", 0)).toBe("2026-03-01");
  });
});

describe("monthIndex", () => {
  it("orders months across years", () => {
    expect(monthIndex("2025-12-31")).toBeLessThan(monthIndex("2026-01-01"));
    expect(monthIndex("2025-04-01") - monthIndex("2025-03-01")).toBe(1);
  });
});

describe("daysInMonth", () => {
  it("handles ordinary lengths", () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 3)).toBe(31);
  });

  it("handles February", () => {
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
  });
});

describe("clampMonth", () => {
  it("clamps outside the year into its first or last month", () => {
    expect(clampMonth("2025-01-15", "2025-04-01", "2026-03-31")).toBe(
      "2025-04-01",
    );
    expect(clampMonth("2026-08-09", "2025-04-01", "2026-03-31")).toBe(
      "2026-03-01",
    );
  });

  it("returns the first of the month for in-year dates", () => {
    expect(clampMonth("2025-12-31", "2025-04-01", "2026-03-31")).toBe(
      "2025-12-01",
    );
  });
});
