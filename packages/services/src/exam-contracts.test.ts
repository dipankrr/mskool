import {
  createExamSchema,
  createPassCriteriaSchema,
  createSubjectTypeSchema,
  gradingScaleBandInput,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

/**
 * EXAM CONTRACT REGRESSIONS (commit 1) — creation/setup blockers that the
 * hermetic gates never caught because no test parsed a minimal payload.
 *
 * Each case below failed before the fix and passes after; they pin:
 * B1 (DB-defaulted columns stay optional), B3 (band endpoints compare as
 * numbers, not strings), pct100 range, the supplementary/improvement link,
 * and the grace-caps cross-check.
 */

const TERM = "00000000-0000-0000-0000-000000000000";

describe("grading bands compare as numbers", () => {
  it("accepts a valid 90–100 band", () => {
    expect(
      gradingScaleBandInput.safeParse({
        minMarks: "90",
        maxMarks: "100",
        gradeLabel: "A",
      }).success,
    ).toBe(true);
  });

  it("rejects an inverted 100–90 band", () => {
    expect(
      gradingScaleBandInput.safeParse({
        minMarks: "100",
        maxMarks: "90",
        gradeLabel: "A",
      }).success,
    ).toBe(false);
  });
});

describe("exam creation accepts minimal payloads", () => {
  it("name + term + type validates (weight defaults to 100)", () => {
    expect(
      createExamSchema.safeParse({
        name: "Term 1 Examination",
        termId: TERM,
        examType: "regular",
      }).success,
    ).toBe(true);
  });

  it("a mock with counts=false validates", () => {
    expect(
      createExamSchema.safeParse({
        name: "Practice",
        termId: TERM,
        examType: "mock",
        countsTowardTermResult: false,
      }).success,
    ).toBe(true);
  });

  it("rejects zero and over-100 weightages with words, not DB errors", () => {
    for (const weightageInTerm of ["0", "0.00", "101", "999"]) {
      const parsed = createExamSchema.safeParse({
        name: "T",
        termId: TERM,
        examType: "regular",
        weightageInTerm,
      });
      expect(parsed.success, weightageInTerm).toBe(false);
    }
  });

  it("improvement without a link is refused; null is not a link", () => {
    expect(
      createExamSchema.safeParse({
        name: "T",
        termId: TERM,
        examType: "improvement",
      }).success,
    ).toBe(false);
    expect(
      createExamSchema.safeParse({
        name: "T",
        termId: TERM,
        examType: "improvement",
        linkedExamId: null,
      }).success,
    ).toBe(false);
  });

  it("supplementary with a link validates", () => {
    expect(
      createExamSchema.safeParse({
        name: "T",
        termId: TERM,
        examType: "supplementary",
        linkedExamId: TERM,
      }).success,
    ).toBe(true);
  });
});

describe("setup defaults stay optional", () => {
  it("a subject type with only a name validates", () => {
    expect(createSubjectTypeSchema.safeParse({ name: "Main" }).success).toBe(
      true,
    );
  });

  it("pass criteria allow grace only with both caps", () => {
    expect(
      createPassCriteriaSchema.safeParse({ graceMarksAllowed: true }).success,
    ).toBe(false);
    expect(
      createPassCriteriaSchema.safeParse({
        graceMarksAllowed: true,
        maxGracePerSubject: "5",
        maxGraceTotal: "10",
      }).success,
    ).toBe(true);
  });
});
