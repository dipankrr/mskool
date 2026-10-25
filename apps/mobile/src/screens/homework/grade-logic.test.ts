import { composeTimestamp } from "../../lib/homework";
import {
  checkExcuseReason,
  checkExtension,
  checkGradeDraft,
  checkResubmitNote,
  MAX_EXTENSION_REASON,
  MAX_FEEDBACK,
  MAX_RESUBMIT_NOTE,
} from "./grade-logic";

/**
 * The grading screens' contract with the server, pinned. Each refusal below
 * mirrors a rule in `homework.service.ts`; if the service changes, one of
 * these should fail before a teacher discovers it on a Friday afternoon.
 */

const at = (day: number, hour = 8, minute = 0) =>
  new Date(2026, 9, day, hour, minute, 0, 0);

describe("a review draft", () => {
  it("saves completion work without a submission", () => {
    const check = checkGradeDraft({
      mode: "completion",
      marks: "",
      feedback: "  Neat work.  ",
      maxMarks: null,
      hasSubmission: false,
    });
    expect(check.valid).toBe(true);
    expect(check.reviewBlocked).toBe(false);
    expect(check.marks).toBeNull();
    expect(check.feedback).toBe("Neat work.");
  });

  it("requires a score in marks mode", () => {
    const check = checkGradeDraft({
      mode: "marks",
      marks: "   ",
      feedback: "",
      maxMarks: "10",
      hasSubmission: true,
    });
    expect(check.valid).toBe(false);
    expect(check.errors.marks).toBeTruthy();
  });

  it("accepts zero as a real score", () => {
    const check = checkGradeDraft({
      mode: "marks",
      marks: "0",
      feedback: "",
      maxMarks: "10",
      hasSubmission: true,
    });
    expect(check.valid).toBe(true);
    expect(check.marks).toBe("0");
  });

  it("refuses a score above the ceiling, and keeps the ceiling visible", () => {
    const check = checkGradeDraft({
      mode: "marks",
      marks: "10.5",
      feedback: "",
      maxMarks: "10",
      hasSubmission: true,
    });
    expect(check.valid).toBe(false);
    expect(check.errors.marks).toContain("10");
  });

  it("refuses a malformed decimal", () => {
    const check = checkGradeDraft({
      mode: "marks",
      marks: "3.333",
      feedback: "",
      maxMarks: "10",
      hasSubmission: true,
    });
    expect(check.valid).toBe(false);
    expect(check.errors.marks).toBeTruthy();
  });

  it("blocks a marks review when nothing was handed in online", () => {
    const check = checkGradeDraft({
      mode: "marks",
      marks: "8",
      feedback: "",
      maxMarks: "10",
      hasSubmission: false,
    });
    expect(check.reviewBlocked).toBe(true);
    expect(check.valid).toBe(false);
  });

  it("blocks a letter-grade review with no submission, like the server", () => {
    const check = checkGradeDraft({
      mode: "grade",
      marks: "",
      feedback: "Good",
      maxMarks: null,
      hasSubmission: false,
    });
    expect(check.reviewBlocked).toBe(true);
    expect(check.valid).toBe(false);
  });

  it("keeps rubric mode read-only", () => {
    const check = checkGradeDraft({
      mode: "rubric",
      marks: "",
      feedback: "",
      maxMarks: null,
      hasSubmission: true,
    });
    expect(check.readOnly).toBe(true);
    expect(check.valid).toBe(false);
  });

  it("drops a marks field the mode does not use", () => {
    const check = checkGradeDraft({
      mode: "completion",
      marks: "8",
      feedback: "",
      maxMarks: "10",
      hasSubmission: true,
    });
    expect(check.marks).toBeNull();
    expect(check.valid).toBe(true);
  });

  it("refuses runaway feedback", () => {
    const check = checkGradeDraft({
      mode: "completion",
      marks: "",
      feedback: "x".repeat(MAX_FEEDBACK + 1),
      maxMarks: null,
      hasSubmission: true,
    });
    expect(check.valid).toBe(false);
    expect(check.errors.feedback).toBeTruthy();
  });
});

describe("a resubmit note", () => {
  it("needs a real sentence", () => {
    expect(checkResubmitNote("  ok ").value).toBeNull();
    expect(checkResubmitNote("  ok ").error).toBeTruthy();
  });

  it("trims and accepts a useful note", () => {
    expect(checkResubmitNote("  Finish question 4.  ")).toEqual({
      value: "Finish question 4.",
      error: null,
    });
  });

  it("refuses more prose than the contract takes", () => {
    const result = checkResubmitNote("x".repeat(MAX_RESUBMIT_NOTE + 1));
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe("a deadline extension", () => {
  const currentDue = at(26, 8);
  const currentClose = at(27, 8);
  const now = at(25, 9);

  it("needs both halves of a due moment", () => {
    const check = checkExtension({
      day: null,
      time: "08:00",
      reason: "",
      currentDueAt: currentDue,
      currentCloseAt: currentClose,
      now,
    });
    expect(check.valid).toBe(false);
    expect(check.error).toBeTruthy();
  });

  it("refuses a moment in the past", () => {
    const when = composeTimestamp("2026-10-24", "08:00");
    const check = checkExtension({
      day: "2026-10-24",
      time: "08:00",
      reason: "",
      currentDueAt: currentDue,
      currentCloseAt: currentClose,
      now,
    });
    expect(when).not.toBeNull();
    expect(check.valid).toBe(false);
  });

  it("refuses to shorten an existing deadline", () => {
    const check = checkExtension({
      day: "2026-10-26",
      time: "07:00",
      reason: "",
      currentDueAt: currentDue,
      currentCloseAt: currentClose,
      now,
    });
    expect(check.valid).toBe(false);
  });

  it("moves the due moment and keeps the same grace window", () => {
    const check = checkExtension({
      day: "2026-10-29",
      time: "10:00",
      reason: "  Was unwell.  ",
      currentDueAt: currentDue,
      currentCloseAt: currentClose,
      now,
    });
    expect(check.valid).toBe(true);
    expect(check.reason).toBe("Was unwell.");
    expect(check.dueAt).not.toBeNull();
    expect(check.closeAt).not.toBeNull();
    const due = new Date(check.dueAt as string);
    const close = new Date(check.closeAt as string);
    expect(close.getTime() - due.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("sends no reason when the field is blank", () => {
    const check = checkExtension({
      day: "2026-10-29",
      time: "10:00",
      reason: "   ",
      currentDueAt: currentDue,
      currentCloseAt: currentClose,
      now,
    });
    expect(check.valid).toBe(true);
    expect(check.reason).toBeNull();
  });

  it("refuses a reason longer than the contract", () => {
    const check = checkExtension({
      day: "2026-10-29",
      time: "10:00",
      reason: "x".repeat(MAX_EXTENSION_REASON + 1),
      currentDueAt: currentDue,
      currentCloseAt: currentClose,
      now,
    });
    expect(check.valid).toBe(false);
    expect(check.error).toBeTruthy();
  });
});

describe("an excuse reason", () => {
  it("needs three real characters", () => {
    expect(checkExcuseReason("  a ").value).toBeNull();
    expect(checkExcuseReason("  a ").error).toBeTruthy();
  });

  it("trims and accepts a reason", () => {
    expect(checkExcuseReason(" Medical leave ")).toEqual({
      value: "Medical leave",
      error: null,
    });
  });

  it("refuses a reason over the contract limit", () => {
    const result = checkExcuseReason("x".repeat(501));
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
