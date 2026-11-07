import { describe, expect, it } from "vitest";

import {
  attendancePercent,
  countAttendance,
  enrolledRanges,
  hasAttendanceMarks,
  isOnBooks,
  monthBounds,
} from "./attendance-counting";

/** Weekdays Mon-Fri between two ISO dates, inclusive. */
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("enrolledRanges", () => {
  it("starts on the enrolment date", () => {
    const ranges = enrolledRanges(
      [{ enrollmentDate: "2025-09-01", leftOn: null, leavingHistory: [] }],
      "2025-09-02",
    );
    expect(ranges).toEqual([{ from: "2025-09-01", until: null }]);
    expect(isOnBooks(ranges, "2025-08-29")).toBe(false);
    expect(isOnBooks(ranges, "2025-09-01")).toBe(true);
  });

  it("drops the gap between leaving and rejoining", () => {
    const ranges = enrolledRanges(
      [
        {
          enrollmentDate: "2025-04-01",
          leftOn: null,
          leavingHistory: [{ leftOn: "2025-07-10", rejoinedOn: "2025-08-01" }],
        },
      ],
      null,
    );
    expect(ranges).toEqual([
      { from: "2025-04-01", until: "2025-07-10" },
      { from: "2025-08-01", until: null },
    ]);
    expect(isOnBooks(ranges, "2025-07-09")).toBe(true);
    expect(isOnBooks(ranges, "2025-07-10")).toBe(false);
    expect(isOnBooks(ranges, "2025-07-31")).toBe(false);
    expect(isOnBooks(ranges, "2025-08-01")).toBe(true);
  });

  it("stops on the day a student left", () => {
    const ranges = enrolledRanges(
      [{ enrollmentDate: "2025-04-01", leftOn: "2025-10-15", leavingHistory: [] }],
      null,
    );
    expect(isOnBooks(ranges, "2025-10-14")).toBe(true);
    expect(isOnBooks(ranges, "2025-10-15")).toBe(false);
  });

  it("starts at the first mark when marks predate the enrolment date", () => {
    const ranges = enrolledRanges(
      [{ enrollmentDate: "2026-11-01", leftOn: null, leavingHistory: [] }],
      "2025-07-07",
    );
    expect(ranges[0]!.from).toBe("2025-07-07");
  });

  it("counts from the first mark when no enrolment row was read", () => {
    expect(enrolledRanges([], "2025-07-07")).toEqual([{ from: "2025-07-07", until: null }]);
    expect(enrolledRanges([], null)).toEqual([]);
  });
});

describe("countAttendance", () => {
  const july = weekdays("2025-07-01", "2025-07-31"); // 23 weekdays
  const base = {
    workingDates: july,
    from: "2025-07-01",
    to: "2025-07-31",
    lateCountsAsPresent: true,
  };

  it("counts only the days a late joiner was on the books", () => {
    const ranges = enrolledRanges(
      [{ enrollmentDate: "2025-07-21", leftOn: null, leavingHistory: [] }],
      null,
    );
    const counts = countAttendance({
      ...base,
      ranges,
      statuses: [{ date: "2025-07-21", status: "present" }],
    });
    // 21st-31st July 2025: Mon 21 to Thu 31 = 9 weekdays.
    expect(counts.workingDays).toBe(9);
    expect(counts.daysAttended).toBe(1);
  });

  it("counts late as attended only when the school says so", () => {
    const ranges = enrolledRanges(
      [{ enrollmentDate: "2025-04-01", leftOn: null, leavingHistory: [] }],
      null,
    );
    const statuses = [
      { date: "2025-07-01", status: "present" as const },
      { date: "2025-07-02", status: "late" as const },
      { date: "2025-07-03", status: "half_day" as const },
      { date: "2025-07-04", status: "absent" as const },
      { date: "2025-07-07", status: "on_leave" as const },
    ];
    const on = countAttendance({ ...base, ranges, statuses });
    expect(on).toMatchObject({
      daysPresent: 1,
      daysLate: 1,
      daysHalfDay: 1,
      daysAbsent: 1,
      daysOnLeave: 1,
      daysAttended: 2,
    });
    const off = countAttendance({ ...base, ranges, statuses, lateCountsAsPresent: false });
    expect(off.daysAttended).toBe(1);
    expect(off.daysPresent).toBe(1);
  });

  it("stops at asOf for the so-far figure", () => {
    const ranges = enrolledRanges(
      [{ enrollmentDate: "2025-04-01", leftOn: null, leavingHistory: [] }],
      null,
    );
    const statuses = weekdays("2025-07-01", "2025-07-10").map((date) => ({
      date,
      status: "present" as const,
    }));
    const whole = countAttendance({ ...base, ranges, statuses });
    const soFar = countAttendance({ ...base, ranges, statuses, asOf: "2025-07-10" });
    expect(whole.workingDays).toBe(23);
    expect(soFar.workingDays).toBe(8);
    expect(attendancePercent(soFar.daysAttended, soFar.workingDays)).toBe("100.00");
  });

  it("reports no marks as no figure", () => {
    const counts = countAttendance({ ...base, ranges: [], statuses: [] });
    expect(hasAttendanceMarks(counts)).toBe(false);
  });
});

describe("attendancePercent", () => {
  it("matches the database's two-decimal rounding", () => {
    expect(attendancePercent(2, 3)).toBe("66.67");
    expect(attendancePercent(1, 3)).toBe("33.33");
    expect(attendancePercent(1, 8)).toBe("12.50");
    expect(attendancePercent(0, 0)).toBe("0.00");
  });
});

describe("monthBounds", () => {
  it("knows month lengths, leap years included", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthBounds("2025-12")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});
