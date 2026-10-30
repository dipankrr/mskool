import {
  annualPassMark,
  annualScore,
  annualVerdict,
  computeRanks,
  fromHundredths,
  gpaAggregate,
  gradeFor,
  percentageOf,
  toHundredths,
  type AnnualPolicyShape,
  type AnnualVerdictRules,
  type GradeBand,
  type TermSubjectOutcome,
} from "./exams-maths";

/**
 * THE ANNUAL COMPUTE (ADR-053) - NO DATABASE. The service loads facts (the
 * roster, each student's term-subject outcomes, the governing policy and
 * rules) and hands them here; this returns the annual subject rows, the
 * student verdicts and the ranks. Deterministic and tested in isolation, so
 * a year's numbers never depend on how they were fetched.
 */

/** One student's outcome for one subject in one term (from `termSubjectScore`). */
export interface AnnualCellInput {
  outcome: TermSubjectOutcome;
  /** Graded-only subjects: the term's grade label. */
  grade: string | null;
}

export interface AnnualComputeInput {
  policy: AnnualPolicyShape;
  /**
   * A fixed bar an annual subject score must clear (hundredths of a percent),
   * or NULL: then the papers' own pass marks, weighted as the score is, decide.
   */
  passPercent: bigint | null;
  rules: AnnualVerdictRules;
  subjects: { subjectId: string; countsTowardResult: boolean; isGradedOnly: boolean }[];
  students: { studentId: string; sectionId: string | null }[];
  /** student -> subject -> term -> outcome. A missing entry means no paper. */
  cells: Map<string, Map<string, Map<string, AnnualCellInput>>>;
  scaleBands: GradeBand[] | null;
}

/** The audit trail stored in `student_final_subject_results.source_terms`. */
export interface SourceTermJson {
  termId: string;
  score: string | null;
  grade: string | null;
  nominalWeight: string | null;
  effectiveWeight: string;
  used: boolean;
}

export interface AnnualSubjectOut {
  studentId: string;
  subjectId: string;
  finalPercentage: string | null;
  grade: string | null;
  gradePoint: string | null;
  /** The bar this score was judged against; null for excused and graded-only subjects. */
  passMark: string | null;
  isPassed: boolean;
  isExempted: boolean;
  countsTowardResult: boolean;
  isGradedOnly: boolean;
  renormalized: boolean;
  sourceTerms: SourceTermJson[];
}

export interface AnnualStudentOut {
  studentId: string;
  sectionId: string | null;
  totalMarks: string | null;
  maxMarks: string | null;
  percentage: string | null;
  grade: string | null;
  gradePoint: string | null;
  isPassed: boolean;
  promotionStatus: "promoted" | "compartment" | "detained";
  failedSubjectIds: string[];
  compartmentSubjectIds: string[];
  renormalized: boolean;
  rankInSection: number | null;
  rankInClass: number | null;
}

export interface AnnualComputeOutput {
  subjects: AnnualSubjectOut[];
  students: AnnualStudentOut[];
}

export function computeAnnual(input: AnnualComputeInput): AnnualComputeOutput {
  const termOrder = [...input.policy.terms].sort((a, b) => a.sequence - b.sequence);
  const included = new Set(termOrder.map((t) => t.termId));
  const weightedPolicy = input.policy.method === "weighted";
  const subjectsOut: AnnualSubjectOut[] = [];
  const studentsOut: AnnualStudentOut[] = [];

  type Scratch = {
    studentId: string;
    sectionId: string | null;
    percentage: bigint | null;
    gradePoint: bigint | null;
    out: AnnualStudentOut;
  };
  const scratch: Scratch[] = [];

  for (const student of input.students) {
    const bySubject = input.cells.get(student.studentId);
    if (!bySubject) continue;

    const rows: AnnualSubjectOut[] = [];
    const gradedPoints: bigint[] = [];
    let anyRenormalized = false;

    for (const subject of input.subjects) {
      const byTerm = bySubject.get(subject.subjectId);
      if (!byTerm) continue;
      const cellsHere = termOrder
        .filter((t) => byTerm.has(t.termId) && included.has(t.termId))
        .map((t) => ({ term: t, cell: byTerm.get(t.termId)! }));
      if (cellsHere.length === 0) continue;

      const base = {
        studentId: student.studentId,
        subjectId: subject.subjectId,
        countsTowardResult: subject.countsTowardResult,
        isGradedOnly: subject.isGradedOnly,
      };
      const nominal = (weightage: bigint | null) =>
        weightedPolicy && weightage !== null ? fromHundredths(weightage) : null;

      // Excused in every term the student has: not scored, not failed.
      if (cellsHere.every((c) => c.cell.outcome.kind === "exempt")) {
        rows.push({
          ...base,
          finalPercentage: null,
          grade: null,
          gradePoint: null,
          passMark: null,
          isPassed: true,
          isExempted: true,
          renormalized: false,
          sourceTerms: termOrder.map((t) => ({
            termId: t.termId,
            score: null,
            grade: null,
            nominalWeight: nominal(t.weightage),
            effectiveWeight: "0.00",
            used: false,
          })),
        });
        continue;
      }

      if (subject.isGradedOnly) {
        // Never aggregated numerically: the year's grade is the latest
        // included term's, the per-term grades ride in the audit trail.
        const graded = cellsHere.filter((c) => c.cell.outcome.kind === "graded");
        if (graded.length === 0) continue;
        const withGrade = graded.filter((c) => c.cell.grade !== null);
        const latest = withGrade[withGrade.length - 1];
        const points = graded
          .filter((c) => c.cell.outcome.kind === "graded" && c.cell.outcome.gradePoint !== null)
          .map((c) => ({
            termId: c.term.termId,
            score: (c.cell.outcome as { kind: "graded"; gradePoint: bigint | null }).gradePoint!,
          }));
        const pick = points.length > 0 ? annualScore(points, input.policy) : null;
        if (pick) gradedPoints.push(pick.score);
        rows.push({
          ...base,
          finalPercentage: null,
          grade: latest?.cell.grade ?? null,
          gradePoint: pick ? fromHundredths(pick.score) : null,
          passMark: null,
          isPassed: true,
          isExempted: false,
          renormalized: false,
          sourceTerms: termOrder.map((t) => {
            const cell = byTerm.get(t.termId);
            return {
              termId: t.termId,
              score: null,
              grade: cell?.grade ?? null,
              nominalWeight: nominal(t.weightage),
              effectiveWeight: "0.00",
              used: latest?.term.termId === t.termId,
            };
          }),
        });
        continue;
      }

      const scored = cellsHere.flatMap((c) =>
        c.cell.outcome.kind === "scored" ? [{ termId: c.term.termId, score: c.cell.outcome.score }] : [],
      );
      const pick = annualScore(scored, input.policy);
      if (!pick) continue;
      const band = input.scaleBands ? gradeFor(pick.score, input.scaleBands) : null;
      if (pick.renormalized) anyRenormalized = true;
      // The bar: the policy's fixed percentage if it set one, else the pass
      // marks of the papers behind the terms that counted.
      const termBar = new Map(
        cellsHere.flatMap((c) =>
          c.cell.outcome.kind === "scored" ? [[c.term.termId, c.cell.outcome.passMark] as const] : [],
        ),
      );
      const bar =
        input.passPercent ??
        annualPassMark(
          pick.sources
            .filter((s) => s.used)
            .map((s) => ({ effectiveWeight: s.effectiveWeight, passMark: termBar.get(s.termId) ?? 0n })),
        );
      rows.push({
        ...base,
        finalPercentage: fromHundredths(pick.score),
        grade: band?.gradeLabel ?? null,
        gradePoint: band?.gradePoint != null ? fromHundredths(band.gradePoint) : null,
        passMark: fromHundredths(bar),
        isPassed: pick.score >= bar,
        isExempted: false,
        renormalized: pick.renormalized,
        sourceTerms: pick.sources.map((s) => ({
          termId: s.termId,
          score: s.score === null ? null : fromHundredths(s.score),
          grade:
            s.score !== null && input.scaleBands
              ? (gradeFor(s.score, input.scaleBands)?.gradeLabel ?? null)
              : null,
          nominalWeight: s.nominalWeight === null ? null : fromHundredths(s.nominalWeight),
          effectiveWeight: fromHundredths(s.effectiveWeight),
          used: s.used,
        })),
      });
    }

    const verdict = annualVerdict(
      rows.map((r) => ({
        subjectId: r.subjectId,
        kind: r.isExempted ? "exempt" : r.isGradedOnly ? "graded" : "scored",
        countsTowardResult: r.countsTowardResult,
        isPassed: r.isPassed,
      })),
      input.rules,
    );
    // A verdict nobody can compute is not fabricated: no counted subject, no row.
    if (!verdict) continue;

    // Totals over COUNTED, scored subjects; a GPA-branch class has no marks.
    const countedScored = rows.filter((r) => r.countsTowardResult && r.finalPercentage !== null && !r.isExempted);
    let totalMarks: string | null = null;
    let maxMarks: string | null = null;
    let percentage: bigint | null = null;
    let gradePoint: bigint | null = null;
    if (!verdict.gpaBranch && countedScored.length > 0) {
      const total = countedScored.reduce((acc, r) => acc + toHundredths(r.finalPercentage!), 0n);
      const max = BigInt(countedScored.length) * 10000n;
      percentage = percentageOf(total, max);
      totalMarks = fromHundredths(total);
      maxMarks = fromHundredths(max);
    } else if (verdict.gpaBranch && gradedPoints.length > 0) {
      gradePoint = gpaAggregate(gradedPoints);
    }
    const band = percentage !== null && input.scaleBands ? gradeFor(percentage, input.scaleBands) : null;

    const out: AnnualStudentOut = {
      studentId: student.studentId,
      sectionId: student.sectionId,
      totalMarks,
      maxMarks,
      percentage: percentage === null ? null : fromHundredths(percentage),
      grade: band?.gradeLabel ?? null,
      gradePoint:
        gradePoint !== null
          ? fromHundredths(gradePoint)
          : band?.gradePoint != null
            ? fromHundredths(band.gradePoint)
            : null,
      isPassed: verdict.isPassed,
      promotionStatus: verdict.promotionStatus,
      failedSubjectIds: verdict.failedSubjectIds,
      compartmentSubjectIds: verdict.promotionStatus === "compartment" ? verdict.failedSubjectIds : [],
      renormalized: anyRenormalized,
      rankInSection: null,
      rankInClass: null,
    };
    subjectsOut.push(...rows);
    studentsOut.push(out);
    scratch.push({ studentId: student.studentId, sectionId: student.sectionId, percentage, gradePoint, out });
  }

  // Ranks inside the same pass (ADR-053 §8): competition ranking, per class
  // and per section; GPA classes rank by grade point; ties share.
  const ranked = scratch.flatMap((s) => {
    const score = s.percentage ?? s.gradePoint;
    return score === null ? [] : [{ id: s.studentId, score, sectionId: s.sectionId }];
  });
  const classRanks = computeRanks(ranked.map(({ id, score }) => ({ id, score })));
  const bySection = new Map<string, { id: string; score: bigint }[]>();
  for (const r of ranked) {
    if (!r.sectionId) continue;
    const list = bySection.get(r.sectionId) ?? [];
    list.push({ id: r.id, score: r.score });
    bySection.set(r.sectionId, list);
  }
  const sectionRanks = new Map<string, number>();
  for (const entries of bySection.values()) {
    for (const [id, rank] of computeRanks(entries)) sectionRanks.set(id, rank);
  }
  for (const s of scratch) {
    s.out.rankInClass = classRanks.get(s.studentId) ?? null;
    s.out.rankInSection = sectionRanks.get(s.studentId) ?? null;
  }

  return { subjects: subjectsOut, students: studentsOut };
}

/**
 * The `sum` display: Σ the used term scores over 100 per used term. Computed
 * where it is shown, from the audit trail - no column holds it.
 */
export function sumDisplay(sources: { score: string | null; used: boolean }[]): {
  marks: string;
  max: string;
} | null {
  const used = sources.filter((s) => s.used && s.score !== null);
  if (used.length === 0) return null;
  const marks = used.reduce((acc, s) => acc + toHundredths(s.score!), 0n);
  return { marks: fromHundredths(marks), max: fromHundredths(BigInt(used.length) * 10000n) };
}
