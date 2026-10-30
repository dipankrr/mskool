import { db } from "@repo/db";
import {
  classSubjectMappings,
  examSubjectSchedules,
  gradingScaleBands,
  gradingScales,
  passCriteria,
  studentEnrollments,
  subjectTypes,
  subjects,
} from "@repo/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  describeSchedulePartitionViolations,
  findSchedulePartitionViolations,
  toHundredths,
} from "./exams-maths";

/**
 * The reads the exam compute and the annual engine must AGREE on: the pass
 * criteria, the default scale, the class's subject set, the cohorts and -
 * above all - which paper each (student, subject) sits (ADR-052). They live
 * here, once, so a result's readiness can never disagree with its compute.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The shared reads accept either an open transaction or the root db. */
export type DbLike = Tx | typeof db;
export type ScheduleRow = typeof examSubjectSchedules.$inferSelect;

/** Pass criteria for a year: the class row wins over the school default. */
export async function loadPassCriteria(
  tx: DbLike,
  schoolId: string,
  academicYearId: string,
  classId: string | null,
) {
  const rows = await tx
    .select()
    .from(passCriteria)
    .where(and(eq(passCriteria.schoolId, schoolId), eq(passCriteria.academicYearId, academicYearId)));
  const classRow = classId ? rows.find((c) => c.classId === classId) : undefined;
  return classRow ?? rows.find((c) => c.classId === null) ?? null;
}

/** The school's default scale + bands (component overrides resolved by callers). */
export async function loadDefaultScale(tx: DbLike, schoolId: string) {
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
 * THE RESOLVER SEAM. The class's counted, exam-mode mappings - v1 returns
 * every counted exam-mode mapping (every student takes every mapped
 * subject). Elective machinery later swaps this one function for a read of
 * `student_subject_enrollments`.
 */
export async function loadSubjectSet(tx: DbLike, classId: string, academicYearId: string) {
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
export async function loadCohort(
  tx: DbLike,
  classId: string,
  academicYearId: string,
  sectionId: string | null,
) {
  const base = [
    eq(studentEnrollments.classId, classId),
    eq(studentEnrollments.academicYearId, academicYearId),
    inArray(studentEnrollments.enrollmentStatus, ["active", "admitted", "section_assigned"]),
  ];
  return tx
    .selectDistinct({ studentId: studentEnrollments.studentId })
    .from(studentEnrollments)
    .where(sectionId ? and(...base, eq(studentEnrollments.sectionId, sectionId)) : and(...base));
}

/**
 * THE PAPER EACH (STUDENT, SUBJECT) SITS (ADR-052). A section paper cohorts
 * its own section; a class-wide paper cohorts the whole class, sectionless
 * students included. The blueprint save refuses ambiguous shapes; this
 * defense refuses them with words - the old engine's section-blind .find()
 * ran the whole class against whichever paper it saw first, zeroing the
 * section whose marks lived on the other row.
 *
 * `allStudentIds` is the compute population: every student at least one
 * paper covers. A student no paper covers - a section that doesn't sit -
 * gets NO row, never a computed zero-fail.
 */
export async function resolvePapers(
  tx: DbLike,
  schedules: ScheduleRow[],
  classId: string,
  academicYearId: string,
) {
  const violations = findSchedulePartitionViolations(schedules);
  if (violations.length > 0) {
    const names = await tx
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(inArray(subjects.id, [...new Set(violations.map((v) => v.subjectId))]));
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    throw new Error(
      `Ambiguous date sheet: ${describeSchedulePartitionViolations(
        violations,
        (id) => nameOf.get(id) ?? "a subject",
      )}. Fix the papers before computing.`,
    );
  }

  // One cohort load per DISTINCT scope: every class-wide paper shares the
  // whole-class cohort; each section loads its own once.
  const cohortByScope = new Map<string, string[]>();
  const cohortFor = async (sectionId: string | null) => {
    const key = sectionId ?? "*class";
    const hit = cohortByScope.get(key);
    if (hit) return hit;
    const rows = await loadCohort(tx, classId, academicYearId, sectionId);
    const ids = rows.map((r) => r.studentId);
    cohortByScope.set(key, ids);
    return ids;
  };
  const paperOf = new Map<string, Map<string, ScheduleRow>>();
  for (const schedule of schedules) {
    for (const studentId of await cohortFor(schedule.sectionId)) {
      let bySubject = paperOf.get(studentId);
      if (!bySubject) {
        bySubject = new Map();
        paperOf.set(studentId, bySubject);
      }
      bySubject.set(schedule.subjectId, schedule);
    }
  }
  const allStudentIds = new Set<string>();
  for (const ids of cohortByScope.values()) {
    for (const id of ids) allStudentIds.add(id);
  }
  return { paperOf, allStudentIds };
}
