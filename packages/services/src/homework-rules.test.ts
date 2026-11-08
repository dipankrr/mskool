import { describe, expect, it } from "vitest";

import { compareRoll, studentWord, validateChoices } from "./homework-rules";

describe("compareRoll", () => {
  it("sorts roll numbers as numbers first", () => {
    const rolls = ["12", "2", "12A", null, "1", "B4", "10"];
    expect([...rolls].sort(compareRoll)).toEqual(["1", "2", "10", "12", "12A", "B4", null]);
  });
});

describe("validateChoices", () => {
  const ok = (kind: Parameters<typeof validateChoices>[0]["kind"], comesBack: any, gradingMode: any, maxMarks: string | null = null) =>
    () => validateChoices({ kind, comesBack, gradingMode, maxMarks });

  it("allows each type's ways back and grading", () => {
    expect(ok("homework", "brought", "none")).not.toThrow();
    expect(ok("homework", "sent", "marks", "10")).not.toThrow();
    expect(ok("homework", "tick", "none")).not.toThrow();
    expect(ok("practice", "brought", "remark")).not.toThrow();
    expect(ok("project", "sent", "grade")).not.toThrow();
    expect(ok("reading", "none", "none")).not.toThrow();
  });

  it("refuses what a type does not allow", () => {
    expect(ok("reading", "sent", "none")).toThrow(/come back that way/);
    expect(ok("project", "tick", "none")).toThrow(/come back that way/);
    expect(ok("practice", "brought", "marks", "5")).toThrow(/graded that way/);
    expect(ok("homework", "tick", "remark")).toThrow(/Only work that comes back/);
    expect(ok("homework", "brought", "marks")).toThrow(/out of/);
  });
});

describe("studentWord", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  const before = new Date("2026-11-09T10:00:00Z");
  const after = new Date("2026-11-11T10:00:00Z");
  const row = (over: Partial<Parameters<typeof studentWord>[0]>) => ({
    status: "assigned" as const,
    checkStatus: null,
    isLate: false,
    effectiveCloseAt: after,
    ...over,
  });

  it("names each state in the student's words", () => {
    expect(studentWord(row({}), "brought", now)).toBe("to_do");
    expect(studentWord(row({ status: "submitted" }), "sent", now)).toBe("sent");
    expect(studentWord(row({ status: "submitted", isLate: true }), "sent", now)).toBe("late");
    expect(studentWord(row({ status: "checked", checkStatus: "done" }), "brought", now)).toBe("checked");
    expect(studentWord(row({ status: "checked", checkStatus: "not_done" }), "brought", now)).toBe("missed");
    expect(studentWord(row({ status: "redo" }), "sent", now)).toBe("redo");
    expect(studentWord(row({ status: "missing" }), "sent", now)).toBe("missed");
  });

  it("work sent in the app or a quiz is missed after close; reading never is", () => {
    expect(studentWord(row({ effectiveCloseAt: before }), "sent", now)).toBe("missed");
    expect(studentWord(row({ effectiveCloseAt: before }), "questions", now)).toBe("missed");
    expect(studentWord(row({ effectiveCloseAt: before }), "tick", now)).toBe("to_do");
    expect(studentWord(row({ effectiveCloseAt: before }), "brought", now)).toBe("to_do");
  });
});
