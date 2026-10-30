import { beforeAll, describe, expect, it } from "vitest";

/**
 * A PAPER EXCUSED ENTIRELY IS EXCUSED EVERYWHERE (ADR-053 §7), against real
 * Postgres. Before: a student with every component of a paper exempt scored 0
 * for that subject and FAILED it, while the term card showed it blank - the
 * card and the total disagreed. After: the subject row is excused (no marks,
 * not failed) and the term leaves it out of the denominator.
 */

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  academicYears,
  classSubjectMappings,
  classes,
  examComponents,
  examSubjectSchedules,
  exams,
  organizations,
  schools,
  sections,
  studentComponentResults,
  studentEnrollments,
  studentSubjectResults,
  studentTermResults,
  students,
  subjectTypes,
  subjects,
  terms,
  user,
} from "@repo/db/schema";
import { examResultsService } from "@repo/services";
import { and, eq } from "drizzle-orm";

const RUN = `exempt-itg-${Date.now()}`;

let scope: DataScope;
let ids: {
  examId: string;
  classId: string;
  termId: string;
  maths: string;
  excused: string;
  control: string;
};

beforeAll(async () => {
  await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: "Exempt", legalName: "Exempt Trust", slug: RUN }).returning();
    const [school] = await tx.insert(schools).values({ organizationId: org!.id, name: "Exempt School", legalName: "Exempt School", code: "EXMP" }).returning();
    const base = { organizationId: org!.id, schoolId: school!.id };
    const [year] = await tx.insert(academicYears).values({ ...base, name: "2037-38", startDate: "2037-04-01", endDate: "2038-03-31", originalEndDate: "2038-03-31" }).returning();
    const [term] = await tx.insert(terms).values({ ...base, academicYearId: year!.id, name: "Term 1", sequenceNumber: 1, startDate: "2037-04-01", endDate: "2037-09-30" }).returning();
    const [klass] = await tx.insert(classes).values({ ...base, name: "Exempt 8", numericOrder: 8 }).returning();
    const [sec] = await tx.insert(sections).values({ ...base, academicYearId: year!.id, classId: klass!.id, name: "A" }).returning();
    const [type] = await tx.insert(subjectTypes).values({ ...base, name: "Main Subjects" }).returning();
    await tx.insert(user).values({ id: `u-${RUN}`, name: "Exempt", email: `${RUN}@test.local`, emailVerified: true });
    const [exam] = await tx.insert(exams).values({ ...base, academicYearId: year!.id, termId: term!.id, name: "Exempt Exam", createdBy: `u-${RUN}` }).returning();

    const parts: Record<string, string> = {};
    const subjectIds: Record<string, string> = {};
    for (const name of ["Maths", "Science"]) {
      const [subject] = await tx.insert(subjects).values({ ...base, name: `${name} ${RUN}` }).returning();
      subjectIds[name] = subject!.id;
      await tx.insert(classSubjectMappings).values({ ...base, academicYearId: year!.id, classId: klass!.id, subjectId: subject!.id, subjectTypeId: type!.id });
      const [schedule] = await tx.insert(examSubjectSchedules).values({ ...base, examId: exam!.id, classId: klass!.id, subjectId: subject!.id, examDate: "2037-09-10", startTime: "09:00:00", durationMinutes: 120, passMarks: "33.00" }).returning();
      const [part] = await tx.insert(examComponents).values({ ...base, scheduleId: schedule!.id, name: "Theory", maxMarks: "100.00", passMarks: "33.00", weightagePercentage: "100.00" }).returning();
      parts[name] = part!.id;
      parts[`${name}:schedule`] = schedule!.id;
    }

    const mk = async (key: string) => {
      const [s] = await tx.insert(students).values({ ...base, admissionNumber: `${RUN}-${key}`, firstName: key, lastName: "Itg", dateOfBirth: "2012-06-15", gender: "female" }).returning();
      await tx.insert(studentEnrollments).values({ ...base, studentId: s!.id, academicYearId: year!.id, classId: klass!.id, sectionId: sec!.id });
      return s!.id;
    };
    const excused = await mk("Excused");
    const control = await mk("Control");

    const entry = (studentId: string, subject: "Maths" | "Science", over: Partial<typeof studentComponentResults.$inferInsert>) => ({
      ...base,
      studentId,
      examId: exam!.id,
      scheduleId: parts[`${subject}:schedule`]!,
      componentId: parts[subject]!,
      ...over,
    });
    await tx.insert(studentComponentResults).values([
      // Excused: the ONLY component of Maths is exempt; Science scored 60.
      entry(excused, "Maths", { isExempted: true, exemptionType: "medical" }),
      entry(excused, "Science", { marksObtained: "60.00" }),
      // Control: Maths 80, Science 60.
      entry(control, "Maths", { marksObtained: "80.00" }),
      entry(control, "Science", { marksObtained: "60.00" }),
    ]);

    scope = { organizationId: org!.id, schoolId: school!.id, classId: null, sectionId: null };
    ids = { examId: exam!.id, classId: klass!.id, termId: term!.id, maths: subjectIds.Maths!, excused, control };
  });
});

describe("exemption integration: a paper excused entirely", () => {
  it("is not scored, not failed, and leaves the term denominator", async () => {
    const computed = await examResultsService.computeClassResults(scope, ids.examId, ids.classId);
    expect(computed).toHaveLength(2);

    const [mathsRow] = await db
      .select()
      .from(studentSubjectResults)
      .where(and(eq(studentSubjectResults.studentId, ids.excused), eq(studentSubjectResults.subjectId, ids.maths)));
    expect(mathsRow).toMatchObject({ isExempted: true, isPassed: true, finalMarks: null, marksObtained: null });

    const term = async (studentId: string) =>
      (
        await db
          .select()
          .from(studentTermResults)
          .where(and(eq(studentTermResults.studentId, studentId), eq(studentTermResults.termId, ids.termId)))
      )[0];

    // The excused student's term is Science alone - never a 0 for Maths.
    const excused = await term(ids.excused);
    expect(excused).toMatchObject({ percentage: "60.00", maxMarks: "100.00", isPassed: true, subjectsFailedCount: 0 });
    expect(excused?.subjectsFailed).toEqual([]);

    // The control student sat both: (80 + 60) / 2.
    expect((await term(ids.control))?.percentage).toBe("70.00");
  }, 120_000);

  it("is stable: computing again changes nothing", async () => {
    await examResultsService.computeClassResults(scope, ids.examId, ids.classId);
    const rows = await db
      .select({ s: studentSubjectResults.studentId, subject: studentSubjectResults.subjectId })
      .from(studentSubjectResults)
      .where(eq(studentSubjectResults.examId, ids.examId));
    expect(rows).toHaveLength(4);
  }, 120_000);
});
