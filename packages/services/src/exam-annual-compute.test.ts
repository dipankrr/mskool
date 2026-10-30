import { describe, expect, it } from "vitest";

import {
  computeAnnual,
  sumDisplay,
  type AnnualCellInput,
  type AnnualComputeInput,
} from "./exam-annual-compute";
import type { GradeBand } from "./exams-maths";

/**
 * THE ANNUAL COMPUTE (ADR-053), whole-class scenarios. Hundredths: 7000n is 70.00.
 */

const T1 = "t1";
const T2 = "t2";
const T3 = "t3";
const MATHS = "maths";
const SCIENCE = "science";
const ART = "art";

const bands: GradeBand[] = [
  { minMarks: 0n, maxMarks: 3300n, gradeLabel: "E", gradePoint: 400n },
  { minMarks: 3300n, maxMarks: 6000n, gradeLabel: "C", gradePoint: 600n },
  { minMarks: 6000n, maxMarks: 8000n, gradeLabel: "B", gradePoint: 800n },
  { minMarks: 8000n, maxMarks: 10000n, gradeLabel: "A", gradePoint: 1000n },
];

const scored = (score: bigint, isPassed = true): AnnualCellInput => ({
  outcome: { kind: "scored", score, isPassed, gradePoint: null },
  grade: null,
});
const exempt = (): AnnualCellInput => ({ outcome: { kind: "exempt" }, grade: null });
const graded = (grade: string | null): AnnualCellInput => ({
  outcome: { kind: "graded", gradePoint: null },
  grade,
});

type Cells = Record<string, Record<string, Record<string, AnnualCellInput>>>;
const toMap = (cells: Cells) =>
  new Map(
    Object.entries(cells).map(([student, bySubject]) => [
      student,
      new Map(
        Object.entries(bySubject).map(([subject, byTerm]) => [subject, new Map(Object.entries(byTerm))]),
      ),
    ]),
  );

const base = (over: Omit<Partial<AnnualComputeInput>, "cells"> & { cells: Cells }): AnnualComputeInput => ({
  policy: {
    method: "weighted",
    bestN: null,
    terms: [
      { termId: T1, sequence: 1, weightage: 2000n },
      { termId: T2, sequence: 2, weightage: 3000n },
      { termId: T3, sequence: 3, weightage: 5000n },
    ],
  },
  passPercent: 3300n,
  rules: {
    minSubjectsToPass: null,
    mandatoryPassSubjectIds: [],
    compartmentAllowed: false,
    maxSubjectsForCompartment: null,
  },
  subjects: [
    { subjectId: MATHS, countsTowardResult: true, isGradedOnly: false },
    { subjectId: SCIENCE, countsTowardResult: true, isGradedOnly: false },
  ],
  students: [{ studentId: "asha", sectionId: "A" }],
  scaleBands: bands,
  ...over,
  cells: toMap(over.cells),
});

const subjectOf = (out: ReturnType<typeof computeAnnual>, student: string, subject: string) =>
  out.subjects.find((s) => s.studentId === student && s.subjectId === subject);
const studentOf = (out: ReturnType<typeof computeAnnual>, student: string) =>
  out.students.find((s) => s.studentId === student);

describe("computeAnnual - a full year", () => {
  const out = computeAnnual(
    base({
      cells: {
        asha: {
          [MATHS]: { [T1]: scored(7000n), [T2]: scored(8000n), [T3]: scored(9000n) },
          [SCIENCE]: { [T1]: scored(6000n), [T2]: scored(6000n), [T3]: scored(6000n) },
        },
      },
    }),
  );

  it("weights the terms 20/30/50 per subject", () => {
    expect(subjectOf(out, "asha", MATHS)).toMatchObject({
      finalPercentage: "83.00",
      grade: "A",
      isPassed: true,
      renormalized: false,
    });
    expect(subjectOf(out, "asha", SCIENCE)?.finalPercentage).toBe("60.00");
  });

  it("keeps the audit trail: every term with nominal and effective weight", () => {
    expect(subjectOf(out, "asha", MATHS)?.sourceTerms).toEqual([
      { termId: T1, score: "70.00", grade: "B", nominalWeight: "20.00", effectiveWeight: "20.00", used: true },
      // 80.00 sits on a shared band edge: the upper band wins.
      { termId: T2, score: "80.00", grade: "A", nominalWeight: "30.00", effectiveWeight: "30.00", used: true },
      { termId: T3, score: "90.00", grade: "A", nominalWeight: "50.00", effectiveWeight: "50.00", used: true },
    ]);
  });

  it("totals the counted subjects and promotes", () => {
    expect(studentOf(out, "asha")).toMatchObject({
      totalMarks: "143.00",
      maxMarks: "200.00",
      percentage: "71.50",
      isPassed: true,
      promotionStatus: "promoted",
      renormalized: false,
      rankInClass: 1,
      rankInSection: 1,
    });
  });
});

describe("computeAnnual - missing terms", () => {
  it("counts a late joiner from the terms they have and says so", () => {
    const out = computeAnnual(
      base({
        cells: {
          asha: {
            [MATHS]: { [T3]: scored(6500n) },
            [SCIENCE]: { [T2]: scored(5000n), [T3]: scored(7000n) },
          },
        },
      }),
    );
    expect(subjectOf(out, "asha", MATHS)).toMatchObject({ finalPercentage: "65.00", renormalized: true });
    // T2 30 and T3 50 renormalized over 80: (5000*30 + 7000*50) / 80
    expect(subjectOf(out, "asha", SCIENCE)).toMatchObject({ finalPercentage: "62.50", renormalized: true });
    expect(subjectOf(out, "asha", MATHS)?.sourceTerms[0]).toMatchObject({ score: null, used: false, effectiveWeight: "0.00" });
    expect(studentOf(out, "asha")?.renormalized).toBe(true);
  });

  it("writes nothing for a subject the student never sat in any included term", () => {
    const out = computeAnnual(base({ cells: { asha: { [MATHS]: { [T1]: scored(7000n) } } } }));
    expect(subjectOf(out, "asha", SCIENCE)).toBeUndefined();
    expect(subjectOf(out, "asha", MATHS)).toBeDefined();
  });

  it("writes no row at all for a student with no results", () => {
    const out = computeAnnual(
      base({
        students: [{ studentId: "asha", sectionId: "A" }, { studentId: "ravi", sectionId: "A" }],
        cells: { asha: { [MATHS]: { [T1]: scored(7000n) } } },
      }),
    );
    expect(out.students.map((s) => s.studentId)).toEqual(["asha"]);
  });
});

describe("computeAnnual - the verdict", () => {
  const failing: Cells = {
    asha: {
      [MATHS]: { [T1]: scored(2000n, false), [T2]: scored(2500n, false), [T3]: scored(3000n, false) },
      [SCIENCE]: { [T1]: scored(8000n), [T2]: scored(8000n), [T3]: scored(8000n) },
    },
  };

  it("detains a failed subject when compartment is off", () => {
    const out = computeAnnual(base({ cells: failing }));
    expect(subjectOf(out, "asha", MATHS)?.isPassed).toBe(false);
    expect(studentOf(out, "asha")).toMatchObject({
      promotionStatus: "detained",
      isPassed: false,
      failedSubjectIds: [MATHS],
      compartmentSubjectIds: [],
    });
  });

  it("compartments it when the rules allow", () => {
    const out = computeAnnual(
      base({
        cells: failing,
        rules: {
          minSubjectsToPass: null,
          mandatoryPassSubjectIds: [],
          compartmentAllowed: true,
          maxSubjectsForCompartment: 1,
        },
      }),
    );
    expect(studentOf(out, "asha")).toMatchObject({
      promotionStatus: "compartment",
      compartmentSubjectIds: [MATHS],
    });
  });

  it("judges the annual score against the policy's bar, not the term verdicts", () => {
    // Failed every term's papers, but the policy's bar is 25%.
    const out = computeAnnual(base({ cells: failing, passPercent: 2500n }));
    expect(subjectOf(out, "asha", MATHS)?.isPassed).toBe(true);
    expect(studentOf(out, "asha")?.promotionStatus).toBe("promoted");
  });
});

describe("computeAnnual - graded-only and excused subjects", () => {
  it("promotes a class whose counted subjects are all graded-only, with no percentage", () => {
    const out = computeAnnual(
      base({
        subjects: [{ subjectId: ART, countsTowardResult: true, isGradedOnly: true }],
        cells: { asha: { [ART]: { [T1]: graded("B"), [T2]: graded("A"), [T3]: graded("A") } } },
      }),
    );
    expect(subjectOf(out, "asha", ART)).toMatchObject({ finalPercentage: null, grade: "A", isPassed: true });
    expect(subjectOf(out, "asha", ART)?.sourceTerms.map((s) => s.used)).toEqual([false, false, true]);
    expect(studentOf(out, "asha")).toMatchObject({
      percentage: null,
      isPassed: true,
      promotionStatus: "promoted",
    });
  });

  it("never fails or counts a subject the student is excused from in every term", () => {
    const out = computeAnnual(
      base({
        cells: {
          asha: {
            [MATHS]: { [T1]: exempt(), [T2]: exempt(), [T3]: exempt() },
            [SCIENCE]: { [T1]: scored(6000n), [T2]: scored(6000n), [T3]: scored(6000n) },
          },
        },
      }),
    );
    expect(subjectOf(out, "asha", MATHS)).toMatchObject({ isExempted: true, finalPercentage: null, isPassed: true });
    expect(studentOf(out, "asha")).toMatchObject({ totalMarks: "60.00", maxMarks: "100.00", percentage: "60.00" });
  });

  it("counts a subject excused in one term from the terms they sat", () => {
    const out = computeAnnual(
      base({
        cells: {
          asha: {
            [MATHS]: { [T1]: scored(7000n), [T2]: exempt(), [T3]: scored(9000n) },
          },
        },
      }),
    );
    expect(subjectOf(out, "asha", MATHS)).toMatchObject({ finalPercentage: "84.29", renormalized: true });
  });

  it("writes no row for a student whose only subjects are excused", () => {
    const out = computeAnnual(
      base({ cells: { asha: { [MATHS]: { [T1]: exempt() }, [SCIENCE]: { [T1]: exempt() } } } }),
    );
    expect(out.students).toEqual([]);
  });
});

describe("computeAnnual - best N", () => {
  it("counts the best two of three and marks which", () => {
    const out = computeAnnual(
      base({
        policy: {
          method: "best_n",
          bestN: 2,
          terms: [
            { termId: T1, sequence: 1, weightage: null },
            { termId: T2, sequence: 2, weightage: null },
            { termId: T3, sequence: 3, weightage: null },
          ],
        },
        cells: { asha: { [MATHS]: { [T1]: scored(4000n), [T2]: scored(8000n), [T3]: scored(9000n) } } },
      }),
    );
    const maths = subjectOf(out, "asha", MATHS);
    expect(maths?.finalPercentage).toBe("85.00");
    expect(maths?.sourceTerms.map((s) => s.used)).toEqual([false, true, true]);
    expect(maths?.sourceTerms[1]).toMatchObject({ nominalWeight: null, effectiveWeight: "50.00" });
    expect(sumDisplay(maths!.sourceTerms)).toEqual({ marks: "170.00", max: "200.00" });
  });
});

describe("computeAnnual - ranks", () => {
  it("ranks by percentage with ties sharing, per class and per section", () => {
    const year = { [T1]: scored(9000n), [T2]: scored(9000n), [T3]: scored(9000n) };
    const mid = { [T1]: scored(8000n), [T2]: scored(8000n), [T3]: scored(8000n) };
    const out = computeAnnual(
      base({
        students: [
          { studentId: "a", sectionId: "A" },
          { studentId: "b", sectionId: "B" },
          { studentId: "c", sectionId: "B" },
          { studentId: "d", sectionId: null },
        ],
        subjects: [{ subjectId: MATHS, countsTowardResult: true, isGradedOnly: false }],
        cells: {
          a: { [MATHS]: mid },
          b: { [MATHS]: year },
          c: { [MATHS]: mid },
          d: { [MATHS]: year },
        },
      }),
    );
    const ranks = Object.fromEntries(out.students.map((s) => [s.studentId, [s.rankInClass, s.rankInSection]]));
    expect(ranks).toEqual({ a: [3, 1], b: [1, 1], c: [3, 2], d: [1, null] });
  });
});
