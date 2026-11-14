import { scopeWhere, type DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  classSubjectMappings,
  classes,
  schools,
  sectionTeacherAssignments as STA,
  sections,
  staff,
  subjects,
} from "@repo/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { atSchoolLevel } from "./academic.service";
import { assignmentIsCurrent } from "./assignment-access.service";

/**
 * TEACHING READ MODELS (ADR-068) — what the Teaching screens show.
 *
 * - `overview`: every section of a branch's session with its class teacher
 *   and each mapped subject's teachers, plus the gaps. Read-only for
 *   teachers (the whole grid is visible to anyone with
 *   `teacher_assignment:read`; only managers see Assign buttons).
 * - `mine`: what the signed-in person teaches now, for Home and Welcome.
 *
 * Both read school-level tables, so the caller's scopes widen to the branch
 * (the same entity-shape widening as the assignment lists).
 */

export interface TeacherRef {
  assignmentId: string;
  staffId: string;
  name: string;
  /** Exclusive end for a substitute; null when open-ended. */
  effectiveTo: string | null;
}

export class TeachingOverviewService {
  async overview(scopes: DataScope[], schoolId: string, academicYearId: string) {
    const wide = scopes.map(atSchoolLevel);
    const [school] = await db
      .select({ on: schools.classTeachersEnabled })
      .from(schools)
      .where(eq(schools.id, schoolId));
    const classTeachersEnabled = school?.on ?? false;

    const sectionRows = await db
      .select({
        sectionId: sections.id,
        sectionName: sections.name,
        classId: classes.id,
        className: classes.name,
        classOrder: classes.numericOrder,
      })
      .from(sections)
      .innerJoin(classes, eq(sections.classId, classes.id))
      .where(
        and(
          eq(sections.schoolId, schoolId),
          eq(sections.academicYearId, academicYearId),
          scopeWhere(wide, { organizationId: sections.organizationId, schoolId: sections.schoolId }),
        ),
      )
      .orderBy(asc(classes.numericOrder), asc(sections.name));

    const mappingRows = await db
      .select({
        mappingId: classSubjectMappings.id,
        classId: classSubjectMappings.classId,
        subjectId: subjects.id,
        subjectName: subjects.name,
        shortName: subjects.shortName,
        sequence: classSubjectMappings.sequenceNumber,
      })
      .from(classSubjectMappings)
      .innerJoin(subjects, eq(classSubjectMappings.subjectId, subjects.id))
      .where(
        and(
          eq(classSubjectMappings.schoolId, schoolId),
          eq(classSubjectMappings.academicYearId, academicYearId),
          eq(subjects.isActive, true),
          scopeWhere(wide, {
            organizationId: classSubjectMappings.organizationId,
            schoolId: classSubjectMappings.schoolId,
          }),
        ),
      )
      .orderBy(asc(classSubjectMappings.sequenceNumber), asc(subjects.name));

    const assignmentRows = await db
      .select({
        assignmentId: STA.id,
        sectionId: STA.sectionId,
        subjectId: STA.subjectId,
        role: STA.role,
        effectiveTo: STA.effectiveTo,
        staffId: staff.id,
        firstName: staff.firstName,
        lastName: staff.lastName,
      })
      .from(STA)
      .innerJoin(staff, eq(STA.staffId, staff.id))
      .where(
        and(
          eq(STA.schoolId, schoolId),
          eq(STA.academicYearId, academicYearId),
          assignmentIsCurrent(),
          scopeWhere(wide, { organizationId: STA.organizationId, schoolId: STA.schoolId }),
        ),
      )
      .orderBy(asc(STA.createdAt));

    const ref = (row: (typeof assignmentRows)[number]): TeacherRef => ({
      assignmentId: row.assignmentId,
      staffId: row.staffId,
      name: `${row.firstName} ${row.lastName}`.trim(),
      effectiveTo: row.effectiveTo,
    });

    let slots = 0;
    let filled = 0;
    let noClassTeacher = 0;
    let noTeacher = 0;
    const out = sectionRows.map((section) => {
      const mine = assignmentRows.filter((row) => row.sectionId === section.sectionId);
      const classTeacherRow = mine.find((row) => row.role === "class_teacher");
      const subjectList = mappingRows
        .filter((mapping) => mapping.classId === section.classId)
        .map((mapping) => {
          const teachers = mine
            .filter((row) => row.role === "subject_teacher" && row.subjectId === mapping.subjectId)
            .map(ref);
          return {
            mappingId: mapping.mappingId,
            subjectId: mapping.subjectId,
            subjectName: mapping.subjectName,
            shortName: mapping.shortName,
            teachers,
          };
        });
      const subjectGaps = subjectList.filter((s) => s.teachers.length === 0).length;
      const classTeacherGap = classTeachersEnabled && !classTeacherRow ? 1 : 0;
      slots += subjectList.length + (classTeachersEnabled ? 1 : 0);
      filled += subjectList.length - subjectGaps + (classTeachersEnabled && classTeacherRow ? 1 : 0);
      noClassTeacher += classTeacherGap;
      noTeacher += subjectGaps;
      return {
        sectionId: section.sectionId,
        sectionName: section.sectionName,
        classId: section.classId,
        className: section.className,
        classTeacher: classTeacherRow ? ref(classTeacherRow) : null,
        subjects: subjectList,
        gaps: subjectGaps + classTeacherGap,
      };
    });

    return {
      classTeachersEnabled,
      sections: out,
      totals: { slots, filled, noClassTeacher, noTeacher },
    };
  }

  /** What the signed-in person teaches now in this branch (Home, Welcome). */
  async mine(organizationId: string, schoolId: string, userId: string) {
    const rows = await db
      .select({
        assignmentId: STA.id,
        role: STA.role,
        effectiveTo: STA.effectiveTo,
        sectionId: sections.id,
        sectionName: sections.name,
        classId: classes.id,
        className: classes.name,
        classOrder: classes.numericOrder,
        subjectId: STA.subjectId,
        subjectName: subjects.name,
      })
      .from(STA)
      .innerJoin(staff, eq(STA.staffId, staff.id))
      .innerJoin(sections, eq(STA.sectionId, sections.id))
      .innerJoin(classes, eq(sections.classId, classes.id))
      .leftJoin(subjects, eq(STA.subjectId, subjects.id))
      .where(
        and(
          eq(STA.organizationId, organizationId),
          eq(STA.schoolId, schoolId),
          eq(staff.userId, userId),
          assignmentIsCurrent(),
        ),
      )
      .orderBy(asc(classes.numericOrder), asc(sections.name), asc(subjects.name));
    return rows.map(({ classOrder: _order, ...row }) => row);
  }

  async setClassTeachersEnabled(scope: DataScope, enabled: boolean) {
    const schoolId = atSchoolLevel(scope).schoolId;
    if (!schoolId) throw new Error("A school is required.");
    const [row] = await db
      .update(schools)
      .set({ classTeachersEnabled: enabled })
      .where(and(eq(schools.id, schoolId), eq(schools.organizationId, scope.organizationId)))
      .returning({ on: schools.classTeachersEnabled });
    return { classTeachersEnabled: row?.on ?? false };
  }
}

export const teachingOverviewService = new TeachingOverviewService();
