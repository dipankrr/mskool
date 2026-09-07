import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  annualWeighted,
  applyGrace,
  computeRanks,
  componentFailed,
  evaluatePass,
  examWeightedSubjectScore,
  fromHundredths,
  gpaAggregate,
  gradeFor,
  percentageOf,
  termAggregate,
  toHundredths,
  weightedComponentRollup,
  type GradeBand,
} from "./exams-maths";

/**
 * B3 — property-based result maths, the fees-property precedent. The
 * INVARIANTS over random inputs: grace never overshoots and respects the
 * caps and the must-pass-first order; ranks agree with the ordering and
 * ties share; percentages land in exactly one band of a contiguous scale;
 * weighted rollups are bounded and sum-exact at the extremes; the
 * string/BigInt round-trip is lossless. Pure and hermetic — no database.
 *
 * All values are BigInt hundredths end to end: no float is ever
 * constructed, not even in the test.
 */

const arbHundredths = (min: bigint, max: bigint) =>
  fc.bigInt({ min, max });

/** Marks between 0 and 200.00 (hundredths), as decimal strings. */
const arbMark = fc
  .integer({ min: 0, max: 20000 })
  .map((n) => fromHundredths(BigInt(n)));

describe("exams property: hundredths round-trip is lossless", () => {
  it("toHundredths ∘ fromHundredths is the identity over 2dp strings", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (n) => {
        expect(toHundredths(fromHundredths(BigInt(n)))).toBe(BigInt(n));
      }),
    );
  });

  it("refuses more than 2 decimal places", () => {
    expect(() => toHundredths("1.005")).toThrow();
  });
});

describe("exams property: the weighted rollup", () => {
  it("is bounded by [0, 100] for marks in [0, max] (the renormalized scale)", () => {
    fc.assert(
      fc.property(
        fc.array(
          // Marks are drawn FIRST so the generator can bound max ≥ marks —
          // an independent draw would produce marks > max, which no real
          // component can have (the ADR-013 trigger refuses it).
          fc.integer({ min: 0, max: 20000 }).chain((marks) =>
            fc.record({
              marksH: fc.constant(BigInt(marks)),
              maxH: fc.integer({ min: marks, max: 20000 }).map((m) => BigInt(m)),
              weightH: arbHundredths(1n, 10000n),
            }),
          ),
          { minLength: 1, maxLength: 8 },
        ),
        (components) => {
          const total = weightedComponentRollup(
            components.map((c) => ({
              marks: c.marksH,
              maxMarks: c.maxH,
              weightagePercentage: c.weightH,
            })),
          );
          // The subject score is always on the renormalized 0-100 scale
          // (Σweight need not be 100 in a random draw).
          expect(total).toBeGreaterThanOrEqual(0n);
          expect(total).toBeLessThanOrEqual(10000n);
        },
      ),
    );
  });

  it("full marks on every component scores exactly 100 (renormalized)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            maxH: arbHundredths(1n, 20000n),
            weightH: arbHundredths(1n, 10000n),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (components) => {
          const score = weightedComponentRollup(
            components.map((c) => ({
              marks: c.maxH,
              maxMarks: c.maxH,
              weightagePercentage: c.weightH,
            })),
          );
          expect(score).toBe(10000n);
        },
      ),
    );
  });

  it("zero marks score zero, absent components contribute zero", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            maxH: arbHundredths(1n, 20000n),
            weightH: arbHundredths(1n, 10000n),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (components) => {
          const zero = weightedComponentRollup(
            components.map((c) => ({
              marks: 0n,
              maxMarks: c.maxH,
              weightagePercentage: c.weightH,
            })),
          );
          expect(zero).toBe(0n);
          const absent = weightedComponentRollup(
            components.map((c) => ({
              marks: null,
              maxMarks: c.maxH,
              weightagePercentage: c.weightH,
            })),
          );
          expect(absent).toBe(0n);
        },
      ),
    );
  });

  it("exemption defaults to zero's effect, renormalizes when the school opts in", () => {
    // Theory (80) exempt, Internal 18/20 (weight 20): default scores the
    // exemption as zero; renormalized it leaves the denominator.
    const components = [
      { marks: null, maxMarks: 8000n, weightagePercentage: 8000n, exempted: true },
      { marks: 1800n, maxMarks: 2000n, weightagePercentage: 2000n, exempted: false },
    ];
    expect(weightedComponentRollup(components)).toBe(1800n);
    expect(weightedComponentRollup(components, { renormalizeExempt: true })).toBe(9000n);
  });

  it("an unattempted mandatory paper fails only under an absent-fails policy", () => {
    const pass = 3300n;
    // No mark, explicitly absent, policy on → failed.
    expect(componentFailed(null, pass, { absent: true, absentFails: true })).toBe(true);
    // Same absence, policy off → not failed (zero's effect only).
    expect(componentFailed(null, pass, { absent: true, absentFails: false })).toBe(false);
    // Exempted is never absence — never fails here.
    expect(componentFailed(null, pass, { absent: false, absentFails: true })).toBe(false);
    // A real mark below the line always fails, policy or not.
    expect(componentFailed(3200n, pass, { absent: false, absentFails: false })).toBe(true);
    expect(componentFailed(3300n, pass, { absent: false, absentFails: true })).toBe(false);
  });
});

describe("exams property: grace never overshoots, caps bind, must-pass first", () => {
  it("every allocation is ≤ its deficit, ≤ the per-subject cap, and Σ ≤ the total cap", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            subjectId: fc.uuid(),
            finalH: arbHundredths(0n, 9900n),
            passH: arbHundredths(9901n, 10000n),
            isMustPass: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        arbHundredths(1n, 2000n),
        arbHundredths(1n, 5000n),
        (candidates, perSubject, total) => {
          const asCandidates = candidates.map((c) => ({
            subjectId: c.subjectId,
            finalMarks: c.finalH,
            passMark: c.passH,
            isMustPass: c.isMustPass,
          }));
          const allocations = applyGrace(asCandidates, {
            perSubject,
            total,
          });
          let sum = 0n;
          for (const [subjectId, grant] of allocations) {
            const c = asCandidates.find((x) => x.subjectId === subjectId)!;
            const deficit = c.passMark - c.finalMarks;
            expect(grant).toBeLessThanOrEqual(deficit);
            expect(grant).toBeLessThanOrEqual(perSubject);
            sum += grant;
          }
          expect(sum).toBeLessThanOrEqual(total);
        },
      ),
    );
  });

  it("rescued subjects land exactly ON the pass line, never past it", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            subjectId: fc.uuid(),
            finalH: arbHundredths(0n, 9900n),
            passH: arbHundredths(9901n, 10000n),
            isMustPass: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        arbHundredths(1n, 3000n),
        arbHundredths(1n, 100000n),
        (candidates, perSubject, total) => {
          const asCandidates = candidates.map((c) => ({
            subjectId: c.subjectId,
            finalMarks: c.finalH,
            passMark: c.passH,
            isMustPass: c.isMustPass,
          }));
          const allocations = applyGrace(asCandidates, { perSubject, total });
          for (const [subjectId, grant] of allocations) {
            const c = asCandidates.find((x) => x.subjectId === subjectId)!;
            // A full rescue lands exactly on the line; a capped one stays below.
            const rescued = c.finalMarks + grant;
            expect(rescued).toBeLessThanOrEqual(c.passMark);
          }
        },
      ),
    );
  });

  it("when the total cap suffices, must-pass subjects are fully rescued first", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            subjectId: fc.uuid(),
            finalH: arbHundredths(0n, 9900n),
            passH: arbHundredths(9901n, 10000n),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        arbHundredths(9901n, 10000n),
        (nonMandatory, passH) => {
          const mustPass = {
            subjectId: "mustpass0000",
            finalMarks: 9000n,
            passMark: passH,
            isMustPass: true,
          };
          const others = nonMandatory.map((c) => ({
            subjectId: c.subjectId,
            finalMarks: c.finalH,
            passMark: c.passH,
            isMustPass: false,
          }));
          const worstDeficit = others.reduce(
            (m, c) => (c.passMark - c.finalMarks > m ? c.passMark - c.finalMarks : m),
            1n,
          );
          const generousTotal = worstDeficit + (passH - 9000n) + 10n;
          const allocations = applyGrace([mustPass, ...others], {
            perSubject: 10000n,
            total: generousTotal,
          });
          // The must-pass subject is fully rescued whenever anything at all
          // is allocatable and its deficit fits the per-subject cap.
          expect(allocations.get("mustpass0000")).toBe(passH - 9000n);
        },
      ),
    );
  });
});

describe("exams property: ranks agree with the ordering and ties share", () => {
  it("higher score ⇒ rank no worse; equal scores ⇒ equal rank; competition gaps", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            score: arbHundredths(0n, 100000n),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (entries) => {
          const ranks = computeRanks(entries);
          const sorted = [...entries].sort(
            (a, b) => (a.score > b.score ? -1 : a.score < b.score ? 1 : 0),
          );
          // Ties share the same rank.
          for (let i = 1; i < sorted.length; i++) {
            const a = sorted[i - 1]!;
            const b = sorted[i]!;
            if (a.score === b.score) {
              expect(ranks.get(a.id)).toBe(ranks.get(b.id));
            } else {
              expect(ranks.get(a.id)!).toBeLessThan(ranks.get(b.id)!);
            }
          }
          // The best rank is 1; every rank equals its 1-based position when
          // all scores are distinct (competition ranking).
          const distinct = new Set(entries.map((e) => e.score)).size === entries.length;
          if (distinct) {
            const ranksList = [...ranks.values()].sort((a, b) => a - b);
            expect(ranksList).toEqual(
              Array.from({ length: entries.length }, (_, i) => i + 1),
            );
          }
        },
      ),
    );
  });
});

describe("exams property: grades land in exactly one contiguous band", () => {
  /** A generated CONTIGUOUS scale covering 0-100 (what scale creation validates). */
  const arbContiguousScale = fc
    .array(fc.integer({ min: 5, max: 40 }), { minLength: 2, maxLength: 6 })
    .map((widths) => {
      const bands: GradeBand[] = [];
      let cursor = 0n;
      widths.forEach((w, i) => {
        const upper = i === widths.length - 1 ? 10000n : cursor + BigInt(w * 100);
        if (upper > 10000n) return;
        bands.push({
          minMarks: cursor,
          maxMarks: upper,
          gradeLabel: `G${i}`,
          gradePoint: BigInt(widths.length - i),
        });
        cursor = upper;
      });
      return bands;
    })
    .filter((bands) => bands.length > 0 && bands[bands.length - 1]!.maxMarks === 10000n);

  it("every percentage 0-100 grades deterministically — boundaries go UP", () => {
    fc.assert(
      fc.property(arbContiguousScale, arbHundredths(0n, 10000n), (bands, pct) => {
        const got = gradeFor(pct, bands);
        expect(got).not.toBeNull();
        // Shared endpoints belong to the UPPER band: the winner is the
        // matching band with the highest floor, never input order.
        const winner = [...bands]
          .filter((b) => pct >= b.minMarks && pct <= b.maxMarks)
          .sort((a, b) => (a.minMarks > b.minMarks ? -1 : 1))[0]!;
        expect(got?.gradeLabel).toBe(winner.gradeLabel);
      }),
    );
  });

  it("a boundary value matches the upper band regardless of input order", () => {
    const bands: GradeBand[] = [
      { minMarks: 9000n, maxMarks: 10000n, gradeLabel: "A", gradePoint: 1000n },
      { minMarks: 8000n, maxMarks: 9000n, gradeLabel: "B", gradePoint: 900n },
      { minMarks: 0n, maxMarks: 8000n, gradeLabel: "C", gradePoint: 800n },
    ];
    expect(gradeFor(9000n, bands)?.gradeLabel).toBe("A");
    expect(gradeFor(9000n, [...bands].reverse())?.gradeLabel).toBe("A");
    expect(gradeFor(8999n, bands)?.gradeLabel).toBe("B");
  });
});

describe("exams property: aggregation invariants", () => {
  it("non-counted subjects never change the totals", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            subjectId: fc.uuid(),
            termScore: arbHundredths(0n, 10000n),
            maxScore: arbHundredths(1n, 10000n),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (subjects) => {
          const counted = subjects.map((s) => ({ ...s, countsTowardResult: true }));
          const withNoise = [
            ...counted,
            { subjectId: "noise00000000", termScore: 9999n, maxScore: 9999n, countsTowardResult: false },
          ];
          const a = termAggregate(counted);
          const b = termAggregate(withNoise);
          expect(b.totalMarks).toBe(a.totalMarks);
          expect(b.maxMarks).toBe(a.maxMarks);
          expect(b.percentage).toBe(a.percentage);
        },
      ),
    );
  });

  it("full marks everywhere ⇒ percentage 100; percentage equals total/max scaled", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            subjectId: fc.uuid(),
            maxScore: arbHundredths(1n, 10000n),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (subjects) => {
          const full = termAggregate(
            subjects.map((s) => ({
              ...s,
              termScore: s.maxScore,
              countsTowardResult: true,
            })),
          );
          expect(full.totalMarks).toBe(full.maxMarks);
          expect(full.percentage).toBe(10000n);
          expect(full.percentage).toBe(percentageOf(full.totalMarks, full.maxMarks));
        },
      ),
    );
  });

  it("the weighted annual is bounded by min/max term percentage", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            pctH: arbHundredths(0n, 10000n),
            weightH: arbHundredths(1n, 10000n),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (terms) => {
          const annual = annualWeighted(
            terms.map((t) => ({ percentage: t.pctH, weightage: t.weightH })),
          );
          const min = terms.reduce((m, t) => (t.pctH < m ? t.pctH : m), 10000n);
          const max = terms.reduce((m, t) => (t.pctH > m ? t.pctH : m), 0n);
          expect(annual).toBeGreaterThanOrEqual(min);
          expect(annual).toBeLessThanOrEqual(max);
        },
      ),
    );
  });

  it("the GPA is the plain average of the grade points (half-up)", () => {
    fc.assert(
      fc.property(
        fc.array(arbHundredths(0n, 1000n), { minLength: 1, maxLength: 10 }),
        (points) => {
          const gpa = gpaAggregate(points);
          const min = points.reduce((m, p) => (p < m ? p : m), 1000n);
          const max = points.reduce((m, p) => (p > m ? p : m), 0n);
          expect(gpa).toBeGreaterThanOrEqual(min);
          expect(gpa).toBeLessThanOrEqual(max);
          // The one exact case the property pins: equal points average to
          // themselves.
          const uniform = points.map(() => points[0]!);
          expect(gpaAggregate(uniform)).toBe(points[0]!);
          void gpa;
        },
      ),
    );
  });
});

describe("exams property: pass/fail and the exam-weighted subject score", () => {
  it("evaluatePass is exactly (final >= pass AND no mandatory failure)", () => {
    fc.assert(
      fc.property(
        arbHundredths(0n, 10000n),
        arbHundredths(0n, 10000n),
        fc.boolean(),
        (final, pass, mandatoryFailed) => {
          expect(evaluatePass({ finalMarks: final, passMark: pass, mandatoryComponentFailed: mandatoryFailed })).toBe(
            !mandatoryFailed && final >= pass,
          );
        },
      ),
    );
  });

  it("componentFailed is strict: a mark equal to the pass mark passes", () => {
    fc.assert(
      fc.property(
        arbHundredths(0n, 10000n),
        arbHundredths(0n, 10000n),
        (marks, pass) => {
          expect(componentFailed(marks, pass)).toBe(marks < pass);
          expect(componentFailed(null, pass)).toBe(false);
        },
      ),
    );
  });

  it("the exam-weighted subject score is 100 at full marks (renormalized)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            maxH: arbHundredths(1n, 20000n),
            weightH: arbHundredths(1n, 10000n),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (results) => {
          const score = examWeightedSubjectScore(
            results.map((r) => ({ marks: r.maxH, maxMarks: r.maxH, weightage: r.weightH })),
          );
          expect(score).toBe(10000n);
        },
      ),
    );
  });
});
