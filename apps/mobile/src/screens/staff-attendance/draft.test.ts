import {
  buildDraft,
  buildEntries,
  bulkDraft,
  changingIds,
  countStatuses,
  deriveClean,
  toggleStatus,
  withStatus,
} from "./draft";
import type { Status } from "./draft";

const ROSTER = ["s1", "s2", "s3"];

function stored(entries: [string, Status][]): Map<string, Status> {
  return new Map(entries);
}

describe("toggleStatus", () => {
  it("flips present to absent", () => {
    expect(toggleStatus("present")).toBe("absent");
  });

  it("returns absent to present", () => {
    expect(toggleStatus("absent")).toBe("present");
  });

  it("returns every exception status to present", () => {
    expect(toggleStatus("late")).toBe("present");
    expect(toggleStatus("half_day")).toBe("present");
    expect(toggleStatus("on_leave")).toBe("present");
  });
});

describe("buildDraft", () => {
  it("prefills stored marks and defaults the missing rows to present", () => {
    const draft = buildDraft(ROSTER, stored([["s1", "absent"], ["s3", "late"]]));
    expect(draft.get("s1")).toBe("absent");
    expect(draft.get("s2")).toBe("present");
    expect(draft.get("s3")).toBe("late");
  });
});

describe("changingIds", () => {
  it("treats a missing row as the default, not as a change", () => {
    const draft = buildDraft(ROSTER, stored([]));
    expect(changingIds(ROSTER, draft, stored([]))).toEqual([]);
  });

  it("counts only entries that differ from the stored marks", () => {
    const marks = stored([["s1", "present"], ["s2", "present"]]);
    const draft = withStatus(buildDraft(ROSTER, marks), "s2", "absent");
    expect(changingIds(ROSTER, draft, marks)).toEqual(["s2"]);
  });

  it("ignores draft entries for students outside the roster", () => {
    const marks = stored([]);
    const draft = withStatus(buildDraft(ROSTER, marks), "other", "absent");
    expect(changingIds(ROSTER, draft, marks)).toEqual([]);
  });
});

describe("bulkDraft and countStatuses", () => {
  it("bulk-marks every roster row and counts them", () => {
    const draft = bulkDraft(ROSTER, "absent");
    expect(countStatuses(ROSTER, draft)).toEqual({
      present: 0,
      absent: 3,
      late: 0,
      half_day: 0,
      on_leave: 0,
    });
  });

  it("counts a mixed draft", () => {
    const draft = withStatus(
      withStatus(bulkDraft(ROSTER, "present"), "s2", "late"),
      "s3",
      "on_leave",
    );
    expect(countStatuses(ROSTER, draft)).toEqual({
      present: 1,
      absent: 0,
      late: 1,
      half_day: 0,
      on_leave: 1,
    });
  });
});

describe("buildEntries", () => {
  it("sends every roster row with the current status", () => {
    const marks = stored([["s1", "present"], ["s2", "absent"]]);
    const draft = withStatus(buildDraft(ROSTER, marks), "s2", "late");
    expect(buildEntries(ROSTER, draft, marks, { isPast: false, reason: "" })).toEqual([
      { studentId: "s1", status: "present" },
      { studentId: "s2", status: "late" },
      { studentId: "s3", status: "present" },
    ]);
  });

  it("attaches the reason only to changed entries on a past date", () => {
    const marks = stored([["s1", "present"], ["s2", "present"]]);
    const draft = withStatus(buildDraft(ROSTER, marks), "s2", "absent");
    const entries = buildEntries(ROSTER, draft, marks, {
      isPast: true,
      reason: "  bus was late  ",
    });
    expect(entries[0]).toEqual({ studentId: "s1", status: "present" });
    expect(entries[1]).toEqual({
      studentId: "s2",
      status: "absent",
      correctionReason: "bus was late",
    });
  });

  it("never attaches the reason on a same-day edit", () => {
    const marks = stored([["s1", "absent"]]);
    const draft = withStatus(buildDraft(ROSTER, marks), "s1", "present");
    const entries = buildEntries(ROSTER, draft, marks, {
      isPast: false,
      reason: "fixing a mistake",
    });
    expect(entries[0]).toEqual({ studentId: "s1", status: "present" });
  });

  it("omits the reason when the field is blank or whitespace", () => {
    const marks = stored([["s1", "present"]]);
    const draft = withStatus(buildDraft(ROSTER, marks), "s1", "absent");
    const entries = buildEntries(ROSTER, draft, marks, {
      isPast: true,
      reason: "   ",
    });
    expect(entries[0]).toEqual({ studentId: "s1", status: "absent" });
  });
});

describe("deriveClean", () => {
  it("is clean only when marked, unchanged and not editing", () => {
    expect(
      deriveClean({ dayIsMarked: true, changingCount: 0, editing: false }),
    ).toBe(true);
  });

  it("is not clean on an unmarked day even with a matching draft", () => {
    expect(
      deriveClean({ dayIsMarked: false, changingCount: 0, editing: false }),
    ).toBe(false);
  });

  it("is not clean with any pending change", () => {
    expect(
      deriveClean({ dayIsMarked: true, changingCount: 1, editing: false }),
    ).toBe(false);
  });

  it("is not clean after Edit re-opened the day", () => {
    expect(
      deriveClean({ dayIsMarked: true, changingCount: 0, editing: true }),
    ).toBe(false);
  });
});
