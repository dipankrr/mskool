import { db } from "@repo/db";
import {
  academicYears,
  classes,
  schools,
  sections,
  studentEnrollments,
  students,
} from "@repo/db/schema";
import { and, desc, eq } from "drizzle-orm";

import { refuse } from "./service-error";

/**
 * The family-read entry point (ADR-062). Every `portal*` read for one child
 * starts here, and it answers two questions in one place:
 *
 * 1. **Is this child this login's?** The owned list comes from the session's
 *    portal-access rows (`ctx.studentIds`). A child outside it is refused
 *    NOT_FOUND, never FORBIDDEN, so a family cannot probe which ids exist.
 * 2. **Which school and year?** Always from the child's enrolment, never from
 *    the session: one login can cover children in different schools, even
 *    different organisations. No `academicYearId`: the current year's
 *    enrolment, else the latest one.
 */
export type PortalChild = {
  studentId: string;
  organizationId: string;
  schoolId: string;
  academicYearId: string;
  enrollmentId: string;
  enrollmentStatus: string;
  classId: string;
  className: string;
  sectionId: string | null;
  sectionName: string | null;
  rollNumber: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  year: { name: string; startDate: string; endDate: string; isCurrent: boolean };
};

const NOT_FOUND_MESSAGE = "Student not found.";

export function fullName(p: {
  firstName: string;
  middleName: string | null;
  lastName: string;
}): string {
  return [p.firstName, p.middleName, p.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

export async function resolvePortalChild(
  ownedStudentIds: readonly string[],
  studentId: string,
  academicYearId?: string,
): Promise<PortalChild> {
  if (!ownedStudentIds.includes(studentId)) {
    throw refuse("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  const rows = await db
    .select({
      enrollmentId: studentEnrollments.id,
      organizationId: studentEnrollments.organizationId,
      schoolId: studentEnrollments.schoolId,
      academicYearId: studentEnrollments.academicYearId,
      enrollmentStatus: studentEnrollments.enrollmentStatus,
      classId: studentEnrollments.classId,
      className: classes.name,
      sectionId: studentEnrollments.sectionId,
      sectionName: sections.name,
      rollNumber: studentEnrollments.rollNumber,
      firstName: students.firstName,
      middleName: students.middleName,
      lastName: students.lastName,
      yearName: academicYears.name,
      yearStart: academicYears.startDate,
      yearEnd: academicYears.endDate,
      isCurrent: academicYears.isCurrent,
    })
    .from(studentEnrollments)
    .innerJoin(students, eq(students.id, studentEnrollments.studentId))
    .innerJoin(academicYears, eq(academicYears.id, studentEnrollments.academicYearId))
    .innerJoin(classes, eq(classes.id, studentEnrollments.classId))
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .where(
      and(
        eq(studentEnrollments.studentId, studentId),
        academicYearId ? eq(studentEnrollments.academicYearId, academicYearId) : undefined,
      ),
    )
    .orderBy(
      desc(academicYears.isCurrent),
      desc(academicYears.startDate),
      desc(studentEnrollments.createdAt),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw refuse("NOT_FOUND", NOT_FOUND_MESSAGE);

  return {
    studentId,
    organizationId: row.organizationId,
    schoolId: row.schoolId,
    academicYearId: row.academicYearId,
    enrollmentId: row.enrollmentId,
    enrollmentStatus: row.enrollmentStatus,
    classId: row.classId,
    className: row.className,
    sectionId: row.sectionId,
    sectionName: row.sectionName,
    rollNumber: row.rollNumber,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    year: {
      name: row.yearName,
      startDate: row.yearStart,
      endDate: row.yearEnd,
      isCurrent: row.isCurrent,
    },
  };
}

/**
 * Every child this login owns, each with its current (else latest)
 * enrolment: the family app’s switcher. Children without any enrolment
 * are left out. Ordered by first name, so the list is stable.
 */
export async function listPortalChildren(ownedStudentIds: readonly string[]) {
  const children = [];
  for (const studentId of ownedStudentIds) {
    let child: PortalChild;
    try {
      child = await resolvePortalChild(ownedStudentIds, studentId);
    } catch {
      continue;
    }
    const [school] = await db
      .select({ name: schools.name })
      .from(schools)
      .where(eq(schools.id, child.schoolId));
    children.push({
      studentId,
      firstName: child.firstName,
      name: fullName(child),
      schoolName: school?.name ?? "",
      className: child.className,
      sectionName: child.sectionName,
      rollNumber: child.rollNumber,
      academicYear: {
        id: child.academicYearId,
        name: child.year.name,
        isCurrent: child.year.isCurrent,
      },
    });
  }
  return children.sort((a, b) => a.firstName.localeCompare(b.firstName));
}
