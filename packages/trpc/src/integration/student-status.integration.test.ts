import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  attendanceRecords,
  attendanceSummary,
  dailyAttendanceStatus,
  studentAssignments,
  studentEnrollments,
  students,
} from "@repo/db/schema";
import { attendanceService, enrollmentService, studentService } from "@repo/services";

import { buildWorld } from "./world";

/**
 * ADR-057: a student's status follows their latest enrollment, lists agree on
 * who is enrolled, and attendance follows the date a student left.
 */
describe("student statuses and the roster", () => {
  let world: Awaited<ReturnType<typeof buildWorld>>;
  let school: DataScope;
  const RUN = Date.now().toString(36);
  let serial = 0;

  const newStudent = (gender: "male" | "female" = "female") => {
    serial += 1;
    return studentService.createStudent(school, {
      admissionNumber: `STATUS-${RUN}-${serial}`,
      firstName: `Status${RUN}`,
      lastName: `Child${serial}`,
      gender,
      dateOfBirth: "2015-01-01",
    });
  };

  const admit = async (section: boolean) => {
    const student = await newStudent();
    const enrollment = await enrollmentService.createEnrollment(school, {
      studentId: student.id,
      academicYearId: world.currentYearAId,
      classId: world.class6Id,
      enrollmentDate: "2025-07-01",
      ...(section ? { sectionId: world.section6aId } : {}),
    });
    return { student, enrollment };
  };

  const statusOf = async (id: string) => {
    const [row] = await db.select().from(students).where(eq(students.id, id));
    return row?.status;
  };

  const roster = (scopes: DataScope[], view: "current" | "left" | "notPlaced" | "all") =>
    studentService.listRoster(scopes, {
      academicYearId: world.currentYearAId,
      view,
      sort: "class",
      q: `Status${RUN}`,
      limit: 100,
    });

  /**
   * The world is shared and other suites pin its exact rosters, so these
   * students never outlive the file. Also runs first, so a crashed run can't
   * poison the next one.
   */
  const removeTestStudents = async () => {
    const testStudents = db
      .select({ id: students.id })
      .from(students)
      .where(
        and(eq(students.schoolId, world.schoolA1Id), like(students.admissionNumber, "STATUS-%")),
      );
    const testEnrollments = db
      .select({ id: studentEnrollments.id })
      .from(studentEnrollments)
      .where(inArray(studentEnrollments.studentId, testStudents));

    await db
      .delete(studentAssignments)
      .where(inArray(studentAssignments.studentEnrollmentId, testEnrollments));
    await db.delete(attendanceRecords).where(inArray(attendanceRecords.studentId, testStudents));
    await db
      .delete(dailyAttendanceStatus)
      .where(inArray(dailyAttendanceStatus.studentId, testStudents));
    await db.delete(attendanceSummary).where(inArray(attendanceSummary.studentId, testStudents));
    await db.delete(studentEnrollments).where(inArray(studentEnrollments.studentId, testStudents));
    await db
      .delete(students)
      .where(
        and(eq(students.schoolId, world.schoolA1Id), like(students.admissionNumber, "STATUS-%")),
      );
  };

  beforeAll(async () => {
    world = await buildWorld();
    school = {
      organizationId: world.orgAId,
      schoolId: world.schoolA1Id,
      classId: null,
      sectionId: null,
    };
    await removeTestStudents();
  });

  afterAll(removeTestStudents);

  it("derives the first status from the section", async () => {
    expect((await admit(true)).enrollment.enrollmentStatus).toBe("studying");
    expect((await admit(false)).enrollment.enrollmentStatus).toBe("admitted");
  });

  it("assigning a section moves admitted to studying", async () => {
    const { enrollment } = await admit(false);
    const updated = await enrollmentService.assignSection(school, enrollment.id, {
      sectionId: world.section6aId,
    });
    expect(updated.enrollmentStatus).toBe("studying");
  });

  it("a student with no section can still get a TC", async () => {
    const { student, enrollment } = await admit(false);
    await enrollmentService.leaveEnrollment(school, world.users.teacherC6, enrollment.id, {
      to: "transferred_out",
    });
    expect(await statusOf(student.id)).toBe("inactive");
  });

  it("a write that skips the service still moves the student", async () => {
    const { student, enrollment } = await admit(true);
    await db
      .update(studentEnrollments)
      .set({ enrollmentStatus: "expelled" })
      .where(eq(studentEnrollments.id, enrollment.id));
    expect(await statusOf(student.id)).toBe("inactive");
  });

  it("refuses a student status the latest enrollment contradicts", async () => {
    const { student } = await admit(true);
    await expect(
      db.update(students).set({ status: "inactive" }).where(eq(students.id, student.id)),
    ).rejects.toThrow();
  });

  it("changing an older session's row leaves today's status alone", async () => {
    const { student } = await admit(true);
    const [older] = await db
      .insert(studentEnrollments)
      .values({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        studentId: student.id,
        academicYearId: world.closedYearAId,
        classId: world.class6Id,
        enrollmentStatus: "studying",
      })
      .returning();
    await db
      .update(studentEnrollments)
      .set({ enrollmentStatus: "withdrawn" })
      .where(eq(studentEnrollments.id, older!.id));
    expect(await statusOf(student.id)).toBe("active");
  });

  it("deactivating closes an open enrollment", async () => {
    const { student, enrollment } = await admit(true);
    await studentService.deactivateStudent(school, student.id, world.users.teacherC6);
    expect(await statusOf(student.id)).toBe("inactive");
    const [row] = await db
      .select()
      .from(studentEnrollments)
      .where(eq(studentEnrollments.id, enrollment.id));
    expect(row?.enrollmentStatus).toBe("withdrawn");
  });

  it("a student never placed can be deactivated and brought back", async () => {
    const student = await newStudent("male");
    await studentService.deactivateStudent(school, student.id, world.users.teacherC6);
    expect(await statusOf(student.id)).toBe("inactive");
    await studentService.rejoinStudent(school, student.id);
    expect(await statusOf(student.id)).toBe("active");
  });

  it("a student who left drops off the default list and moves roster views", async () => {
    const { student, enrollment } = await admit(true);
    const ids = async (includeLeft: boolean) =>
      (
        await enrollmentService.listEnrollments(
          [school],
          world.currentYearAId,
          undefined,
          world.section6aId,
          includeLeft,
        )
      ).map((row) => row.student.id);

    expect(await ids(false)).toContain(student.id);
    expect((await roster([school], "current")).rows.map((row) => row.id)).toContain(student.id);

    await enrollmentService.leaveEnrollment(school, world.users.teacherC6, enrollment.id, {
      to: "withdrawn",
    });

    expect(await ids(false)).not.toContain(student.id);
    expect(await ids(true)).toContain(student.id);
    expect((await roster([school], "current")).rows.map((row) => row.id)).not.toContain(student.id);
    const left = (await roster([school], "left")).rows.find((row) => row.id === student.id);
    expect(left?.enrollmentStatus).toBe("withdrawn");
    expect(left?.className).toBe("ITG Class 6");
  });

  it("not placed means active with no row this year", async () => {
    const student = await newStudent("male");
    expect((await roster([school], "notPlaced")).rows.map((row) => row.id)).toContain(student.id);
    expect((await roster([school], "current")).rows.map((row) => row.id)).not.toContain(student.id);
  });

  it("someone limited to a section sees only that section's students", async () => {
    const inSection = await admit(true);
    const noSection = await admit(false);
    const teacher: DataScope = { ...school, classId: world.class6Id, sectionId: world.section6aId };
    const seen = (await roster([teacher], "all")).rows.map((row) => row.id);
    expect(seen).toContain(inSection.student.id);
    expect(seen).not.toContain(noSection.student.id);
    expect((await roster([teacher], "notPlaced")).rows).toEqual([]);
  });

  it("the summary counts match the views, and the list pages", async () => {
    await admit(true);
    const summary = await studentService.rosterSummary([school], world.currentYearAId);
    const count = async (view: "current" | "left" | "notPlaced" | "all") => {
      let total = 0;
      let cursor: number | undefined;
      do {
        const page = await studentService.listRoster([school], {
          academicYearId: world.currentYearAId,
          view,
          sort: "name",
          limit: 100,
          ...(cursor !== undefined ? { cursor } : {}),
        });
        total += page.rows.length;
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return total;
    };
    expect(await count("current")).toBe(summary.counts.current);
    expect(await count("notPlaced")).toBe(summary.counts.notPlaced);
    expect(await count("left")).toBe(summary.counts.left);
    expect(await count("all")).toBe(summary.counts.all);
  });

  it("offers the years students were admitted in, and filters by one", async () => {
    serial += 1;
    const student = await studentService.createStudent(school, {
      admissionNumber: `STATUS-${RUN}-${serial}`,
      firstName: `Status${RUN}`,
      lastName: `Child${serial}`,
      gender: "male",
      dateOfBirth: "2015-01-01",
      admissionDate: "2019-06-01",
    });
    const { admissionYears } = await studentService.rosterSummary([school], world.currentYearAId);
    expect(admissionYears).toContain(2019);
    expect(admissionYears).toEqual([...admissionYears].sort((a, b) => b - a));
    const page = await studentService.listRoster([school], {
      academicYearId: world.currentYearAId,
      view: "all",
      sort: "name",
      q: `Status${RUN}`,
      admissionYear: 2019,
    });
    expect(page.rows.map((row) => row.id)).toEqual([student.id]);
  });

  it("attendance accepts days before a student left and refuses from that day", async () => {
    const { student, enrollment } = await admit(true);
    const mark = (date: string) =>
      attendanceService.markAttendance(
        school,
        {
          sectionId: world.section6aId,
          date,
          entries: [{ studentId: student.id, status: "present" }],
        },
        world.users.teacherC6,
      );
    await enrollmentService.leaveEnrollment(school, world.users.teacherC6, enrollment.id, {
      to: "withdrawn",
      leftOn: "2025-07-16",
    });
    await expect(mark("2025-07-15")).resolves.toEqual({ marked: 1 });
    await expect(mark("2025-07-16")).rejects.toThrow(/not enrolled in this section/);
  });
});
