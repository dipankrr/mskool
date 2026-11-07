jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import { i18n } from "./index";
import { createFormat } from "./format";

const f = createFormat(i18n.t.bind(i18n));

describe("family format", () => {
  it("formats calendar dates without a timezone shift", () => {
    expect(f.date("2026-03-01")).toBe("1 Mar");
    expect(f.date("2026-03-31", "dayMonthYear")).toBe("31 Mar 2026");
    expect(f.date("2026-10-14", "weekdayDayMonth")).toBe("Wed, 14 Oct");
    expect(f.date(null)).toBe("—");
    expect(f.date("not a date")).toBe("—");
  });

  it("formats ranges and collapses a one-day range", () => {
    expect(f.dateRange("2026-10-14", "2026-10-20")).toBe("14 Oct – 20 Oct");
    expect(f.dateRange("2026-10-14", "2026-10-14")).toBe("14 Oct");
  });

  it("formats months from a month key or a date", () => {
    expect(f.month("2026-04")).toBe("April 2026");
    expect(f.month("2026-04-12", "short")).toBe("Apr");
    expect(f.month("2026-12", "long")).toBe("December");
  });

  it("formats clock times on a 12-hour clock", () => {
    expect(f.time("09:30:00")).toBe("9:30 AM");
    expect(f.time("12:05")).toBe("12:05 PM");
    expect(f.time("00:15:00")).toBe("12:15 AM");
    expect(f.time(null)).toBe("—");
  });

  it("formats durations with plurals", () => {
    expect(f.duration(45)).toBe("45 min");
    expect(f.duration(60)).toBe("1 hr");
    expect(f.duration(180)).toBe("3 hr");
    expect(f.duration(90)).toBe("1 hr 30 min");
  });

  it("formats percentages and drops a zero decimal", () => {
    expect(f.percent(86.4)).toBe("86.4%");
    expect(f.percent("92.00")).toBe("92%");
    expect(f.percent(null)).toBe("—");
  });

  it("formats money with Indian grouping", () => {
    expect(f.money("125000.00")).toBe("₹1,25,000");
  });
});
