import {
  formatIsoDate,
  formatLongWeekday,
  formatMonthLong,
  formatShortWeekday,
  isIsoDate,
  todayIso,
  weekdayShort,
} from "./format";

describe("isIsoDate", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isIsoDate("2026-03-31")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true); // leap year
    expect(isIsoDate("2026-02-29")).toBe(false); // not a leap year
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("31/03/2026")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("formatIsoDate", () => {
  it("renders DD/MM/YYYY so 03/04 is unambiguous", () => {
    expect(formatIsoDate("2026-04-03")).toBe("03/04/2026");
  });

  it("renders the em dash for anything unparseable", () => {
    expect(formatIsoDate("")).toBe("—");
    expect(formatIsoDate(null)).toBe("—");
  });
});

describe("formatLongWeekday / formatShortWeekday", () => {
  it("names the weekday in both probe formats", () => {
    // 2026-10-18 is a Sunday (repo clock check date).
    expect(formatLongWeekday("2026-10-18")).toBe("Sunday, 18 Oct");
    expect(formatShortWeekday("2026-10-18")).toBe("Sun 18 Oct");
  });

  it("handles month and year boundaries without UTC drift", () => {
    expect(formatLongWeekday("2026-01-01")).toBe("Thursday, 1 Jan");
    expect(formatLongWeekday("2025-12-31")).toBe("Wednesday, 31 Dec");
  });

  it("renders the em dash for anything unparseable", () => {
    expect(formatLongWeekday("nope")).toBe("—");
    expect(formatShortWeekday(undefined)).toBe("—");
  });
});

describe("todayIso", () => {
  it("reads local calendar parts, zero-padded", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isIsoDate(todayIso())).toBe(true);
  });
});

describe("weekdayShort / formatMonthLong", () => {
  it("names the weekday and month for the day picker", () => {
    expect(weekdayShort("2026-10-18")).toBe("Sun");
    expect(formatMonthLong("2026-10-18")).toBe("October 2026");
    expect(weekdayShort("2026-01-01")).toBe("Thu");
    expect(formatMonthLong("2025-12-31")).toBe("December 2025");
  });

  it("renders the em dash for anything unparseable", () => {
    expect(weekdayShort("2026-13-01")).toBe("—");
    expect(formatMonthLong(null)).toBe("—");
  });
});
