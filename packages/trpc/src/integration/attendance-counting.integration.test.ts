import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gte, inArray, like, lte } from "drizzle-orm";

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  academicCalendar,
  attendanceRecords,
  attendanceSummary,
  dailyAttendanceStatus,
  studentAssignments,
  studentEnrollments,
  students,
} from "@repo/db/schema";
import {
  attendancePercent,
  attendanceService,
  attendanceToDate,
  enrollmentService,
  studentService,
} from "@repo/services";

import { buildWorld } from "./world";

/**
 * How attendance is counted and how fast a save is.
 */
describe("attendance counting", () => {
  let world: Awaited<ReturnType<typeof buildWorld>>;
  let school: DataScope;
  const RUN = Date.now().toString(36);
  let serial = 0;

  const admit = async (enrollmentDate: string) => {
    serial += 1;
    const student = await studentService.createStudent(school, {
      admissionNumber: `ATTC-${RUN}-${serial}`,
      firstName: `Count${RUN}`,
      lastName: `Child${serial}`,
      gender: "female",
      dateOfBirth: "2015-01-01",
    });
    const enrollment = await enrollmentService.createEnrollment(school, {
      studentId: student.id,
      academicYearId: world.currentYearAId,
      classId: world.class6Id,
      sectionId: world.section6aId,
      enrollmentDate,
    });
    return { student, enrollment };
  };

  const mark = (
    date: string,
    entries: { studentId: string; status: "present" | "absent" | "late" | "half_day" | "on_leave" }[],
  ) =>
    attendanceService.markAttendance(
      school,
      { sectionId: world.section6aId, date, entries },
      world.users.teacherC6,
    );

  /** Test students never outlive the file; also runs first, so a crash can't poison the next run. */
  const removeTestStudents = async () => {
    const testStudents = db
      .select({ id: students.id })
      .from(students)
      .where(
        and(eq(students.schoolId, world.schoolA1Id), like(students.admissionNumber, "ATTC-%")),
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
        and(eq(students.schoolId, world.schoolA1Id), like(students.admissionNumber, "ATTC-%")),
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

  /** Working days in the fixture calendar between two dates, inclusive. */
  const workingBetween = async (from: string, to: string) => {
    const rows = await db
      .select({ date: academicCalendar.date })
      .from(academicCalendar)
      .where(
        and(
          eq(academicCalendar.schoolId, world.schoolA1Id),
          eq(academicCalendar.academicYearId, world.currentYearAId),
          inArray(academicCalendar.dayType, ["working", "exam_day", "half_day"]),
          gte(academicCalendar.date, from),
          lte(academicCalendar.date, to),
        ),
      );
    return rows.length;
  };

  const summariesOf = (studentId: string) =>
    db
      .select()
      .from(attendanceSummary)
      .where(
        and(
          eq(attendanceSummary.studentId, studentId),
          eq(attendanceSummary.academicYearId, world.currentYearAId),
        ),
      );

  it("counts a late joiner's working days from the day she joined", async () => {
    const { student } = await admit("2025-07-21");
    await mark("2025-07-21", [{ studentId: student.id, status: "present" }]);

    const rows = await summariesOf(student.id);
    const july = rows.find((r) => r.periodType === "monthly" && r.month === 7);
    const annual = rows.find((r) => r.periodType === "annual");
    const term1 = rows.find((r) => r.termId === world.termA1T1Id);
    expect(july!.workingDays).toBe(await workingBetween("2025-07-21", "2025-07-31"));
    expect(annual!.workingDays).toBe(await workingBetween("2025-07-21", "2026-03-31"));
    expect(term1!.workingDays).toBe(await workingBetween("2025-07-21", "2025-09-30"));
    expect(july!.attendancePercentage).toBe(
      attendancePercent(1, await workingBetween("2025-07-21", "2025-07-31")),
    );
  });

  it("leaves out the days between leaving and rejoining", async () => {
    const { student, enrollment } = await admit("2025-04-01");
    await mark("2025-06-02", [{ studentId: student.id, status: "present" }]);
    await db
      .update(studentEnrollments)
      .set({
        leavingHistory: [
          {
            status: "withdrawn",
            leftOn: "2025-06-10",
            reason: null,
            leftBy: null,
            rejoinedOn: "2025-07-01",
          },
        ],
      })
      .where(eq(studentEnrollments.id, enrollment.id));
    await attendanceService.recomputeSummary(school, world.currentYearAId, [student.id]);

    const annual = (await summariesOf(student.id)).find((r) => r.periodType === "annual");
    expect(annual!.workingDays).toBe(
      (await workingBetween("2025-04-01", "2025-06-09")) +
        (await workingBetween("2025-07-01", "2026-03-31")),
    );
  });

  it("the so-far figure stops at the given date", async () => {
    const { student } = await admit("2025-04-01");
    await mark("2025-08-04", [{ studentId: student.id, status: "present" }]);
    await mark("2025-08-05", [{ studentId: student.id, status: "absent" }]);

    const soFar = await attendanceToDate(db, {
      schoolId: world.schoolA1Id,
      academicYearId: world.currentYearAId,
      studentIds: [student.id],
      asOf: "2025-08-05",
    });
    const working = await workingBetween("2025-04-01", "2025-08-05");
    expect(soFar.get(student.id)).toMatchObject({
      workingDays: working,
      daysAttended: 1,
      percentage: attendancePercent(1, working),
    });

    // A student with no marks has no figure at all, never a 0%.
    const { student: unmarked } = await admit("2025-04-01");
    const none = await attendanceToDate(db, {
      schoolId: world.schoolA1Id,
      academicYearId: world.currentYearAId,
      studentIds: [unmarked.id],
    });
    expect(none.has(unmarked.id)).toBe(false);
  });

  it("the late switch re-counts the current session", async () => {
    const { student } = await admit("2025-04-01");
    await mark("2025-09-01", [{ studentId: student.id, status: "present" }]);
    await mark("2025-09-02", [{ studentId: student.id, status: "late" }]);

    const annualOf = async () =>
      (await summariesOf(student.id)).find((r) => r.periodType === "annual")!;
    expect((await annualOf()).daysAttended).toBe(2);

    try {
      await attendanceService.upsertPolicy(
        school,
        { lateCountsAsPresent: false },
        world.users.adminA,
      );
      const off = await annualOf();
      expect(off.daysAttended).toBe(1);
      expect(off.daysLate).toBe(1);
      expect(off.attendancePercentage).toBe(attendancePercent(1, off.workingDays));
    } finally {
      await attendanceService.upsertPolicy(
        school,
        { lateCountsAsPresent: true },
        world.users.adminA,
      );
    }
    expect((await annualOf()).daysAttended).toBe(2);
  }, 120_000);

  it("saves a 15-student register (timing)", async () => {
    const roster = [];
    for (let i = 0; i < 15; i += 1) roster.push(await admit("2025-04-01"));
    // Some earlier days, so the recompute has months and terms to cover.
    for (const date of ["2025-06-02", "2025-08-04", "2025-10-06"]) {
      await mark(
        date,
        roster.map((r) => ({ studentId: r.student.id, status: "present" as const })),
      );
    }

    const entries = roster.map((r, i) => ({
      studentId: r.student.id,
      status: (i % 5 === 0 ? "absent" : "present") as "absent" | "present",
    }));
    const t0 = performance.now();
    await mark("2025-11-03", entries);
    const firstSave = performance.now() - t0;

    const t1 = performance.now();
    await mark(
      "2025-11-03",
      entries.map((e) => ({ ...e, status: "late" as const })),
    );
    const reSave = performance.now() - t1;

    console.log(
      `[attendance timing] first save ${Math.round(firstSave)} ms, re-save ${Math.round(reSave)} ms`,
    );
    // Before ADR-061 this save took about 24 s on the remote database.
    expect(firstSave).toBeLessThan(8000);
    expect(reSave).toBeLessThan(8000);

    // The batched re-mark still landed for everyone, with the summary in step.
    const statuses = await db
      .select({ status: dailyAttendanceStatus.status })
      .from(dailyAttendanceStatus)
      .where(
        and(
          eq(dailyAttendanceStatus.date, "2025-11-03"),
          inArray(
            dailyAttendanceStatus.studentId,
            roster.map((r) => r.student.id),
          ),
        ),
      );
    expect(statuses).toHaveLength(15);
    expect(statuses.every((s) => s.status === "late")).toBe(true);
    const november = await db
      .select()
      .from(attendanceSummary)
      .where(
        and(
          eq(attendanceSummary.studentId, roster[0]!.student.id),
          eq(attendanceSummary.periodType, "monthly"),
          eq(attendanceSummary.month, 11),
        ),
      );
    expect(november[0]).toMatchObject({ daysLate: 1, daysPresent: 0, daysAttended: 1 });
  }, 300_000);
});
