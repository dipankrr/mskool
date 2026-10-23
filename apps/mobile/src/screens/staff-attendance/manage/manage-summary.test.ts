import { summarizeCalendar } from "./manage-summary";
import type { CalendarSummaryRow } from "./manage-summary";

function day(date: string, dayType: string, reason: string | null = null): CalendarSummaryRow {
  return { date, dayType, reason };
}

describe("summarizeCalendar", () => {
  it("returns an unset summary for no rows", () => {
    expect(summarizeCalendar([], "2026-03-06")).toEqual({
      workingDays: 0,
      missingThisMonth: 0,
      nextHoliday: null,
    });
  });

  it("counts markable day types as working days", () => {
    const summary = summarizeCalendar(
      [
        day("2026-03-02", "working"),
        day("2026-03-03", "half_day"),
        day("2026-03-04", "exam_day"),
        day("2026-03-05", "holiday"),
        day("2026-03-06", "weekend"),
      ],
      "2026-03-06",
    );
    expect(summary.workingDays).toBe(3);
  });

  it("counts days with no row this month as missing", () => {
    const summary = summarizeCalendar(
      [
        day("2026-03-02", "working"),
        day("2026-03-03", "working"),
        day("2026-03-04", "working"),
        day("2026-03-05", "working"),
      ],
      "2026-03-06",
    );
    // March has 31 days; four rows are present.
    expect(summary.missingThisMonth).toBe(27);
  });

  it("does not warn about a month outside the session", () => {
    const summary = summarizeCalendar(
      [day("2026-03-02", "working")],
      "2026-10-22",
      "2025-04-01",
      "2026-03-31",
    );
    expect(summary.missingThisMonth).toBe(0);
  });

  it("only counts the part of the month inside the session", () => {
    const summary = summarizeCalendar(
      [
        day("2026-03-01", "weekend"),
        day("2026-03-02", "working"),
        day("2026-03-03", "working"),
        day("2026-03-04", "holiday"),
      ],
      "2026-03-06",
      "2025-04-01",
      "2026-03-04",
    );
    // 1-4 March are in-session; all four have rows.
    expect(summary.missingThisMonth).toBe(0);
  });

  it("finds the next holiday on or after today, with its reason", () => {
    const summary = summarizeCalendar(
      [
        day("2026-03-01", "holiday", "Past holiday"),
        day("2026-03-07", "holiday", "E2E holiday"),
        day("2026-03-14", "holiday", "Later holiday"),
        day("2026-03-08", "weekend"),
      ],
      "2026-03-06",
    );
    expect(summary.nextHoliday).toEqual({
      date: "2026-03-07",
      reason: "E2E holiday",
    });
  });

  it("reports no next holiday when only weekends remain", () => {
    const summary = summarizeCalendar([day("2026-03-08", "weekend")], "2026-03-06");
    expect(summary.nextHoliday).toBeNull();
  });
});
