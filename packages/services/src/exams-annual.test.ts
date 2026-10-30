import { describe, expect, it } from "vitest";

import {
  annualPolicySummary,
  annualScore,
  annualVerdict,
  termSubjectScore,
  type AnnualPolicyShape,
  type TermSubjectVote,
} from "./exams-maths";

/**
 * THE TERM SUBJECT FUNCTION AND THE ANNUAL ENGINES (ADR-053). Hundredths
 * everywhere: 8000n is 80.00.
 */

const vote = (over: Partial<TermSubjectVote> = {}): TermSubjectVote => ({
  marks: 8000n,
  weightage: 10000n,
  isPassed: true,
  isExempted: false,
  gradePoint: null,
  ...over,
});

describe("termSubjectScore", () => {
  it("weights the term's exams by weightage_in_term", () => {
    const out = termSubjectScore(
      [vote({ marks: 8000n, weightage: 3000n }), vote({ marks: 6000n, weightage: 7000n })],
      { isGradedOnly: false },
    );
    expect(out).toMatchObject({ kind: "scored", score: 6600n });
  });

  it("renormalizes over the exams provided", () => {
    const out = termSubjectScore([vote({ marks: 8000n, weightage: 5000n })], { isGradedOnly: false });
    expect(out).toMatchObject({ kind: "scored", score: 8000n });
  });

  it("scores a missing mark as zero's effect (absence is already on the exam row)", () => {
    const out = termSubjectScore(
      [vote({ marks: null, weightage: 5000n, isPassed: false }), vote({ marks: 8000n, weightage: 5000n })],
      { isGradedOnly: false },
    );
    expect(out).toMatchObject({ kind: "scored", score: 4000n, isPassed: false });
  });

  it("passes only when every exam it sat passed", () => {
    const out = termSubjectScore(
      [vote({ marks: 9000n, weightage: 5000n }), vote({ marks: 3000n, weightage: 5000n, isPassed: false })],
      { isGradedOnly: false },
    );
    expect(out).toMatchObject({ kind: "scored", score: 6000n, isPassed: false });
  });

  it("drops an excused exam out of the weighting and the pass test", () => {
    const out = termSubjectScore(
      [vote({ marks: 9000n, weightage: 5000n }), vote({ marks: null, weightage: 5000n, isPassed: true, isExempted: true })],
      { isGradedOnly: false },
    );
    expect(out).toMatchObject({ kind: "scored", score: 9000n, isPassed: true });
  });

  it("is exempt - not scored, not failed - when every exam was excused", () => {
    const out = termSubjectScore([vote({ isExempted: true, marks: null }), vote({ isExempted: true, marks: null })], {
      isGradedOnly: false,
    });
    expect(out).toEqual({ kind: "exempt" });
  });

  it("never scores or fails a graded-only subject; the grade point is the exam-weighted mean", () => {
    const out = termSubjectScore(
      [
        vote({ marks: null, weightage: 5000n, gradePoint: 1000n }),
        vote({ marks: null, weightage: 5000n, gradePoint: 800n }),
        vote({ marks: null, weightage: 5000n, gradePoint: null }),
      ],
      { isGradedOnly: true },
    );
    expect(out).toEqual({ kind: "graded", gradePoint: 900n });
  });

  it("carries the weighted grade point on a scored subject too", () => {
    const out = termSubjectScore(
      [vote({ weightage: 5000n, gradePoint: 900n }), vote({ weightage: 5000n, gradePoint: 700n })],
      { isGradedOnly: false },
    );
    expect(out).toMatchObject({ kind: "scored", gradePoint: 800n });
  });
});

const T1 = "t1";
const T2 = "t2";
const T3 = "t3";
const terms = (weights: Array<bigint | null>) =>
  [T1, T2, T3].slice(0, weights.length).map((termId, i) => ({
    termId,
    sequence: i + 1,
    weightage: weights[i] ?? null,
  }));
const weighted: AnnualPolicyShape = { method: "weighted", bestN: null, terms: terms([2000n, 3000n, 5000n]) };

describe("annualScore - weighted", () => {
  it("weights 20/30/50 over 70/80/90 as 83.00", () => {
    const pick = annualScore(
      [
        { termId: T1, score: 7000n },
        { termId: T2, score: 8000n },
        { termId: T3, score: 9000n },
      ],
      weighted,
    );
    expect(pick?.score).toBe(8300n);
    expect(pick?.renormalized).toBe(false);
    expect(pick?.sources.map((s) => s.effectiveWeight)).toEqual([2000n, 3000n, 5000n]);
  });

  it("renormalizes over the terms the student has, and says so", () => {
    // T2 has no paper: 20/70 and 50/70 of the weight.
    const pick = annualScore(
      [
        { termId: T1, score: 7000n },
        { termId: T3, score: 9000n },
      ],
      weighted,
    );
    expect(pick?.score).toBe(8429n);
    expect(pick?.renormalized).toBe(true);
    expect(pick?.usedCount).toBe(2);
    expect(pick?.sources.find((s) => s.termId === T2)).toMatchObject({ score: null, used: false, effectiveWeight: 0n });
    expect(pick?.sources.find((s) => s.termId === T1)?.effectiveWeight).toBe(2857n);
    expect(pick?.sources.find((s) => s.termId === T3)?.effectiveWeight).toBe(7143n);
  });

  it("a student with one term is counted from it alone", () => {
    expect(annualScore([{ termId: T3, score: 6500n }], weighted)?.score).toBe(6500n);
  });

  it("ignores a score from a term the policy does not include", () => {
    expect(annualScore([{ termId: "other", score: 9000n }], weighted)).toBeNull();
  });

  it("is null when the student has no included term at all", () => {
    expect(annualScore([], weighted)).toBeNull();
  });
});

describe("annualScore - single term", () => {
  const last: AnnualPolicyShape = { method: "single_term", bestN: null, terms: terms([null, null, null]).slice(2) };

  it("reads the one term", () => {
    expect(annualScore([{ termId: T3, score: 7700n }, { termId: T1, score: 9900n }], last)?.score).toBe(7700n);
  });

  it("has no annual result when that term has no paper for the student", () => {
    expect(annualScore([{ termId: T1, score: 9900n }], last)).toBeNull();
  });
});

describe("annualScore - best N", () => {
  const all = (n: number | null): AnnualPolicyShape => ({
    method: "best_n",
    bestN: n,
    terms: terms([null, null, null]),
  });
  const cells = [
    { termId: T1, score: 7000n },
    { termId: T2, score: 8000n },
    { termId: T3, score: 9000n },
  ];

  it("averages every included term when N is all of them (the Average preset)", () => {
    expect(annualScore(cells, all(3))?.score).toBe(8000n);
    expect(annualScore(cells, all(null))?.score).toBe(8000n);
  });

  it("takes the best N and marks which terms counted", () => {
    const pick = annualScore(cells, all(2));
    expect(pick?.score).toBe(8500n);
    expect(pick?.sources.map((s) => s.used)).toEqual([false, true, true]);
    expect(pick?.renormalized).toBe(false);
  });

  it("is the highest term when N is 1", () => {
    expect(annualScore(cells, all(1))?.score).toBe(9000n);
  });

  it("breaks ties by term order", () => {
    const tied = [
      { termId: T1, score: 8000n },
      { termId: T2, score: 8000n },
      { termId: T3, score: 7000n },
    ];
    const pick = annualScore(tied, all(1));
    expect(pick?.sources.map((s) => s.used)).toEqual([true, false, false]);
  });

  it("averages what is available when fewer than N terms exist, and flags it", () => {
    const pick = annualScore([{ termId: T3, score: 6000n }], all(2));
    expect(pick?.score).toBe(6000n);
    expect(pick?.renormalized).toBe(true);
  });

  it("does not flag a student who has N terms even if one selected term is missing", () => {
    const pick = annualScore([{ termId: T1, score: 7000n }, { termId: T3, score: 9000n }], all(2));
    expect(pick?.renormalized).toBe(false);
  });

  it("rounds half-up once, at the end", () => {
    const pick = annualScore(
      [
        { termId: T1, score: 9999n },
        { termId: T2, score: 10000n },
      ],
      { method: "best_n", bestN: 2, terms: terms([null, null]) },
    );
    expect(pick?.score).toBe(10000n);
  });
});

describe("annualVerdict", () => {
  const rules = (over: Partial<Parameters<typeof annualVerdict>[1]> = {}) => ({
    minSubjectsToPass: null,
    mandatoryPassSubjectIds: [] as string[],
    compartmentAllowed: false,
    maxSubjectsForCompartment: null,
    ...over,
  });
  const sub = (id: string, isPassed: boolean, over: Partial<Parameters<typeof annualVerdict>[0][number]> = {}) => ({
    subjectId: id,
    kind: "scored" as const,
    countsTowardResult: true,
    isPassed,
    ...over,
  });

  it("promotes when every counted subject passed", () => {
    expect(annualVerdict([sub("a", true), sub("b", true)], rules())).toMatchObject({
      isPassed: true,
      promotionStatus: "promoted",
    });
  });

  it("detains a failure when compartment is off", () => {
    expect(annualVerdict([sub("a", true), sub("b", false)], rules())).toMatchObject({
      isPassed: false,
      promotionStatus: "detained",
      failedSubjectIds: ["b"],
    });
  });

  it("compartments a failure that fits the cap, detains one that does not", () => {
    const r = rules({ compartmentAllowed: true, maxSubjectsForCompartment: 1 });
    expect(annualVerdict([sub("a", true), sub("b", false)], r)?.promotionStatus).toBe("compartment");
    expect(annualVerdict([sub("a", false), sub("b", false)], r)?.promotionStatus).toBe("detained");
  });

  it("detains when compartment is allowed but no cap was set", () => {
    const r = rules({ compartmentAllowed: true, maxSubjectsForCompartment: null });
    expect(annualVerdict([sub("a", false)], r)?.promotionStatus).toBe("detained");
  });

  it("honours a minimum number of passed subjects", () => {
    expect(annualVerdict([sub("a", true), sub("b", true), sub("c", false)], rules({ minSubjectsToPass: 2 }))).toMatchObject({
      isPassed: true,
      promotionStatus: "promoted",
      failedSubjectIds: ["c"],
    });
  });

  it("fails a student who failed a must-pass subject however many others passed", () => {
    const out = annualVerdict(
      [sub("a", true), sub("b", true), sub("maths", false)],
      rules({ minSubjectsToPass: 2, mandatoryPassSubjectIds: ["maths"] }),
    );
    expect(out?.isPassed).toBe(false);
  });

  it("ignores excused subjects and subjects that do not count", () => {
    const out = annualVerdict(
      [sub("a", true), sub("b", false, { kind: "exempt" }), sub("c", false, { countsTowardResult: false })],
      rules(),
    );
    expect(out).toMatchObject({ isPassed: true, countedSubjects: 1 });
  });

  it("promotes a class whose counted subjects are all graded-only", () => {
    const out = annualVerdict([sub("a", true, { kind: "graded" }), sub("b", true, { kind: "graded" })], rules());
    expect(out).toMatchObject({ promotionStatus: "promoted", gpaBranch: true });
  });

  it("is null when nothing counts", () => {
    expect(annualVerdict([sub("a", true, { kind: "exempt" })], rules())).toBeNull();
  });
});

describe("annualPolicySummary", () => {
  const named = (names: string[], weights: Array<bigint | null>) =>
    names.map((name, i) => ({ name, weightage: weights[i] ?? null, sequence: i + 1 }));

  it("reads a weighted policy", () => {
    expect(
      annualPolicySummary({
        method: "weighted",
        bestN: null,
        totalDisplay: "average",
        terms: named(["Term 1", "Term 2", "Term 3"], [2000n, 3000n, 5000n]),
        annualSubjectPassPercent: 3300n,
      }),
    ).toBe("Weighted: Term 1 20% · Term 2 30% · Term 3 50% · subject pass 33%");
  });

  it("reads best N, average, sum and one term", () => {
    const base = { totalDisplay: "average" as const, annualSubjectPassPercent: 3350n };
    const three = named(["T1", "T2", "T3"], [null, null, null]);
    expect(annualPolicySummary({ ...base, method: "best_n", bestN: 2, terms: three })).toBe("Best 2 of 3 terms · subject pass 33.50%");
    expect(annualPolicySummary({ ...base, method: "best_n", bestN: 3, terms: three })).toBe("Average of 3 terms · subject pass 33.50%");
    expect(annualPolicySummary({ ...base, method: "best_n", bestN: 3, totalDisplay: "sum", terms: three })).toBe("Sum of 3 terms · subject pass 33.50%");
    expect(annualPolicySummary({ ...base, method: "single_term", bestN: null, terms: three.slice(2) })).toBe("T3 only · subject pass 33.50%");
  });
});
