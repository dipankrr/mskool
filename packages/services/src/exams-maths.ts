/**
 * EXAMS — the pure result maths. NO DATABASE IMPORTS.
 *
 * Same discipline as fees-maths: `pnpm test` must run hermetically, so
 * every function here is deterministic — decimal strings in, BigInt
 * hundredths out. Marks are `numeric(6,2)` in the DB; the code unit is the
 * HUNDREDTH (1/100th of a mark), BigInt end to end. No float ever touches a
 * mark (hard rule 4's cousin).
 *
 * Rounding (ADR-032 §10): full precision between steps (BigInt hundredths
 * with exact multiplication), and HALF-UP (away from zero) only when a
 * division forces a scale change — i.e., at the boundaries where a value is
 * stored. This keeps printed component contributions summing to the
 * printed total to within the last hundredth, which the property tests
 * pin.
 *
 * The service wrappers that load facts and call these live in
 * exam-results.service.ts (B4c). THE RESOLVER SEAM (ADR-032 §12) sits
 * there too: this module never decides WHICH subjects a student takes.
 */

// ---------------------------------------------------------------------------
// Mark helpers — BigInt hundredths, never float
// ---------------------------------------------------------------------------

/** "62.5" → 6250n. Accepts a leading minus (negative marking). */
export function toHundredths(marks: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(marks)) {
    throw new Error(`Invalid mark: "${marks}".`);
  }
  const sign = marks.startsWith("-") ? -1n : 1n;
  const digits = marks.replace("-", "");
  const [whole, frac = ""] = digits.split(".");
  return sign * (BigInt(whole ?? "0") * 100n + BigInt((frac + "00").slice(0, 2)));
}

/** 6250n → "62.50". */
export function fromHundredths(hundredths: bigint): string {
  const sign = hundredths < 0n ? "-" : "";
  const abs = hundredths < 0n ? -hundredths : hundredths;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${sign}${whole}.${frac.toString().padStart(2, "0")}`;
}

/**
 * a × b / d with HALF-UP (away from zero) rounding — the only place scale
 * changes happen, so the rounding policy lives in exactly one function.
 */
export function mulDivHalfUp(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("Division by zero in marks maths.");
  const product = a * b;
  const sign = product < 0n ? -1n : 1n;
  const abs = product < 0n ? -product : product;
  // floor((abs*2 + d) / (2d)) is floor(abs/d + 0.5) — half-up on |value|.
  return sign * ((abs * 2n + d) / (2n * d));
}

/** Percentage of a total, in hundredths of a percent (88.33% → 8833n). */
export function percentageOf(total: bigint, max: bigint): bigint {
  if (max === 0n) throw new Error("Percentage of a zero maximum.");
  return mulDivHalfUp(total, 10000n, max);
}

// ---------------------------------------------------------------------------
// Component → subject: the weighted rollup (one exam, one student)
// ---------------------------------------------------------------------------

export interface ComponentScoreInput {
  /** The student's mark on the component's own scale (hundredths); null when absent/exempt. */
  marks: bigint | null;
  /** The component's max marks (hundredths, on its own scale). */
  maxMarks: bigint;
  /** The component's weightage percentage (hundredths: 80% → 8000n). */
  weightagePercentage: bigint;
}

/**
 * The weighted rollup: contribution_i = marks_i / max_i × weight_i, summed.
 * The subject's max on this scale is Σ weight_i (= 100 when the blueprint
 * validates, but the function renormalizes defensively). Absent/exempt
 * components contribute ZERO — absence is not zero, it IS zero's effect
 * here while `isAbsent` rides alongside for display.
 */
export function weightedComponentRollup(components: ComponentScoreInput[]): bigint {
  let total = 0n;
  let weightSum = 0n;
  for (const c of components) {
    weightSum += c.weightagePercentage;
    if (c.marks === null || c.maxMarks === 0n) continue;
    // contribution (marks-hundredths) = marks × weight% / max. Units:
    // marks [hundredths] × weight [hundredths-of-%] / max [hundredths].
    total += mulDivHalfUp(c.marks, c.weightagePercentage, c.maxMarks);
  }
  if (weightSum === 10000n) return total;
  // Defensive renormalization (blueprint validation should make this a no-op).
  if (weightSum === 0n) return 0n;
  return mulDivHalfUp(total, 10000n, weightSum);
}

/**
 * The DEFAULT subject-level pass mark on the weighted scale:
 * Σ (pass_i / max_i × weight_i). In the canonical CBSE shape (weight_i =
 * max_i's share of 100) this equals the raw sum of component pass marks,
 * which is why "sum of component passes" is the school-facing description.
 * A school may override it on the schedule (the "≥50/100 total" rule).
 */
export function weightedDefaultPassMark(components: ComponentScoreInput[]): bigint {
  let total = 0n;
  let weightSum = 0n;
  for (const c of components) {
    weightSum += c.weightagePercentage;
    if (c.maxMarks === 0n) continue;
    // The caller passes the component's PASS MARK in `marks` for this shape.
    if (c.marks === null) continue;
    total += mulDivHalfUp(c.marks, c.weightagePercentage, c.maxMarks);
  }
  if (weightSum === 0n || weightSum === 10000n) return total;
  return mulDivHalfUp(total, 10000n, weightSum);
}

// ---------------------------------------------------------------------------
// Pass/fail evaluation
// ---------------------------------------------------------------------------

export interface PassEvaluationInput {
  finalMarks: bigint;
  passMark: bigint;
  /** True when any `isMandatoryPass` component failed on its own scale. */
  mandatoryComponentFailed: boolean;
}

/** A subject passes when the total clears the pass mark AND no mandatory component failed. */
export function evaluatePass(input: PassEvaluationInput): boolean {
  return !input.mandatoryComponentFailed && input.finalMarks >= input.passMark;
}

/** A component fails its own scale when the mark is below its pass mark. */
export function componentFailed(marks: bigint | null, passMark: bigint): boolean {
  if (marks === null) return false; // absent/exempt is handled elsewhere
  return marks < passMark;
}

// ---------------------------------------------------------------------------
// Grace — the rescue maths (ADR-032 §10 order is binding)
// ---------------------------------------------------------------------------

export interface GraceCandidate {
  subjectId: string;
  finalMarks: bigint;
  passMark: bigint;
  /** `mandatory_pass_subject_ids` — rescued first. */
  isMustPass: boolean;
}

export interface GraceCaps {
  perSubject: bigint;
  total: bigint;
}

/**
 * Allocates grace marks to failing subjects. Binding order: MUST-PASS
 * subjects first, then the LARGEST DEFICIT; each rescue is
 * min(deficit, perSubjectCap, remainingTotal) — grace never overshoots the
 * pass line, and the total cap binds across subjects. Different orders
 * produce different pass/fail outcomes, which is why this is pinned here
 * and nowhere else.
 */
export function applyGrace(
  candidates: GraceCandidate[],
  caps: GraceCaps,
): Map<string, bigint> {
  const allocations = new Map<string, bigint>();
  let remaining = caps.total;
  const failing = candidates
    .filter((c) => c.finalMarks < c.passMark)
    .sort((a, b) => {
      if (a.isMustPass !== b.isMustPass) return a.isMustPass ? -1 : 1;
      const deficitA = a.passMark - a.finalMarks;
      const deficitB = b.passMark - b.finalMarks;
      if (deficitA !== deficitB) return deficitA > deficitB ? -1 : 1;
      return a.subjectId < b.subjectId ? -1 : 1;
    });
  for (const c of failing) {
    if (remaining <= 0n) break;
    const deficit = c.passMark - c.finalMarks;
    const grant = deficit < caps.perSubject ? deficit : caps.perSubject;
    const actual = grant < remaining ? grant : remaining;
    if (actual > 0n) {
      allocations.set(c.subjectId, actual);
      remaining -= actual;
    }
  }
  return allocations;
}

// ---------------------------------------------------------------------------
// Grades — percentage → band (contiguous 0-100, scale-creation validated)
// ---------------------------------------------------------------------------

export interface GradeBand {
  minMarks: bigint; // percentage hundredths
  maxMarks: bigint;
  gradeLabel: string;
  gradePoint: bigint | null; // hundredths
}

/**
 * The band containing `percentageHundredths` (inclusive both ends — the
 * school convention). Returns null when the percentage falls outside every
 * band; scale creation validates contiguity 0-100 so a covered percentage
 * always lands in exactly one.
 */
export function gradeFor(
  percentageHundredths: bigint,
  bands: GradeBand[],
): { gradeLabel: string; gradePoint: bigint | null } | null {
  for (const band of bands) {
    if (percentageHundredths >= band.minMarks && percentageHundredths <= band.maxMarks) {
      return { gradeLabel: band.gradeLabel, gradePoint: band.gradePoint };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aggregation — term, annual, GPA
// ---------------------------------------------------------------------------

export interface TermSubjectScore {
  subjectId: string;
  /** The subject's term score on its own max scale (hundredths). */
  termScore: bigint;
  maxScore: bigint;
  countsTowardResult: boolean;
}

/**
 * Totals over COUNTED subjects only (the type flag decides — ADR-031/032);
 * percentage from the stored totals, per the rounding policy.
 */
export function termAggregate(subjects: TermSubjectScore[]): {
  totalMarks: bigint;
  maxMarks: bigint;
  percentage: bigint;
} {
  let total = 0n;
  let max = 0n;
  for (const s of subjects) {
    if (!s.countsTowardResult) continue;
    total += s.termScore;
    max += s.maxScore;
  }
  return {
    totalMarks: total,
    maxMarks: max,
    percentage: max === 0n ? 0n : percentageOf(total, max),
  };
}

/**
 * One subject's TERM score across a term's exams: Σ(marks_i/max_i × w_i)
 * renormalized over the exams PROVIDED. Strict coverage (ADR-032 §4) means
 * v1 always provides every counting exam; the renormalization keeps the
 * maths honest if a future relaxer feeds a subset.
 */
export function examWeightedSubjectScore(
  examResults: { marks: bigint | null; maxMarks: bigint; weightage: bigint }[],
): bigint {
  let total = 0n;
  let weightSum = 0n;
  for (const r of examResults) {
    weightSum += r.weightage;
    if (r.marks === null || r.maxMarks === 0n) continue;
    total += mulDivHalfUp(r.marks, r.weightage, r.maxMarks);
  }
  if (weightSum === 0n) return 0n;
  if (weightSum === 10000n) return total;
  return mulDivHalfUp(total, 10000n, weightSum);
}

/**
 * The annual percentage. `weighted`: Σ(pct_i × w_i) renormalized over the
 * terms provided (the service validates the weights sum to 100).
 * `last_term`: the caller passes ONLY the final term's row.
 */
export function annualWeighted(terms: { percentage: bigint; weightage: bigint }[]): bigint {
  let weightedSum = 0n;
  let weightSum = 0n;
  for (const t of terms) {
    weightSum += t.weightage;
    // EXACT accumulation — no per-term rounding. Σ(pct_i × w_i / w_i_sum)
    // rounds ONCE at the end; rounding per term then averaging can inflate
    // a two-equal-terms average by a hundredth (9999,9999 → 5000+5000).
    weightedSum += t.percentage * t.weightage;
  }
  if (weightSum === 0n) return 0n;
  return mulDivHalfUp(weightedSum, 1n, weightSum);
}

/**
 * The GPA branch (ADR-032 §3): every counted subject is graded-only, so the
 * aggregate is the plain average of grade points (equal weights — v1 has no
 * credits). Hundredths, half-up.
 */
export function gpaAggregate(gradePoints: bigint[]): bigint {
  if (gradePoints.length === 0) return 0n;
  let sum = 0n;
  for (const gp of gradePoints) sum += gp;
  return mulDivHalfUp(sum, 1n, BigInt(gradePoints.length));
}

// ---------------------------------------------------------------------------
// Ranks — competition ranking, computed explicitly, ties share
// ---------------------------------------------------------------------------

/**
 * Competition ranking (1,2,2,4): ties share the better rank and the next
 * rank skips. Ordering is by score DESC; equal scores are indistinguishable
 * by design (no arbitrary tie-break in the DATA — display may sort by name).
 */
export function computeRanks(
  entries: { id: string; score: bigint }[],
): Map<string, number> {
  const sorted = [...entries].sort((a, b) => {
    if (a.score !== b.score) return a.score > b.score ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  const ranks = new Map<string, number>();
  let position = 0;
  let currentRank = 0;
  let previousScore: bigint | null = null;
  for (const entry of sorted) {
    position += 1;
    if (previousScore === null || entry.score !== previousScore) {
      currentRank = position;
    }
    ranks.set(entry.id, currentRank);
    previousScore = entry.score;
  }
  return ranks;
}
