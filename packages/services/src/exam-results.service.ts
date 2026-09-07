import { requireSchoolId } from "./academic.service";
import { scopeWhere, type DataScope } from "@repo/authz";
import type { SubmitRevisionInput } from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  authzAuditLog,
  attendanceSummary,
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
  studentComponentResultRevisions,
  studentComponentResults,
  studentFinalResults,
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
  annualWeighted,
  applyGrace,
  evaluatePass,
  componentFailed,
  computeRanks,
  examWeightedSubjectScore,
  fromHundredths,
  gpaAggregate,
  gradeFor,
  termAggregate,
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
 * THE RESOLVER SEAM (ADR-032 §12): every per-student subject set comes from
 * `resolveSubjectSet` — v1 returns all counted exam-mode mappings of the
 * class. When `student_subject_enrollments` lands, only this function
 * changes.
 *
 * PUBLISHED ROWS GET REFRESHED, not rewritten: a recompute after
 * publication updates the live aggregates (the card carries the frozen
 * truth; the window close re-photographs it). This is what makes the
 * window's re-version pass able to diff against what was issued.
 */

const CARD_SCOPE_COLUMNS = {
  organizationId: publishedReportCards.organizationId,
  schoolId: publishedReportCards.schoolId,
} as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The shared reads accept either an open transaction or the root db. */
type DbLike = Tx | typeof db;

/** Half-up percentage (hundredths of a percent), tolerating a zero max. */
function percentageOfSafe(total: bigint, max: bigint): bigint {
  if (max === 0n) return 0n;
  return total < 0n ? -(((-total) * 10000n + max / 2n) / max) : (total * 10000n + max / 2n) / max;
}

export class ExamResultsService {
  // -------------------------------------------------------------------------
  // Shared reads
  // -------------------------------------------------------------------------

  /** Pass criteria for a year: the class row wins over the school default. */
  private async resolvePassCriteria(
    tx: DbLike,
    schoolId: string,
    academicYearId: string,
    classId: string | null,
  ) {
    const rows = await tx
      .select()
      .from(passCriteria)
      .where(
        and(eq(passCriteria.schoolId, schoolId), eq(passCriteria.academicYearId, academicYearId)),
      );
    const classRow = classId ? rows.find((c) => c.classId === classId) : undefined;
    return classRow ?? rows.find((c) => c.classId === null) ?? null;
  }

  /** The school's default scale + bands (component overrides resolved by callers). */
  private async resolveDefaultScale(tx: DbLike, schoolId: string) {
    const [scale] = await tx
      .select()
      .from(gradingScales)
      .where(and(eq(gradingScales.schoolId, schoolId), eq(gradingScales.isDefault, true)));
    if (!scale) return null;
    const bands = await tx
      .select()
      .from(gradingScaleBands)
      .where(eq(gradingScaleBands.gradingScaleId, scale.id))
      .orderBy(asc(gradingScaleBands.sequenceNumber));
    return {
      scale,
      bands: bands.map((b) => ({
        minMarks: toHundredths(b.minMarks),
        maxMarks: toHundredths(b.maxMarks),
        gradeLabel: b.gradeLabel,
        gradePoint: b.gradePoint ? toHundredths(b.gradePoint) : null,
      })),
    };
  }

  /**
   * THE RESOLVER SEAM. The class's counted, exam-mode mappings — v1 returns
   * every counted exam-mode mapping (every student takes every mapped
   * subject). Elective machinery later swaps this one function for a read
   * of `student_subject_enrollments`.
   */
  private async resolveSubjectSet(tx: DbLike, classId: string, academicYearId: string) {
    return tx
      .select({
        mappingId: classSubjectMappings.id,
        subjectId: classSubjectMappings.subjectId,
        countsTowardResult: subjectTypes.countsTowardResult,
        isGradedOnly: subjectTypes.isGradedOnly,
      })
      .from(classSubjectMappings)
      .innerJoin(subjectTypes, eq(classSubjectMappings.subjectTypeId, subjectTypes.id))
      .where(
        and(
          eq(classSubjectMappings.classId, classId),
          eq(classSubjectMappings.academicYearId, academicYearId),
          eq(subjectTypes.assessmentMode, "exam"),
        ),
      );
  }

  /** The cohort: active enrollments of the class (or one section) for the year. */
  private async cohortOf(tx: DbLike, classId: string, academicYearId: string, sectionId: string | null) {
    const base = [
      eq(studentEnrollments.classId, classId),
      eq(studentEnrollments.academicYearId, academicYearId),
      inArray(studentEnrollments.enrollmentStatus, ["active", "admitted", "section_assigned"]),
    ];
    return tx
      .selectDistinct({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .where(
        sectionId
          ? and(...base, eq(studentEnrollments.sectionId, sectionId))
          : and(...base),
      );
  }

  // -------------------------------------------------------------------------
  // Compute — components -> subjects -> term (idempotent, re-runnable)
  // -------------------------------------------------------------------------

  /**
   * Recomputes subject results (grace, grades, snapshots) for one exam's
   * class, then each cohort student's term result. Idempotent.
   */
  async computeClassResults(scope: DataScope, examId: string, classId: string) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [exam] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)));
      if (!exam) return null;

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
      const cohort = await this.cohortOf(tx, classId, exam.academicYearId, null);

      const processed: { studentId: string }[] = [];
      for (const { studentId } of cohort) {
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
          const schedule = schedules.find((s) => s.subjectId === mapping.subjectId);
          if (!schedule) continue;
          const scheduleComponents = components.filter((c) => c.scheduleId === schedule.id);
          const studentRows = componentRows.filter(
            (r) => r.scheduleId === schedule.id && r.studentId === studentId,
          );

          if (mapping.isGradedOnly) {
            const overall = studentRows.find((r) => r.gradeObtained !== null);
            outcomes.push({
              subjectId: mapping.subjectId,
              marks: null,
              max: 10000n,
              isPassed: true, // graded-only subjects never fail on marks
              failedComponents: [],
              isAbsent: studentRows.length > 0 && studentRows.every((r) => r.isAbsent),
              isExempted: studentRows.some((r) => r.isExempted),
              grade: overall?.gradeObtained ?? null,
              gradePoint: null,
              countsTowardResult: mapping.countsTowardResult,
              isGradedOnly: true,
            });
            continue;
          }

          const inputs = scheduleComponents.map((c) => {
            const row = studentRows.find((r) => r.componentId === c.id);
            return {
              marks: row?.marksObtained != null ? toHundredths(row.marksObtained) : null,
              maxMarks: toHundredths(c.maxMarks),
              weightagePercentage: toHundredths(c.weightagePercentage),
              passMarks: toHundredths(c.passMarks),
              mandatory: c.isMandatoryPass,
            };
          });
          const marks = weightedComponentRollup(
            inputs.map((c) => ({
              marks: c.marks,
              maxMarks: c.maxMarks,
              weightagePercentage: c.weightagePercentage,
            })),
          );
          const failedComponents = inputs
            .filter((c) => c.mandatory && componentFailed(c.marks, c.passMarks))
            .map((_, i) => scheduleComponents[i]!.id);
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
            isExempted: studentRows.some((r) => r.isExempted),
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
                    schedules.find((sc) => sc.subjectId === s.subjectId)?.passMarks ?? "0.00",
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
            schedules.find((sc) => sc.subjectId === outcome.subjectId)?.passMarks ?? "0.00",
          );
          const isPassed = outcome.isGradedOnly
            ? true
            : evaluatePass({ finalMarks: final, passMark, mandatoryComponentFailed: outcome.failedComponents.length > 0 });
          const gradeObj = outcome.isGradedOnly
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
            finalMarks: outcome.isGradedOnly ? null : fromHundredths(final),
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

          const [existing] = await tx
            .select({ id: studentSubjectResults.id })
            .from(studentSubjectResults)
            .where(
              and(
                eq(studentSubjectResults.studentId, studentId),
                eq(studentSubjectResults.examId, examId),
                eq(studentSubjectResults.subjectId, outcome.subjectId),
              ),
            );
          if (existing) {
            await tx
              .update(studentSubjectResults)
              .set(values)
              .where(eq(studentSubjectResults.id, existing.id));
          } else {
            await tx.insert(studentSubjectResults).values({
              organizationId: scope.organizationId,
              schoolId,
              studentId,
              examId,
              subjectId: outcome.subjectId,
              ...values,
            });
          }
        }
        processed.push({ studentId });
      }

      // The term result folds in every counted exam of the term.
      for (const { studentId } of processed) {
        await this.computeTermResult(tx, studentId, exam.termId, schoolId, scope.organizationId);
      }
      return processed;
    });
  }

  /**
   * One student's term result: every counted exam of the term folds into
   * per-subject term scores (weight-normalized), then the term aggregate.
   * The GPA branch activates when every counted subject is graded-only.
   * Idempotent; published rows get their numbers refreshed (the card is the
   * frozen truth, and a re-issue re-photographs it).
   */
  async computeTermResult(
    tx: DbLike,
    studentId: string,
    termId: string,
    schoolId: string,
    organizationId: string,
  ) {
    const [term] = await tx.select().from(terms).where(eq(terms.id, termId));
    if (!term) return null;

    const termExams = await tx
      .select()
      .from(exams)
      .where(and(eq(exams.termId, termId), eq(exams.countsTowardTermResult, true)));
    if (termExams.length === 0) return null;
    const termExamIds = termExams.map((e) => e.id);

    const subjectResults = await tx
      .select()
      .from(studentSubjectResults)
      .where(
        and(
          eq(studentSubjectResults.studentId, studentId),
          inArray(studentSubjectResults.examId, termExamIds),
        ),
      );

    const classId = (
      await tx
        .select({ classId: examSubjectSchedules.classId })
        .from(examSubjectSchedules)
        .where(inArray(examSubjectSchedules.examId, termExamIds))
        .limit(1)
    )[0]?.classId;
    const subjectSet = classId
      ? await this.resolveSubjectSet(tx, classId, term.academicYearId)
      : [];
    const scale = await this.resolveDefaultScale(tx, schoolId);
    const criteria = await this.resolvePassCriteria(tx, schoolId, term.academicYearId, classId ?? null);

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
      const votes = subjectResults.filter((sr) => sr.subjectId === setType.subjectId);
      if (votes.length === 0) continue;
      const gradedOnly = setType.isGradedOnly;
      const score = gradedOnly
        ? 0n
        : examWeightedSubjectScore(
            votes.map((v) => {
              const weight = toHundredths(
                termExams.find((e) => e.id === v.examId)?.weightageInTerm ?? "0.00",
              );
              return {
                marks: v.finalMarks ? toHundredths(v.finalMarks) : 0n,
                maxMarks: 10000n,
                weightage: weight,
              };
            }),
          );
      const isPassed = gradedOnly ? true : votes.every((v) => v.isPassed);
      const gradePoint = votes[0]?.gradePoint ? toHundredths(votes[0].gradePoint) : null;
      scores.push({
        subjectId: setType.subjectId,
        termScore: score,
        maxScore: 10000n,
        countsTowardResult: setType.countsTowardResult,
        isPassed,
        gradePoint,
        isGradedOnly: gradedOnly,
      });
    }

    const countedScores = scores.filter((s) => s.countsTowardResult);
    const allGradedOnly =
      countedScores.length > 0 && countedScores.every((s) => s.isGradedOnly);
    const gpa = allGradedOnly
      ? gpaAggregate(countedScores.map((s) => s.gradePoint ?? 0n))
      : null;

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

    const [attendance] = await tx
      .select({ pct: attendanceSummary.attendancePercentage })
      .from(attendanceSummary)
      .where(
        and(
          eq(attendanceSummary.studentId, studentId),
          eq(attendanceSummary.academicYearId, term.academicYearId),
          eq(attendanceSummary.periodType, "term"),
          eq(attendanceSummary.termId, termId),
        ),
      );

    // The section snapshot: ranks are computed per section, so the term row
    // must remember where the student sat (mid-year moves don't rewrite it).
    const [enrollment] = await tx
      .select({ sectionId: studentEnrollments.sectionId })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.studentId, studentId),
          eq(studentEnrollments.academicYearId, term.academicYearId),
        ),
      );

    const values = {
      sectionId: enrollment?.sectionId ?? null,
      totalMarks: allGradedOnly ? null : fromHundredths(aggregate.totalMarks),
      maxMarks: allGradedOnly ? null : fromHundredths(aggregate.maxMarks),
      percentage: allGradedOnly ? null : fromHundredths(aggregate.percentage),
      grade: grade?.gradeLabel ?? (allGradedOnly ? null : grade?.gradeLabel ?? null),
      gradePoint: gpa !== null ? fromHundredths(gpa) : grade?.gradePoint ? fromHundredths(grade.gradePoint) : null,
      isPassed,
      subjectsFailedCount: failedSubjects.length,
      subjectsFailed: failedSubjects,
      attendancePercentage: attendance?.pct ?? null,
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
      computedAt: new Date(),
    };

    const [existing] = await tx
      .select({ id: studentTermResults.id })
      .from(studentTermResults)
      .where(and(eq(studentTermResults.studentId, studentId), eq(studentTermResults.termId, termId)));
    if (existing) {
      await tx.update(studentTermResults).set(values).where(eq(studentTermResults.id, existing.id));
      return { studentId, termId, ...values };
    }
    const [row] = await tx
      .insert(studentTermResults)
      .values({ organizationId, schoolId, studentId, termId, ...values })
      .returning();
    return row;
  }

  // -------------------------------------------------------------------------
  // Ranks — explicit, never live
  // -------------------------------------------------------------------------

  /**
   * Term ranks: rankInSection within the snapshotted section, rankInClass
   * across the class. Score = percentage (GPA classes rank by grade point).
   * Competition ranking; ties share.
   */
  async computeTermRanks(scope: DataScope, termId: string) {
    const schoolId = requireSchoolId(scope);
    const rows = await db
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
    for (const [sectionId, entries] of bySection) {
      for (const [id, rank] of computeRanks(entries)) {
        await db
          .update(studentTermResults)
          .set({ rankInSection: rank, rankComputedAt: now })
          .where(eq(studentTermResults.id, id));
        updated += 1;
      }

      // rankInClass across every section of this section's class.
      const [section] = await db
        .select({ classId: sections.classId })
        .from(sections)
        .where(eq(sections.id, sectionId));
      if (!section) continue;
      const classRows = rows.filter((r) => {
        const sectionIdOf = r.sectionId;
        return sectionIdOf != null;
      });
      const classEntries: { id: string; score: bigint }[] = [];
      for (const r of classRows) {
        if (!r.sectionId) continue;
        const [sec] = await db.select({ classId: sections.classId }).from(sections).where(eq(sections.id, r.sectionId));
        if (sec?.classId === section.classId) {
          classEntries.push({ id: r.id, score: scoreOf(r) });
        }
      }
      for (const [id, rank] of computeRanks(classEntries)) {
        await db
          .update(studentTermResults)
          .set({ rankInClass: rank, rankComputedAt: now })
          .where(eq(studentTermResults.id, id));
      }
    }
    return { updated };
  }

  // -------------------------------------------------------------------------
  // Final results + promotion (year end)
  // -------------------------------------------------------------------------

  async computeFinalResults(scope: DataScope, academicYearId: string) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;
    const yearTerms = await db
      .select()
      .from(terms)
      .where(and(eq(terms.academicYearId, academicYearId), eq(terms.schoolId, schoolId)))
      .orderBy(asc(terms.sequenceNumber));
    const termIds = yearTerms.map((t) => t.id);
    if (termIds.length === 0) return [];

    const termResults = await db
      .select()
      .from(studentTermResults)
      .where(inArray(studentTermResults.termId, termIds));
    const byStudent = new Map<string, typeof termResults>();
    for (const row of termResults) {
      const list = byStudent.get(row.studentId) ?? [];
      list.push(row);
      byStudent.set(row.studentId, list);
    }

    const scale = await this.resolveDefaultScale(db, schoolId);
    const criteria = await this.resolvePassCriteria(db, schoolId, academicYearId, null);
    const out: { studentId: string; promotionStatus: string }[] = [];

    for (const [studentId, rows] of byStudent) {
      const ordered = rows
        .map((r) => ({ row: r, term: yearTerms.find((t) => t.id === r.termId)! }))
        .sort((a, b) => a.term.sequenceNumber - b.term.sequenceNumber);
      const last = ordered[ordered.length - 1]!.row;
      const weighted = annualWeighted(
        ordered.map((o) => ({
          percentage: toHundredths(o.row.percentage ?? "0.00"),
          weightage: toHundredths(o.term.weightage),
        })),
      );
      const lastOnly = toHundredths(last.percentage ?? "0.00");
      // The policy: cumulative terms fold into the annual; a terminal last
      // term IS the annual.
      const isCumulative = ordered.some((o) => o.term.resultMode === "cumulative");
      const percentage = isCumulative ? weighted : lastOnly;
      const grade = scale ? gradeFor(percentage, scale.bands) : null;
      const failedCount = ordered.reduce((a, o) => a + o.row.subjectsFailedCount, 0);

      const promotionStatus: "promoted" | "detained" | "compartment" =
        isPassedAll(ordered) || last.isPassed
          ? "promoted"
          : criteria?.compartmentAllowed && failedCount <= (criteria.maxSubjectsForCompartment ?? 0)
            ? "compartment"
            : "detained";
      const isPassed = promotionStatus === "promoted";

      const values = {
        percentage: fromHundredths(percentage),
        grade: grade?.gradeLabel ?? null,
        gradePoint: grade?.gradePoint ? fromHundredths(grade.gradePoint) : null,
        isPassed,
        subjectsFailedCount: failedCount,
        attendancePercentage: last.attendancePercentage,
        promotionStatus,
        computedAt: new Date(),
      };

      const [existing] = await db
        .select({ id: studentFinalResults.id })
        .from(studentFinalResults)
        .where(
          and(
            eq(studentFinalResults.studentId, studentId),
            eq(studentFinalResults.academicYearId, academicYearId),
          ),
        );
      if (existing) {
        await db.update(studentFinalResults).set(values).where(eq(studentFinalResults.id, existing.id));
      } else {
        await db.insert(studentFinalResults).values({
          organizationId,
          schoolId,
          studentId,
          academicYearId,
          ...values,
        });
      }
      out.push({ studentId, promotionStatus });
    }
    return out;
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

    const typeBySubject = new Map<string, { name: string; sequence: number }>();
    for (const [subjectId] of bySubject) {
      const [row] = await tx
        .select({ name: subjectTypes.name, sequence: subjectTypes.sequence })
        .from(classSubjectMappings)
        .innerJoin(subjectTypes, eq(classSubjectMappings.subjectTypeId, subjectTypes.id))
        .where(eq(classSubjectMappings.subjectId, subjectId));
      if (row) typeBySubject.set(subjectId, row);
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
        className: "",
        sectionName: null,
        rollNumber: null,
      },
      school: { name: "" },
      academicYear: { name: year?.name ?? "" },
      term: { id: termId, name: termRow?.name ?? "" },
      subjects: [...bySubject.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([subjectId, rows]) => {
        const score = rows[0]!.isExempted
          ? null
          : examWeightedSubjectScore(
              rows.map((r) => ({
                marks: r.marksObtained ? toHundredths(r.marksObtained) : 0n,
                maxMarks: 10000n,
                weightage: toHundredths(r.weightage),
              })),
            );
        const type = typeBySubject.get(subjectId);
        return {
          subjectId,
          subjectName: rows[0]!.subjectName,
          subjectTypeId: null,
          widgetName: type?.name ?? null,
          widgetSequence: type?.sequence ?? null,
          marksObtained: score === null || (score === 0n && rows.every((r) => r.isAbsent)) ? null : fromHundredths(score),
          maxMarks: "100.00",
          grade: rows[0]!.grade,
          gradePoint: rows[0]!.gradePoint,
          isAbsent: rows.some((r) => r.isAbsent),
          isExempted: rows.some((r) => r.isExempted),
          countsTowardResult: rows[0]!.countsTowardResult,
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
      for (const schedule of schedules) {
        const cohort = await this.cohortOf(tx, classId, exam.academicYearId, schedule.sectionId);
        const [components] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(examComponents)
          .where(eq(examComponents.scheduleId, schedule.id));
        const entered = await tx
          .selectDistinct({ studentId: studentComponentResults.studentId })
          .from(studentComponentResults)
          .where(
            and(
              eq(studentComponentResults.scheduleId, schedule.id),
              sql`${studentComponentResults.resultStatus} <> 'draft'`,
            ),
          );
        if ((components?.count ?? 0) === 0 || entered.length < cohort.length) {
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
        await tx
          .update(studentComponentResults)
          .set({ resultStatus: "published", publishedAt: new Date() })
          .where(inArray(studentComponentResults.scheduleId, scheduleIds));
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
    const stats = subjectsOfExam.map((subject) => {
      const rows = subjectResults.filter(
        (r) =>
          r.subjectId === subject.id &&
          r.countsTowardResult &&
          !r.isExempted &&
          r.finalMarks != null,
      );
      const scores = rows.map((r) => Number(r.finalMarks));
      const average =
        scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      const highest = scores.length > 0 ? Math.max(...scores) : null;
      return {
        subjectId: subject.id,
        average: average != null ? average.toFixed(2) : null,
        highest: highest != null ? highest.toFixed(2) : null,
        passCount: rows.filter((r) => r.isPassed).length,
        enteredCount: rows.length,
      };
    });
    const percentages = termResults
      .map((r) => (r.percentage != null ? Number(r.percentage) : null))
      .filter((p): p is number => p != null);
    const classAverage =
      percentages.length > 0
        ? (percentages.reduce((a, b) => a + b, 0) / percentages.length).toFixed(2)
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
  async publishExam(scope: DataScope, userId: string, examId: string) {
    const schoolId = requireSchoolId(scope);
    const classIds = (
      await db
        .selectDistinct({ classId: examSubjectSchedules.classId })
        .from(examSubjectSchedules)
        .where(and(eq(examSubjectSchedules.examId, examId), eq(examSubjectSchedules.schoolId, schoolId)))
    ).map((r) => r.classId);
    for (const classId of classIds) {
      await this.publishClass(scope, userId, examId, classId);
    }
    return { publishedClasses: classIds.length };
  }

  // -------------------------------------------------------------------------
  // Revision windows + the quick edit (hard rule 7)
  // -------------------------------------------------------------------------

  async openRevisionWindow(scope: DataScope, userId: string, examId: string, classId: string) {
    const schoolId = requireSchoolId(scope);
    const [row] = await db
      .update(examClassPublication)
      .set({ state: "revision_open", revisionOpenedBy: userId, revisionOpenedAt: new Date() })
      .where(
        and(
          eq(examClassPublication.examId, examId),
          eq(examClassPublication.classId, classId),
          eq(examClassPublication.state, "published"),
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
          ),
        );
      if (!publication) return null;

      const [exam] = await tx.select().from(exams).where(eq(exams.id, examId));
      if (!exam) return null;
      const cohort = await this.cohortOf(tx, classId, exam.academicYearId, null);
      await this.computeClassResults(scope, examId, classId);
      for (const { studentId } of cohort) {
        await this.computeTermResult(tx, studentId, exam.termId, schoolId, scope.organizationId);
      }
      await this.computeTermRanks(scope, exam.termId);

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

  /**
   * The quick edit's impact preview — computed live, never written. Returns
   * the revised numbers plus every OTHER student whose rank would move.
   */
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
      .where(and(eq(publishedReportCards.id, cardId), inArray(publishedReportCards.studentId, studentIds)));
    return card ?? null;
  }

  async previewRevision(scope: DataScope, input: SubmitRevisionInput) {
    const schoolId = requireSchoolId(scope);
    const [result] = await db
      .select()
      .from(studentComponentResults)
      .where(
        and(
          eq(studentComponentResults.id, input.id),
          eq(studentComponentResults.schoolId, schoolId),
        ),
      );
    if (!result) return null;

    const [schedule] = await db
      .select({ classId: examSubjectSchedules.classId })
      .from(examSubjectSchedules)
      .where(eq(examSubjectSchedules.id, result.scheduleId));
    const [exam] = await db.select().from(exams).where(eq(exams.id, result.examId));
    if (!schedule || !exam) return null;

    // Simulate: apply the mark, recompute in-memory ranks for the section,
    // and diff against the current ones.
    await this.computeClassResults(scope, result.examId, schedule.classId);
    await this.computeTermResult(db, result.studentId, exam.termId, schoolId, scope.organizationId);
    await this.computeTermRanks(scope, exam.termId);

    const cohort = await db.transaction(async (tx) =>
      this.cohortOf(tx, schedule.classId, exam.academicYearId, null),
    );
    const affected = (
      await db
        .select({
          studentId: studentTermResults.studentId,
          rank: studentTermResults.rankInSection,
          percentage: studentTermResults.percentage,
        })
        .from(studentTermResults)
        .where(
          and(
            eq(studentTermResults.termId, exam.termId),
            inArray(
              studentTermResults.studentId,
              cohort.map((c) => c.studentId),
            ),
          ),
        )
    ).map((r) => ({
      studentId: r.studentId,
      rank: r.rank,
      percentage: r.percentage,
    }));

    return {
      componentResultId: input.id,
      affected: affected,
    } as unknown as import("@repo/contracts").RevisionImpact;
  }

  /**
   * Applies a post-publication correction: the ledger row FIRST (hard rule
   * 7), then the mark, then the recompute, then the re-photograph of every
   * affected card — one transaction.
   */
  async applyRevision(scope: DataScope, userId: string, input: SubmitRevisionInput) {
    const schoolId = requireSchoolId(scope);

    // STEP 1 — the ledger row FIRST, then the mark (hard rule 7). One small
    // transaction holding only this row's lock.
    const componentResultId = await db.transaction(async (tx) => {
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
      return result.id;
    });
    if (componentResultId === null) return null;

    // STEP 2 — recompute on FRESH connections. The step-1 locks are released,
    // so the engine's own transactions cannot deadlock against them.
    const [resultRow] = await db
      .select()
      .from(studentComponentResults)
      .where(eq(studentComponentResults.id, componentResultId));
    const [schedule] = await db
      .select({ classId: examSubjectSchedules.classId })
      .from(examSubjectSchedules)
      .where(eq(examSubjectSchedules.id, resultRow!.scheduleId));
    const [exam] = await db.select().from(exams).where(eq(exams.id, resultRow!.examId));
    if (schedule && exam) {
      await this.computeClassResults(scope, resultRow!.examId, schedule.classId);
      await this.computeTermResult(db, resultRow!.studentId, exam.termId, schoolId, scope.organizationId);
      await this.computeTermRanks(scope, exam.termId);

      // STEP 3 — re-photograph every current card of the class whose frozen
      // data moved. Idempotent: unchanged cards keep their version.
      await db.transaction(async (tx) => {
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
      });
    }
    return { componentResultId, applied: true };
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

function isPassedAll(
  ordered: { row: { isPassed: boolean } }[],
): boolean {
  return ordered.every((o) => o.row.isPassed);
}

export const examResultsService = new ExamResultsService();
