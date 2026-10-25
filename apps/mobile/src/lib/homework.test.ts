import {
  addDays,
  clockOf,
  closeForEdit,
  composeTimestamp,
  countStudentWork,
  dayLabel,
  dayKeyOf,
  dueLoadsByDay,
  formatClock,
  formatMarks,
  formatMinutes,
  groupByDay,
  isPastDue,
  isPositiveMarks,
  isValidMarks,
  localDayKey,
  matchesSegment,
  matchesStudentFilter,
  nextDayWithWork,
  preserveLateWindow,
  segmentOf,
  sortByDue,
  sortRoster,
  splitTimestamp,
  startOfWeek,
  weekDays,
  weekMonthLabel,
} from "./homework";

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("crosses a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("knows leap years", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("leaves a malformed key alone rather than inventing a day", () => {
    expect(addDays("not-a-day", 1)).toBe("not-a-day");
    expect(addDays("2026-02-31", 1)).toBe("2026-02-31");
  });
});

describe("week strips", () => {
  it("starts on Monday", () => {
    // 2026-10-25 is a Sunday.
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-19")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-24")).toBe("2026-10-19");
  });

  it("returns seven consecutive days", () => {
    expect(weekDays("2026-12-31")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("names one month, or two when the strip crosses", () => {
    expect(weekMonthLabel(weekDays("2026-10-21"))).toBe("October 2026");
    expect(weekMonthLabel(weekDays("2026-12-31"))).toBe(
      "December 2026 – January 2027",
    );
  });
});

describe("day labels", () => {
  it("says today, tomorrow and yesterday", () => {
    expect(dayLabel("2026-10-25", "2026-10-25")).toBe("Today");
    expect(dayLabel("2026-10-26", "2026-10-25")).toBe("Tomorrow");
    expect(dayLabel("2026-10-24", "2026-10-25")).toBe("Yesterday");
  });

  it("names any other day", () => {
    expect(dayLabel("2026-10-21", "2026-10-25")).toBe("Wed 21 Oct");
  });
});

describe("timestamps", () => {
  const stamp = new Date(2026, 9, 25, 8, 5, 0, 0);

  it("reads a timestamp in local parts", () => {
    expect(localDayKey(stamp)).toBe("2026-10-25");
    expect(dayKeyOf(stamp)).toBe("2026-10-25");
    expect(clockOf(stamp)).toBe("8:05 am");
  });

  it("accepts the ISO strings the wire actually sends", () => {
    expect(dayKeyOf(stamp.toISOString())).toBe("2026-10-25");
    expect(clockOf(stamp.toISOString())).toBe("8:05 am");
  });

  it("composes and splits without losing the wall clock", () => {
    const composed = composeTimestamp("2026-10-25", "08:05");
    expect(composed).not.toBeNull();
    expect(splitTimestamp(composed)).toEqual({
      day: "2026-10-25",
      time: "08:05",
    });
  });

  it("refuses half a due time", () => {
    expect(composeTimestamp(null, "08:05")).toBeNull();
    expect(composeTimestamp("2026-10-25", null)).toBeNull();
    expect(composeTimestamp("2026-02-31", "08:05")).toBeNull();
    expect(composeTimestamp("2026-10-25", "25:00")).toBeNull();
  });

  it("formats 12-hour clocks", () => {
    expect(formatClock("00:00")).toBe("12:00 am");
    expect(formatClock("12:00")).toBe("12:00 pm");
    expect(formatClock("13:45")).toBe("1:45 pm");
    expect(formatClock("bad")).toBe("—");
  });

  it("keeps the late window when a due time moves", () => {
    const existingDue = new Date(2026, 9, 25, 8, 0);
    const existingClose = new Date(2026, 9, 26, 8, 0);
    const moved = composeTimestamp("2026-10-27", "09:00");
    expect(moved).not.toBeNull();
    const close = closeForEdit(moved as string, existingDue, existingClose);
    expect(new Date(close).getTime() - new Date(moved as string).getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it("moves an extension without inventing grace that was not there", () => {
    const previousDue = new Date(2026, 9, 25, 8, 0);
    const previousClose = new Date(2026, 9, 25, 8, 0);
    const moved = composeTimestamp("2026-10-28", "10:00");
    expect(moved).not.toBeNull();
    expect(preserveLateWindow(moved as string, previousDue, previousClose)).toBe(
      moved,
    );
  });
});

describe("grouping and counts", () => {
  const rows = [
    { id: "a", dueAt: new Date(2026, 9, 25, 9, 0), status: "published" },
    { id: "b", dueAt: new Date(2026, 9, 25, 14, 0), status: "draft" },
    { id: "c", dueAt: new Date(2026, 9, 26, 8, 0), status: "closed" },
    { id: "d", dueAt: new Date(2026, 9, 26, 8, 0), status: "cancelled" },
  ];

  it("counts only work that is actually due", () => {
    expect(dueLoadsByDay(rows)).toEqual({
      "2026-10-25": 1,
      "2026-10-26": 1,
    });
  });

  it("sorts both ways", () => {
    expect(sortByDue(rows).map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(sortByDue(rows, "desc").map((row) => row.id)).toEqual([
      "c",
      "d",
      "b",
      "a",
    ]);
  });

  it("groups by the reader's day", () => {
    const groups = groupByDay(rows);
    expect(groups.map((group) => group.day)).toEqual([
      "2026-10-25",
      "2026-10-26",
    ]);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("formats estimated work", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(30)).toBe("30 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(90)).toBe("1 h 30 min");
  });

  it("validates marks", () => {
    expect(isPositiveMarks("20")).toBe(true);
    expect(isPositiveMarks("20.5")).toBe(true);
    expect(isPositiveMarks("0")).toBe(false);
    expect(isPositiveMarks("2.555")).toBe(false);
    expect(isPositiveMarks("")).toBe(false);
  });
});

describe("triage", () => {
  it("maps every status onto one segment", () => {
    expect(segmentOf("draft")).toBe("drafts");
    expect(segmentOf("scheduled")).toBe("live");
    expect(segmentOf("published")).toBe("live");
    expect(segmentOf("closed")).toBe("closed");
    expect(segmentOf("cancelled")).toBe("closed");
    expect(matchesSegment("draft", "all")).toBe(true);
    expect(matchesSegment("draft", "live")).toBe(false);
  });

  it("only calls published work past due", () => {
    const now = new Date(2026, 9, 25, 12, 0);
    const dueAt = new Date(2026, 9, 25, 8, 0);
    expect(isPastDue({ dueAt, status: "published" }, now)).toBe(true);
    expect(isPastDue({ dueAt, status: "closed" }, now)).toBe(false);
    expect(isPastDue({ dueAt, status: "draft" }, now)).toBe(false);
    expect(
      isPastDue({ dueAt: new Date(2026, 9, 26, 8, 0), status: "published" }, now),
    ).toBe(false);
  });

  it("finds the next day with work, never the past", () => {
    const rows = [
      { dueAt: new Date(2026, 9, 24, 8, 0), status: "published" },
      { dueAt: new Date(2026, 9, 27, 8, 0), status: "published" },
      { dueAt: new Date(2026, 9, 26, 8, 0), status: "draft" },
      { dueAt: new Date(2026, 9, 25, 8, 0), status: "closed" },
    ];
    expect(nextDayWithWork(rows, "2026-10-25")).toBe("2026-10-25");
    expect(nextDayWithWork(rows, "2026-10-26")).toBe("2026-10-27");
    expect(nextDayWithWork(rows, "2026-10-28")).toBeNull();
  });
});

describe("grading maths", () => {
  it("accepts zero as a score but not a broken decimal", () => {
    expect(isValidMarks("0", 10)).toBe(true);
    expect(isValidMarks("0.00", 10)).toBe(true);
    expect(isValidMarks("9.75", 10)).toBe(true);
    expect(isValidMarks("10", 10)).toBe(true);
    expect(isValidMarks("10.01", 10)).toBe(false);
    expect(isValidMarks("2.555", 10)).toBe(false);
    expect(isValidMarks("", 10)).toBe(false);
    expect(isValidMarks("9.75", null)).toBe(true);
  });

  it("prints marks without padding zeros", () => {
    expect(formatMarks("8.00")).toBe("8");
    expect(formatMarks("8.50")).toBe("8.5");
    expect(formatMarks("0.00")).toBe("0");
    expect(formatMarks(12)).toBe("12");
    expect(formatMarks(null)).toBeNull();
    expect(formatMarks("—")).toBe("—");
  });

  it("counts a grid honestly", () => {
    const rows = [
      { status: "reviewed" },
      { status: "reviewed" },
      { status: "submitted" },
      { status: "resubmit_requested" },
      { status: "assigned" },
      { status: "in_progress" },
      { status: "missing" },
      { status: "excused" },
    ];
    const counts = countStudentWork(rows);
    expect(counts).toMatchObject({
      total: 8,
      reviewable: 7,
      reviewed: 2,
      submitted: 1,
      resubmit: 1,
      toGrade: 2,
      notSubmitted: 2,
      missing: 1,
      excused: 1,
      viewOnly: 0,
    });
  });

  it("shows late joiners without letting them skew the totals", () => {
    const counts = countStudentWork([
      { status: "reviewed" },
      { status: "assigned", countsTowardStats: false },
    ]);
    expect(counts.total).toBe(1);
    expect(counts.reviewed).toBe(1);
    expect(counts.viewOnly).toBe(1);
  });

  it("maps a status onto the four filters", () => {
    expect(matchesStudentFilter("submitted", "all")).toBe(true);
    expect(matchesStudentFilter("submitted", "to_grade")).toBe(true);
    expect(matchesStudentFilter("resubmit_requested", "to_grade")).toBe(true);
    expect(matchesStudentFilter("assigned", "to_grade")).toBe(false);
    expect(matchesStudentFilter("reviewed", "graded")).toBe(true);
    expect(matchesStudentFilter("missing", "missing")).toBe(true);
    expect(matchesStudentFilter("excused", "graded")).toBe(false);
  });

  it("sorts the register by roll, then name, with blanks last", () => {
    const rows = [
      { rollNumber: "10", studentName: "Tara" },
      { rollNumber: "2", studentName: "Bilal" },
      { rollNumber: null, studentName: "Aarav" },
      { rollNumber: "A-3", studentName: "Zoya" },
      { rollNumber: "A-1", studentName: "Ira" },
      { rollNumber: "2", studentName: "Anya" },
    ];
    expect(sortRoster(rows).map((row) => row.studentName)).toEqual([
      "Anya",
      "Bilal",
      "Tara",
      "Ira",
      "Zoya",
      "Aarav",
    ]);
  });
});
