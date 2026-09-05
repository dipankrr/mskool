import {
  atSchoolLevel,
  requireSchoolId,
} from "./academic.service";
import { scopeWhere, type DataScope } from "@repo/authz";
import type {
  OverrideEligibilityInput,
  SaveComponentResultInput,
  SaveTermAssessmentInput,
  VerifyComponentResultsInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  studentEnrollments,
  attendanceSummary,
  classSubjectMappings,
  examClassPublication,
  examComponents,
  examEligibility,
  examSubjectSchedules,
  exams,
  passCriteria,
  studentComponentResults,
  subjectTypes,
  termAssessments,
} from "@repo/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

/**
 * EXAM MARKS — B4b: eligibility (advisory), the autosave cell, verification,
 * and term assessments (ADR-032).
 *
 * **The autosave cell.** One row upsert per save, created lazily; the write
 * takes `expectedUpdatedAt` and refuses when another writer moved the row
 * first (optimistic concurrency — two teachers on one grid). A row that is
 * verified/published can no longer be autosaved: the revision window is the
 * only post-verification correction path. Status-aware value rule mirrors
 * the database CHECK: draft rows may be empty, entered rows must carry a
 * mark, grade, or absent/exempt flag.
 *
 * **Eligibility is advisory** (ADR-032 §9): it is computed from
 * `attendance_summary` against the resolved pass criteria, surfaced once on
 * the readiness screen, and every override (the NORMAL path) is recorded
 * with its reason. Nothing here blocks anything.
 *
 * **Verification** moves Entered → Verified in batch; it is deliberately
 * optional — publish tolerates Entered rows with a warning. The subject
 * gate (ADR-029) sits in the ROUTER (`marks:create` etc. are
 * SUBJECT_GATED_WRITES); this service enforces only what no caller shape
 * can bypass: scope, state, and concurrency.
 */

const COMPONENT_RESULT_SCOPE_COLUMNS = {
  organizationId: studentComponentResults.organizationId,
  schoolId: studentComponentResults.schoolId,
} as const;

export interface SavedComponentResult {
  id: string;
  resultStatus: string;
  marksObtained: string | null;
  gradeObtained: string | null;
  isAbsent: boolean;
  isExempted: boolean;
  updatedAt: Date;
}

export class ExamMarksService {
  // -------------------------------------------------------------------------
  // Eligibility — advisory, recomputable, overridable
  // -------------------------------------------------------------------------

  async listEligibility(scopes: DataScope[], examId: string) {
    return db
      .select()
      .from(examEligibility)
      .where(
        and(
          eq(examEligibility.examId, examId),
          scopeWhere(scopes.map(atSchoolLevel), {
            organizationId: examEligibility.organizationId,
            schoolId: examEligibility.schoolId,
          }),
        ),
      )
      .orderBy(asc(examEligibility.studentId));
  }

  /**
   * Recomputes eligibility for the exam's whole cohort from the attendance
   * summary (term row when present, annual row as fallback) against the
   * resolved pass criteria (class row overrides the school default).
   * Overrides are PRESERVED — a recomputation refreshes the numbers, never
   * the principal's decision.
   */
  async recomputeEligibility(scope: DataScope, examId: string) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [exam] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)));
      if (!exam) return null;
      return this.recomputeCohortEligibility(tx, exam.id, exam.termId, exam.academicYearId, schoolId, scope.organizationId);
    });
  }

  /**
   * The actual cohort recompute, shared by the state transition. Reads the
   * attendance summary (term row, else annual) and the resolved criteria
   * per class, then upserts one eligibility row per cohort student.
   */
  private async recomputeCohortEligibility(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    examId: string,
    termId: string,
    academicYearId: string,
    schoolId: string,
    organizationId: string,
  ) {
    const schedules = await tx
      .select({ classId: examSubjectSchedules.classId })
      .from(examSubjectSchedules)
      .where(eq(examSubjectSchedules.examId, examId));
    const classIds = [...new Set(schedules.map((s) => s.classId))];
    if (classIds.length === 0) return [];

    // Drizzle-native cohort read (distinct students across the classes).
    const cohortRows = await tx
      .selectDistinct({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .where(
        and(
          inArray(studentEnrollments.classId, classIds),
          eq(studentEnrollments.academicYearId, academicYearId),
          inArray(studentEnrollments.enrollmentStatus, ["active", "admitted", "section_assigned"]),
        ),
      );

    const criteriaRows = await tx
      .select()
      .from(passCriteria)
      .where(
        and(eq(passCriteria.schoolId, schoolId), eq(passCriteria.academicYearId, academicYearId)),
      );

    const results: { studentId: string; isEligible: boolean }[] = [];
    for (const { studentId } of cohortRows) {
      // Attendance: the term row when present, else the annual row.
      const [termRow] = await tx
        .select({ pct: attendanceSummary.attendancePercentage })
        .from(attendanceSummary)
        .where(
          and(
            eq(attendanceSummary.studentId, studentId),
            eq(attendanceSummary.academicYearId, academicYearId),
            eq(attendanceSummary.periodType, "term"),
            eq(attendanceSummary.termId, termId),
          ),
        );
      let pct = termRow?.pct ?? null;
      if (pct === null) {
        const [annualRow] = await tx
          .select({ pct: attendanceSummary.attendancePercentage })
          .from(attendanceSummary)
          .where(
            and(
              eq(attendanceSummary.studentId, studentId),
              eq(attendanceSummary.academicYearId, academicYearId),
              eq(attendanceSummary.periodType, "annual"),
            ),
          );
        pct = annualRow?.pct ?? "0.00";
      }

      // Resolved criteria: the class override wins over the school default.
      const [enrollment] = await tx
        .select({ classId: studentEnrollments.classId })
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.studentId, studentId),
            eq(studentEnrollments.academicYearId, academicYearId),
          ),
        );
      const classRow = enrollment
        ? criteriaRows.find((c) => c.classId === enrollment.classId)
        : undefined;
      const schoolRow = criteriaRows.find((c) => c.classId === null);
      const resolved = classRow ?? schoolRow;
      const minRequired = resolved?.minAttendancePct ?? "75.00";
      const isEligible = Number(pct) >= Number(minRequired);

      const [existing] = await tx
        .select({
          id: examEligibility.id,
          isOverridden: examEligibility.isOverridden,
          overrideEligible: examEligibility.overrideEligible,
        })
        .from(examEligibility)
        .where(
          and(eq(examEligibility.examId, examId), eq(examEligibility.studentId, studentId)),
        );

      if (existing) {
        // Overrides are PRESERVED — recompute refreshes the numbers, never
        // the principal's decision.
        await tx
          .update(examEligibility)
          .set({
            attendancePercentage: pct,
            minRequiredPct: minRequired,
            isEligible: existing.isOverridden ? (existing.overrideEligible ?? isEligible) : isEligible,
            computedAt: new Date(),
          })
          .where(eq(examEligibility.id, existing.id));
      } else {
        await tx.insert(examEligibility).values({
          organizationId,
          schoolId,
          examId,
          studentId,
          attendancePercentage: pct,
          minRequiredPct: minRequired,
          isEligible,
          computedAt: new Date(),
        });
      }
      results.push({ studentId, isEligible });
    }
    return results;
  }

  async overrideEligibility(scope: DataScope, userId: string, input: OverrideEligibilityInput) {
    const schoolId = requireSchoolId(scope);
    const [row] = await db
      .update(examEligibility)
      .set({
        isOverridden: true,
        overrideEligible: input.overrideEligible,
        overrideReason: input.reason,
        overriddenBy: userId,
        overriddenAt: new Date(),
        isEligible: input.overrideEligible,
      })
      .where(
        and(
          eq(examEligibility.examId, input.examId),
          eq(examEligibility.studentId, input.studentId),
          eq(examEligibility.schoolId, schoolId),
        ),
      )
      .returning();
    return row ?? null;
  }

  // -------------------------------------------------------------------------
  // The autosave cell
  // -------------------------------------------------------------------------

  /**
   * One cell save: create-or-update with the optimistic guard. Returns the
   * fresh row so the grid updates without a refetch.
   */
  async saveComponentResult(
    scope: DataScope,
    userId: string,
    input: SaveComponentResultInput,
  ): Promise<SavedComponentResult | null> {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [schedule] = await tx
        .select({
          id: examSubjectSchedules.id,
          isLocked: examSubjectSchedules.isLocked,
          examStatus: exams.status,
        })
        .from(examSubjectSchedules)
        .innerJoin(exams, eq(examSubjectSchedules.examId, exams.id))
        .where(
          and(
            eq(examSubjectSchedules.id, input.scheduleId),
            eq(examSubjectSchedules.schoolId, schoolId),
          ),
        );
      if (!schedule) return null;
      if (!["marks_entry", "under_verification"].includes(schedule.examStatus)) {
        throw new Error("Marks entry is not open for this exam.");
      }

      const [component] = await tx
        .select({ id: examComponents.id })
        .from(examComponents)
        .where(
          and(
            eq(examComponents.id, input.componentId),
            eq(examComponents.scheduleId, input.scheduleId),
          ),
        );
      if (!component) return null;

      const [existing] = await tx
        .select()
        .from(studentComponentResults)
        .where(
          and(
            eq(studentComponentResults.studentId, input.studentId),
            eq(studentComponentResults.examId, input.examId),
            eq(studentComponentResults.componentId, input.componentId),
          ),
        )
        .for("update");

      if (existing && ["verified", "published", "locked"].includes(existing.resultStatus)) {
        if (existing.resultStatus === "verified" && schedule.examStatus === "under_verification") {
          throw new Error(
            "This entry is verified — open a revision window to correct it.",
          );
        }
        if (["published", "locked"].includes(existing.resultStatus)) {
          throw new Error(
            "This result is published — corrections go through the revision ledger.",
          );
        }
        throw new Error("This entry is verified and can no longer be autosaved.");
      }

      if (existing && input.expectedUpdatedAt) {
        const expected = new Date(input.expectedUpdatedAt);
        if (existing.updatedAt.getTime() !== expected.getTime()) {
          throw new Error(
            "This entry changed while you were typing — refresh the cell and reapply.",
          );
        }
      }

      const hasValue =
        input.marks != null ||
        (input.grade != null && input.grade !== "") ||
        input.isAbsent ||
        input.isExempted;
      const status = hasValue ? "entered" : "draft";
      const now = new Date();

      if (existing) {
        const [row] = await tx
          .update(studentComponentResults)
          .set({
            marksObtained: input.marks ?? null,
            gradeObtained: input.grade ?? null,
            isAbsent: input.isAbsent,
            isExempted: input.isExempted,
            exemptionType: input.isExempted ? (input.exemptionType ?? null) : null,
            resultStatus: status,
            enteredBy: userId,
            enteredAt: now,
          })
          .where(eq(studentComponentResults.id, existing.id))
          .returning();
        return row
          ? {
              id: row.id,
              resultStatus: row.resultStatus,
              marksObtained: row.marksObtained,
              gradeObtained: row.gradeObtained,
              isAbsent: row.isAbsent,
              isExempted: row.isExempted,
              updatedAt: row.updatedAt,
            }
          : null;
      }

      const [row] = await tx
        .insert(studentComponentResults)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: input.studentId,
          examId: input.examId,
          scheduleId: input.scheduleId,
          componentId: input.componentId,
          marksObtained: input.marks ?? null,
          gradeObtained: input.grade ?? null,
          isAbsent: input.isAbsent,
          isExempted: input.isExempted,
          exemptionType: input.isExempted ? (input.exemptionType ?? null) : null,
          resultStatus: status,
          enteredBy: userId,
          enteredAt: now,
        })
        .returning();
      return row
        ? {
            id: row.id,
            resultStatus: row.resultStatus,
            marksObtained: row.marksObtained,
            gradeObtained: row.gradeObtained,
            isAbsent: row.isAbsent,
            isExempted: row.isExempted,
            updatedAt: row.updatedAt,
          }
        : null;
    });
  }

  /** Batch verify: Entered → Verified. Rows must carry a value or a flag. */
  async verifyComponentResults(
    scope: DataScope,
    userId: string,
    input: VerifyComponentResultsInput,
  ) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(studentComponentResults)
        .where(inArray(studentComponentResults.id, input.componentResultIds));
      const inScope = rows.filter((r) => r.schoolId === schoolId);
      if (inScope.length !== input.componentResultIds.length) {
        throw new Error("Some entries do not exist in this school.");
      }
      const empty = inScope.find(
        (r) =>
          r.resultStatus === "draft" &&
          !r.isAbsent &&
          !r.isExempted &&
          r.marksObtained === null &&
          r.gradeObtained === null,
      );
      if (empty) {
        throw new Error("An unentered entry cannot be verified — enter a value or mark it absent first.");
      }
      return tx
        .update(studentComponentResults)
        .set({ resultStatus: "verified", verifiedBy: userId, verifiedAt: new Date() })
        .where(inArray(studentComponentResults.id, inScope.map((r) => r.id)))
        .returning();
    });
  }

  /** The readiness screen's entry-completeness data for one exam + class. */
  async entrySummary(scope: DataScope, examId: string, classId: string) {
    const schoolId = requireSchoolId(scope);
    const [entered] = await db
      .select({
        entered: sql<number>`count(*) FILTER (WHERE ${studentComponentResults.resultStatus} <> 'draft')::int`,
        verified: sql<number>`count(*) FILTER (WHERE ${studentComponentResults.resultStatus} = 'verified')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(studentComponentResults)
      .innerJoin(
        examSubjectSchedules,
        eq(studentComponentResults.scheduleId, examSubjectSchedules.id),
      )
      .where(
        and(
          eq(studentComponentResults.examId, examId),
          eq(examSubjectSchedules.classId, classId),
          eq(studentComponentResults.schoolId, schoolId),
        ),
      );
    return entered ?? { entered: 0, verified: 0, total: 0 };
  }

  // -------------------------------------------------------------------------
  // Term assessments — the term_grade pipeline (areas; never the math)
  // -------------------------------------------------------------------------

  async listTermAssessments(scopes: DataScope[], termId: string) {
    return db
      .select()
      .from(termAssessments)
      .where(
        and(
          eq(termAssessments.termId, termId),
          scopeWhere(scopes.map(atSchoolLevel), {
            organizationId: termAssessments.organizationId,
            schoolId: termAssessments.schoolId,
          }),
        ),
      );
  }

  async saveTermAssessment(scope: DataScope, userId: string, input: SaveTermAssessmentInput) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      // The mapping's type must be term_grade — exam-mode subjects cannot be
      // assessed here even by a direct call.
      const [mapping] = await tx
        .select({ mode: subjectTypes.assessmentMode, name: subjectTypes.name })
        .from(classSubjectMappings)
        .innerJoin(subjectTypes, eq(classSubjectMappings.subjectTypeId, subjectTypes.id))
        .where(eq(classSubjectMappings.id, input.mappingId));
      if (!mapping) return null;
      if (mapping.mode !== "term_grade") {
        throw new Error(
          `"${mapping.name}" is an exam-assessed subject — its grades come from marks, not term-end entry.`,
        );
      }

      const [row] = await tx
        .insert(termAssessments)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          studentId: input.studentId,
          termId: input.termId,
          mappingId: input.mappingId,
          grade: input.grade,
          descriptor: input.descriptor ?? null,
          teacherRemarks: input.teacherRemarks ?? null,
          enteredBy: userId,
        })
        .onConflictDoUpdate({
          target: [termAssessments.studentId, termAssessments.termId, termAssessments.mappingId],
          set: {
            grade: input.grade,
            descriptor: input.descriptor ?? null,
            teacherRemarks: input.teacherRemarks ?? null,
            enteredBy: userId,
          },
        })
        .returning();
      return row ?? null;
    });
  }

  // -------------------------------------------------------------------------
  // Owner adapters
  // -------------------------------------------------------------------------

  async getComponentResultOwnerId(organizationId: string, id: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: studentComponentResults.schoolId })
      .from(studentComponentResults)
      .where(
        and(
          eq(studentComponentResults.id, id),
          eq(studentComponentResults.organizationId, organizationId),
        ),
      );
    return row?.schoolId ?? null;
  }

  async getExamClassPublicationExists(organizationId: string, examId: string, classId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: examClassPublication.id })
      .from(examClassPublication)
      .where(
        and(
          eq(examClassPublication.examId, examId),
          eq(examClassPublication.classId, classId),
          eq(examClassPublication.organizationId, organizationId),
        ),
      );
    return row != null;
  }
}

// The cohort reads use the enrollments table directly (Phase 2's year
// anchor); student_subject_enrollments arrives with the elective machinery
// (ADR-032 §12) and will refine the subject set, not the cohort.

export const examMarksService = new ExamMarksService();
