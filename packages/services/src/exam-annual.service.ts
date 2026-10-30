import { scopeWhere, type DataScope } from "@repo/authz";
import type {
  AnnualCardOutput,
  AnnualGenerateOutput,
  AnnualIssue,
  AnnualPolicyOutput,
  AnnualPublishOutput,
  AnnualReadinessOutput,
  AnnualTableOutput,
  ReportCardSnapshotV2,
  SaveAnnualPolicyInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  annualResultPolicies,
  annualResultPolicyTerms,
  attendanceSummary,
  authzAuditLog,
  classSubjectMappings,
  classes,
  examClassPublication,
  examSubjectSchedules,
  exams,
  publishedReportCards,
  reportCardTemplates,
  schools,
  sections,
  studentEnrollments,
  studentFinalResults,
  studentFinalSubjectResults,
  studentSubjectResults,
  studentTermResults,
  subjectTypes,
  subjects,
  terms,
  students as studentsTable,
} from "@repo/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { atSchoolLevel, requireSchoolId } from "./academic.service";
import {
  computeAnnual,
  sumDisplay,
  type AnnualCellInput,
} from "./exam-annual-compute";
import {
  loadDefaultScale,
  loadPassCriteria,
  loadSubjectSet,
  resolvePapers,
  type DbLike,
} from "./exam-shared";
import {
  annualPolicySummary,
  termSubjectScore,
  toHundredths,
  type AnnualPolicyShape,
  type AnnualVerdictRules,
} from "./exams-maths";

/**
 * THE ANNUAL RESULT (ADR-053): the saved policy, readiness, generate (one
 * transaction per class, set-based), the table the staff apps read, and the
 * class-scoped publication of the annual card (`snapshotVersion: 2`).
 *
 * The maths is `exam-annual-compute` (pure, tested without a database); this
 * file loads facts, writes rows, and enforces the workflow:
 * policy -> readiness -> generate (a draft, a preview) -> review -> publish.
 * `terms.weightage` is the FEE share and is never read here.
 */

const POLICY_SCOPE_COLUMNS = {
  organizationId: annualResultPolicies.organizationId,
  schoolId: annualResultPolicies.schoolId,
} as const;

const ROSTER_STATUSES = ["active", "admitted", "section_assigned"] as const;
const CHUNK = 200;

type PolicyRow = typeof annualResultPolicies.$inferSelect;

interface PolicyTermInfo {
  termId: string;
  name: string;
  sequence: number;
  weightage: string | null;
}
interface PolicyWithTerms {
  row: PolicyRow;
  terms: PolicyTermInfo[];
}
interface Governing {
  policy: PolicyWithTerms;
  scope: "class" | "default";
  shape: AnnualPolicyShape;
  passPercent: bigint;
}
interface RosterRow {
  studentId: string;
  name: string;
  admissionNumber: string;
  rollNumber: string | null;
  sectionId: string | null;
  sectionName: string | null;
}

function chunked<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/** The stored enum has two legacy values the annual card never prints. */
function verdictOf(status: string): "promoted" | "compartment" | "detained" {
  if (status === "compartment" || status === "detained") return status;
  return status === "pending" ? "detained" : "promoted";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export class ExamAnnualService {
  // -------------------------------------------------------------------------
  // The policy
  // -------------------------------------------------------------------------

  private async withTerms(tx: DbLike, rows: PolicyRow[]): Promise<PolicyWithTerms[]> {
    if (rows.length === 0) return [];
    const children = await tx
      .select()
      .from(annualResultPolicyTerms)
      .where(inArray(annualResultPolicyTerms.policyId, rows.map((r) => r.id)));
    const termRows = children.length
      ? await tx
          .select({ id: terms.id, name: terms.name, sequenceNumber: terms.sequenceNumber })
          .from(terms)
          .where(inArray(terms.id, [...new Set(children.map((c) => c.termId))]))
      : [];
    const termById = new Map(termRows.map((t) => [t.id, t]));
    return rows.map((row) => ({
      row,
      terms: children
        .filter((c) => c.policyId === row.id)
        .map((c) => {
          const t = termById.get(c.termId);
          return {
            termId: c.termId,
            name: t?.name ?? "Term",
            sequence: t?.sequenceNumber ?? 0,
            weightage: c.weightage,
          };
        })
        .sort((a, b) => a.sequence - b.sequence),
    }));
  }

  private summaryOf(p: PolicyWithTerms): string {
    return annualPolicySummary({
      method: p.row.method,
      bestN: p.row.bestN,
      totalDisplay: p.row.totalDisplay,
      terms: p.terms.map((t) => ({
        name: t.name,
        sequence: t.sequence,
        weightage: t.weightage === null ? null : toHundredths(t.weightage),
      })),
      annualSubjectPassPercent: toHundredths(p.row.annualSubjectPassPercent),
    });
  }

  private toOutput(p: PolicyWithTerms): AnnualPolicyOutput {
    return {
      ...p.row,
      terms: p.terms.map((t) => ({ termId: t.termId, weightage: t.weightage })),
      summary: this.summaryOf(p),
    };
  }

  async listPolicies(scopes: DataScope[], academicYearId: string): Promise<AnnualPolicyOutput[]> {
    const rows = await db
      .select()
      .from(annualResultPolicies)
      .where(
        and(
          eq(annualResultPolicies.academicYearId, academicYearId),
          scopeWhere(scopes.map(atSchoolLevel), POLICY_SCOPE_COLUMNS),
        ),
      );
    return (await this.withTerms(db, rows)).map((p) => this.toOutput(p));
  }

  /** The policy that governs a class: its own row, else the school-year default. */
  private async resolveGoverning(
    tx: DbLike,
    schoolId: string,
    academicYearId: string,
    classId: string,
  ): Promise<Governing | null> {
    const rows = await tx
      .select()
      .from(annualResultPolicies)
      .where(
        and(
          eq(annualResultPolicies.schoolId, schoolId),
          eq(annualResultPolicies.academicYearId, academicYearId),
        ),
      );
    const classRow = rows.find((r) => r.classId === classId);
    const row = classRow ?? rows.find((r) => r.classId === null);
    if (!row) return null;
    const [policy] = await this.withTerms(tx, [row]);
    if (!policy || policy.terms.length === 0) return null;
    return {
      policy,
      scope: classRow ? "class" : "default",
      shape: {
        method: row.method,
        bestN: row.bestN,
        terms: policy.terms.map((t) => ({
          termId: t.termId,
          sequence: t.sequence,
          weightage: t.weightage === null ? null : toHundredths(t.weightage),
        })),
      },
      passPercent: toHundredths(row.annualSubjectPassPercent),
    };
  }

  async savePolicy(
    scope: DataScope,
    userId: string,
    input: SaveAnnualPolicyInput,
  ): Promise<AnnualPolicyOutput> {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [year] = await tx
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(and(eq(academicYears.id, input.academicYearId), eq(academicYears.schoolId, schoolId)));
      if (!year) throw new Error("That academic year was not found.");
      if (input.classId) {
        const [klass] = await tx
          .select({ id: classes.id })
          .from(classes)
          .where(and(eq(classes.id, input.classId), eq(classes.schoolId, schoolId)));
        if (!klass) throw new Error("That class was not found.");
      }
      const termIds = input.terms.map((t) => t.termId);
      const found = await tx
        .select({ id: terms.id })
        .from(terms)
        .where(
          and(
            inArray(terms.id, termIds),
            eq(terms.academicYearId, input.academicYearId),
            eq(terms.schoolId, schoolId),
          ),
        );
      if (found.length !== termIds.length) {
        throw new Error("Every picked term must belong to this academic year.");
      }

      const existing = await tx
        .select()
        .from(annualResultPolicies)
        .where(
          and(
            eq(annualResultPolicies.schoolId, schoolId),
            eq(annualResultPolicies.academicYearId, input.academicYearId),
          ),
        );
      const sameScope = existing.find((r) => (r.classId ?? null) === (input.classId ?? null));
      if (!input.id && sameScope) {
        throw new Error(
          input.classId
            ? "This class already has its own annual rule - edit it instead."
            : "The school already has a default annual rule for this year - edit it instead.",
        );
      }
      const target = input.id ? existing.find((r) => r.id === input.id) : undefined;
      if (input.id && !target) throw new Error("That annual rule was not found.");
      if (target && (target.classId ?? null) !== (input.classId ?? null)) {
        throw new Error("A rule cannot move to another class - create a new one.");
      }

      // The own-rules block is stored only when it is in use; a switched-off
      // block would otherwise keep stale values nobody can see.
      const own = input.useOwnPassRules;
      const values = {
        method: input.method,
        bestN: input.method === "best_n" ? (input.bestN ?? null) : null,
        totalDisplay: input.totalDisplay,
        annualSubjectPassPercent: input.annualSubjectPassPercent,
        useOwnPassRules: own,
        minSubjectsToPass: own ? (input.minSubjectsToPass ?? null) : null,
        mandatoryPassSubjectIds: own ? input.mandatoryPassSubjectIds : [],
        compartmentAllowed: own ? input.compartmentAllowed : false,
        maxSubjectsForCompartment: own && input.compartmentAllowed ? (input.maxSubjectsForCompartment ?? null) : null,
        minAttendancePct: own ? input.minAttendancePct : "75.00",
      };

      let policyId: string;
      if (target) {
        policyId = target.id;
        await tx
          .update(annualResultPolicies)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(annualResultPolicies.id, target.id));
        await tx
          .delete(annualResultPolicyTerms)
          .where(eq(annualResultPolicyTerms.policyId, target.id));
      } else {
        const [created] = await tx
          .insert(annualResultPolicies)
          .values({
            ...values,
            organizationId: scope.organizationId,
            schoolId,
            academicYearId: input.academicYearId,
            classId: input.classId,
            createdBy: userId,
          })
          .returning();
        policyId = created!.id;
      }
      await tx.insert(annualResultPolicyTerms).values(
        input.terms.map((t) => ({
          organizationId: scope.organizationId,
          schoolId,
          policyId,
          termId: t.termId,
          weightage: input.method === "weighted" ? (t.weightage ?? null) : null,
        })),
      );
      const [row] = await tx
        .select()
        .from(annualResultPolicies)
        .where(eq(annualResultPolicies.id, policyId));
      const [saved] = await this.withTerms(tx, [row!]);
      return this.toOutput(saved!);
    });
  }

  async deletePolicy(scope: DataScope, id: string): Promise<boolean> {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: annualResultPolicies.id })
        .from(annualResultPolicies)
        .where(and(eq(annualResultPolicies.id, id), eq(annualResultPolicies.schoolId, schoolId)));
      if (!row) return false;
      const [used] = await tx
        .select({ id: studentFinalResults.id })
        .from(studentFinalResults)
        .where(eq(studentFinalResults.policyId, id))
        .limit(1);
      if (used) {
        throw new Error("Results were generated with this rule - edit it instead of deleting it.");
      }
      await tx.delete(annualResultPolicies).where(eq(annualResultPolicies.id, id));
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Shared loads
  // -------------------------------------------------------------------------

  private async requireClassYear(
    tx: DbLike,
    schoolId: string,
    academicYearId: string,
    classId: string,
  ) {
    const [year] = await tx
      .select({ name: academicYears.name })
      .from(academicYears)
      .where(and(eq(academicYears.id, academicYearId), eq(academicYears.schoolId, schoolId)));
    const [klass] = await tx
      .select({ name: classes.name })
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.schoolId, schoolId)));
    if (!year || !klass) return null;
    const [school] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId));
    return { yearName: year.name, className: klass.name, schoolName: school?.name ?? "" };
  }

  private async loadRoster(tx: DbLike, classId: string, academicYearId: string): Promise<RosterRow[]> {
    const rows = await tx
      .select({
        studentId: studentEnrollments.studentId,
        sectionId: studentEnrollments.sectionId,
        rollNumber: studentEnrollments.rollNumber,
        firstName: studentsTable.firstName,
        lastName: studentsTable.lastName,
        admissionNumber: studentsTable.admissionNumber,
        sectionName: sections.name,
      })
      .from(studentEnrollments)
      .innerJoin(studentsTable, eq(studentEnrollments.studentId, studentsTable.id))
      .leftJoin(sections, eq(studentEnrollments.sectionId, sections.id))
      .where(
        and(
          eq(studentEnrollments.classId, classId),
          eq(studentEnrollments.academicYearId, academicYearId),
          inArray(studentEnrollments.enrollmentStatus, [...ROSTER_STATUSES]),
        ),
      );
    const seen = new Map<string, RosterRow>();
    for (const r of rows) {
      if (seen.has(r.studentId)) continue;
      seen.set(r.studentId, {
        studentId: r.studentId,
        name: `${r.firstName} ${r.lastName}`.trim(),
        admissionNumber: r.admissionNumber,
        rollNumber: r.rollNumber,
        sectionId: r.sectionId,
        sectionName: r.sectionName,
      });
    }
    return [...seen.values()];
  }

  /** Every counting exam of the policy's terms (school-wide; rows filter by student). */
  private async loadTermExams(tx: DbLike, schoolId: string, policy: Governing) {
    return tx
      .select({
        id: exams.id,
        name: exams.name,
        termId: exams.termId,
        weightage: exams.weightageInTerm,
      })
      .from(exams)
      .where(
        and(
          inArray(exams.termId, policy.policy.terms.map((t) => t.termId)),
          eq(exams.countsTowardTermResult, true),
          eq(exams.schoolId, schoolId),
        ),
      );
  }

  /**
   * The student x subject x term outcomes, through THE term-subject function.
   * A cell exists only where the student has exam rows (ADR-052: no paper,
   * no row).
   */
  private async loadCells(
    tx: DbLike,
    termExams: { id: string; termId: string; weightage: string }[],
    studentIds: string[],
    subjectSet: { subjectId: string; isGradedOnly: boolean }[],
  ) {
    const cells = new Map<string, Map<string, Map<string, AnnualCellInput>>>();
    if (termExams.length === 0 || studentIds.length === 0) return { cells, latestInputAt: null as Date | null };
    const examById = new Map(termExams.map((e) => [e.id, e]));
    const gradedOnly = new Map(subjectSet.map((s) => [s.subjectId, s.isGradedOnly]));
    const rows = await tx
      .select({
        studentId: studentSubjectResults.studentId,
        subjectId: studentSubjectResults.subjectId,
        examId: studentSubjectResults.examId,
        finalMarks: studentSubjectResults.finalMarks,
        isPassed: studentSubjectResults.isPassed,
        isExempted: studentSubjectResults.isExempted,
        gradePoint: studentSubjectResults.gradePoint,
        grade: studentSubjectResults.grade,
        computedAt: studentSubjectResults.computedAt,
      })
      .from(studentSubjectResults)
      .where(
        and(
          inArray(studentSubjectResults.examId, [...examById.keys()]),
          inArray(studentSubjectResults.studentId, studentIds),
        ),
      );

    type Group = { studentId: string; subjectId: string; termId: string; rows: typeof rows };
    const groups = new Map<string, Group>();
    let latestInputAt: Date | null = null;
    for (const r of rows) {
      if (!gradedOnly.has(r.subjectId)) continue;
      const exam = examById.get(r.examId)!;
      const key = `${r.studentId}|${r.subjectId}|${exam.termId}`;
      const g = groups.get(key) ?? { studentId: r.studentId, subjectId: r.subjectId, termId: exam.termId, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
      if (!latestInputAt || r.computedAt > latestInputAt) latestInputAt = r.computedAt;
    }
    for (const g of groups.values()) {
      const outcome = termSubjectScore(
        g.rows.map((r) => ({
          marks: r.finalMarks ? toHundredths(r.finalMarks) : null,
          weightage: toHundredths(examById.get(r.examId)!.weightage),
          isPassed: r.isPassed,
          isExempted: r.isExempted,
          gradePoint: r.gradePoint ? toHundredths(r.gradePoint) : null,
        })),
        { isGradedOnly: gradedOnly.get(g.subjectId) ?? false },
      );
      // The term's grade for a graded-only subject: the heaviest exam that has one.
      const heaviest = [...g.rows]
        .filter((r) => r.grade !== null && !r.isExempted)
        .sort((a, b) => Number(examById.get(b.examId)!.weightage) - Number(examById.get(a.examId)!.weightage))[0];
      const bySubject = cells.get(g.studentId) ?? new Map<string, Map<string, AnnualCellInput>>();
      const byTerm = bySubject.get(g.subjectId) ?? new Map<string, AnnualCellInput>();
      byTerm.set(g.termId, { outcome, grade: heaviest?.grade ?? null });
      bySubject.set(g.subjectId, byTerm);
      cells.set(g.studentId, bySubject);
    }
    return { cells, latestInputAt };
  }

  private async rulesFor(
    tx: DbLike,
    schoolId: string,
    academicYearId: string,
    classId: string,
    policy: Governing,
  ): Promise<{
    source: "annual_policy" | "pass_criteria" | "default";
    rules: AnnualVerdictRules;
    minAttendancePct: string;
  }> {
    const row = policy.policy.row;
    if (row.useOwnPassRules) {
      return {
        source: "annual_policy",
        rules: {
          minSubjectsToPass: row.minSubjectsToPass,
          mandatoryPassSubjectIds: row.mandatoryPassSubjectIds,
          compartmentAllowed: row.compartmentAllowed,
          maxSubjectsForCompartment: row.maxSubjectsForCompartment,
        },
        minAttendancePct: row.minAttendancePct,
      };
    }
    const criteria = await loadPassCriteria(tx, schoolId, academicYearId, classId);
    if (criteria) {
      return {
        source: "pass_criteria",
        rules: {
          minSubjectsToPass: criteria.minSubjectsToPass,
          mandatoryPassSubjectIds: criteria.mandatoryPassSubjectIds,
          compartmentAllowed: criteria.compartmentAllowed,
          maxSubjectsForCompartment: criteria.maxSubjectsForCompartment,
        },
        minAttendancePct: criteria.minAttendancePct,
      };
    }
    return {
      source: "default",
      rules: {
        minSubjectsToPass: null,
        mandatoryPassSubjectIds: [],
        compartmentAllowed: false,
        maxSubjectsForCompartment: null,
      },
      minAttendancePct: "75.00",
    };
  }

  /** Which classes have a generated year, and how far along - one grouped read. */
  async overview(scopes: DataScope[], academicYearId: string) {
    const rows = await db
      .select({
        classId: studentFinalResults.classId,
        students: sql<number>`count(*)::int`,
        publishedStudents: sql<number>`count(*) filter (where ${studentFinalResults.resultStatus} <> draft)::int`,
        computedAt: sql<Date>`max(${studentFinalResults.computedAt})`,
      })
      .from(studentFinalResults)
      .where(
        and(
          eq(studentFinalResults.academicYearId, academicYearId),
          sql`${studentFinalResults.policyId} IS NOT NULL`,
          scopeWhere(scopes.map(atSchoolLevel), {
            organizationId: studentFinalResults.organizationId,
            schoolId: studentFinalResults.schoolId,
          }),
        ),
      )
      .groupBy(studentFinalResults.classId);
    return rows.flatMap((r) =>
      r.classId
        ? [{ classId: r.classId, students: r.students, publishedStudents: r.publishedStudents, computedAt: new Date(r.computedAt) }]
        : [],
    );
  }

  // -------------------------------------------------------------------------
  // Generate - one class, one transaction, set-based
  // -------------------------------------------------------------------------

  async generate(
    scope: DataScope,
    academicYearId: string,
    classId: string,
  ): Promise<AnnualGenerateOutput | null> {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const ctx = await this.requireClassYear(tx, schoolId, academicYearId, classId);
      if (!ctx) return null;
      const governing = await this.resolveGoverning(tx, schoolId, academicYearId, classId);
      if (!governing) {
        throw new Error("Set the annual rules for this class first (Grading setup, Annual rules).");
      }
      const roster = await this.loadRoster(tx, classId, academicYearId);
      if (roster.length === 0) throw new Error("This class has no enrolled students for the year.");
      const studentIds = roster.map((r) => r.studentId);

      const [published] = await tx
        .select({ id: studentFinalResults.id })
        .from(studentFinalResults)
        .where(
          and(
            eq(studentFinalResults.academicYearId, academicYearId),
            inArray(studentFinalResults.studentId, studentIds),
            inArray(studentFinalResults.resultStatus, ["published", "locked"]),
          ),
        )
        .limit(1);
      if (published) {
        throw new Error(
          "This class's annual results are published and frozen - generating again is closed.",
        );
      }

      const subjectSet = await loadSubjectSet(tx, classId, academicYearId);
      const scale = await loadDefaultScale(tx, schoolId);
      const termExams = await this.loadTermExams(tx, schoolId, governing);
      const { cells } = await this.loadCells(tx, termExams, studentIds, subjectSet);
      const { rules, source, minAttendancePct } = await this.rulesFor(
        tx,
        schoolId,
        academicYearId,
        classId,
        governing,
      );

      const result = computeAnnual({
        policy: governing.shape,
        passPercent: governing.passPercent,
        rules,
        subjects: subjectSet.map((s) => ({
          subjectId: s.subjectId,
          countsTowardResult: s.countsTowardResult,
          isGradedOnly: s.isGradedOnly,
        })),
        students: roster.map((r) => ({ studentId: r.studentId, sectionId: r.sectionId })),
        cells,
        scaleBands: scale?.bands ?? null,
      });

      const attendanceRows = await tx
        .select({
          studentId: attendanceSummary.studentId,
          pct: attendanceSummary.attendancePercentage,
        })
        .from(attendanceSummary)
        .where(
          and(
            eq(attendanceSummary.academicYearId, academicYearId),
            eq(attendanceSummary.periodType, "annual"),
            inArray(attendanceSummary.studentId, studentIds),
          ),
        );
      const attendance = new Map(attendanceRows.map((a) => [a.studentId, a.pct]));

      const now = new Date();
      const snapshot = {
        source,
        method: governing.policy.row.method,
        bestN: governing.policy.row.bestN,
        totalDisplay: governing.policy.row.totalDisplay,
        annualSubjectPassPercent: governing.policy.row.annualSubjectPassPercent,
        terms: governing.policy.terms.map((t) => ({
          termId: t.termId,
          name: t.name,
          weightage: t.weightage,
        })),
        minSubjectsToPass: rules.minSubjectsToPass,
        mandatoryPassSubjectIds: rules.mandatoryPassSubjectIds,
        compartmentAllowed: rules.compartmentAllowed,
        maxSubjectsForCompartment: rules.maxSubjectsForCompartment,
        minAttendancePct,
      };

      const subjectValues = result.subjects.map((s) => ({
        organizationId: scope.organizationId,
        schoolId,
        studentId: s.studentId,
        academicYearId,
        subjectId: s.subjectId,
        classId,
        sectionId: roster.find((r) => r.studentId === s.studentId)?.sectionId ?? null,
        finalPercentage: s.finalPercentage,
        grade: s.grade,
        gradePoint: s.gradePoint,
        isPassed: s.isPassed,
        isExempted: s.isExempted,
        countsTowardResult: s.countsTowardResult,
        isGradedOnly: s.isGradedOnly,
        renormalized: s.renormalized,
        sourceTerms: s.sourceTerms,
        computedAt: now,
        resultStatus: "draft" as const,
      }));
      for (const part of chunked(subjectValues)) {
        await tx
          .insert(studentFinalSubjectResults)
          .values(part)
          .onConflictDoUpdate({
            target: [
              studentFinalSubjectResults.studentId,
              studentFinalSubjectResults.academicYearId,
              studentFinalSubjectResults.subjectId,
            ],
            set: {
              classId: sql`excluded.class_id`,
              sectionId: sql`excluded.section_id`,
              finalPercentage: sql`excluded.final_percentage`,
              grade: sql`excluded.grade`,
              gradePoint: sql`excluded.grade_point`,
              isPassed: sql`excluded.is_passed`,
              isExempted: sql`excluded.is_exempted`,
              countsTowardResult: sql`excluded.counts_toward_result`,
              isGradedOnly: sql`excluded.is_graded_only`,
              renormalized: sql`excluded.renormalized`,
              sourceTerms: sql`excluded.source_terms`,
              computedAt: sql`excluded.computed_at`,
              resultStatus: sql`excluded.result_status`,
              updatedAt: now,
            },
          });
      }

      const finalValues = result.students.map((s) => ({
        organizationId: scope.organizationId,
        schoolId,
        studentId: s.studentId,
        academicYearId,
        classId,
        sectionId: s.sectionId,
        policyId: governing.policy.row.id,
        totalMarks: s.totalMarks,
        maxMarks: s.maxMarks,
        percentage: s.percentage,
        grade: s.grade,
        gradePoint: s.gradePoint,
        isPassed: s.isPassed,
        subjectsFailedCount: s.failedSubjectIds.length,
        subjectsFailed: s.failedSubjectIds,
        attendancePercentage: attendance.get(s.studentId) ?? null,
        promotionStatus: s.promotionStatus,
        compartmentSubjects: s.compartmentSubjectIds,
        renormalized: s.renormalized,
        rankInSection: s.rankInSection,
        rankInClass: s.rankInClass,
        rankComputedAt: now,
        computedAt: now,
        passPolicySnapshot: snapshot,
        resultStatus: "draft" as const,
      }));
      for (const part of chunked(finalValues)) {
        await tx
          .insert(studentFinalResults)
          .values(part)
          .onConflictDoUpdate({
            target: [studentFinalResults.studentId, studentFinalResults.academicYearId],
            set: {
              classId: sql`excluded.class_id`,
              sectionId: sql`excluded.section_id`,
              policyId: sql`excluded.policy_id`,
              totalMarks: sql`excluded.total_marks`,
              maxMarks: sql`excluded.max_marks`,
              percentage: sql`excluded.percentage`,
              grade: sql`excluded.grade`,
              gradePoint: sql`excluded.grade_point`,
              isPassed: sql`excluded.is_passed`,
              subjectsFailedCount: sql`excluded.subjects_failed_count`,
              subjectsFailed: sql`excluded.subjects_failed`,
              attendancePercentage: sql`excluded.attendance_percentage`,
              promotionStatus: sql`excluded.promotion_status`,
              compartmentSubjects: sql`excluded.compartment_subjects`,
              renormalized: sql`excluded.renormalized`,
              rankInSection: sql`excluded.rank_in_section`,
              rankInClass: sql`excluded.rank_in_class`,
              rankComputedAt: sql`excluded.rank_computed_at`,
              computedAt: sql`excluded.computed_at`,
              passPolicySnapshot: sql`excluded.pass_policy_snapshot`,
              resultStatus: sql`excluded.result_status`,
              updatedAt: now,
            },
          });
      }

      // Stale DRAFT rows for pairs this run no longer produces (a subject the
      // student no longer has, a student who left): drafts are disposable,
      // published rows are never touched (the published guard above).
      const keepSubject = new Set(result.subjects.map((s) => `${s.studentId}|${s.subjectId}`));
      const existingSubjects = await tx
        .select({
          id: studentFinalSubjectResults.id,
          studentId: studentFinalSubjectResults.studentId,
          subjectId: studentFinalSubjectResults.subjectId,
        })
        .from(studentFinalSubjectResults)
        .where(
          and(
            eq(studentFinalSubjectResults.academicYearId, academicYearId),
            inArray(studentFinalSubjectResults.studentId, studentIds),
            eq(studentFinalSubjectResults.resultStatus, "draft"),
          ),
        );
      const staleSubjects = existingSubjects
        .filter((r) => !keepSubject.has(`${r.studentId}|${r.subjectId}`))
        .map((r) => r.id);
      for (const part of chunked(staleSubjects)) {
        await tx.delete(studentFinalSubjectResults).where(inArray(studentFinalSubjectResults.id, part));
      }
      const keepStudent = new Set(result.students.map((s) => s.studentId));
      const staleStudents = studentIds.filter((id) => !keepStudent.has(id));
      if (staleStudents.length > 0) {
        await tx
          .delete(studentFinalResults)
          .where(
            and(
              eq(studentFinalResults.academicYearId, academicYearId),
              inArray(studentFinalResults.studentId, staleStudents),
              eq(studentFinalResults.resultStatus, "draft"),
            ),
          );
      }

      const count = (status: "promoted" | "compartment" | "detained") =>
        result.students.filter((s) => s.promotionStatus === status).length;
      return {
        generated: result.students.length,
        promoted: count("promoted"),
        compartment: count("compartment"),
        detained: count("detained"),
        renormalized: result.students.filter((s) => s.renormalized).length,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Readiness
  // -------------------------------------------------------------------------

  async readiness(
    scope: DataScope,
    academicYearId: string,
    classId: string,
  ): Promise<AnnualReadinessOutput | null> {
    const schoolId = requireSchoolId(scope);
    const ctx = await this.requireClassYear(db, schoolId, academicYearId, classId);
    if (!ctx) return null;
    return this.readinessTx(db, schoolId, academicYearId, classId);
  }

  private async readinessTx(
    tx: DbLike,
    schoolId: string,
    academicYearId: string,
    classId: string,
  ): Promise<AnnualReadinessOutput> {
    const blockers: AnnualIssue[] = [];
    const warnings: AnnualIssue[] = [];
    const governing = await this.resolveGoverning(tx, schoolId, academicYearId, classId);
    const policy = governing
      ? {
          id: governing.policy.row.id,
          scope: governing.scope,
          summary: this.summaryOf(governing.policy),
          useOwnPassRules: governing.policy.row.useOwnPassRules,
        }
      : null;
    const empty = (): AnnualReadinessOutput => ({
      policy,
      status: "none",
      generatedAt: null,
      studentCount: 0,
      blockers,
      warnings,
      publishBlockedReason: null,
    });

    const roster = await this.loadRoster(tx, classId, academicYearId);
    if (roster.length === 0) {
      blockers.push({ code: "no_students", message: "This class has no enrolled students for the year.", count: 0, examId: null });
      const out = empty();
      out.publishBlockedReason = "There are no students to publish.";
      return out;
    }
    if (!governing) {
      blockers.push({
        code: "no_policy",
        message: "No annual rules for this class yet. Set them in Grading setup, Annual rules.",
        count: 0,
        examId: null,
      });
      const out = empty();
      out.studentCount = roster.length;
      out.publishBlockedReason = "Set the annual rules first.";
      return out;
    }

    const studentIds = roster.map((r) => r.studentId);
    const nameOf = new Map(roster.map((r) => [r.studentId, r.name]));
    const finals = await tx
      .select({
        status: studentFinalResults.resultStatus,
        computedAt: studentFinalResults.computedAt,
        renormalized: studentFinalResults.renormalized,
      })
      .from(studentFinalResults)
      .where(
        and(
          eq(studentFinalResults.academicYearId, academicYearId),
          inArray(studentFinalResults.studentId, studentIds),
          sql`${studentFinalResults.policyId} IS NOT NULL`,
        ),
      );
    const hasPublished = finals.some((f) => f.status !== "draft");
    const generatedAt = finals.reduce<Date | null>(
      (acc, f) => (!acc || f.computedAt > acc ? f.computedAt : acc),
      null,
    );

    const subjectSet = await loadSubjectSet(tx, classId, academicYearId);
    const subjectIds = subjectSet.map((s) => s.subjectId);
    const subjectNames = new Map(
      (subjectIds.length
        ? await tx.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, subjectIds))
        : []
      ).map((s) => [s.id, s.name]),
    );
    const sectionNames = new Map(roster.filter((r) => r.sectionId).map((r) => [r.sectionId!, r.sectionName ?? ""]));

    const termExams = await this.loadTermExams(tx, schoolId, governing);
    const unpublished: { id: string; name: string }[] = [];
    const correctionsOpen: { id: string; name: string }[] = [];

    for (const exam of termExams) {
      const schedules = await tx
        .select()
        .from(examSubjectSchedules)
        .where(and(eq(examSubjectSchedules.examId, exam.id), eq(examSubjectSchedules.classId, classId)));
      if (schedules.length === 0) continue; // this exam is not sat by the class

      const [publication] = await tx
        .select({ state: examClassPublication.state })
        .from(examClassPublication)
        .where(and(eq(examClassPublication.examId, exam.id), eq(examClassPublication.classId, classId)));
      if (!publication) unpublished.push({ id: exam.id, name: exam.name });
      else if (publication.state === "revision_open") correctionsOpen.push({ id: exam.id, name: exam.name });

      let papers;
      try {
        papers = await resolvePapers(tx, schedules, classId, academicYearId);
      } catch (e) {
        blockers.push({
          code: "missing_result",
          message: `${exam.name}: ${(e as Error).message}`,
          count: 0,
          examId: exam.id,
        });
        continue;
      }
      const have = new Set(
        (
          await tx
            .select({
              studentId: studentSubjectResults.studentId,
              subjectId: studentSubjectResults.subjectId,
            })
            .from(studentSubjectResults)
            .where(
              and(eq(studentSubjectResults.examId, exam.id), inArray(studentSubjectResults.studentId, studentIds)),
            )
        ).map((r) => `${r.studentId}|${r.subjectId}`),
      );

      const missing = new Map<string, { subjectId: string; sectionId: string | null; students: string[] }>();
      for (const [studentId, bySubject] of papers.paperOf) {
        if (!nameOf.has(studentId)) continue;
        for (const subjectId of subjectIds) {
          const paper = bySubject.get(subjectId);
          if (!paper || have.has(`${studentId}|${subjectId}`)) continue;
          const key = `${subjectId}|${paper.sectionId ?? ""}`;
          const g = missing.get(key) ?? { subjectId, sectionId: paper.sectionId, students: [] };
          g.students.push(studentId);
          missing.set(key, g);
        }
      }
      for (const g of missing.values()) {
        const sample = g.students.slice(0, 3).map((id) => nameOf.get(id)).join(", ");
        const where = g.sectionId ? ` (${sectionNames.get(g.sectionId) ?? "a section"})` : "";
        blockers.push({
          code: "missing_result",
          message: `${subjectNames.get(g.subjectId) ?? "A subject"}${where} - ${exam.name}: ${plural(g.students.length, "student has", "students have")} no computed result (${sample}${g.students.length > 3 ? ", ..." : ""}). Compute that class's results first.`,
          count: g.students.length,
          examId: exam.id,
        });
      }

      // A section that does not sit a subject the rest of the class does.
      const paperSubjects = new Set(schedules.map((s) => s.subjectId));
      for (const subjectId of subjectIds) {
        if (!paperSubjects.has(subjectId)) continue;
        const without = roster.filter((r) => !papers.paperOf.get(r.studentId)?.has(subjectId));
        if (without.length > 0) {
          warnings.push({
            code: "no_paper_for_section",
            message: `${subjectNames.get(subjectId) ?? "A subject"} - ${exam.name}: ${plural(without.length, "student has", "students have")} no paper (a section that did not sit).`,
            count: without.length,
            examId: exam.id,
          });
        }
      }
    }

    if (unpublished.length > 0) {
      warnings.push({
        code: "term_not_published",
        message: `${plural(unpublished.length, "exam is", "exams are")} not published for this class yet: ${unpublished.map((e) => e.name).join(", ")}.`,
        count: unpublished.length,
        examId: unpublished[0]!.id,
      });
    }
    if (correctionsOpen.length > 0) {
      warnings.push({
        code: "term_corrections_open",
        message: `Corrections are still open on ${correctionsOpen.map((e) => e.name).join(", ")}.`,
        count: correctionsOpen.length,
        examId: correctionsOpen[0]!.id,
      });
    }

    // Staleness: any input or the policy itself newer than the draft.
    let latestInput: Date | null = null;
    if (termExams.length > 0) {
      const [latest] = await tx
        .select({ at: sql<Date | null>`max(${studentSubjectResults.computedAt})` })
        .from(studentSubjectResults)
        .where(
          and(
            inArray(studentSubjectResults.examId, termExams.map((e) => e.id)),
            inArray(studentSubjectResults.studentId, studentIds),
          ),
        );
      latestInput = latest?.at ? new Date(latest.at) : null;
    }
    const changedSince =
      generatedAt !== null &&
      ((latestInput !== null && latestInput > generatedAt) ||
        governing.policy.row.updatedAt > generatedAt);
    if (changedSince && !hasPublished) {
      warnings.push({
        code: "stale_inputs",
        message: "Results or the annual rules changed after this year was generated - generate again.",
        count: 0,
        examId: null,
      });
    }
    if (changedSince && hasPublished) {
      warnings.push({
        code: "predates_correction",
        message: "Results changed after these were published. The published cards are unchanged.",
        count: 0,
        examId: null,
      });
    }

    const renormalized = finals.filter((f) => f.renormalized).length;
    if (renormalized > 0) {
      warnings.push({
        code: "renormalized",
        message: `${plural(renormalized, "student")} counted from fewer terms than the rules select.`,
        count: renormalized,
        examId: null,
      });
    }
    if (finals.length > 0) {
      const excused = await tx
        .select({ studentId: studentFinalSubjectResults.studentId })
        .from(studentFinalSubjectResults)
        .where(
          and(
            eq(studentFinalSubjectResults.academicYearId, academicYearId),
            inArray(studentFinalSubjectResults.studentId, studentIds),
            eq(studentFinalSubjectResults.isExempted, true),
          ),
        );
      const excusedStudents = new Set(excused.map((e) => e.studentId)).size;
      if (excusedStudents > 0) {
        warnings.push({
          code: "excused",
          message: `${plural(excusedStudents, "student")} excused from at least one subject.`,
          count: excusedStudents,
          examId: null,
        });
      }
    }

    const status: AnnualReadinessOutput["status"] = hasPublished
      ? "published"
      : finals.length === 0
        ? "none"
        : changedSince
          ? "stale"
          : "draft";

    let publishBlockedReason: string | null = null;
    if (status === "published") publishBlockedReason = "Already published.";
    else if (finals.length === 0) publishBlockedReason = "Generate the year first.";
    else if (blockers.length > 0) publishBlockedReason = "Fix the blockers first.";
    else if (status === "stale") publishBlockedReason = "Results changed since the year was generated - generate again.";
    else if (unpublished.length > 0) {
      publishBlockedReason = `Publish the term results first: ${unpublished.map((e) => e.name).join(", ")}.`;
    } else if (correctionsOpen.length > 0) {
      publishBlockedReason = "Close the open corrections first.";
    }

    return {
      policy,
      status,
      generatedAt,
      studentCount: roster.length,
      blockers,
      warnings,
      publishBlockedReason,
    };
  }

  // -------------------------------------------------------------------------
  // The table - what the staff apps read
  // -------------------------------------------------------------------------

  private async loadStored(
    tx: DbLike,
    schoolId: string,
    academicYearId: string,
    classId: string,
  ) {
    const governing = await this.resolveGoverning(tx, schoolId, academicYearId, classId);
    const roster = await this.loadRoster(tx, classId, academicYearId);
    const studentIds = roster.map((r) => r.studentId);
    const finals = studentIds.length
      ? await tx
          .select()
          .from(studentFinalResults)
          .where(
            and(
              eq(studentFinalResults.academicYearId, academicYearId),
              inArray(studentFinalResults.studentId, studentIds),
              sql`${studentFinalResults.policyId} IS NOT NULL`,
            ),
          )
      : [];
    const subjectRows = studentIds.length
      ? await tx
          .select()
          .from(studentFinalSubjectResults)
          .where(
            and(
              eq(studentFinalSubjectResults.academicYearId, academicYearId),
              inArray(studentFinalSubjectResults.studentId, studentIds),
            ),
          )
      : [];
    const subjectIds = [...new Set(subjectRows.map((r) => r.subjectId))];
    const subjectNames = new Map(
      (subjectIds.length
        ? await tx.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, subjectIds))
        : []
      ).map((s) => [s.id, s.name]),
    );
    return { governing, roster, finals, subjectRows, subjectNames };
  }

  async table(
    scope: DataScope,
    academicYearId: string,
    classId: string,
  ): Promise<AnnualTableOutput | null> {
    const schoolId = requireSchoolId(scope);
    const ctx = await this.requireClassYear(db, schoolId, academicYearId, classId);
    if (!ctx) return null;
    const { governing, roster, finals, subjectRows, subjectNames } = await this.loadStored(
      db,
      schoolId,
      academicYearId,
      classId,
    );
    const totalDisplay = governing?.policy.row.totalDisplay ?? "average";
    const finalOf = new Map(finals.map((f) => [f.studentId, f]));
    const rowsOf = new Map<string, typeof subjectRows>();
    for (const r of subjectRows) {
      const list = rowsOf.get(r.studentId) ?? [];
      list.push(r);
      rowsOf.set(r.studentId, list);
    }

    const students: AnnualTableOutput["students"] = [];
    for (const r of roster) {
      const f = finalOf.get(r.studentId);
      if (!f) continue;
      const mine = (rowsOf.get(r.studentId) ?? []).sort((a, b) =>
        (subjectNames.get(a.subjectId) ?? "").localeCompare(subjectNames.get(b.subjectId) ?? ""),
      );
      students.push({
        studentId: r.studentId,
        name: r.name,
        rollNumber: r.rollNumber,
        sectionId: r.sectionId,
        sectionName: r.sectionName,
        percentage: f.percentage,
        grade: f.grade,
        gradePoint: f.gradePoint,
        isPassed: f.isPassed,
        promotionStatus: verdictOf(f.promotionStatus),
        failedSubjectIds: f.subjectsFailed,
        compartmentSubjectIds: f.compartmentSubjects,
        rankInClass: f.rankInClass,
        rankInSection: f.rankInSection,
        attendancePercentage: f.attendancePercentage,
        renormalized: f.renormalized,
        termsUsed: Math.max(
          0,
          ...mine.map((s) => (s.sourceTerms as { used: boolean }[]).filter((t) => t.used).length),
        ),
        published: f.resultStatus !== "draft",
        subjects: mine.map((s) => {
          const sources = s.sourceTerms as AnnualTableOutput["students"][number]["subjects"][number]["sources"];
          const sum = totalDisplay === "sum" ? sumDisplay(sources) : null;
          return {
            subjectId: s.subjectId,
            percentage: s.finalPercentage,
            grade: s.grade,
            gradePoint: s.gradePoint,
            isPassed: s.isPassed,
            isExempted: s.isExempted,
            isGradedOnly: s.isGradedOnly,
            countsTowardResult: s.countsTowardResult,
            renormalized: s.renormalized,
            displayMarks: sum?.marks ?? null,
            displayMax: sum?.max ?? null,
            sources,
          };
        }),
      });
    }
    const allSubjectIds = [...new Set(students.flatMap((s) => s.subjects.map((x) => x.subjectId)))];
    return {
      status: finals.length === 0 ? "none" : finals.some((f) => f.resultStatus !== "draft") ? "published" : "draft",
      computedAt: finals.reduce<Date | null>((acc, f) => (!acc || f.computedAt > acc ? f.computedAt : acc), null),
      policy: governing
        ? {
            id: governing.policy.row.id,
            scope: governing.scope,
            summary: this.summaryOf(governing.policy),
            useOwnPassRules: governing.policy.row.useOwnPassRules,
          }
        : null,
      totalDisplay,
      terms: (governing?.policy.terms ?? []).map((t) => ({ id: t.termId, name: t.name, sequence: t.sequence })),
      subjects: allSubjectIds
        .map((id) => ({ id, name: subjectNames.get(id) ?? "Subject" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      students,
    };
  }

  // -------------------------------------------------------------------------
  // The annual card (snapshotVersion 2)
  // -------------------------------------------------------------------------

  /** Builds every student's V2 snapshot from the STORED rows (draft preview == published card). */
  private async buildSnapshots(
    tx: DbLike,
    schoolId: string,
    academicYearId: string,
    classId: string,
    only?: string[],
  ): Promise<Map<string, ReportCardSnapshotV2>> {
    const ctx = await this.requireClassYear(tx, schoolId, academicYearId, classId);
    const out = new Map<string, ReportCardSnapshotV2>();
    if (!ctx) return out;
    const { governing, roster, finals, subjectRows, subjectNames } = await this.loadStored(
      tx,
      schoolId,
      academicYearId,
      classId,
    );
    if (!governing) return out;
    const studentIds = (only ?? roster.map((r) => r.studentId)).filter((id) =>
      finals.some((f) => f.studentId === id),
    );
    if (studentIds.length === 0) return out;

    const widgetRows = await tx
      .select({
        subjectId: classSubjectMappings.subjectId,
        name: subjectTypes.name,
        sequence: subjectTypes.sequence,
      })
      .from(classSubjectMappings)
      .innerJoin(subjectTypes, eq(classSubjectMappings.subjectTypeId, subjectTypes.id))
      .where(
        and(
          eq(classSubjectMappings.classId, classId),
          eq(classSubjectMappings.academicYearId, academicYearId),
        ),
      );
    const widgetOf = new Map(widgetRows.map((w) => [w.subjectId, w]));

    const termIds = governing.policy.terms.map((t) => t.termId);
    const termResults = await tx
      .select({
        studentId: studentTermResults.studentId,
        termId: studentTermResults.termId,
        percentage: studentTermResults.percentage,
        grade: studentTermResults.grade,
        rankInClass: studentTermResults.rankInClass,
      })
      .from(studentTermResults)
      .where(and(inArray(studentTermResults.termId, termIds), inArray(studentTermResults.studentId, studentIds)));
    const termResultOf = new Map(termResults.map((t) => [`${t.studentId}|${t.termId}`, t]));

    const attendanceRows = await tx
      .select({
        studentId: attendanceSummary.studentId,
        workingDays: attendanceSummary.workingDays,
        daysPresent: attendanceSummary.daysPresent,
        pct: attendanceSummary.attendancePercentage,
      })
      .from(attendanceSummary)
      .where(
        and(
          eq(attendanceSummary.academicYearId, academicYearId),
          eq(attendanceSummary.periodType, "annual"),
          inArray(attendanceSummary.studentId, studentIds),
        ),
      );
    const attendanceOf = new Map(attendanceRows.map((a) => [a.studentId, a]));

    const finalOf = new Map(finals.map((f) => [f.studentId, f]));
    const rosterOf = new Map(roster.map((r) => [r.studentId, r]));
    const nowIso = new Date().toISOString();
    const p = governing.policy;

    for (const studentId of studentIds) {
      const f = finalOf.get(studentId)!;
      const r = rosterOf.get(studentId);
      if (!r) continue;
      const mine = subjectRows
        .filter((s) => s.studentId === studentId)
        .sort((a, b) => {
          const sa = widgetOf.get(a.subjectId)?.sequence ?? 999;
          const sb = widgetOf.get(b.subjectId)?.sequence ?? 999;
          if (sa !== sb) return sa - sb;
          return (subjectNames.get(a.subjectId) ?? "").localeCompare(subjectNames.get(b.subjectId) ?? "");
        });
      const attendance = attendanceOf.get(studentId);
      const named = (ids: string[]) =>
        ids.map((subjectId) => ({ subjectId, subjectName: subjectNames.get(subjectId) ?? "Subject" }));

      out.set(studentId, {
        snapshotVersion: 2,
        kind: "annual",
        student: {
          name: r.name,
          admissionNumber: r.admissionNumber,
          className: ctx.className,
          sectionName: r.sectionName,
          rollNumber: r.rollNumber,
        },
        school: { name: ctx.schoolName },
        academicYear: { name: ctx.yearName },
        policy: {
          method: p.row.method,
          totalDisplay: p.row.totalDisplay,
          annualSubjectPassPercent: p.row.annualSubjectPassPercent,
          summary: this.summaryOf(p),
        },
        terms: p.terms.map((t) => {
          const tr = termResultOf.get(`${studentId}|${t.termId}`);
          return {
            termId: t.termId,
            name: t.name,
            sequence: t.sequence,
            percentage: tr?.percentage ?? null,
            grade: tr?.grade ?? null,
            rankInClass: tr?.rankInClass ?? null,
            nominalWeight: p.row.method === "weighted" ? t.weightage : null,
          };
        }),
        subjects: mine.map((s) => {
          const sources = s.sourceTerms as {
            termId: string;
            score: string | null;
            grade: string | null;
            used: boolean;
          }[];
          const sum = p.row.totalDisplay === "sum" ? sumDisplay(sources) : null;
          const widget = widgetOf.get(s.subjectId);
          return {
            subjectId: s.subjectId,
            subjectName: subjectNames.get(s.subjectId) ?? "Subject",
            widgetName: widget?.name ?? null,
            widgetSequence: widget?.sequence ?? null,
            percentage: s.finalPercentage,
            displayMarks: sum?.marks ?? null,
            displayMax: sum?.max ?? null,
            grade: s.grade,
            gradePoint: s.gradePoint,
            isPassed: s.isPassed,
            isExempted: s.isExempted,
            isGradedOnly: s.isGradedOnly,
            countsTowardResult: s.countsTowardResult,
            renormalized: s.renormalized,
            byTerm: sources.map((x) => ({
              termId: x.termId,
              score: x.score,
              grade: x.grade,
              used: x.used,
            })),
          };
        }),
        totals: {
          totalMarks: f.totalMarks,
          maxMarks: f.maxMarks,
          percentage: f.percentage,
          grade: f.grade,
          gradePoint: f.gradePoint,
          isPassed: f.isPassed,
          rankInSection: f.rankInSection,
          rankInClass: f.rankInClass,
        },
        verdict: {
          promotionStatus: verdictOf(f.promotionStatus),
          failedSubjects: named(f.subjectsFailed),
          compartmentSubjects: named(f.compartmentSubjects),
          renormalized: f.renormalized,
        },
        attendance: attendance
          ? {
              workingDays: attendance.workingDays,
              daysPresent: attendance.daysPresent,
              percentage: attendance.pct,
            }
          : null,
        generatedAt: nowIso,
      });
    }
    return out;
  }

  async card(
    scope: DataScope,
    academicYearId: string,
    classId: string,
    studentId: string,
  ): Promise<AnnualCardOutput> {
    const schoolId = requireSchoolId(scope);
    const ctx = await this.requireClassYear(db, schoolId, academicYearId, classId);
    if (!ctx) return null;
    const [published] = await db
      .select({ version: publishedReportCards.version, snapshotData: publishedReportCards.snapshotData })
      .from(publishedReportCards)
      .where(
        and(
          eq(publishedReportCards.studentId, studentId),
          eq(publishedReportCards.academicYearId, academicYearId),
          eq(publishedReportCards.isCurrent, true),
          sql`${publishedReportCards.termId} IS NULL`,
          eq(publishedReportCards.schoolId, schoolId),
        ),
      );
    if (published) {
      return { status: "published", version: published.version, snapshotData: published.snapshotData };
    }
    const snapshots = await this.buildSnapshots(db, schoolId, academicYearId, classId, [studentId]);
    const draft = snapshots.get(studentId);
    return draft ? { status: "draft", version: null, snapshotData: draft } : null;
  }

  // -------------------------------------------------------------------------
  // Publish - one class, explicit, never automatic
  // -------------------------------------------------------------------------

  async publishClass(
    scope: DataScope,
    userId: string,
    academicYearId: string,
    classId: string,
  ): Promise<AnnualPublishOutput | null> {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const ctx = await this.requireClassYear(tx, schoolId, academicYearId, classId);
      if (!ctx) return null;
      const readiness = await this.readinessTx(tx, schoolId, academicYearId, classId);
      if (readiness.publishBlockedReason) throw new Error(readiness.publishBlockedReason);

      const snapshots = await this.buildSnapshots(tx, schoolId, academicYearId, classId);
      const studentIds = [...snapshots.keys()];
      if (studentIds.length === 0) throw new Error("Generate the year first.");

      const [template] = await tx
        .select({ id: reportCardTemplates.id })
        .from(reportCardTemplates)
        .where(
          and(
            eq(reportCardTemplates.schoolId, schoolId),
            eq(reportCardTemplates.isDefault, true),
            eq(reportCardTemplates.isActive, true),
          ),
        );

      const now = new Date();
      for (const studentId of studentIds) {
        const [existing] = await tx
          .select({ id: publishedReportCards.id, version: publishedReportCards.version })
          .from(publishedReportCards)
          .where(
            and(
              eq(publishedReportCards.studentId, studentId),
              eq(publishedReportCards.academicYearId, academicYearId),
              eq(publishedReportCards.isCurrent, true),
              sql`${publishedReportCards.termId} IS NULL`,
            ),
          );
        if (existing) {
          await tx
            .update(publishedReportCards)
            .set({ isCurrent: false })
            .where(eq(publishedReportCards.id, existing.id));
        }
        await tx.insert(publishedReportCards).values({
          organizationId: scope.organizationId,
          schoolId,
          studentId,
          academicYearId,
          termId: null,
          version: (existing?.version ?? 0) + 1,
          replacesVersion: existing?.version ?? null,
          snapshotData: snapshots.get(studentId)!,
          snapshotVersion: 2,
          templateId: template?.id ?? null,
          revisionReason: existing ? "re-issue" : null,
          publishedBy: userId,
        });
      }

      await tx
        .update(studentFinalResults)
        .set({ resultStatus: "published", publishedBy: userId, publishedAt: now })
        .where(
          and(
            eq(studentFinalResults.academicYearId, academicYearId),
            inArray(studentFinalResults.studentId, studentIds),
          ),
        );
      await tx
        .update(studentFinalSubjectResults)
        .set({ resultStatus: "published", publishedAt: now })
        .where(
          and(
            eq(studentFinalSubjectResults.academicYearId, academicYearId),
            inArray(studentFinalSubjectResults.studentId, studentIds),
          ),
        );

      await tx.insert(authzAuditLog).values({
        organizationId: scope.organizationId,
        action: "result_published",
        actorUserId: userId,
        scopeId: classId,
        permission: "exam:publish",
        details: { kind: "annual", academicYearId, classId, students: studentIds.length },
      });

      return { published: studentIds.length, skipped: Math.max(0, readiness.studentCount - studentIds.length) };
    });
  }
}

export const examAnnualService = new ExamAnnualService();
