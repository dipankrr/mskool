import {
  appendMarkKey,
  changedResults,
  countDrafts,
  gradingOptions,
  initialDrafts,
  markAllDone,
  marksValid,
  nextSchoolDay,
  nextStatus,
  sectionLabel,
  weeksAhead,
  type RegisterRow,
} from "./homework";

const row = (id: string, over: Partial<RegisterRow> = {}): RegisterRow => ({
  studentAssignmentId: id,
  studentId: `s-${id}`,
  name: `Child ${id}`,
  rollNumber: id,
  photo: null,
  status: "assigned",
  absentToday: false,
  submittedAt: null,
  isLate: false,
  fileCount: 0,
  checkStatus: null,
  marks: null,
  grade: null,
  remark: null,
  note: null,
  checkedAt: null,
  ...over,
});

describe("school days", () => {
  it("skips Sundays", () => {
    // 2026-11-07 is a Saturday.
    expect(nextSchoolDay("2026-11-07", 1)).toBe("2026-11-09");
    expect(nextSchoolDay("2026-11-05", 2)).toBe("2026-11-07");
    expect(nextSchoolDay("2026-11-06", 2)).toBe("2026-11-09");
  });

  it("moves a week ahead off a Sunday", () => {
    expect(weeksAhead("2026-11-01", 1)).toBe("2026-11-09");
    expect(weeksAhead("2026-11-04", 2)).toBe("2026-11-18");
  });
});

describe("grading options", () => {
  it("drops grading when nothing comes back to the teacher", () => {
    expect(gradingOptions("homework", "brought")).toEqual(["none", "marks", "grade", "remark"]);
    expect(gradingOptions("homework", "tick")).toEqual(["none"]);
    expect(gradingOptions("practice", "brought")).toEqual(["none", "remark"]);
  });
});

describe("section labels", () => {
  it("joins short section names and separates words", () => {
    expect(sectionLabel("Class 6", "A")).toBe("6A");
    expect(sectionLabel("6", "B")).toBe("6B");
    expect(sectionLabel("Nursery", "Rose")).toBe("Nursery · Rose");
  });
});

describe("the check list", () => {
  it("cycles a tap through the four statuses", () => {
    expect(nextStatus(null)).toBe("done");
    expect(nextStatus("done")).toBe("incomplete");
    expect(nextStatus("incomplete")).toBe("not_done");
    expect(nextStatus("not_done")).toBe("absent");
    expect(nextStatus("absent")).toBe("done");
  });

  it("starts absent children as Absent and keeps saved marks", () => {
    const drafts = initialDrafts([row("1", { absentToday: true }), row("2", { checkStatus: "incomplete" }), row("3")]);
    expect(drafts["1"]!.checkStatus).toBe("absent");
    expect(drafts["2"]!.checkStatus).toBe("incomplete");
    expect(drafts["3"]!.checkStatus).toBeNull();
  });

  it("All done marks only the unset children", () => {
    const drafts = markAllDone(initialDrafts([row("1", { absentToday: true }), row("2"), row("3", { checkStatus: "not_done" })]));
    expect(countDrafts(drafts)).toEqual({ done: 1, incomplete: 0, notDone: 1, absent: 1, left: 0 });
  });

  it("sends only what changed", () => {
    const rows = [row("1"), row("2", { checkStatus: "done" })];
    const drafts = initialDrafts(rows);
    drafts["1"] = { ...drafts["1"]!, checkStatus: "done", note: "  Neat  " };
    expect(changedResults(rows, drafts)).toEqual([
      { studentAssignmentId: "1", checkStatus: "done", marks: null, grade: null, remark: null, note: "Neat" },
    ]);
  });
});

describe("the marks pad", () => {
  it("takes digits and one decimal point with two places", () => {
    let v = "";
    for (const k of ["1", "2", ".", "5", "5", "9"]) v = appendMarkKey(v, k);
    expect(v).toBe("12.55");
    expect(appendMarkKey("12.55", "⌫")).toBe("12.5");
    expect(appendMarkKey("", ".")).toBe("");
    expect(appendMarkKey("0", "7")).toBe("7");
  });

  it("checks marks against the maximum", () => {
    expect(marksValid("8", "10.00")).toBe(true);
    expect(marksValid("11", "10.00")).toBe(false);
    expect(marksValid("8.", "10")).toBe(false);
  });
});
