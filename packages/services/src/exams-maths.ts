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
  /** Medical/board exemption — the student never sat this component. */
  exempted?: boolean;
}

/**
 * The weighted rollup: contribution_i = marks_i / max_i × weight_i, summed.
 * The subject's max on this scale is Σ weight_i (= 100 when the blueprint
 * validates, but the function renormalizes defensively). Absent components
 * contribute ZERO — absence is not zero, it IS zero's effect here while
 * `isAbsent` rides alongside for display. Exempt components ALSO score
 * zero's effect UNLESS `renormalizeExempt` is set — then they leave the
 * denominator entirely (never sat means never counted). The flag is school
 * policy (`pass_criteria.exempt_renormalizes`, default off for history).
 */
export function weightedComponentRollup(
  components: ComponentScoreInput[],
  opts?: { renormalizeExempt?: boolean },
): bigint {
  let total = 0n;
  let weightSum = 0n;
  for (const c of components) {
    if (opts?.renormalizeExempt && c.exempted) continue;
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
export function componentFailed(
  marks: bigint | null,
  passMark: bigint,
  opts?: { absent?: boolean; absentFails?: boolean },
): boolean {
  // No mark: an explicitly absent (not exempted) mandatory paper fails when
  // the school says so (`pass_criteria.absent_mandatory_fails`, default on).
  // Exempted papers never fail here — exemption excuses, it does not accuse.
  if (marks === null) return opts?.absent === true && opts?.absentFails === true;
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
 * The band containing `percentageHundredths`. Bands are contiguous with
 * SHARED endpoints (scale creation enforces it), so a boundary value sits
 * in two bands — the UPPER one wins ("90 and above" reads as A), decided
 * by descending floor order, never by input order. Returns null outside
 * every band; a covered percentage always lands in exactly one.
 */
export function gradeFor(
  percentageHundredths: bigint,
  bands: GradeBand[],
): { gradeLabel: string; gradePoint: bigint | null } | null {
  const ordered = [...bands].sort((a, b) =>
    a.minMarks !== b.minMarks ? (a.minMarks > b.minMarks ? -1 : 1) : 0,
  );
  for (const band of ordered) {
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

/**
 * The weighted mean of same-scale values (grade points across a term's
 * exams): Σ(valueᵢ × weightᵢ) / Σ(weightᵢ), half-up. Missing votes never
 * reach here — the caller filters them, so absence cannot drag the mean.
 */
export function weightedAverage(entries: { value: bigint; weightage: bigint }[]): bigint {
  let total = 0n;
  let weightSum = 0n;
  for (const e of entries) {
    weightSum += e.weightage;
    total += e.value * e.weightage;
  }
  if (weightSum === 0n) return 0n;
  return mulDivHalfUp(total, 1n, weightSum);
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

// ---------------------------------------------------------------------------
// Schedule partition — per-section papers (ADR-052)
// ---------------------------------------------------------------------------

export interface SchedulePartitionRow {
  classId: string;
  subjectId: string;
  /** Missing, null, and undefined all mean the class-wide paper. */
  sectionId?: string | null;
}

export type SchedulePartitionViolation =
  | { classId: string; subjectId: string; kind: "mixed_class_wide_and_section" }
  | { classId: string; subjectId: string; kind: "duplicate_section" };

/**
 * For one (class, subject), an exam's papers are either exactly ONE
 * class-wide row (sectionId null) or section rows with distinct sections —
 * never both, never a section twice (ADR-052). Anything else is ambiguous:
 * compute could not tell which paper a student sat, and picking one
 * arbitrarily zeroes out the section whose marks live elsewhere. The
 * blueprint save refuses these shapes; compute re-checks defensively
 * (rows can predate the validator).
 */
export function findSchedulePartitionViolations(
  allRows: SchedulePartitionRow[],
): SchedulePartitionViolation[] {
  // undefined and null sectionId are the same class-wide shape; normalize
  // before grouping so neither bucket misfiles the other.
  const rows = allRows.map((r) => ({ ...r, sectionId: r.sectionId ?? null }));
  const byPaper = new Map<string, { classId: string; subjectId: string; rows: SchedulePartitionRow[] }>();
  for (const row of rows) {
    const key = `${row.classId}|${row.subjectId}`;
    const group = byPaper.get(key) ?? { classId: row.classId, subjectId: row.subjectId, rows: [] };
    group.rows.push(row);
    byPaper.set(key, group);
  }
  const violations: SchedulePartitionViolation[] = [];
  for (const group of byPaper.values()) {
    const classWide = group.rows.filter((r) => r.sectionId === null);
    const sectioned = group.rows.filter((r) => r.sectionId !== null);
    if (classWide.length > 0 && sectioned.length > 0) {
      violations.push({
        classId: group.classId,
        subjectId: group.subjectId,
        kind: "mixed_class_wide_and_section",
      });
      continue;
    }
    const sectionIds = new Set(sectioned.map((r) => r.sectionId));
    if (sectionIds.size !== sectioned.length) {
      violations.push({
        classId: group.classId,
        subjectId: group.subjectId,
        kind: "duplicate_section",
      });
    }
  }
  return violations;
}

/** One shared wording for the refusal — the blueprint save and the compute
 * defense must say the same thing about the same broken shape. */
export function describeSchedulePartitionViolations(
  violations: SchedulePartitionViolation[],
  subjectName: (subjectId: string) => string,
): string {
  return violations
    .map((v) =>
      v.kind === "mixed_class_wide_and_section"
        ? `${subjectName(v.subjectId)} has both a class-wide paper and per-section papers`
        : `${subjectName(v.subjectId)} has two papers for the same section`,
    )
    .join("; ");
}

// ---------------------------------------------------------------------------
// Term subject score - the ONE derivation (ADR-053 §4)
// ---------------------------------------------------------------------------

/**
 * One counting exam's vote for a subject: a `student_subject_results` row and
 * its exam's weight inside the term.
 */
export interface TermSubjectVote {
  /** Exam-grain final marks on the 0-100 scale (hundredths); null when none. */
  marks: bigint | null;
  /** `exams.weightage_in_term` (hundredths of a percent). */
  weightage: bigint;
  isPassed: boolean;
  /** The paper's own pass mark on the same 0-100 scale as `marks` (hundredths). */
  passMark: bigint;
  /** The paper was excused ENTIRELY (every component exempt, ADR-053 §7). */
  isExempted: boolean;
  gradePoint: bigint | null;
}

export type TermSubjectOutcome =
  | {
      kind: "scored";
      score: bigint;
      isPassed: boolean;
      /** The papers' own pass marks, weighted exactly as the score is. */
      passMark: bigint;
      gradePoint: bigint | null;
    }
  | { kind: "graded"; gradePoint: bigint | null }
  | { kind: "exempt" };

/**
 * One subject's TERM outcome across the term's counting exams - the single
 * place it is derived (term compute, the term card and the annual engine all
 * call this; a bare score cannot reproduce the term pass).
 *
 * Exams the student was excused from drop out of the weighting (the weights
 * renormalize over the papers sat, as ADR-052 does for whole papers); a
 * subject excused in EVERY exam is `exempt` - not scored, not failed. A term
 * subject passes when every exam it sat passed (there is no term-level pass
 * mark). Graded-only subjects never score or fail; their grade point is the
 * exam-weighted mean of the points that exist. Absent marks arrive as 0 (the
 * exam row already carries the absence; zero is its effect).
 *
 * Callers pass at least one vote: "no votes" means "no paper", which is not
 * this function's question.
 */
export function termSubjectScore(
  votes: TermSubjectVote[],
  opts: { isGradedOnly: boolean },
): TermSubjectOutcome {
  const sat = votes.filter((v) => !v.isExempted);
  if (sat.length === 0) return { kind: "exempt" };
  const withPoint = sat.filter((v) => v.gradePoint !== null);
  const gradePoint =
    withPoint.length > 0
      ? weightedAverage(withPoint.map((v) => ({ value: v.gradePoint!, weightage: v.weightage })))
      : null;
  if (opts.isGradedOnly) return { kind: "graded", gradePoint };
  const score = examWeightedSubjectScore(
    sat.map((v) => ({ marks: v.marks ?? 0n, maxMarks: 10000n, weightage: v.weightage })),
  );
  const passMark = weightedAverage(sat.map((v) => ({ value: v.passMark, weightage: v.weightage })));
  return { kind: "scored", score, isPassed: sat.every((v) => v.isPassed), passMark, gradePoint };
}

// ---------------------------------------------------------------------------
// The annual engines - weighted, single term, best N (ADR-053 §2, §5)
// ---------------------------------------------------------------------------

export type AnnualMethod = "weighted" | "single_term" | "best_n";

export interface AnnualPolicyTerm {
  termId: string;
  /** The term's `sequence_number` - orders ties and the display. */
  sequence: number;
  /** Hundredths of a percent; only the weighted method reads it. */
  weightage: bigint | null;
}

export interface AnnualPolicyShape {
  method: AnnualMethod;
  /** Required for `best_n`; null means every included term. */
  bestN: number | null;
  terms: AnnualPolicyTerm[];
}

/** A student's score for one subject in one term (a percentage, or a grade point). */
export interface AnnualTermCell {
  termId: string;
  score: bigint;
}

export interface AnnualSourceTerm {
  termId: string;
  /** The term's score for this subject; null when the student has none (no paper). */
  score: bigint | null;
  /** The policy's configured weight; null off the weighted method. */
  nominalWeight: bigint | null;
  /** What the term contributed after renormalization (hundredths of a percent). */
  effectiveWeight: bigint;
  used: boolean;
}

export interface AnnualPick {
  score: bigint;
  /** One entry per included term, in term order - the audit trail. */
  sources: AnnualSourceTerm[];
  /** Counted from fewer terms than the policy selects. */
  renormalized: boolean;
  usedCount: number;
}

/**
 * The annual score of one subject from the terms the student actually has.
 * Every method divides by what it was GIVEN and rounds half-up ONCE at the
 * end (no per-term rounding). Null when no included term has a score for
 * the student - there is no annual result to fabricate.
 */
export function annualScore(
  cells: AnnualTermCell[],
  policy: AnnualPolicyShape,
): AnnualPick | null {
  const cellOf = new Map(cells.map((c) => [c.termId, c.score]));
  const ordered = [...policy.terms].sort((a, b) => a.sequence - b.sequence);
  const present = ordered.filter((t) => cellOf.has(t.termId));
  if (present.length === 0) return null;

  const source = (t: AnnualPolicyTerm, used: boolean, effective: bigint): AnnualSourceTerm => ({
    termId: t.termId,
    score: cellOf.get(t.termId) ?? null,
    nominalWeight: policy.method === "weighted" ? t.weightage : null,
    effectiveWeight: used ? effective : 0n,
    used,
  });

  if (policy.method === "single_term") {
    const only = ordered[0];
    if (!only || !cellOf.has(only.termId)) return null;
    return {
      score: cellOf.get(only.termId)!,
      sources: [source(only, true, 10000n)],
      renormalized: false,
      usedCount: 1,
    };
  }

  if (policy.method === "weighted") {
    const weightSum = present.reduce((acc, t) => acc + (t.weightage ?? 0n), 0n);
    if (weightSum === 0n) return null;
    const score = annualWeighted(
      present.map((t) => ({ percentage: cellOf.get(t.termId)!, weightage: t.weightage ?? 0n })),
    );
    return {
      score,
      sources: ordered.map((t) => {
        const isPresent = cellOf.has(t.termId);
        return source(t, isPresent, isPresent ? mulDivHalfUp(t.weightage ?? 0n, 10000n, weightSum) : 0n);
      }),
      renormalized: present.length < ordered.length,
      usedCount: present.length,
    };
  }

  // best_n: the N highest, ties broken by term order; fewer than N available
  // averages the available.
  const wanted = Math.min(policy.bestN ?? ordered.length, ordered.length);
  const take = Math.min(wanted, present.length);
  const ranked = [...present].sort((a, b) => {
    const sa = cellOf.get(a.termId)!;
    const sb = cellOf.get(b.termId)!;
    if (sa !== sb) return sa > sb ? -1 : 1;
    return a.sequence - b.sequence;
  });
  const picked = new Set(ranked.slice(0, take).map((t) => t.termId));
  let sum = 0n;
  for (const id of picked) sum += cellOf.get(id)!;
  const each = mulDivHalfUp(10000n, 1n, BigInt(take));
  return {
    score: mulDivHalfUp(sum, 1n, BigInt(take)),
    sources: ordered.map((t) => source(t, picked.has(t.termId), each)),
    renormalized: present.length < wanted,
    usedCount: take,
  };
}

/**
 * The year's pass mark for a subject when the policy sets none: the pass
 * marks of the terms that COUNTED, weighted exactly as the score was (each
 * term's effective weight). A paper with a pass mark of 40 in Term 3 and 33
 * in Term 1, weighted 70/30, makes a year bar of 37.90 - so the year is judged
 * by the very standard the school already set on its papers, not by a second
 * number someone has to keep in step.
 */
export function annualPassMark(
  used: { effectiveWeight: bigint; passMark: bigint }[],
): bigint {
  let num = 0n;
  let den = 0n;
  for (const u of used) {
    num += u.passMark * u.effectiveWeight;
    den += u.effectiveWeight;
  }
  return den === 0n ? 0n : mulDivHalfUp(num, 1n, den);
}

// ---------------------------------------------------------------------------
// The annual verdict (ADR-053 §6)
// ---------------------------------------------------------------------------

export interface AnnualVerdictSubject {
  subjectId: string;
  /** `exempt` subjects are excused: never counted, never failed. */
  kind: "scored" | "graded" | "exempt";
  countsTowardResult: boolean;
  isPassed: boolean;
}

export interface AnnualVerdictRules {
  /** Null = every counted subject must pass. */
  minSubjectsToPass: number | null;
  mandatoryPassSubjectIds: string[];
  compartmentAllowed: boolean;
  maxSubjectsForCompartment: number | null;
}

export interface AnnualVerdict {
  isPassed: boolean;
  failedSubjectIds: string[];
  promotionStatus: "promoted" | "compartment" | "detained";
  /** Every counted subject is graded-only: no marks to fail. */
  gpaBranch: boolean;
  countedSubjects: number;
}

/**
 * Same shape as the term result: must-pass subjects, a minimum number of
 * passed subjects (null = all), then promoted / compartment (allowed and the
 * failed subjects fit the cap) / detained. A GPA-branch class has nothing to
 * fail on marks and is promoted. Null when nothing counts - a verdict nobody
 * can compute is not fabricated.
 */
export function annualVerdict(
  subjects: AnnualVerdictSubject[],
  rules: AnnualVerdictRules,
): AnnualVerdict | null {
  const counted = subjects.filter((s) => s.countsTowardResult && s.kind !== "exempt");
  if (counted.length === 0) return null;
  const gpaBranch = counted.every((s) => s.kind === "graded");
  if (gpaBranch) {
    return {
      isPassed: true,
      failedSubjectIds: [],
      promotionStatus: "promoted",
      gpaBranch: true,
      countedSubjects: counted.length,
    };
  }
  const failed = counted.filter((s) => !s.isPassed).map((s) => s.subjectId);
  const passedCount = counted.length - failed.length;
  const mustPassFailed = rules.mandatoryPassSubjectIds.some((id) => failed.includes(id));
  const needed = rules.minSubjectsToPass ?? counted.length;
  const isPassed = !mustPassFailed && passedCount >= needed;
  const promotionStatus = isPassed
    ? "promoted"
    : rules.compartmentAllowed &&
        failed.length >= 1 &&
        failed.length <= (rules.maxSubjectsForCompartment ?? 0)
      ? "compartment"
      : "detained";
  return {
    isPassed,
    failedSubjectIds: failed,
    promotionStatus,
    gpaBranch: false,
    countedSubjects: counted.length,
  };
}

// ---------------------------------------------------------------------------
// The policy in words (ADR-053 §1) - one wording for the card and the screens
// ---------------------------------------------------------------------------

export function annualPolicySummary(input: {
  method: AnnualMethod;
  bestN: number | null;
  totalDisplay: "average" | "sum";
  terms: { name: string; weightage: bigint | null; sequence: number }[];
  /** NULL = the papers' own pass marks decide (the default). */
  annualSubjectPassPercent: bigint | null;
}): string {
  const terms = [...input.terms].sort((a, b) => a.sequence - b.sequence);
  const pass =
    input.annualSubjectPassPercent === null
      ? "papers' own pass marks"
      : `subject pass ${fromHundredths(input.annualSubjectPassPercent).replace(/\.00$/, "")}%`;
  let how: string;
  if (input.method === "weighted") {
    how = `Weighted: ${terms
      .map((t) => `${t.name} ${fromHundredths(t.weightage ?? 0n).replace(/\.00$/, "")}%`)
      .join(" · ")}`;
  } else if (input.method === "single_term") {
    how = `${terms[0]?.name ?? "One term"} only`;
  } else if (input.bestN !== null && input.bestN < terms.length) {
    how = `Best ${input.bestN} of ${terms.length} terms`;
  } else {
    how = `${input.totalDisplay === "sum" ? "Sum" : "Average"} of ${terms.length} term${terms.length === 1 ? "" : "s"}`;
  }
  return `${how} · ${pass}`;
}
