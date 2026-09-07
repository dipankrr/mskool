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
  studentEnrollments as studentEnrollmentsSection,
  studentSubjectResults,
  studentEnrollments,
  attendanceSummary,
  classSubjectMappings,
  examClassPublication,
  examComponents,
  examEligibility,
  examSubjectSchedules,
  exams,
  passCriteria,
  sections,
  studentComponentResults,
  students,
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
   * Public for ExamConfigService.transition (ADR-032 §9 recomputes on
   * transitions) — always called with the caller's open transaction, never
   * in its own, so a failed recompute rolls the transition back.
   */
  async recomputeCohortEligibility(
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
    // The student must belong to THIS exam's cohort: an active enrollment
    // in a class the exam schedules. A studentId from another branch — or
    // a class the exam never scheduled — is a miss, not an override. And a
    // section/class-scoped caller allows only their own students.
    const [exam] = await db
      .select({ academicYearId: exams.academicYearId })
      .from(exams)
      .where(and(eq(exams.id, input.examId), eq(exams.schoolId, schoolId)));
    if (!exam) return null;
    const scheduled = await db
      .select({ classId: examSubjectSchedules.classId })
      .from(examSubjectSchedules)
      .where(eq(examSubjectSchedules.examId, input.examId));
    const [enrollment] = await db
      .select({
        classId: studentEnrollments.classId,
        sectionId: studentEnrollments.sectionId,
      })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.studentId, input.studentId),
          eq(studentEnrollments.academicYearId, exam.academicYearId),
          eq(studentEnrollments.schoolId, schoolId),
          inArray(studentEnrollments.enrollmentStatus, [
            "active",
            "admitted",
            "section_assigned",
          ]),
        ),
      );
    if (!enrollment || !scheduled.some((s) => s.classId === enrollment.classId)) {
      return null;
    }
    if (scope.sectionId && enrollment.sectionId !== scope.sectionId) {
      return null;
    }
    if (!scope.sectionId && scope.classId && enrollment.classId !== scope.classId) {
      return null;
    }
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
   *
   * `sectionId`/`subjectId` are REQUIRED (not just router-gated): the
   * router's subjectGate answers the assignment fact on the pair, and here
   * the pair must also BE this paper — same exam, same subject, a section
   * the paper sits, and a student enrolled in it. A gate pair from one
   * paper can never write another.
   */
  async saveComponentResult(
    scope: DataScope,
    userId: string,
    input: SaveComponentResultInput & { sectionId: string; subjectId: string },
  ): Promise<SavedComponentResult | null> {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [schedule] = await tx
        .select({
          id: examSubjectSchedules.id,
          isLocked: examSubjectSchedules.isLocked,
          examId: examSubjectSchedules.examId,
          examStatus: exams.status,
          allowsNegativeMarking: exams.allowsNegativeMarking,
          academicYearId: exams.academicYearId,
          classId: examSubjectSchedules.classId,
          sectionId: examSubjectSchedules.sectionId,
          subjectId: examSubjectSchedules.subjectId,
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
      // Same exam: a scheduleId from another exam paired with this examId
      // is a cross-exam write, not a typo.
      if (input.examId !== schedule.examId) return null;
      // Same subject: a Maths assignment never writes the Physics paper.
      if (input.subjectId !== schedule.subjectId) return null;
      // A section the paper sits: exact for section papers; any of the
      // class's sections for class-wide papers (entered section by section).
      if (schedule.sectionId) {
        if (input.sectionId !== schedule.sectionId) return null;
      } else {
        const [section] = await tx
          .select({ id: sections.id })
          .from(sections)
          .where(
            and(
              eq(sections.id, input.sectionId),
              eq(sections.classId, schedule.classId),
              eq(sections.schoolId, schoolId),
            ),
          );
        if (!section) return null;
      }
      // The student sits in that section this year — except sectionless
      // classmates on class-wide papers, who belong to the cohort but to
      // no teacher's section yet.
      const [enrollment] = await tx
        .select({ sectionId: studentEnrollments.sectionId })
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.studentId, input.studentId),
            eq(studentEnrollments.academicYearId, schedule.academicYearId),
            eq(studentEnrollments.schoolId, schoolId),
            inArray(studentEnrollments.enrollmentStatus, [
              "active",
              "admitted",
              "section_assigned",
            ]),
          ),
        );
      if (!enrollment) return null;
      if (enrollment.sectionId !== input.sectionId) {
        if (enrollment.sectionId !== null || schedule.sectionId !== null) {
          return null;
        }
      }
      if (!["marks_entry", "under_verification"].includes(schedule.examStatus)) {
        throw new Error("Marks entry is not open for this exam.");
      }
      // The floor the DB trigger doesn't check (it caps at max only):
      // negatives need the exam's explicit opt-in.
      if (input.marks != null && Number(input.marks) < 0 && !schedule.allowsNegativeMarking) {
        throw new Error("This exam does not allow negative marks.");
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
            eq(studentComponentResults.scheduleId, input.scheduleId),
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

  /**
   * Batch verify: Entered → Verified, bound to ONE paper and ONE section.
   * The router's subjectGate answers the assignment fact on the
   * (sectionId, subjectId) pair; here every row must belong to that paper
   * (one schedule, the stated subject) and every student must sit in that
   * section — a batch spanning papers is refused rather than partially
   * applied. Published/locked rows belong to the revision ledger now and
   * can never be re-verified into it.
   */
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
      const papers = new Set(
        inScope.map((r) => `${r.examId}|${r.scheduleId}`),
      );
      if (papers.size !== 1) {
        throw new Error(
          "A verification batch covers one paper — split mixed batches by paper.",
        );
      }
      const [schedule] = await tx
        .select({
          sectionId: examSubjectSchedules.sectionId,
          subjectId: examSubjectSchedules.subjectId,
          classId: examSubjectSchedules.classId,
          academicYearId: exams.academicYearId,
        })
        .from(examSubjectSchedules)
        .innerJoin(exams, eq(examSubjectSchedules.examId, exams.id))
        .where(
          and(
            eq(examSubjectSchedules.id, inScope[0]!.scheduleId),
            eq(examSubjectSchedules.schoolId, schoolId),
          ),
        );
      if (!schedule) {
        throw new Error("The paper no longer exists in this school.");
      }
      if (input.subjectId !== schedule.subjectId) {
        throw new Error("These entries do not belong to the stated subject.");
      }
      if (schedule.sectionId) {
        if (input.sectionId !== schedule.sectionId) {
          throw new Error("These entries do not belong to the stated section.");
        }
      } else {
        const [section] = await tx
          .select({ id: sections.id })
          .from(sections)
          .where(
            and(
              eq(sections.id, input.sectionId),
              eq(sections.classId, schedule.classId),
              eq(sections.schoolId, schoolId),
            ),
          );
        if (!section) {
          throw new Error("These entries do not belong to the stated section.");
        }
      }
      const enrollments = await tx
        .select({
          studentId: studentEnrollments.studentId,
          sectionId: studentEnrollments.sectionId,
        })
        .from(studentEnrollments)
        .where(
          and(
            inArray(
              studentEnrollments.studentId,
              [...new Set(inScope.map((r) => r.studentId))],
            ),
            eq(studentEnrollments.academicYearId, schedule.academicYearId),
            eq(studentEnrollments.schoolId, schoolId),
            inArray(studentEnrollments.enrollmentStatus, [
              "active",
              "admitted",
              "section_assigned",
            ]),
          ),
        );
      const byStudent = new Map(enrollments.map((e) => [e.studentId, e]));
      const outsider = inScope.find((r) => {
        const enrollment = byStudent.get(r.studentId);
        if (!enrollment) return true;
        if (enrollment.sectionId === input.sectionId) return false;
        // Same sectionless-classmate allowance as the save: class-wide
        // papers only, never section papers.
        return !(
          enrollment.sectionId === null && schedule.sectionId === null
        );
      });
      if (outsider) {
        throw new Error("Some entries are outside the stated section.");
      }
      const sealed = inScope.find((r) =>
        ["published", "locked"].includes(r.resultStatus),
      );
      if (sealed) {
        throw new Error(
          "A published result cannot be verified — corrections go through the revision ledger.",
        );
      }
      const empty = inScope.find((r) => r.resultStatus === "draft");
      if (empty) {
        throw new Error("An unentered entry cannot be verified — enter a value or mark it absent first.");
      }
      const enteredIds = inScope
        .filter((r) => r.resultStatus === "entered")
        .map((r) => r.id);
      if (enteredIds.length > 0) {
        await tx
          .update(studentComponentResults)
          .set({ resultStatus: "verified", verifiedBy: userId, verifiedAt: new Date() })
          .where(inArray(studentComponentResults.id, enteredIds));
      }
      return tx
        .select()
        .from(studentComponentResults)
        .where(inArray(studentComponentResults.id, inScope.map((r) => r.id)));
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

  /**
   * THE ENTRY GRID (S3) — one call gives the screen everything: the
   * schedule's components, the roster (the enrollment cohort, narrowed to
   * the section when the paper is section-scoped), and every existing
   * component result. The read is schedule-addressed, so the ROUTER's
   * owner resolver answers the tenancy question; the service re-checks
   * the school anyway — a schedule id from another branch must be
   * indistinguishable from a typo, not a 500.
   */
  async entryGrid(scope: DataScope, examId: string, scheduleId: string, sectionId?: string) {
    const schoolId = requireSchoolId(scope);
    const [schedule] = await db
      .select()
      .from(examSubjectSchedules)
      .where(
        and(
          eq(examSubjectSchedules.id, scheduleId),
          eq(examSubjectSchedules.examId, examId),
          eq(examSubjectSchedules.schoolId, schoolId),
        ),
      );
    if (!schedule) return null;

    // A class-wide paper (NULL section) is entered SECTION by SECTION: the
    // caller names the section whose roster it is entering (its own — the
    // subject gate on the save enforces the assignment fact). The view
    // section never widens a section-scoped paper.
    const rosterSectionId = schedule.sectionId ?? sectionId ?? null;

    const [exam] = await db
      .select({
        status: exams.status,
        academicYearId: exams.academicYearId,
        allowsNegativeMarking: exams.allowsNegativeMarking,
      })
      .from(exams)
      .where(eq(exams.id, examId));
    if (!exam) return null;

    // Graded-only exam-mode papers are entered as GRADES on an implicit
    // single "Overall" component (ADR-032 §2). The row is ensured here so
    // the grid always has a column to type into — first open wins, the
    // unique index absorbs a racing second.
    const [mapping] = await db
      .select({
        mode: subjectTypes.assessmentMode,
        gradedOnly: subjectTypes.isGradedOnly,
      })
      .from(classSubjectMappings)
      .innerJoin(subjectTypes, eq(classSubjectMappings.subjectTypeId, subjectTypes.id))
      .where(
        and(
          eq(classSubjectMappings.classId, schedule.classId),
          eq(classSubjectMappings.academicYearId, exam.academicYearId),
          eq(classSubjectMappings.subjectId, schedule.subjectId),
        ),
      );
    const isGradedOnly = mapping?.mode === "exam" && mapping?.gradedOnly === true;
    if (isGradedOnly) {
      await db
        .insert(examComponents)
        .values({
          organizationId: schedule.organizationId,
          schoolId,
          scheduleId,
          name: "Overall",
          maxMarks: "100.00",
          passMarks: "0.00",
          weightagePercentage: "100.00",
          isMandatoryPass: false,
          sequenceNumber: 0,
        })
        .onConflictDoNothing({
          target: [examComponents.scheduleId, examComponents.name],
        });
    }

    const components = await db
      .select({
        id: examComponents.id,
        name: examComponents.name,
        sequenceNumber: examComponents.sequenceNumber,
        maxMarks: examComponents.maxMarks,
        passMarks: examComponents.passMarks,
        weightagePercentage: examComponents.weightagePercentage,
        isMandatoryPass: examComponents.isMandatoryPass,
      })
      .from(examComponents)
      .where(eq(examComponents.scheduleId, scheduleId))
      .orderBy(asc(examComponents.sequenceNumber), asc(examComponents.id));

    // The roster: same cohort definition as the eligibility recompute
    // (active enrollments in the paper's class), narrowed to the section
    // when the paper is section-scoped. NULL-section papers sit the whole
    // class — including students whose section is not yet assigned.
    const roster = await db
      .select({
        studentId: studentEnrollments.studentId,
        rollNumber: studentEnrollments.rollNumber,
        admissionNumber: students.admissionNumber,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(studentEnrollments)
      .innerJoin(students, eq(studentEnrollments.studentId, students.id))
      .where(
        and(
          eq(studentEnrollments.academicYearId, exam.academicYearId),
          eq(studentEnrollments.classId, schedule.classId),
          rosterSectionId
            ? eq(studentEnrollments.sectionId, rosterSectionId)
            : undefined,
          inArray(studentEnrollments.enrollmentStatus, [
            "admitted",
            "section_assigned",
            "active",
          ]),
        ),
      )
      .orderBy(asc(studentEnrollments.rollNumber), asc(students.lastName), asc(students.firstName));

    const entries = roster.length
      ? await db
          .select({
            id: studentComponentResults.id,
            studentId: studentComponentResults.studentId,
            componentId: studentComponentResults.componentId,
            resultStatus: studentComponentResults.resultStatus,
            marksObtained: studentComponentResults.marksObtained,
            gradeObtained: studentComponentResults.gradeObtained,
            isAbsent: studentComponentResults.isAbsent,
            isExempted: studentComponentResults.isExempted,
            updatedAt: studentComponentResults.updatedAt,
          })
          .from(studentComponentResults)
          .where(
            and(
              eq(studentComponentResults.scheduleId, scheduleId),
              inArray(
                studentComponentResults.studentId,
                roster.map((r) => r.studentId),
              ),
            ),
          )
      : [];

    return {
      examStatus: exam.status,
      classId: schedule.classId,
      sectionId: schedule.sectionId,
      subjectId: schedule.subjectId,
      passMarks: schedule.passMarks,
      isLocked: schedule.isLocked,
      isGradedOnly,
      allowsNegativeMarking: exam.allowsNegativeMarking,
      components,
      roster,
      entries,
    };
  }

  /**
   * ONE STUDENT'S ENTRIES for an exam (S4) — the correction dialog's data:
   * component results with paper + component labels, so the corrector names
   * the exact cell they are revising. The ledger apply (hard rule 7) still
   * refuses what it must; this read only displays.
   */
  async listStudentEntries(scope: DataScope, examId: string, studentId: string) {
    const schoolId = requireSchoolId(scope);
    return db
      .select({
        id: studentComponentResults.id,
        scheduleId: studentComponentResults.scheduleId,
        componentId: studentComponentResults.componentId,
        component: examComponents.name,
        subjectId: examSubjectSchedules.subjectId,
        maxMarks: examComponents.maxMarks,
        resultStatus: studentComponentResults.resultStatus,
        marksObtained: studentComponentResults.marksObtained,
        gradeObtained: studentComponentResults.gradeObtained,
        isAbsent: studentComponentResults.isAbsent,
        isExempted: studentComponentResults.isExempted,
      })
      .from(studentComponentResults)
      .innerJoin(examComponents, eq(studentComponentResults.componentId, examComponents.id))
      .innerJoin(
        examSubjectSchedules,
        eq(studentComponentResults.scheduleId, examSubjectSchedules.id),
      )
      .where(
        and(
          eq(studentComponentResults.examId, examId),
          eq(studentComponentResults.studentId, studentId),
          eq(studentComponentResults.schoolId, schoolId),
        ),
      );
  }

  /**
   * THE READINESS VIEW (the publish screen's one call): entry completeness
   * per the class's schedules, verification counts, the stale-compute flag,
   * and the advisory below-bar attendance list. Advisory — nothing here
   * blocks; it informs.
   */
  async readiness(scope: DataScope, examId: string, classId: string) {
    const schoolId = requireSchoolId(scope);
    const [exam] = await db
      .select()
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)));
    if (!exam) return null;

    const schedules = await db
      .select({ id: examSubjectSchedules.id, sectionId: examSubjectSchedules.sectionId })
      .from(examSubjectSchedules)
      .where(and(eq(examSubjectSchedules.examId, examId), eq(examSubjectSchedules.classId, classId)));

    let expectedEntries = 0;
    let enteredEntries = 0;
    let verifiedEntries = 0;
    for (const schedule of schedules) {
      const cohortWhere = schedule.sectionId
        ? eq(studentEnrollmentsSection.sectionId, schedule.sectionId)
        : eq(studentEnrollmentsSection.classId, classId);
      const [cohort] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(studentEnrollmentsSection)
        .where(
          and(
            eq(studentEnrollmentsSection.classId, classId),
            eq(studentEnrollmentsSection.academicYearId, exam.academicYearId),
            inArray(studentEnrollmentsSection.enrollmentStatus, ["active", "admitted", "section_assigned"]),
            cohortWhere,
          ),
        );
      const [components] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(examComponents)
        .where(eq(examComponents.scheduleId, schedule.id));
      expectedEntries += (cohort?.count ?? 0) * (components?.count ?? 0);

      const [entryCounts] = await db
        .select({
          entered: sql<number>`count(*) FILTER (WHERE ${studentComponentResults.resultStatus} <> 'draft')::int`,
          verified: sql<number>`count(*) FILTER (WHERE ${studentComponentResults.resultStatus} = 'verified')::int`,
        })
        .from(studentComponentResults)
        .where(eq(studentComponentResults.scheduleId, schedule.id));
      enteredEntries += entryCounts?.entered ?? 0;
      verifiedEntries += entryCounts?.verified ?? 0;
    }

    const [stale] = await db
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
          inArray(
            studentComponentResults.scheduleId,
            schedules.map((s) => s.id),
          ),
          sql`${studentComponentResults.updatedAt} > ${studentSubjectResults.computedAt}`,
        ),
      )
      .limit(1);

    // Below-bar, scoped to THIS class: eligibility rows carry no class, so
    // join the year's enrollment — a sibling class's below-bar students
    // must never invite overrides against the wrong cohort.
    const belowBar = await db
      .select({
        studentId: examEligibility.studentId,
        attendancePercentage: examEligibility.attendancePercentage,
        minRequiredPct: examEligibility.minRequiredPct,
        isOverridden: examEligibility.isOverridden,
      })
      .from(examEligibility)
      .innerJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.studentId, examEligibility.studentId),
          eq(studentEnrollments.academicYearId, exam.academicYearId),
          eq(studentEnrollments.classId, classId),
          inArray(studentEnrollments.enrollmentStatus, [
            "active",
            "admitted",
            "section_assigned",
          ]),
        ),
      )
      .where(
        and(
          eq(examEligibility.examId, examId),
          eq(examEligibility.isEligible, false),
          eq(examEligibility.isOverridden, false),
        ),
      );

    return {
      expectedEntries,
      enteredEntries,
      verifiedEntries,
      staleCompute: stale != null,
      belowBar,
    };
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
