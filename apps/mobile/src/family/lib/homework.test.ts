import { countdown, groupDone, groupOpen, nextOpen, resultLabel, shownWord, subjectSlot, tonight } from "./homework";
import type { PortalItem } from "./homework";

const NOW = new Date(2026, 10, 9, 19, 20); // Mon 9 Nov 2026, 7:20 pm

function item(over: Partial<PortalItem> & { id: string }): PortalItem {
  const { id, ...rest } = over;
  return {
    studentAssignmentId: id,
    kind: "homework",
    comesBack: "sent",
    gradingMode: "none",
    maxMarks: null,
    title: id,
    book: null,
    subjectName: "Maths",
    teacherName: "Mrs. Rao",
    estimatedMinutes: null,
    givenAt: new Date(2026, 10, 8),
    dueAt: new Date(2026, 10, 9, 20, 0),
    closeAt: new Date(2026, 10, 9, 20, 0),
    word: "to_do",
    checkStatus: null,
    marks: null,
    grade: null,
    remark: null,
    hasNote: false,
    canUntick: false,
    ...rest,
  };
}

describe("shownWord", () => {
  it("says Done for a ticked homework and keeps the server word otherwise", () => {
    expect(shownWord({ word: "sent", comesBack: "tick" })).toBe("done");
    expect(shownWord({ word: "sent", comesBack: "sent" })).toBe("sent");
    expect(shownWord({ word: "redo", comesBack: "sent" })).toBe("redo");
  });
});

describe("countdown", () => {
  it("counts down in minutes, hours and days with a tone", () => {
    expect(countdown(new Date(2026, 10, 9, 20, 0), new Date(2026, 10, 9, 20, 0), NOW)).toEqual({ kind: "left", amount: 40, unit: "m", tone: "critical" });
    expect(countdown(new Date(2026, 10, 10, 8, 0), new Date(2026, 10, 10, 8, 0), NOW)).toMatchObject({ amount: 13, unit: "h", tone: "caution" });
    expect(countdown(new Date(2026, 10, 14, 19, 20), new Date(2026, 10, 14, 19, 20), NOW)).toMatchObject({ amount: 5, unit: "d", tone: "neutral" });
  });

  it("shows the late window after the due time, then closed", () => {
    expect(countdown(new Date(2026, 10, 9, 8, 0), new Date(2026, 10, 10, 19, 20), NOW)).toEqual({ kind: "lateOpen", amount: 1, unit: "d" });
    expect(countdown(new Date(2026, 10, 9, 8, 0), new Date(2026, 10, 9, 8, 0), NOW)).toEqual({ kind: "closed" });
  });
});

describe("groupOpen", () => {
  it("puts sent-back first, then by due day, then work waiting for the teacher", () => {
    const groups = groupOpen(
      [
        item({ id: "later", dueAt: new Date(2026, 10, 20) }),
        item({ id: "tomorrow", dueAt: new Date(2026, 10, 10, 8) }),
        item({ id: "today", dueAt: new Date(2026, 10, 9, 20) }),
        item({ id: "back", word: "redo" }),
        item({ id: "sent", word: "sent" }),
        item({ id: "past", dueAt: new Date(2026, 10, 9, 8), closeAt: new Date(2026, 10, 10) }),
        item({ id: "checked", word: "checked" }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.key, g.items.map((i) => i.studentAssignmentId)])).toEqual([
      ["back", ["back"]],
      ["late", ["past"]],
      ["today", ["today"]],
      ["tomorrow", ["tomorrow"]],
      ["later", ["later"]],
      ["waiting", ["sent"]],
    ]);
  });
});

describe("groupDone", () => {
  it("keeps checked and missed work, newest first, by week", () => {
    const groups = groupDone(
      [
        item({ id: "old", word: "checked", dueAt: new Date(2026, 9, 1) }),
        item({ id: "this", word: "checked", dueAt: new Date(2026, 10, 9, 8) }),
        item({ id: "last", word: "missed", dueAt: new Date(2026, 10, 4) }),
        item({ id: "open", word: "to_do" }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.key, g.items.map((i) => i.studentAssignmentId)])).toEqual([
      ["thisWeek", ["this"]],
      ["lastWeek", ["last"]],
      ["earlier", ["old"]],
    ]);
  });
});

describe("tonight", () => {
  it("counts today's homework left and done, and adds up the minutes left", () => {
    expect(
      tonight(
        [
          item({ id: "a", estimatedMinutes: 30 }),
          item({ id: "b", estimatedMinutes: 15, word: "redo" }),
          item({ id: "c", word: "sent" }),
          item({ id: "d", dueAt: new Date(2026, 10, 10) }),
        ],
        NOW,
      ),
    ).toEqual({ total: 3, left: 2, done: 1, minutes: 45 });
  });
});

describe("nextOpen and the rest", () => {
  it("picks the soonest other to-do", () => {
    const next = nextOpen(
      [item({ id: "x" }), item({ id: "late", dueAt: new Date(2026, 10, 12) }), item({ id: "soon", dueAt: new Date(2026, 10, 10) })],
      "x",
    );
    expect(next?.studentAssignmentId).toBe("soon");
  });

  it("gives a subject the same colour slot every time", () => {
    expect(subjectSlot("Maths")).toBe(subjectSlot("Maths"));
    expect(subjectSlot("Maths")).toBeLessThan(5);
  });

  it("reads the result as marks, grade or remark", () => {
    expect(resultLabel({ gradingMode: "marks", marks: "9.00", maxMarks: "10.00", grade: null, remark: null })).toEqual({ value: "9", unit: "/10" });
    expect(resultLabel({ gradingMode: "grade", marks: null, maxMarks: null, grade: "A", remark: null })).toEqual({ value: "A" });
    expect(resultLabel({ gradingMode: "remark", marks: null, maxMarks: null, grade: null, remark: "good" })).toEqual({ remark: "good" });
    expect(resultLabel({ gradingMode: "none", marks: null, maxMarks: null, grade: null, remark: null })).toBeNull();
  });
});
