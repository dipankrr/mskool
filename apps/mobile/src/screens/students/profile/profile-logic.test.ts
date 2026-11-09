import {
  absenceRun,
  clockOf,
  feeFlag,
  finishSteps,
  lastMarkedDays,
  monthsPaid,
  percentDelta,
  resultFlag,
  tileSpans,
  todayMark,
  visibleActions,
  type HistoryRow,
} from "./profile-logic";

const row = (date: string, status: HistoryRow["status"], studentId = "s1"): HistoryRow => ({
  studentId,
  date,
  status,
  createdAt: `${date}T03:35:00.000Z`,
});

describe("attendance folds", () => {
  const rows = [
    row("2026-11-02", "present"),
    row("2026-11-03", "absent"),
    row("2026-11-04", "absent"),
    row("2026-11-05", "late"),
    row("2026-11-06", "present"),
    row("2026-11-05", "absent", "s2"),
  ];

  it("keeps the student's last marked days, oldest first", () => {
    expect(lastMarkedDays(rows, "s1", 3).map((d) => d.date)).toEqual([
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
  });

  it("finds today's mark for this student only", () => {
    expect(todayMark(rows, "s1", "2026-11-06")?.status).toBe("present");
    expect(todayMark(rows, "s2", "2026-11-06")).toBeNull();
  });

  it("flags two or more absences in the last seven marked days", () => {
    expect(absenceRun(rows, "s1")).toEqual({
      count: 2,
      of: 5,
      dates: ["2026-11-03", "2026-11-04"],
    });
    expect(absenceRun(rows, "s2")).toBeNull();
  });

  it("formats a mark time on a 12-hour clock", () => {
    expect(clockOf("not a date")).toBeNull();
    expect(clockOf("2026-11-06T03:35:00.000Z")).toMatch(/^\d{1,2}:\d{2} (am|pm)$/);
  });
});

describe("fees", () => {
  it("overdue money is critical, money due now a caution, nothing owed no line", () => {
    expect(feeFlag({ overdue: "5450.00", dueNow: "8200.00" })).toEqual({
      tone: "critical",
      amount: "5450.00",
    });
    expect(feeFlag({ overdue: "0.00", dueNow: "2750.50" })).toEqual({
      tone: "caution",
      amount: "2750.50",
    });
    expect(feeFlag({ overdue: "0", dueNow: "0.00" })).toBeNull();
  });

  it("counts paid months among months that bill anything", () => {
    expect(
      monthsPaid([{ state: "paid" }, { state: "overdue" }, { state: "none" }, { state: "upcoming" }]),
    ).toEqual({ paid: 1, total: 3 });
  });
});

describe("results", () => {
  it("rounds the change to whole points", () => {
    expect(percentDelta("78.40", "84.00")).toBe(-6);
    expect(percentDelta("78.40", null)).toBeNull();
  });

  it("names failed subjects first, then a drop of five or more", () => {
    const base = { termName: "Half-yearly", percentage: "70.00", previousPercentage: "80.00" };
    expect(resultFlag({ ...base, failedSubjects: ["Hindi"] })).toEqual({
      kind: "failed",
      subjects: ["Hindi"],
    });
    expect(resultFlag({ ...base, failedSubjects: [] })).toEqual({ kind: "dropped", points: 10 });
    expect(resultFlag({ ...base, previousPercentage: "73.00", failedSubjects: [] })).toBeNull();
  });
});

describe("to finish an admission", () => {
  const all = { enrol: true, place: true, parent: true, fees: true };

  it("asks for a class before a section, and fees only once enrolled", () => {
    expect(
      finishSteps({ enrolled: false, hasSection: false, hasParent: false, hasFeePlan: false, can: all }),
    ).toEqual({ mine: ["enrol", "parent"], others: 0 });
    expect(
      finishSteps({ enrolled: true, hasSection: false, hasParent: true, hasFeePlan: false, can: all }),
    ).toEqual({ mine: ["place", "fees"], others: 0 });
  });

  it("counts the steps this viewer can't do instead of hiding them", () => {
    expect(
      finishSteps({
        enrolled: true,
        hasSection: false,
        hasParent: false,
        hasFeePlan: false,
        can: { enrol: false, place: false, parent: true, fees: false },
      }),
    ).toEqual({ mine: ["parent"], others: 2 });
  });

  it("doesn't judge fees the viewer can't read", () => {
    expect(
      finishSteps({ enrolled: true, hasSection: true, hasParent: true, hasFeePlan: null, can: all }),
    ).toEqual({ mine: [], others: 0 });
  });
});

describe("layout", () => {
  it("spans an odd last tile across the row", () => {
    expect(tileSpans(1)).toEqual(["full"]);
    expect(tileSpans(3)).toEqual(["half", "half", "full"]);
    expect(tileSpans(4)).toEqual(["half", "half", "half", "half"]);
  });

  it("keeps up to four allowed actions in order", () => {
    expect(visibleActions(["call", false, "collect", null, "card", "rejoin", "x"])).toEqual([
      "call",
      "collect",
      "card",
      "rejoin",
    ]);
  });
});
