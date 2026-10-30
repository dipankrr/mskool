import { requireSchoolId } from "./academic.service";
import { scopeWhere, type DataScope } from "@repo/authz";
import type { SubmitRevisionInput } from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  authzAuditLog,
  attendanceSummary,
  classes,
  classSubjectMappings,
  examClassPublication,
  examComponents,
  examSubjectSchedules,
  exams,
  gradingScaleBands,
  gradingScales,
  passCriteria,
  publishedReportCards,
  reportCardTemplates,
  schools,
  studentComponentResultRevisions,
  studentComponentResults,
  studentEnrollments,
  studentSubjectResults,
  studentTermResults,
  subjectTypes,
  termAssessments,
  terms,
  sections,
  subjects,
  students as studentsTable,
} from "@repo/db/schema";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  loadCohort,
  loadDefaultScale,
  loadPassCriteria,
  loadSubjectSet,
  resolvePapers,
} from "./exam-shared";
import {
  applyGrace,
  evaluatePass,
  componentFailed,
  computeRanks,
  describeSchedulePartitionViolations,
  findSchedulePartitionViolations,
  fromHundredths,
  gpaAggregate,
  gradeFor,
  mulDivHalfUp,
  percentageOf,
  termAggregate,
  termSubjectScore,
  toHundredths,
  weightedComponentRollup,
} from "./exams-maths";

/**
 * EXAM RESULTS — B4c: the compute orchestration, ranks, publication, the
 * revision windows, and the published-card reads (ADR-032).
 *
 * This service is the ONLY writer of the computed chain and the ONLY writer
 * of `published_report_cards`. The maths lives in exams-maths (pure,
 * property-tested); this file loads facts, snapshots them, and enforces the
 * workflow: compute (idempotent) -> ranks (explicit) -> publish per class
 * (frozen photographs, hard rule 8) -> corrections through revision windows
 * (hard rule 7).
 *
 * THE RESOLVER SEAM (ADR-032 §12, amended by ADR-052): the subject set comes
 * from `resolveSubjectSet` — all counted exam-mode mappings of the class —
 * and each (student, subject) resolves to the PAPER whose cohort holds the
 * student: the section paper they sit, or the class-wide one. A student no
 * paper covers is not computed at all. When `student_subject_enrollments`
 * lands, only resolveSubjectSet changes.
 *
 * PUBLISHED ROWS GET REFRESHED, not rewritten — and only inside the
 * ledger-owning flows: `computeClassResults` refuses published/locked exams
 * unless called with `{ allowPublished: true }`, which only the window close
 * and the revision apply pass (both re-version every card they move; the
 * card carries the frozen truth). Ad-hoc `results.compute` on a published
 * exam is refused with a worded error.
 */

const CARD_SCOPE_COLUMNS = {
  organizationId: publishedReportCards.organizationId,
  schoolId: publishedReportCards.schoolId,
} as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The shared reads accept either an open transaction or the root db. */
type DbLike = Tx | typeof db;

/** The maths core's single rounding (percentageOf), tolerating a zero max. */
function percentageOfSafe(total: bigint, max: bigint): bigint {
  if (max === 0n) return 0n;
  return percentageOf(total, max);
}

export class ExamResultsService {
  // -------------------------------------------------------------------------
  // Shared reads
  // -------------------------------------------------------------------------

  /** Pass criteria for a year: the class row wins over the school default. */
  private resolvePassCriteria(tx: DbLike, schoolId: string, academicYearId: string, classId: string | null) {
    return loadPassCriteria(tx, schoolId, academicYearId, classId);
  }

  /** The school default scale + bands (component overrides resolved by callers). */
  private resolveDefaultScale(tx: DbLike, schoolId: string) {
    return loadDefaultScale(tx, schoolId);
  }

  /** THE RESOLVER SEAM (see exam-shared.ts). */
  private resolveSubjectSet(tx: DbLike, classId: string, academicYearId: string) {
    return loadSubjectSet(tx, classId, academicYearId);
  }

  /** The cohort: active enrollments of the class (or one section) for the year. */
  private cohortOf(tx: DbLike, classId: string, academicYearId: string, sectionId: string | null) {
    return loadCohort(tx, classId, academicYearId, sectionId);
  }

  // -------------------------------------------------------------------------
  // Compute — components -> subjects -> term (idempotent, re-runnable)
  // -------------------------------------------------------------------------

  /**
   * Recomputes subject results (grace, grades, snapshots) for one exam's
   * class, then each cohort student's term result. Idempotent.
   *
   * `tx` is the closeRevisionWindow escape hatch: inside that window-close
   * the whole recompute must commit or roll back WITH the re-issue, so the
   * caller passes its open transaction instead of letting this method open
   * an independent (separately-committing) one.
   */
  async computeClassResults(
    scope: DataScope,
    examId: string,
    classId: string,
    tx?: Tx,
    opts?: { allowPublished?: boolean },
  ) {
    if (tx) return this.computeClassResultsTx(tx, scope, examId, classId, opts);
    return db.transaction((inner) => this.computeClassResultsTx(inner, scope, examId, classId, opts));
  }

  // NOTE: the engine body below sits in a bare block kept from the original
  // transaction callback — the engine's edits happen inside it; the block
  // scopes its locals and keeps the diff blame-friendly. Do not reindent
  // casually.
  private async computeClassResultsTx(
    tx: Tx,
    scope: DataScope,
    examId: string,
    classId: string,
    opts?: { allowPublished?: boolean },
  ) {
    const schoolId = requireSchoolId(scope);
    {
      const [exam] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)));
      if (!exam) return null;
      // Published/locked exams are frozen: ad-hoc recompute would rewrite
      // rows the cards already photographed (hard rule 7). Only the
      // ledger-owning flows (window close, revision apply) may recompute —
      // they re-version every card they move.
      if ((exam.status === "published" || exam.status === "locked") && !opts?.allowPublished) {
        throw new Error("This exam is published — recompute is closed. Correct through a revision window.");
      }

      const schedules = await tx
        .select()
        .from(examSubjectSchedules)
        .where(
          and(eq(examSubjectSchedules.examId, examId), eq(examSubjectSchedules.classId, classId)),
        );
      if (schedules.length === 0) return [];

      const scheduleIds = schedules.map((s) => s.id);
      const components = await tx
        .select()
        .from(examComponents)
        .where(inArray(examComponents.scheduleId, scheduleIds));
      const componentRows = await tx
        .select()
        .from(studentComponentResults)
        .where(inArray(studentComponentResults.scheduleId, scheduleIds));

      const criteria = await this.resolvePassCriteria(tx, schoolId, exam.academicYearId, classId);
      const scale = await this.resolveDefaultScale(tx, schoolId);
      const subjectSet = await this.resolveSubjectSet(tx, classId, exam.academicYearId);

      // Which paper each (student, subject) sits, and who is computed at all
      // (ADR-052) - the same resolver the annual readiness uses.
      const { paperOf, allStudentIds } = await resolvePapers(
        tx,
        schedules,
        classId,
        exam.academicYearId,
      );

      // The per-component scale overrides (the ICSE case): a component with
      // its own scale gets its own grade — the reference SQL's "this
      // component gets its own independent grade" — stamped onto the
      // component result's gradeObtained (the column the schema names as
      // exactly this data's home). The subject's grade stays on the school
      // default; this is additive, never a re-grading of the aggregate.
      const overrideScaleIds = [
        ...new Set(
          components
            .map((c) => c.gradingScaleId)
            .filter((id): id is string => id != null),
        ),
      ];
      // Highest floor first: shared-endpoint contiguous bands grade
      // upper-wins, mirroring gradeFor's descending-min first match — the
      // query order must not decide boundary percentages.
      const overrideBands = overrideScaleIds.length
        ? await tx
            .select({
              scaleId: gradingScaleBands.gradingScaleId,
              minMarks: gradingScaleBands.minMarks,
              maxMarks: gradingScaleBands.maxMarks,
              gradeLabel: gradingScaleBands.gradeLabel,
            })
            .from(gradingScaleBands)
            .where(inArray(gradingScaleBands.gradingScaleId, overrideScaleIds))
            .orderBy(desc(gradingScaleBands.minMarks))
        : [];

      const processed: { studentId: string }[] = [];
      // Every subject row this run produces, written as ONE bulk upsert below
      // (the per-row select+write cost two round trips per student x subject).
      const subjectWrites: (typeof studentSubjectResults.$inferInsert)[] = [];
      for (const studentId of allStudentIds) {
        const outcomes: {
          subjectId: string;
          marks: bigint | null;
          max: bigint;
          isPassed: boolean;
          failedComponents: string[];
          isAbsent: boolean;
          isExempted: boolean;
          grade: string | null;
          gradePoint: bigint | null;
          countsTowardResult: boolean;
          isGradedOnly: boolean;
        }[] = [];

        for (const mapping of subjectSet) {
          const schedule = paperOf.get(studentId)?.get(mapping.subjectId);
          if (!schedule) continue;
          const scheduleComponents = components.filter((c) => c.scheduleId === schedule.id);
          const studentRows = componentRows.filter(
            (r) => r.scheduleId === schedule.id && r.studentId === studentId,
          );

          // Stamp the override components' own grades: marks → percent →
          // band on THAT scale. Only rows that exist and carry marks — an
          // absent or exempt part has nothing to grade. Re-runnable: a row
          // already showing the right grade is left alone.
          for (const row of studentRows) {
            if (row.marksObtained == null) continue;
            const component = scheduleComponents.find((c) => c.id === row.componentId);
            if (!component?.gradingScaleId) continue;
            const max = toHundredths(component.maxMarks);
            if (max === 0n) continue;
            // Half-up (away from zero), never truncation: a 49.995% must not
            // grade below its band, and negative marks round symmetrically.
            const pct = mulDivHalfUp(toHundredths(row.marksObtained), 10000n, max);
            const band = overrideBands.find(
              (b) =>
                b.scaleId === component.gradingScaleId &&
                pct >= toHundredths(b.minMarks) &&
                pct <= toHundredths(b.maxMarks),
            );
            const grade = band?.gradeLabel ?? null;
            if (grade !== row.gradeObtained) {
              await tx
                .update(studentComponentResults)
                .set({ gradeObtained: grade })
                .where(eq(studentComponentResults.id, row.id));
            }
          }

          if (mapping.isGradedOnly) {
            const overall = studentRows.find((r) => r.gradeObtained !== null);
            outcomes.push({
              subjectId: mapping.subjectId,
              marks: null,
              max: 10000n,
              isPassed: true, // graded-only subjects never fail on marks
              failedComponents: [],
              isAbsent: studentRows.length > 0 && studentRows.every((r) => r.isAbsent),
              isExempted: studentRows.length > 0 && studentRows.every((r) => r.isExempted),
              grade: overall?.gradeObtained ?? null,
              gradePoint: null,
              countsTowardResult: mapping.countsTowardResult,
              isGradedOnly: true,
            });
            continue;
          }

          const renormalizeExempt = criteria?.exemptRenormalizes ?? false;
          const absentFails = criteria?.absentMandatoryFails ?? true;
          const inputs = scheduleComponents.map((c) => {
            const row = studentRows.find((r) => r.componentId === c.id);
            // Exemption excuses (never a failure); absence accuses only when
            // the school's policy says an unattempted mandatory paper fails.
            const exempted = row?.isExempted ?? false;
            return {
              id: c.id,
              marks: row?.marksObtained != null ? toHundredths(row.marksObtained) : null,
              maxMarks: toHundredths(c.maxMarks),
              weightagePercentage: toHundredths(c.weightagePercentage),
              passMarks: toHundredths(c.passMarks),
              mandatory: c.isMandatoryPass,
              exempted,
              absent: (row?.isAbsent ?? false) && !exempted,
            };
          });
          // A paper the student is excused from ENTIRELY (every component
          // exempt) is excused at every level (ADR-053 §7): no marks, no
          // failure, no grace - the term and the year leave it out. A partial
          // exemption keeps following `exemptRenormalizes`, unchanged.
          if (inputs.length > 0 && inputs.every((c) => c.exempted)) {
            outcomes.push({
              subjectId: mapping.subjectId,
              marks: null,
              max: 10000n,
              isPassed: true,
              failedComponents: [],
              isAbsent: false,
              isExempted: true,
              grade: null,
              gradePoint: null,
              countsTowardResult: mapping.countsTowardResult,
              isGradedOnly: false,
            });
            continue;
          }
          const marks = weightedComponentRollup(inputs, { renormalizeExempt });
          // The failed COMPONENT's own id — the pre-filter index pointed at
          // innocent components whenever an earlier one passed.
          const failedComponents = inputs
            .filter((c) =>
              c.mandatory && componentFailed(c.marks, c.passMarks, { absent: c.absent, absentFails }),
            )
            .map((c) => c.id);
          const passMark = toHundredths(schedule.passMarks);
          const isPassed = evaluatePass({
            finalMarks: marks,
            passMark,
            mandatoryComponentFailed: failedComponents.length > 0,
          });
          const grade = scale ? gradeFor(percentageOfSafe(marks, 10000n), scale.bands) : null;

          outcomes.push({
            subjectId: mapping.subjectId,
            marks,
            max: 10000n,
            isPassed,
            failedComponents,
            isAbsent: studentRows.length > 0 && studentRows.every((r) => r.isAbsent),
            isExempted: false,
            grade: grade?.gradeLabel ?? null,
            gradePoint: grade?.gradePoint ?? null,
            countsTowardResult: mapping.countsTowardResult,
            isGradedOnly: false,
          });
        }

        // Grace across the exam's failing counted subjects (ADR-032 §10).
        const counted = outcomes.filter((s) => s.countsTowardResult && !s.isGradedOnly);
        const failing = counted.filter((s) => !s.isPassed);
        const allocations =
          criteria?.graceMarksAllowed && failing.length > 0
            ? applyGrace(
                failing.map((s) => ({
                  subjectId: s.subjectId,
                  finalMarks: s.marks ?? 0n,
                  passMark: toHundredths(
                    paperOf.get(studentId)?.get(s.subjectId)?.passMarks ?? "0.00",
                  ),
                  isMustPass: (criteria?.mandatoryPassSubjectIds ?? []).includes(s.subjectId),
                })),
                {
                  perSubject: toHundredths(criteria?.maxGracePerSubject ?? "0.00"),
                  total: toHundredths(criteria?.maxGraceTotal ?? "0.00"),
                },
              )
            : new Map<string, bigint>();

        for (const outcome of outcomes) {
          const grace = allocations.get(outcome.subjectId) ?? 0n;
          const final = (outcome.marks ?? 0n) + grace;
          const passMark = toHundredths(
            paperOf.get(studentId)?.get(outcome.subjectId)?.passMarks ?? "0.00",
          );
          // Graded-only and fully-excused papers carry no marks and never fail.
          const unscored = outcome.isGradedOnly || outcome.isExempted;
          const isPassed = unscored
            ? true
            : evaluatePass({ finalMarks: final, passMark, mandatoryComponentFailed: outcome.failedComponents.length > 0 });
          const gradeObj = unscored
            ? null
            : scale
              ? gradeFor(percentageOfSafe(final, 10000n), scale.bands)
              : null;

          const values = {
            marksObtained: outcome.marks === null ? null : fromHundredths(outcome.marks),
            maxMarks: "100.00",
            passMarks: fromHundredths(passMark),
            marksBeforeGrace: outcome.marks === null ? null : fromHundredths(outcome.marks),
            graceMarksApplied: fromHundredths(grace),
            finalMarks: unscored ? null : fromHundredths(final),
            isPassed,
            failedComponents: outcome.failedComponents,
            isAbsent: outcome.isAbsent,
            isExempted: outcome.isExempted,
            grade: outcome.grade ?? gradeObj?.gradeLabel ?? null,
            gradePoint:
              outcome.isGradedOnly && outcome.gradePoint !== null
                ? fromHundredths(outcome.gradePoint)
                : gradeObj?.gradePoint != null
                  ? fromHundredths(gradeObj.gradePoint)
                  : null,
            gradingScaleId: scale?.scale.id ?? null,
            countsTowardResult: outcome.countsTowardResult,
            isGradedOnly: outcome.isGradedOnly,
            computedAt: new Date(),
          };

          subjectWrites.push({
            organizationId: scope.organizationId,
            schoolId,
            studentId,
            examId,
            subjectId: outcome.subjectId,
            ...values,
          });
        }
        processed.push({ studentId });
      }

      // One upsert per chunk on the (student, exam, subject) unique index. The
      // SET names exactly the computed columns: status, ranks and publication
      // stamps on an existing row are never touched.
      // (A duplicate mapping row must not put one pair in a statement twice.)
      const uniqueWrites = [
        ...new Map(subjectWrites.map((w) => [`${w.studentId}|${w.subjectId}`, w])).values(),
      ];
      for (let i = 0; i < uniqueWrites.length; i += 200) {
        await tx
          .insert(studentSubjectResults)
          .values(uniqueWrites.slice(i, i + 200))
          .onConflictDoUpdate({
            target: [
              studentSubjectResults.studentId,
              studentSubjectResults.examId,
              studentSubjectResults.subjectId,
            ],
            set: {
              marksObtained: sql`excluded.marks_obtained`,
              maxMarks: sql`excluded.max_marks`,
              passMarks: sql`excluded.pass_marks`,
              marksBeforeGrace: sql`excluded.marks_before_grace`,
              graceMarksApplied: sql`excluded.grace_marks_applied`,
              finalMarks: sql`excluded.final_marks`,
              isPassed: sql`excluded.is_passed`,
              failedComponents: sql`excluded.failed_components`,
              isAbsent: sql`excluded.is_absent`,
              isExempted: sql`excluded.is_exempted`,
              grade: sql`excluded.grade`,
              gradePoint: sql`excluded.grade_point`,
              gradingScaleId: sql`excluded.grading_scale_id`,
              countsTowardResult: sql`excluded.counts_toward_result`,
              isGradedOnly: sql`excluded.is_graded_only`,
              computedAt: sql`excluded.computed_at`,
            },
          });
      }

      // Stale draft cleanup: recompute is idempotent, so a (student,
      // subject) pair no paper covers must not keep its row from an
      // earlier compute — a paper restructured between computes (legal
      // while nothing is entered) would otherwise leave zero-fail rows
      // behind. Draft rows are disposable computed math; published/locked
      // rows are frozen and left alone.
      const classCohort = await this.cohortOf(tx, classId, exam.academicYearId, null);
      const classStudentIds = classCohort.map((c) => c.studentId);
      if (classStudentIds.length > 0) {
        const existingRows = await tx
          .select({
            id: studentSubjectResults.id,
            studentId: studentSubjectResults.studentId,
            subjectId: studentSubjectResults.subjectId,
            resultStatus: studentSubjectResults.resultStatus,
          })
          .from(studentSubjectResults)
          .where(
            and(
              eq(studentSubjectResults.examId, examId),
              inArray(studentSubjectResults.studentId, classStudentIds),
            ),
          );
        const staleIds = existingRows
          .filter(
            (r) =>
              r.resultStatus === "draft" &&
              !paperOf.get(r.studentId)?.has(r.subjectId),
          )
          .map((r) => r.id);
        if (staleIds.length > 0) {
          await tx
            .delete(studentSubjectResults)
            .where(inArray(studentSubjectResults.id, staleIds));
        }
      }

      // The term result folds in every counted exam of the term - one batch.
      await this.computeTermResults(
        tx,
        processed.map((p) => p.studentId),
        exam.termId,
        schoolId,
        scope.organizationId,
      );
      return processed;
    }
  }

  /**
   * One student's term result. Kept for the revision flow, which re-folds a
   * single student; the work is `computeTermResults`.
   */
  async computeTermResult(
    tx: DbLike,
    studentId: string,
    termId: string,
    schoolId: string,
    organizationId: string,
  ) {
    const [row] = await this.computeTermResults(tx, [studentId], termId, schoolId, organizationId);
    return row ?? null;
  }

  /**
   * The term results of many students at once: every counted exam of the term
   * folds into per-subject term scores (weight-normalized), then the term
   * aggregate. The GPA branch activates when every counted subject is
   * graded-only. Idempotent; published rows get their numbers refreshed (the
   * card is the frozen truth, and a re-issue re-photographs it).
   *
   * SET-BASED: the term, its exams, the scale and each class's subject set and
   * pass criteria are read ONCE; the per-student facts (exam rows, enrollment,
   * attendance, existing result) are four bulk reads; the writes are one bulk
   * upsert per chunk. The per-student version this replaces spent about a
   * dozen round trips per student - 64 s for a 20-student class on the remote
   * database (plan gap 29, ADR-053 §12).
   */
  async computeTermResults(
    tx: DbLike,
    studentIds: string[],
    termId: string,
    schoolId: string,
    organizationId: string,
  ) {
    if (studentIds.length === 0) return [];
    const [term] = await tx.select().from(terms).where(eq(terms.id, termId));
    if (!term) return [];

    const termExams = await tx
      .select()
      .from(exams)
      .where(and(eq(exams.termId, termId), eq(exams.countsTowardTermResult, true)));
    if (termExams.length === 0) return [];
    const termExamIds = termExams.map((e) => e.id);
    const weightOf = new Map(
      termExams.map((e) => [e.id, toHundredths(e.weightageInTerm ?? "0.00")]),
    );

    const subjectResults = await tx
      .select()
      .from(studentSubjectResults)
      .where(
        and(
          inArray(studentSubjectResults.studentId, studentIds),
          inArray(studentSubjectResults.examId, termExamIds),
        ),
      );
    const resultsOf = new Map<string, typeof subjectResults>();
    for (const r of subjectResults) {
      const list = resultsOf.get(r.studentId) ?? [];
      list.push(r);
      resultsOf.set(r.studentId, list);
    }

    // THE student's class and section - never the term's first schedule row.
    // Exams spanning classes with different mappings used to compute every
    // other class against the wrong subject set (subjects silently skipped).
    const enrollments = await tx
      .select({
        studentId: studentEnrollments.studentId,
        classId: studentEnrollments.classId,
        sectionId: studentEnrollments.sectionId,
      })
      .from(studentEnrollments)
      .where(
        and(
          inArray(studentEnrollments.studentId, studentIds),
          eq(studentEnrollments.academicYearId, term.academicYearId),
        ),
      );
    const enrollmentOf = new Map<string, { classId: string; sectionId: string | null }>();
    for (const e of enrollments) {
      if (!enrollmentOf.has(e.studentId)) {
        enrollmentOf.set(e.studentId, { classId: e.classId, sectionId: e.sectionId });
      }
    }

    const attendanceRows = await tx
      .select({
        studentId: attendanceSummary.studentId,
        pct: attendanceSummary.attendancePercentage,
      })
      .from(attendanceSummary)
      .where(
        and(
          inArray(attendanceSummary.studentId, studentIds),
          eq(attendanceSummary.academicYearId, term.academicYearId),
          eq(attendanceSummary.periodType, "term"),
          eq(attendanceSummary.termId, termId),
        ),
      );
    const attendanceOf = new Map(attendanceRows.map((a) => [a.studentId, a.pct]));

    const scale = await this.resolveDefaultScale(tx, schoolId);
    const perClass = new Map<
      string,
      {
        subjectSet: Awaited<ReturnType<ExamResultsService["resolveSubjectSet"]>>;
        criteria: Awaited<ReturnType<ExamResultsService["resolvePassCriteria"]>>;
      }
    >();
    const classFacts = async (classId: string | null) => {
      const key = classId ?? "*none";
      const hit = perClass.get(key);
      if (hit) return hit;
      const facts = {
        subjectSet: classId ? await this.resolveSubjectSet(tx, classId, term.academicYearId) : [],
        criteria: await this.resolvePassCriteria(tx, schoolId, term.academicYearId, classId),
      };
      perClass.set(key, facts);
      return facts;
    };

    const computedAt = new Date();
    const out: (typeof studentTermResults.$inferInsert)[] = [];

    for (const studentId of studentIds) {
      const enrollment = enrollmentOf.get(studentId);
      const { subjectSet, criteria } = await classFacts(enrollment?.classId ?? null);
      const mine = resultsOf.get(studentId) ?? [];

      const scores: {
        subjectId: string;
        termScore: bigint;
        maxScore: bigint;
        countsTowardResult: boolean;
        isPassed: boolean;
        gradePoint: bigint | null;
        isGradedOnly: boolean;
      }[] = [];
      for (const setType of subjectSet) {
        const votes = mine.filter((sr) => sr.subjectId === setType.subjectId);
        if (votes.length === 0) continue;
        // THE one derivation (ADR-053 §4): exam-weighted score, every-exam
        // pass, and every counting exam's grade point weighted like the marks.
        const outcome = termSubjectScore(
          votes.map((v) => ({
            marks: v.finalMarks ? toHundredths(v.finalMarks) : null,
            weightage: weightOf.get(v.examId) ?? 0n,
            isPassed: v.isPassed,
            passMark: toHundredths(v.passMarks),
            isExempted: v.isExempted,
            gradePoint: v.gradePoint != null ? toHundredths(v.gradePoint) : null,
          })),
          { isGradedOnly: setType.isGradedOnly },
        );
        // Excused from every exam of the subject: not scored, not failed, out
        // of the denominator (ADR-053 §7).
        if (outcome.kind === "exempt") continue;
        scores.push({
          subjectId: setType.subjectId,
          termScore: outcome.kind === "scored" ? outcome.score : 0n,
          maxScore: 10000n,
          countsTowardResult: setType.countsTowardResult,
          isPassed: outcome.kind === "scored" ? outcome.isPassed : true,
          gradePoint: outcome.gradePoint,
          isGradedOnly: outcome.kind === "graded",
        });
      }

      const countedScores = scores.filter((s) => s.countsTowardResult);
      const allGradedOnly =
        countedScores.length > 0 && countedScores.every((s) => s.isGradedOnly);
      // Missing grade points are EXCLUDED, never zeroes — one undescribed
      // band must not drag the whole GPA down.
      const gradedPoints = countedScores
        .map((s) => s.gradePoint)
        .filter((gp): gp is bigint => gp !== null);
      const gpa =
        allGradedOnly && gradedPoints.length > 0 ? gpaAggregate(gradedPoints) : null;

      const aggregate = termAggregate(
        countedScores.map((s) => ({
          subjectId: s.subjectId,
          termScore: allGradedOnly ? (s.gradePoint ?? 0n) : s.termScore,
          maxScore: s.maxScore,
          countsTowardResult: s.countsTowardResult,
        })),
      );
      const grade = scale && !allGradedOnly ? gradeFor(aggregate.percentage, scale.bands) : null;

      const failedSubjects = countedScores.filter((s) => !s.isPassed).map((s) => s.subjectId);
      const passedCount = countedScores.filter((s) => s.isPassed).length;
      const mustPassFailed = (criteria?.mandatoryPassSubjectIds ?? []).filter((id) =>
        failedSubjects.includes(id),
      );
      const minRequired = criteria?.minSubjectsToPass ?? countedScores.length;
      const isPassed =
        countedScores.length > 0 &&
        !allGradedOnly &&
        mustPassFailed.length === 0 &&
        passedCount >= minRequired;

      out.push({
        organizationId,
        schoolId,
        studentId,
        termId,
        // The section snapshot: ranks are computed per section, so the term
        // row must remember where the student sat (mid-year moves don't
        // rewrite it).
        sectionId: enrollment?.sectionId ?? null,
        totalMarks: allGradedOnly ? null : fromHundredths(aggregate.totalMarks),
        maxMarks: allGradedOnly ? null : fromHundredths(aggregate.maxMarks),
        percentage: allGradedOnly ? null : fromHundredths(aggregate.percentage),
        grade: grade?.gradeLabel ?? null,
        gradePoint:
          gpa !== null
            ? fromHundredths(gpa)
            : grade?.gradePoint
              ? fromHundredths(grade.gradePoint)
              : null,
        isPassed,
        subjectsFailedCount: failedSubjects.length,
        subjectsFailed: failedSubjects,
        attendancePercentage: attendanceOf.get(studentId) ?? null,
        passPolicySnapshot: criteria
          ? {
              minSubjectsToPass: criteria.minSubjectsToPass,
              mandatoryPassSubjectIds: criteria.mandatoryPassSubjectIds,
              graceMarksAllowed: criteria.graceMarksAllowed,
              maxGracePerSubject: criteria.maxGracePerSubject,
              maxGraceTotal: criteria.maxGraceTotal,
              compartmentAllowed: criteria.compartmentAllowed,
              maxSubjectsForCompartment: criteria.maxSubjectsForCompartment,
              minAttendancePct: criteria.minAttendancePct,
            }
          : null,
        computedAt,
      });
    }

    // One upsert per chunk. The SET names exactly the computed columns, so a
    // published row keeps its status, ranks and publication stamps.
    for (let i = 0; i < out.length; i += 200) {
      await tx
        .insert(studentTermResults)
        .values(out.slice(i, i + 200))
        .onConflictDoUpdate({
          target: [studentTermResults.studentId, studentTermResults.termId],
          set: {
            sectionId: sql`excluded.section_id`,
            totalMarks: sql`excluded.total_marks`,
            maxMarks: sql`excluded.max_marks`,
            percentage: sql`excluded.percentage`,
            grade: sql`excluded.grade`,
            gradePoint: sql`excluded.grade_point`,
            isPassed: sql`excluded.is_passed`,
            subjectsFailedCount: sql`excluded.subjects_failed_count`,
            subjectsFailed: sql`excluded.subjects_failed`,
            attendancePercentage: sql`excluded.attendance_percentage`,
            passPolicySnapshot: sql`excluded.pass_policy_snapshot`,
            computedAt: sql`excluded.computed_at`,
          },
        });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Ranks — explicit, never live
  // -------------------------------------------------------------------------

  /**
   * Term ranks: rankInSection within the snapshotted section, rankInClass
   * across the class. Score = percentage (GPA classes rank by grade point).
   * Competition ranking; ties share.
   */
  async computeTermRanks(scope: DataScope, termId: string, tx: DbLike = db) {
    const schoolId = requireSchoolId(scope);
    const rows = await tx
      .select()
      .from(studentTermResults)
      .where(and(eq(studentTermResults.termId, termId), eq(studentTermResults.schoolId, schoolId)));

    const scoreOf = (r: (typeof rows)[number]) =>
      r.percentage ? toHundredths(r.percentage) : r.gradePoint ? toHundredths(r.gradePoint) : 0n;

    const bySection = new Map<string, { id: string; score: bigint }[]>();
    for (const row of rows) {
      if (!row.sectionId) continue;
      const list = bySection.get(row.sectionId) ?? [];
      list.push({ id: row.id, score: scoreOf(row) });
      bySection.set(row.sectionId, list);
    }

    let updated = 0;
    const now = new Date();
    for (const entries of bySection.values()) {
      for (const [id, rank] of computeRanks(entries)) {
        await tx
          .update(studentTermResults)
          .set({ rankInSection: rank, rankComputedAt: now })
          .where(eq(studentTermResults.id, id));
        updated += 1;
      }
    }

    // rankInClass across the class: one batched section→class map (not a
    // query per student), then one ranking per class. Sectionless students
    // — admitted but unassigned, a legal state — get a class rank through
    // their enrollment; they simply have no section rank.
    const [term] = await tx.select().from(terms).where(eq(terms.id, termId));
    const sectionIds = [...new Set(rows.map((r) => r.sectionId).filter((s): s is string => s != null))];
    const sectionRows = sectionIds.length
      ? await tx
          .select({ id: sections.id, classId: sections.classId })
          .from(sections)
          .where(inArray(sections.id, sectionIds))
      : [];
    const classBySection = new Map(sectionRows.map((s) => [s.id, s.classId]));
    const sectionlessIds = [...new Set(rows.filter((r) => !r.sectionId).map((r) => r.studentId))];
    const enrollmentRows =
      term && sectionlessIds.length
        ? await tx
            .select({ studentId: studentEnrollments.studentId, classId: studentEnrollments.classId })
            .from(studentEnrollments)
            .where(
              and(
                inArray(studentEnrollments.studentId, sectionlessIds),
                eq(studentEnrollments.academicYearId, term.academicYearId),
              ),
            )
        : [];
    const classByStudent = new Map(enrollmentRows.map((e) => [e.studentId, e.classId]));
    const byClass = new Map<string, { id: string; score: bigint }[]>();
    for (const row of rows) {
      const classId =
        (row.sectionId ? classBySection.get(row.sectionId) : undefined) ??
        classByStudent.get(row.studentId);
      if (!classId) continue;
      const list = byClass.get(classId) ?? [];
      list.push({ id: row.id, score: scoreOf(row) });
      byClass.set(classId, list);
    }
    for (const entries of byClass.values()) {
      for (const [id, rank] of computeRanks(entries)) {
        await tx
          .update(studentTermResults)
          .set({ rankInClass: rank, rankComputedAt: now })
          .where(eq(studentTermResults.id, id));
      }
    }
    return { updated };
  }

  // -------------------------------------------------------------------------
  // Publication — per class, frozen photographs (hard rule 8)
  // -------------------------------------------------------------------------

  /** Assembles the v1 snapshot for one student's term card from frozen facts. */
  private async assembleSnapshot(
    tx: Tx,
    studentId: string,
    termId: string,
  ): Promise<import("@repo/contracts").ReportCardSnapshotV1> {
    const [student] = await tx
      .select({
        firstName: studentsTable.firstName,
        lastName: studentsTable.lastName,
        admissionNumber: studentsTable.admissionNumber,
        schoolId: studentsTable.schoolId,
      })
      .from(studentsTable)
      .where(eq(studentsTable.id, studentId));
    const [termRow] = await tx.select().from(terms).where(eq(terms.id, termId));
    const [year] = termRow
      ? await tx
          .select({ name: academicYears.name })
          .from(academicYears)
          .where(eq(academicYears.id, termRow.academicYearId))
      : [{ name: "" }];

    // Identity is FROZEN, not referenced: a reprint in 2032 shows the
    // class/section/roll/school as they were, even if the student moved.
    const [enrollment] = termRow
      ? await tx
          .select({
            classId: studentEnrollments.classId,
            sectionId: studentEnrollments.sectionId,
            rollNumber: studentEnrollments.rollNumber,
          })
          .from(studentEnrollments)
          .where(
            and(
              eq(studentEnrollments.studentId, studentId),
              eq(studentEnrollments.academicYearId, termRow.academicYearId),
            ),
          )
      : [];
    const [klass] = enrollment
      ? await tx.select({ name: classes.name }).from(classes).where(eq(classes.id, enrollment.classId))
      : [];
    const [section] = enrollment?.sectionId
      ? await tx.select({ name: sections.name }).from(sections).where(eq(sections.id, enrollment.sectionId))
      : [];
    const [school] = student?.schoolId
      ? await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, student.schoolId))
      : [];
    const scale = student?.schoolId
      ? await this.resolveDefaultScale(tx, student.schoolId)
      : null;

    const termExamIds = (
      await tx
        .select({ id: exams.id })
        .from(exams)
        .where(and(eq(exams.termId, termId), eq(exams.countsTowardTermResult, true)))
    ).map((e) => e.id);
    const subjectRows = termExamIds.length
      ? await tx
          .select({
            subjectId: studentSubjectResults.subjectId,
            subjectName: subjects.name,
            countsTowardResult: studentSubjectResults.countsTowardResult,
            marksObtained: studentSubjectResults.finalMarks,
            maxMarks: studentSubjectResults.maxMarks,
            grade: studentSubjectResults.grade,
            gradePoint: studentSubjectResults.gradePoint,
            isPassed: studentSubjectResults.isPassed,
            passMarks: studentSubjectResults.passMarks,
            isGradedOnly: studentSubjectResults.isGradedOnly,
            isAbsent: studentSubjectResults.isAbsent,
            isExempted: studentSubjectResults.isExempted,
            weightage: exams.weightageInTerm,
          })
          .from(studentSubjectResults)
          .innerJoin(subjects, eq(studentSubjectResults.subjectId, subjects.id))
          .innerJoin(exams, eq(studentSubjectResults.examId, exams.id))
          .where(
            and(
              eq(studentSubjectResults.studentId, studentId),
              inArray(studentSubjectResults.examId, termExamIds),
            ),
          )
      : [];

    // One row per subject: exam-weighted term score (same maths as compute).
    const bySubject = new Map<string, typeof subjectRows>();
    for (const row of subjectRows) {
      const list = bySubject.get(row.subjectId) ?? [];
      list.push(row);
      bySubject.set(row.subjectId, list);
    }

    const [termResult] = await tx
      .select()
      .from(studentTermResults)
      .where(and(eq(studentTermResults.studentId, studentId), eq(studentTermResults.termId, termId)));

    const typeBySubject = new Map<string, { id: string; name: string; sequence: number }>();
    for (const [subjectId] of bySubject) {
      // Class-scoped: the same subject can be typed differently in two
      // classes — the student's own class/year wins. Subject-only is the
      // fallback for cards whose enrollment is gone (never borrowed across
      // classes when the enrollment exists but the mapping doesn't).
      let resolved: { id: string; name: string; sequence: number } | undefined;
      if (enrollment && termRow) {
        [resolved] = await tx
          .select({ id: subjectTypes.id, name: subjectTypes.name, sequence: subjectTypes.sequence })
          .from(classSubjectMappings)
          .innerJoin(subjectTypes, eq(classSubjectMappings.subjectTypeId, subjectTypes.id))
          .where(
            and(
              eq(classSubjectMappings.subjectId, subjectId),
              eq(classSubjectMappings.classId, enrollment.classId),
              eq(classSubjectMappings.academicYearId, termRow.academicYearId),
            ),
          );
      } else {
        [resolved] = await tx
          .select({ id: subjectTypes.id, name: subjectTypes.name, sequence: subjectTypes.sequence })
          .from(classSubjectMappings)
          .innerJoin(subjectTypes, eq(classSubjectMappings.subjectTypeId, subjectTypes.id))
          .where(eq(classSubjectMappings.subjectId, subjectId));
      }
      if (resolved) typeBySubject.set(subjectId, resolved);
    }

    const assessments = await tx
      .select({
        mappingId: termAssessments.mappingId,
        grade: termAssessments.grade,
        remarks: termAssessments.teacherRemarks,
        typeName: subjectTypes.name,
        typeSequence: subjectTypes.sequence,
      })
      .from(termAssessments)
      .innerJoin(classSubjectMappings, eq(termAssessments.mappingId, classSubjectMappings.id))
      .innerJoin(subjectTypes, eq(classSubjectMappings.subjectTypeId, subjectTypes.id))
      .where(and(eq(termAssessments.studentId, studentId), eq(termAssessments.termId, termId)));

    const [attendance] = await tx
      .select({
        workingDays: attendanceSummary.workingDays,
        daysPresent: attendanceSummary.daysPresent,
        pct: attendanceSummary.attendancePercentage,
      })
      .from(attendanceSummary)
      .where(
        termRow
          ? and(
              eq(attendanceSummary.studentId, studentId),
              eq(attendanceSummary.academicYearId, termRow.academicYearId),
              eq(attendanceSummary.periodType, "term"),
              eq(attendanceSummary.termId, termId),
            )
          : sql`false`,
      );

    return {
      snapshotVersion: 1,
      student: {
        name: `${student?.firstName ?? ""} ${student?.lastName ?? ""}`.trim(),
        admissionNumber: student?.admissionNumber ?? "",
        className: klass?.name ?? "",
        sectionName: section?.name ?? null,
        rollNumber: enrollment?.rollNumber ?? null,
      },
      school: { name: school?.name ?? "" },
      academicYear: { name: year?.name ?? "" },
      term: { id: termId, name: termRow?.name ?? "" },
      // Print order, not UUID order: the school's own widget sequence,
      // then subject name.
      subjects: [...bySubject.entries()]
        .sort(([aId, aRows], [bId, bRows]) => {
          const aType = typeBySubject.get(aId);
          const bType = typeBySubject.get(bId);
          const aSeq = aType?.sequence ?? 999;
          const bSeq = bType?.sequence ?? 999;
          if (aSeq !== bSeq) return aSeq - bSeq;
          return (aRows[0]?.subjectName ?? "").localeCompare(bRows[0]?.subjectName ?? "");
        })
        .map(([subjectId, rows]) => {
        // The same derivation the term compute uses (ADR-053 §4): the card
        // and the total can no longer disagree. A subject excused from every
        // exam prints blank; graded-only subjects print no marks.
        const outcome = termSubjectScore(
          rows.map((r) => ({
            marks: r.marksObtained ? toHundredths(r.marksObtained) : null,
            weightage: toHundredths(r.weightage),
            isPassed: r.isPassed,
            passMark: toHundredths(r.passMarks),
            isExempted: r.isExempted,
            gradePoint: r.gradePoint ? toHundredths(r.gradePoint) : null,
          })),
          { isGradedOnly: rows.some((r) => r.isGradedOnly) },
        );
        const exempted = outcome.kind === "exempt";
        const score = outcome.kind === "scored" ? outcome.score : null;
        const type = typeBySubject.get(subjectId);
        // The TERM grade of the term score — not the first exam's grade.
        const termGrade = score !== null && scale ? gradeFor(score, scale.bands) : null;
        return {
          subjectId,
          subjectName: rows[0]!.subjectName,
          subjectTypeId: type?.id ?? null,
          widgetName: type?.name ?? null,
          widgetSequence: type?.sequence ?? null,
          marksObtained: score === null || (score === 0n && rows.every((r) => r.isAbsent)) ? null : fromHundredths(score),
          maxMarks: "100.00",
          grade: termGrade?.gradeLabel ?? rows.find((r) => r.grade != null)?.grade ?? null,
          gradePoint:
            termGrade?.gradePoint != null
              ? fromHundredths(termGrade.gradePoint)
              : (rows.find((r) => r.gradePoint != null)?.gradePoint ?? null),
          isAbsent: rows.some((r) => r.isAbsent),
          isExempted: exempted,
          countsTowardResult: rows.some((r) => r.countsTowardResult),
        };
      }),
      totals: {
        totalMarks: termResult?.totalMarks ?? null,
        maxMarks: termResult?.maxMarks ?? null,
        percentage: termResult?.percentage ?? null,
        grade: termResult?.grade ?? null,
        gradePoint: termResult?.gradePoint ?? null,
        isPassed: termResult?.isPassed ?? null,
        rankInSection: termResult?.rankInSection ?? null,
        rankInClass: termResult?.rankInClass ?? null,
      },
      attendance: attendance
        ? {
            workingDays: attendance.workingDays,
            daysPresent: attendance.daysPresent,
            percentage: attendance.pct,
          }
        : null,
      termAssessments: assessments.map((a) => ({
        mappingId: a.mappingId,
        areaName: a.typeName,
        widgetName: a.typeName,
        grade: a.grade,
        remarks: a.remarks,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Publishes ONE class: readiness gate (entry complete, compute fresh),
   * then the frozen photographs. The exam flips to `published` when its
   * LAST class publishes.
   */
  async publishClass(scope: DataScope, userId: string, examId: string, classId: string) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [exam] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)));
      if (!exam) return null;
      if (!["under_verification", "published"].includes(exam.status)) {
        throw new Error("The exam must be under verification before any class can publish.");
      }

      const schedules = await tx
        .select()
        .from(examSubjectSchedules)
        .where(and(eq(examSubjectSchedules.examId, examId), eq(examSubjectSchedules.classId, classId)));

      // Entry completeness: every schedule's cohort × components have rows.
      // ROWS, not distinct students — one entered cell per student still
      // leaves the class half-entered, and publishing it would silently
      // score the missing components as zero.
      for (const schedule of schedules) {
        const cohort = await this.cohortOf(tx, classId, exam.academicYearId, schedule.sectionId);
        const [components] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(examComponents)
          .where(eq(examComponents.scheduleId, schedule.id));
        const [entered] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(studentComponentResults)
          .where(
            and(
              eq(studentComponentResults.scheduleId, schedule.id),
              sql`${studentComponentResults.resultStatus} <> 'draft'`,
            ),
          );
        const expected = cohort.length * (components?.count ?? 0);
        if ((components?.count ?? 0) === 0 || (entered?.count ?? 0) < expected) {
          throw new Error(
            "Entry is incomplete for this class — every student needs every component entered (or marked absent).",
          );
        }
      }

      // Compute freshness: any component edit after its subject's computedAt
      // means the aggregates are stale — recompute before publishing.
      const scheduleIds = schedules.map((s) => s.id);
      if (scheduleIds.length > 0) {
        const [stale] = await tx
          .select({ id: studentComponentResults.id })
          .from(studentComponentResults)
          .innerJoin(
            studentSubjectResults,
            and(
              eq(studentComponentResults.studentId, studentSubjectResults.studentId),
              eq(studentComponentResults.examId, studentSubjectResults.examId),
            ),
          )
          .where(
            and(
              inArray(studentComponentResults.scheduleId, scheduleIds),
              sql`${studentComponentResults.updatedAt} > ${studentSubjectResults.computedAt}`,
            ),
          )
          .limit(1);
        if (stale) {
          throw new Error(
            "Marks changed after the last compute — recompute the results before publishing.",
          );
        }
      }

      const cohort = await this.cohortOf(tx, classId, exam.academicYearId, null);
      const cohortIds = cohort.map((c) => c.studentId);

      if (scheduleIds.length > 0) {
        // Only entered-or-better rows flip: the gate above proved no drafts
        // remain, and this predicate keeps the flip total even if a draft
        // ever sneaks in — flipping an empty draft would violate the
        // value-present CHECK and abort the whole publication.
        await tx
          .update(studentComponentResults)
          .set({ resultStatus: "published", publishedAt: new Date() })
          .where(
            and(
              inArray(studentComponentResults.scheduleId, scheduleIds),
              sql`${studentComponentResults.resultStatus} <> 'draft'`,
            ),
          );
      }
      if (cohortIds.length > 0) {
        await tx
          .update(studentSubjectResults)
          .set({ resultStatus: "published", publishedAt: new Date() })
          .where(
            and(
              eq(studentSubjectResults.examId, examId),
              inArray(studentSubjectResults.studentId, cohortIds),
            ),
          );
      }

      const termId = exam.termId;
      const [template] = await tx
        .select()
        .from(reportCardTemplates)
        .where(
          and(
            eq(reportCardTemplates.schoolId, schoolId),
            eq(reportCardTemplates.isDefault, true),
            eq(reportCardTemplates.isActive, true),
          ),
        );

      for (const studentId of cohortIds) {
        const [termResult] = await tx
          .select()
          .from(studentTermResults)
          .where(and(eq(studentTermResults.studentId, studentId), eq(studentTermResults.termId, termId)));
        if (!termResult) continue;
        await tx
          .update(studentTermResults)
          .set({ resultStatus: "published", publishedBy: userId, publishedAt: new Date() })
          .where(eq(studentTermResults.id, termResult.id));

        const snapshot = await this.assembleSnapshot(tx, studentId, termId);
        const [existingCard] = await tx
          .select({ id: publishedReportCards.id, version: publishedReportCards.version })
          .from(publishedReportCards)
          .where(
            and(
              eq(publishedReportCards.studentId, studentId),
              eq(publishedReportCards.termId, termId),
              eq(publishedReportCards.isCurrent, true),
            ),
          );
        if (existingCard) {
          await tx
            .update(publishedReportCards)
            .set({ isCurrent: false })
            .where(eq(publishedReportCards.id, existingCard.id));
          await tx.insert(publishedReportCards).values({
            organizationId: scope.organizationId,
            schoolId,
            studentId,
            academicYearId: exam.academicYearId,
            termId,
            version: existingCard.version + 1,
            replacesVersion: existingCard.version,
            snapshotData: snapshot,
            templateId: template?.id ?? null,
            revisionReason: "re-issue",
            publishedBy: userId,
          });
        } else {
          await tx.insert(publishedReportCards).values({
            organizationId: scope.organizationId,
            schoolId,
            studentId,
            academicYearId: exam.academicYearId,
            termId,
            version: 1,
            snapshotData: snapshot,
            templateId: template?.id ?? null,
            publishedBy: userId,
          });
        }
      }

      await tx
        .insert(examClassPublication)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          examId,
          classId,
          publishedBy: userId,
        })
        .onConflictDoUpdate({
          target: [examClassPublication.examId, examClassPublication.classId],
          set: { publishedBy: userId, publishedAt: new Date(), state: "published" },
        });

      // The consequential act gets the append-only audit trail.
      await tx.insert(authzAuditLog).values({
        organizationId: scope.organizationId,
        action: "result_published",
        actorUserId: userId,
        scopeId: classId,
        permission: "exam:publish",
        details: { examId, classId },
      });

      // The exam is published when its LAST class is.
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(examSubjectSchedules)
        .where(
          and(
            eq(examSubjectSchedules.examId, examId),
            sql`${examSubjectSchedules.classId} NOT IN (
              SELECT class_id FROM exam_class_publication WHERE exam_id = ${examId}
            )`,
          ),
        );
      if ((remaining?.count ?? 1) === 0 && exam.status !== "published") {
        await tx.update(exams).set({ status: "published" }).where(eq(exams.id, examId));
      }
      return { examId, classId, published: true };
    });
  }

  /**
   * THE LEAGUE TABLE READ (S4) — one call for the results screen: roster,
   * the subject-result matrix, the term totals, and the class statistics
   * that give the numbers meaning. Reads the COMPUTED chain only — this is
   * a photograph of the last compute (the stale flag is the readiness
   * panel's job, not repeated here).
   */
  async classResults(scope: DataScope, examId: string, classId: string) {
    const schoolId = requireSchoolId(scope);
    const [exam] = await db
      .select({
        id: exams.id,
        termId: exams.termId,
        status: exams.status,
        academicYearId: exams.academicYearId,
      })
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)));
    if (!exam) return null;

    const roster = await db
      .select({
        studentId: studentEnrollments.studentId,
        rollNumber: studentEnrollments.rollNumber,
        admissionNumber: studentsTable.admissionNumber,
        firstName: studentsTable.firstName,
        lastName: studentsTable.lastName,
      })
      .from(studentEnrollments)
      .innerJoin(studentsTable, eq(studentEnrollments.studentId, studentsTable.id))
      .where(
        and(
          eq(studentEnrollments.academicYearId, exam.academicYearId),
          eq(studentEnrollments.classId, classId),
          inArray(studentEnrollments.enrollmentStatus, [
            "admitted",
            "section_assigned",
            "active",
          ]),
        ),
      )
      .orderBy(asc(studentEnrollments.rollNumber), asc(studentsTable.lastName), asc(studentsTable.firstName));
    const studentIds = roster.map((r) => r.studentId);

    const subjectIds = (
      await db
        .selectDistinct({ subjectId: examSubjectSchedules.subjectId })
        .from(examSubjectSchedules)
        .where(eq(examSubjectSchedules.examId, examId))
    ).map((s) => s.subjectId);
    const subjectsOfExam = subjectIds.length
      ? await db
          .select({ id: subjects.id, name: subjects.name })
          .from(subjects)
          .where(inArray(subjects.id, subjectIds))
      : [];

    const subjectResults = studentIds.length
      ? await db
          .select({
            studentId: studentSubjectResults.studentId,
            subjectId: studentSubjectResults.subjectId,
            finalMarks: studentSubjectResults.finalMarks,
            maxMarks: studentSubjectResults.maxMarks,
            graceMarksApplied: studentSubjectResults.graceMarksApplied,
            isPassed: studentSubjectResults.isPassed,
            isAbsent: studentSubjectResults.isAbsent,
            isExempted: studentSubjectResults.isExempted,
            grade: studentSubjectResults.grade,
            countsTowardResult: studentSubjectResults.countsTowardResult,
            isGradedOnly: studentSubjectResults.isGradedOnly,
            resultStatus: studentSubjectResults.resultStatus,
          })
          .from(studentSubjectResults)
          .where(
            and(
              eq(studentSubjectResults.examId, examId),
              inArray(studentSubjectResults.studentId, studentIds),
            ),
          )
      : [];

    const termResults = studentIds.length
      ? await db
          .select({
            studentId: studentTermResults.studentId,
            totalMarks: studentTermResults.totalMarks,
            maxMarks: studentTermResults.maxMarks,
            percentage: studentTermResults.percentage,
            grade: studentTermResults.grade,
            isPassed: studentTermResults.isPassed,
            subjectsFailedCount: studentTermResults.subjectsFailedCount,
            rankInSection: studentTermResults.rankInSection,
            rankInClass: studentTermResults.rankInClass,
            resultStatus: studentTermResults.resultStatus,
            publishedAt: studentTermResults.publishedAt,
          })
          .from(studentTermResults)
          .where(
            and(
              eq(studentTermResults.termId, exam.termId),
              inArray(studentTermResults.studentId, studentIds),
            ),
          )
      : [];

    // Per-subject class stats over the COUNTED, non-empty results.
    // BigInt hundredths end to end (hard rule 4's cousin) — the old float
    // path could sit a hundredth off the stored aggregates.
    const stats = subjectsOfExam.map((subject) => {
      const rows = subjectResults.filter(
        (r) =>
          r.subjectId === subject.id &&
          r.countsTowardResult &&
          !r.isExempted &&
          r.finalMarks != null,
      );
      const scores = rows.map((r) => toHundredths(r.finalMarks!));
      const average =
        scores.length > 0
          ? fromHundredths(mulDivHalfUp(scores.reduce((a, b) => a + b, 0n), 1n, BigInt(scores.length)))
          : null;
      const highest =
        scores.length > 0
          ? fromHundredths(scores.reduce((a, b) => (a > b ? a : b)))
          : null;
      return {
        subjectId: subject.id,
        average,
        highest,
        passCount: rows.filter((r) => r.isPassed).length,
        enteredCount: rows.length,
      };
    });
    // Hundredths end to end like the subject stats above: Number() + `/`
    // + toFixed(2) is the one place float touched marks, and it can sit a
    // hundredth off a mean the aggregates would state exactly.
    const percentages = termResults
      .map((r) => (r.percentage != null ? toHundredths(r.percentage) : null))
      .filter((p): p is bigint => p != null);
    const classAverage =
      percentages.length > 0
        ? fromHundredths(
            mulDivHalfUp(
              percentages.reduce((a, b) => a + b, 0n),
              1n,
              BigInt(percentages.length),
            ),
          )
        : null;

    return {
      examStatus: exam.status,
      roster,
      subjects: subjectsOfExam,
      subjectResults,
      termResults,
      stats,
      classAverage,
    };
  }

  /** The per-class publication records — the visible proof of the act. */
  async listPublications(scope: DataScope, examId: string) {
    const schoolId = requireSchoolId(scope);
    return db
      .select({
        classId: examClassPublication.classId,
        state: examClassPublication.state,
        publishedAt: examClassPublication.publishedAt,
        revisionOpenedAt: examClassPublication.revisionOpenedAt,
        reIssuedAt: examClassPublication.reIssuedAt,
      })
      .from(examClassPublication)
      .where(
        and(
          eq(examClassPublication.examId, examId),
          eq(examClassPublication.schoolId, schoolId),
        ),
      );
  }

  /**
   * THE CLASS SET (S5) — every student's CURRENT card for the exam's
   * reporting unit, for the client-side print pass. Published cards only,
   * by construction of the table; isCurrent picks the latest version so a
   * re-issued card supersedes its ancestor without extra logic here.
   */
  async listClassCards(scope: DataScope, examId: string, classId: string) {
    const schoolId = requireSchoolId(scope);
    const [exam] = await db
      .select({
        termId: exams.termId,
        academicYearId: exams.academicYearId,
      })
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)));
    if (!exam) return null;

    const cohort = await db
      .selectDistinct({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.academicYearId, exam.academicYearId),
          eq(studentEnrollments.classId, classId),
        ),
      );
    const studentIds = cohort.map((c) => c.studentId);
    if (studentIds.length === 0) {
      return { cards: [] };
    }

    const cards = await db
      .select({
        id: publishedReportCards.id,
        studentId: publishedReportCards.studentId,
        version: publishedReportCards.version,
        isCurrent: publishedReportCards.isCurrent,
        snapshotData: publishedReportCards.snapshotData,
        publishedAt: publishedReportCards.publishedAt,
      })
      .from(publishedReportCards)
      .where(
        and(
          eq(publishedReportCards.academicYearId, exam.academicYearId),
          exam.termId
            ? eq(publishedReportCards.termId, exam.termId)
            : isNull(publishedReportCards.termId),
          inArray(publishedReportCards.studentId, studentIds),
          eq(publishedReportCards.isCurrent, true),
        ),
      );
    return { cards };
  }

  /** One-click whole-exam publish: loops the classes that have schedules. */
  /**
   * Publishes every scheduled class, each in its own transaction: one
   * class's incomplete entry must not roll back its siblings' publications.
   * The count answers what actually published — a mid-loop throw used to
   * leave partial state behind a full count. Failures ride along per class
   * so the UI can point at readiness instead of claiming success.
   */
  async publishExam(scope: DataScope, userId: string, examId: string) {
    const schoolId = requireSchoolId(scope);
    const classIds = (
      await db
        .selectDistinct({ classId: examSubjectSchedules.classId })
        .from(examSubjectSchedules)
        .where(and(eq(examSubjectSchedules.examId, examId), eq(examSubjectSchedules.schoolId, schoolId)))
    ).map((r) => r.classId);
    let publishedClasses = 0;
    const failedClassIds: string[] = [];
    for (const classId of classIds) {
      try {
        await this.publishClass(scope, userId, examId, classId);
        publishedClasses += 1;
      } catch {
        failedClassIds.push(classId);
      }
    }
    return { publishedClasses, failedClassIds };
  }

  // -------------------------------------------------------------------------
  // Revision windows + the quick edit (hard rule 7)
  // -------------------------------------------------------------------------

  /**
   * Opens a correction window for one class. Reopenable: after a close
   * (`re_issued`) a later correction opens a new window rather than
   * forcing a hand edit — every correction stays ledgered.
   */
  async openRevisionWindow(scope: DataScope, userId: string, examId: string, classId: string) {
    const schoolId = requireSchoolId(scope);
    const [row] = await db
      .update(examClassPublication)
      .set({ state: "revision_open", revisionOpenedBy: userId, revisionOpenedAt: new Date() })
      .where(
        and(
          eq(examClassPublication.examId, examId),
          eq(examClassPublication.classId, classId),
          inArray(examClassPublication.state, ["published", "re_issued"]),
          eq(examClassPublication.schoolId, schoolId),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Closes the window: ONE recompute of the class's students, ranks once,
   * then every card whose frozen data differs gets a new version — all in
   * one transaction. Cards that did not change keep their version.
   *
   * The engine calls below run INSIDE this transaction (the shared-tx
   * overloads): an outer rollback undoes the recompute too, never a
   * recomputed aggregate with un-re-versioned cards.
   */
  async closeRevisionWindow(scope: DataScope, userId: string, examId: string, classId: string) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [publication] = await tx
        .select()
        .from(examClassPublication)
        .where(
          and(
            eq(examClassPublication.examId, examId),
            eq(examClassPublication.classId, classId),
            eq(examClassPublication.state, "revision_open"),
            eq(examClassPublication.schoolId, schoolId),
          ),
        );
      if (!publication) return null;

      const [exam] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)));
      if (!exam) return null;
      const cohort = await this.cohortOf(tx, classId, exam.academicYearId, null);
      // One engine pass: computeClassResults already folds each student's
      // term result (no second per-student loop — it doubles the term
      // compute on large cohorts for identical rows).
      await this.computeClassResults(scope, examId, classId, tx, { allowPublished: true });
      await this.computeTermRanks(scope, exam.termId, tx);

      const currentCards = await tx
        .select()
        .from(publishedReportCards)
        .where(
          and(
            eq(publishedReportCards.termId, exam.termId),
            eq(publishedReportCards.isCurrent, true),
            inArray(
              publishedReportCards.studentId,
              cohort.map((c) => c.studentId),
            ),
          ),
        );
      let reIssued = 0;
      for (const card of currentCards) {
        const fresh = await this.assembleSnapshot(tx, card.studentId, exam.termId);
        if (sameSnapshot(fresh, card.snapshotData)) continue;
        await tx
          .update(publishedReportCards)
          .set({ isCurrent: false })
          .where(eq(publishedReportCards.id, card.id));
        await tx.insert(publishedReportCards).values({
          organizationId: card.organizationId,
          schoolId: card.schoolId,
          studentId: card.studentId,
          academicYearId: card.academicYearId,
          termId: card.termId,
          version: card.version + 1,
          replacesVersion: card.version,
          snapshotData: fresh,
          templateId: card.templateId,
          revisionReason: "revision window re-issue",
          publishedBy: userId,
        });
        reIssued += 1;
      }
      const [row] = await tx
        .update(examClassPublication)
        .set({ state: "re_issued", reIssuedBy: userId, reIssuedAt: new Date() })
        .where(eq(examClassPublication.id, publication.id))
        .returning();
      return { publication: row, reIssued };
    });
  }

  // -------------------------------------------------------------------------
  // Reads — staff card versions + the portal (hard rule 8's ONLY door)
  // -------------------------------------------------------------------------

  async listCardVersions(scope: DataScope, studentId: string) {
    return db
      .select()
      .from(publishedReportCards)
      .where(
        and(eq(publishedReportCards.studentId, studentId), scopeWhere(scope, CARD_SCOPE_COLUMNS)),
      )
      .orderBy(desc(publishedReportCards.version));
  }

  /** The portal's card list: ownership-filtered, current-only by default. */
  async listOwnedCards(studentIds: string[], academicYearId?: string) {
    if (studentIds.length === 0) return [];
    return db
      .select()
      .from(publishedReportCards)
      .where(
        and(
          inArray(publishedReportCards.studentId, studentIds),
          eq(publishedReportCards.isCurrent, true),
          academicYearId ? eq(publishedReportCards.academicYearId, academicYearId) : undefined,
        ),
      )
      .orderBy(desc(publishedReportCards.publishedAt));
  }

  async getOwnedCard(studentIds: string[], cardId: string) {
    if (studentIds.length === 0) return null;
    const [card] = await db
      .select()
      .from(publishedReportCards)
      .where(
        and(
          eq(publishedReportCards.id, cardId),
          inArray(publishedReportCards.studentId, studentIds),
          // Current only, like the list: superseded versions are history,
          // reachable through the versions read — never as "the" card.
          eq(publishedReportCards.isCurrent, true),
        ),
      );
    return card ?? null;
  }

  /**
   * Applies a post-publication correction: the ledger row FIRST (hard rule
   * 7), then the mark, then the recompute, then the re-photograph of every
   * affected card — ONE transaction, so a crash can never leave a ledgered
   * mark with stale aggregates or stale cards.
   *
   * Window enforcement: with an open window for the paper's class the edit
   * only ledgers + updates the mark (the close recomputes once for all of
   * them — no card moves mid-window). Without one, the single correction
   * applies atomically (the plan's invisible auto-window of size one).
   * Requested == approved by design: the control is the window (or the
   * single-actor quick edit) + the mandatory reason + the ledger + the
   * audit row — there is no maker-checker queue in v1.
   */
  async applyRevision(scope: DataScope, userId: string, input: SubmitRevisionInput) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      // STEP 1 — the ledger row FIRST, then the mark (hard rule 7).
      const [result] = await tx
        .select()
        .from(studentComponentResults)
        .where(
          and(
            eq(studentComponentResults.id, input.id),
            eq(studentComponentResults.schoolId, schoolId),
          ),
        )
        .for("update");
      if (!result) return null;
      if (["draft", "entered"].includes(result.resultStatus)) {
        throw new Error("This entry is not published — edit it directly in the grid.");
      }
      if (result.resultStatus === "locked") {
        throw new Error("This exam is locked — corrections are closed.");
      }

      await tx.insert(studentComponentResultRevisions).values({
        organizationId: result.organizationId,
        schoolId: result.schoolId,
        originalResultId: result.id,
        previousMarks: result.marksObtained,
        revisedMarks: input.revisedMarks ?? null,
        previousGrade: result.gradeObtained,
        revisedGrade: input.revisedGrade ?? null,
        previousStatus: result.resultStatus,
        revisedStatus: "published",
        reason: input.reason,
        revisionType: input.revisionType,
        requestedBy: userId,
        approvedBy: userId,
      });

      await tx
        .update(studentComponentResults)
        .set({ marksObtained: input.revisedMarks ?? null, gradeObtained: input.revisedGrade ?? null })
        .where(eq(studentComponentResults.id, result.id));

      await tx.insert(authzAuditLog).values({
        organizationId: result.organizationId,
        action: "result_corrected",
        actorUserId: userId,
        // The subject of a correction is a STUDENT, not a user row — the
        // audit's target_user_id FKs to `user`, so the student rides in
        // details (the ledger row already carries the entry).
        scopeId: result.id,
        permission: "marks:publish",
        details: {
          studentId: result.studentId,
          previousMarks: result.marksObtained,
          revisedMarks: input.revisedMarks ?? null,
          reason: input.reason,
        },
      });

      // Window check: with an open window the close owns the recompute —
      // ledger + mark commit here and stop. A locked exam refuses
      // everything, window or not.
      const [schedule] = await tx
        .select({ classId: examSubjectSchedules.classId })
        .from(examSubjectSchedules)
        .where(eq(examSubjectSchedules.id, result.scheduleId));
      const [exam] = await tx
        .select({
          status: exams.status,
          termId: exams.termId,
          academicYearId: exams.academicYearId,
        })
        .from(exams)
        .where(eq(exams.id, result.examId));
      if (!schedule || !exam) {
        throw new Error("The paper no longer exists in this school.");
      }
      if (exam.status === "locked") {
        throw new Error("This exam is locked — corrections are closed.");
      }
      const [publication] = await tx
        .select({ state: examClassPublication.state })
        .from(examClassPublication)
        .where(
          and(
            eq(examClassPublication.examId, result.examId),
            eq(examClassPublication.classId, schedule.classId),
            eq(examClassPublication.schoolId, schoolId),
          ),
        );
      if (publication?.state === "revision_open") {
        return { componentResultId: result.id, applied: true };
      }

      // STEP 2 — recompute inside the SAME transaction (never separate ones:
      // a crash between ledger and aggregates was the split-brain this merge
      // closes). The engine accepts the open tx throughout.
      await this.computeClassResults(scope, result.examId, schedule.classId, tx, {
        allowPublished: true,
      });
      await this.computeTermResult(tx, result.studentId, exam.termId, schoolId, scope.organizationId);
      await this.computeTermRanks(scope, exam.termId, tx);

      // STEP 3 — re-photograph every current card of the class whose frozen
      // data moved. Idempotent: unchanged cards keep their version.
      const cohort = await this.cohortOf(tx, schedule.classId, exam.academicYearId, null);
      const currentCards = await tx
        .select()
        .from(publishedReportCards)
        .where(
          and(
            eq(publishedReportCards.termId, exam.termId),
            eq(publishedReportCards.isCurrent, true),
            inArray(
              publishedReportCards.studentId,
              cohort.map((c) => c.studentId),
            ),
          ),
        );
      for (const card of currentCards) {
        const fresh = await this.assembleSnapshot(tx, card.studentId, exam.termId);
        if (sameSnapshot(fresh, card.snapshotData)) continue;
        await tx
          .update(publishedReportCards)
          .set({ isCurrent: false })
          .where(eq(publishedReportCards.id, card.id));
        await tx.insert(publishedReportCards).values({
          organizationId: card.organizationId,
          schoolId: card.schoolId,
          studentId: card.studentId,
          academicYearId: card.academicYearId,
          termId: card.termId,
          version: card.version + 1,
          replacesVersion: card.version,
          snapshotData: fresh,
          templateId: card.templateId,
          revisionReason: `correction: ${input.reason}`,
          publishedBy: userId,
        });
      }
      return { componentResultId: result.id, applied: true };
    });
  }
}


/**
 * Two snapshots are the same card when everything but generatedAt matches.
 * The comparison is CANONICAL (keys sorted recursively) because Postgres
 * jsonb does not preserve key order — a naive stringify of a stored
 * snapshot never equals a fresh assembly, even with identical data.
 */
function sameSnapshot(a: unknown, b: unknown): boolean {
  const canonicalize = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + canonicalize((v as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  };
  const strip = (v: unknown) => {
    const copy = { ...(v as Record<string, unknown>) };
    delete copy.generatedAt;
    return canonicalize(copy);
  };
  return strip(a) === strip(b);
}

export const examResultsService = new ExamResultsService();
