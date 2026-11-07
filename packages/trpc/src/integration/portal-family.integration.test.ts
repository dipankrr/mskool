import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gte, inArray, like, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { invalidateUserAuthCache, type DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  academicCalendar,
  academicYears,
  attendancePolicies,
  attendanceRecords,
  attendanceSummary,
  dailyAttendanceStatus,
  examComponents,
  examSubjectSchedules,
  exams,
  feeHeads,
  feeInstallments,
  studentAssignments,
  studentEnrollments,
  studentPortalAccess,
  students,
  user,
} from "@repo/db/schema";
import {
  academicService,
  attendanceService,
  enrollmentService,
  feesBillingService,
  feesCollectionService,
  feesService,
  organizationService,
  studentService,
} from "@repo/services";

import { appRouter } from "../router";
import { buildWorld } from "./world";

/**
 * The family reads (ADR-062) through the real routers, as a parent login:
 * attendance month / overview / ranking, fees, and the exam date sheet. Each
 * read returns only the owned child's data, in its narrow family shape.
 */

const RUN = randomUUID().slice(0, 8);
const PREFIX = "PFAM-";

type Caller = ReturnType<typeof appRouter.createCaller>;
const callerFor = (userId: string): Caller =>
  appRouter.createCaller({ db, session: { user: { id: userId } }, req: {}, res: {} } as never);

async function expectCode(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect((caught as { code?: string } | undefined)?.code).toBe(code);
}

async function makeUser(tag: string) {
  const id = `${PREFIX}${tag}-${RUN}`;
  await db.insert(user).values({
    id,
    name: tag,
    email: `${id.toLowerCase()}@family-itg.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

/** As the real grant flow does: the row, then the login's cached child list cleared. */
async function grant(userId: string, studentId: string) {
  await db.insert(studentPortalAccess).values({ userId, studentId, isActive: true });
  await invalidateUserAuthCache(userId);
}

let world: Awaited<ReturnType<typeof buildWorld>>;
let school: DataScope;
let parentId: string;
let serial = 0;

async function admit(
  name: string,
  enrollmentDate: string,
  sectionId: string | null = null,
  classId?: string,
) {
  serial += 1;
  const student = await studentService.createStudent(school, {
    admissionNumber: `${PREFIX}${RUN}-${serial}`,
    firstName: name,
    lastName: `Fam${RUN}`,
    gender: "female",
    dateOfBirth: "2015-01-01",
  });
  await enrollmentService.createEnrollment(school, {
    studentId: student.id,
    academicYearId: world.currentYearAId,
    classId: classId ?? world.class6Id,
    ...(sectionId ? { sectionId } : {}),
    enrollmentDate,
  });
  return student;
}

const removeTestRows = async () => {
  const testStudents = db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.schoolId, world.schoolA1Id), like(students.admissionNumber, `${PREFIX}%`)));
  const testEnrollments = db
    .select({ id: studentEnrollments.id })
    .from(studentEnrollments)
    .where(inArray(studentEnrollments.studentId, testStudents));
  await db.delete(studentAssignments).where(inArray(studentAssignments.studentEnrollmentId, testEnrollments));
  await db.delete(attendanceRecords).where(inArray(attendanceRecords.studentId, testStudents));
  await db.delete(dailyAttendanceStatus).where(inArray(dailyAttendanceStatus.studentId, testStudents));
  await db.delete(attendanceSummary).where(inArray(attendanceSummary.studentId, testStudents));
  await db.delete(studentPortalAccess).where(inArray(studentPortalAccess.studentId, testStudents));
  await db.delete(studentEnrollments).where(inArray(studentEnrollments.studentId, testStudents));
  await db
    .delete(students)
    .where(and(eq(students.schoolId, world.schoolA1Id), like(students.admissionNumber, `${PREFIX}%`)));

  const testExams = db
    .select({ id: exams.id })
    .from(exams)
    .where(and(eq(exams.schoolId, world.schoolA1Id), like(exams.name, `${PREFIX}%`)));
  const testSchedules = db
    .select({ id: examSubjectSchedules.id })
    .from(examSubjectSchedules)
    .where(inArray(examSubjectSchedules.examId, testExams));
  await db.delete(examComponents).where(inArray(examComponents.scheduleId, testSchedules));
  await db.delete(examSubjectSchedules).where(inArray(examSubjectSchedules.examId, testExams));
  await db.delete(exams).where(and(eq(exams.schoolId, world.schoolA1Id), like(exams.name, `${PREFIX}%`)));
};

beforeAll(async () => {
  world = await buildWorld();
  school = { organizationId: world.orgAId, schoolId: world.schoolA1Id, classId: null, sectionId: null };
  await removeTestRows();
  parentId = await makeUser("parent");
}, 120_000);

afterAll(async () => {
  await removeTestRows();
}, 120_000);

describe("family reads: who may read", () => {
  it("refuses another family's child with NOT_FOUND, and a login with no children", async () => {
    const own = await admit("Gate", "2025-04-01", world.section6aId);
    await grant(parentId, own.id);

    // The world's owned child belongs to another parent.
    await expectCode(
      callerFor(parentId).portalAttendance.overview({ studentId: world.ownedStudentId }),
      "NOT_FOUND",
    );
    await expectCode(
      callerFor(parentId).portalFees.summary({ studentId: world.ownedStudentId }),
      "NOT_FOUND",
    );
    await expectCode(
      callerFor(parentId).portalExam.schedule.list({ studentId: world.ownedStudentId }),
      "NOT_FOUND",
    );
    // A staff login with no portal access never reaches a family read.
    await expectCode(
      callerFor(world.users.adminA).portalAttendance.overview({ studentId: own.id }),
      "FORBIDDEN",
    );
  }, 60_000);
});

describe("family attendance", () => {
  let workingDates: string[] = [];
  let ana: { id: string };
  let bea: { id: string };
  let cal: { id: string };
  let dia: { id: string };
  let eve: { id: string };
  const marked: string[] = [];

  beforeAll(async () => {
    const rows = await db
      .select({ date: academicCalendar.date })
      .from(academicCalendar)
      .where(
        and(
          eq(academicCalendar.schoolId, world.schoolA1Id),
          eq(academicCalendar.academicYearId, world.currentYearAId),
          inArray(academicCalendar.dayType, ["working", "exam_day", "half_day"]),
          gte(academicCalendar.date, "2026-01-01"),
          lte(academicCalendar.date, "2026-03-31"),
        ),
      )
      .orderBy(academicCalendar.date);
    workingDates = rows.map((r) => r.date);
    expect(workingDates.length).toBeGreaterThan(20);

    ana = await admit("Ana", "2026-01-01", world.section6aId);
    bea = await admit("Bea", "2026-01-01", world.section6aId);
    cal = await admit("Cal", "2026-01-01", world.section6aId);
    dia = await admit("Dia", workingDates[workingDates.length - 3]!, world.section6aId);
    eve = await admit("Eve", "2026-01-01");
    for (const s of [ana, bea, cal, dia, eve]) await grant(parentId, s.id);

    // 16 marked days: Ana and Cal present every day, Bea absent once.
    for (const [i, date] of workingDates.slice(0, 16).entries()) {
      marked.push(date);
      await attendanceService.markAttendance(
        school,
        {
          sectionId: world.section6aId,
          date,
          entries: [
            { studentId: ana.id, status: "present" },
            { studentId: bea.id, status: i === 3 ? "absent" : "present" },
            { studentId: cal.id, status: i === 5 ? "late" : "present" },
          ],
        },
        world.users.teacherC6,
      );
    }
    const last = workingDates[workingDates.length - 1]!;
    await attendanceService.markAttendance(
      school,
      { sectionId: world.section6aId, date: last, entries: [{ studentId: dia.id, status: "present" }] },
      world.users.teacherC6,
    );
  }, 240_000);

  it("month: every day of the month with the child's mark", async () => {
    const first = marked[0]!;
    const month = first.slice(0, 7);
    const result = await callerFor(parentId).portalAttendance.month({ studentId: ana.id, month });
    expect(result.days.length).toBeGreaterThanOrEqual(28);
    expect(result.days.find((d) => d.date === first)?.status).toBe("present");
    const unmarked = workingDates.find((d) => d.startsWith(month) && !marked.includes(d));
    if (unmarked) {
      expect(result.days.find((d) => d.date === unmarked)?.status).toBe("not_marked");
    }
    expect(result.counts?.daysPresent).toBe(marked.filter((d) => d.startsWith(month)).length);

    // Days before a late joiner joined are not enrolled and carry no mark.
    const diaMonth = await callerFor(parentId).portalAttendance.month({
      studentId: dia.id,
      month: workingDates[0]!.slice(0, 7),
    });
    expect(diaMonth.days.every((d) => !d.enrolled && d.status === null)).toBe(true);
    expect(diaMonth.counts).toBeNull();
  }, 60_000);

  it("overview: the year and each term, counted so far", async () => {
    const result = await callerFor(parentId).portalAttendance.overview({ studentId: ana.id });
    expect(result.terms.map((t) => t.id)).toEqual([world.termA1T1Id, world.termA1T2Id]);
    expect(result.year?.daysPresent).toBe(16);
    // Working days run from the day she joined to the session's end.
    expect(result.year?.workingDays).toBe(workingDates.length);
    expect(result.terms[0]?.counts).toBeNull();
  }, 60_000);

  it("ranking: ties share a rank, the top list names the section, the child is flagged", async () => {
    const result = await callerFor(parentId).portalAttendance.ranking({ studentId: ana.id, period: "year" });
    expect(result.topVisible).toBe(true);
    expect(result.minWorkingDays).toBe(15);
    expect(result.you.reason).toBeNull();

    const name = (first: string) => `${first} Fam${RUN}`;
    const anaRow = result.top.find((r) => r.name === name("Ana"));
    const calRow = result.top.find((r) => r.name === name("Cal"));
    const beaRank = (
      await callerFor(parentId).portalAttendance.ranking({ studentId: bea.id, period: "year" })
    ).you.rank;
    // Late counts as present by default, so Cal ties with Ana.
    expect(calRow?.rank).toBe(anaRow?.rank);
    expect(anaRow?.isYou).toBe(true);
    expect(calRow?.isYou).toBe(false);
    expect(beaRank).toBeGreaterThan(result.you.rank!);
    // No other child's id or counts ever leave.
    expect(Object.keys(result.top[0]!).sort()).toEqual(["isYou", "name", "percentage", "rank"]);
  }, 60_000);

  it("ranking: a late joiner below the minimum and a child with no section are not ranked", async () => {
    const late = await callerFor(parentId).portalAttendance.ranking({ studentId: dia.id, period: "year" });
    expect(late.you.rank).toBeNull();
    expect(late.you.reason).toBe("too_few_days");

    const sectionless = await callerFor(parentId).portalAttendance.ranking({ studentId: eve.id, period: "year" });
    expect(sectionless.you.reason).toBe("no_section");
    expect(sectionless.top).toEqual([]);
  }, 60_000);

  it("ranking: with the school's switch off, only the child's own rank", async () => {
    const [before] = await db
      .select({ visible: attendancePolicies.familyRankingVisible })
      .from(attendancePolicies)
      .where(eq(attendancePolicies.schoolId, world.schoolA1Id));
    try {
      await db
        .update(attendancePolicies)
        .set({ familyRankingVisible: false })
        .where(eq(attendancePolicies.schoolId, world.schoolA1Id));
      const result = await callerFor(parentId).portalAttendance.ranking({ studentId: ana.id, period: "year" });
      if (before) {
        expect(result.topVisible).toBe(false);
        expect(result.top).toEqual([]);
      }
      expect(result.you.rank).not.toBeNull();
    } finally {
      await db
        .update(attendancePolicies)
        .set({ familyRankingVisible: before?.visible ?? true })
        .where(eq(attendancePolicies.schoolId, world.schoolA1Id));
    }
  }, 60_000);

  it("ranking: a month needs a term or month the input names", async () => {
    await expectCode(
      callerFor(parentId).portalAttendance.ranking({ studentId: ana.id, period: "month" }),
      "BAD_REQUEST",
    );
    const month = await callerFor(parentId).portalAttendance.ranking({
      studentId: ana.id,
      period: "month",
      month: marked[0]!.slice(0, 7),
    });
    expect(month.period.isRunning).toBe(false);
    expect(month.minWorkingDays).toBeGreaterThan(0);
  }, 60_000);
});

describe("family exam date sheet", () => {
  let child: { id: string };
  let scheduledExamId: string;
  let draftExamId: string;

  beforeAll(async () => {
    child = await admit("Exam", "2025-04-01", world.section6aId);
    await grant(parentId, child.id);

    const base = {
      organizationId: world.orgAId,
      schoolId: world.schoolA1Id,
      academicYearId: world.currentYearAId,
      termId: world.termA1T1Id,
    };
    const [scheduled] = await db
      .insert(exams)
      .values({ ...base, name: `${PREFIX}Half yearly ${RUN}`, status: "scheduled", examType: "regular" })
      .returning();
    const [draft] = await db
      .insert(exams)
      .values({ ...base, name: `${PREFIX}Draft ${RUN}`, status: "draft" })
      .returning();
    scheduledExamId = scheduled!.id;
    draftExamId = draft!.id;

    const paper = (examId: string, subjectId: string, sectionId: string | null, examDate: string) => ({
      organizationId: world.orgAId,
      schoolId: world.schoolA1Id,
      examId,
      classId: world.class6Id,
      sectionId,
      subjectId,
      examDate,
      startTime: "09:30:00",
      durationMinutes: 180,
      venue: "Hall A",
      passMarks: "33.00",
    });
    const [maths] = await db
      .insert(examSubjectSchedules)
      .values([
        // Class-wide maths: everyone in Class 6.
        paper(scheduledExamId, world.subjectA1MathId, null, "2025-09-10"),
        // Physics for 6-B only: never on a 6-A child's sheet.
        paper(scheduledExamId, world.subjectA1PhysicsId, world.section6bId, "2025-09-12"),
        paper(draftExamId, world.subjectA1MathId, null, "2025-09-20"),
      ])
      .returning();
    await db.insert(examComponents).values([
      {
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        scheduleId: maths!.id,
        name: "Theory",
        sequenceNumber: 1,
        maxMarks: "80.00",
        passMarks: "26.00",
        weightagePercentage: "80.00",
      },
      {
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        scheduleId: maths!.id,
        name: "Practical",
        sequenceNumber: 2,
        maxMarks: "20.00",
        passMarks: "7.00",
        weightagePercentage: "20.00",
      },
    ]);
  }, 120_000);

  it("lists scheduled exams with the child's own papers, never drafts", async () => {
    const list = await callerFor(parentId).portalExam.schedule.list({ studentId: child.id });
    const mine = list.filter((e) => e.name.startsWith(PREFIX));
    expect(mine.map((e) => e.id)).toEqual([scheduledExamId]);
    expect(mine[0]).toMatchObject({
      paperCount: 1,
      firstDate: "2025-09-10",
      lastDate: "2025-09-10",
      // Scheduled, and the last paper's date has passed.
      state: "marks_being_checked",
    });
  }, 60_000);

  it("the date sheet shows parts and max marks, and hides pass marks", async () => {
    const detail = await callerFor(parentId).portalExam.schedule.detail({
      studentId: child.id,
      examId: scheduledExamId,
    });
    expect(detail.papers).toHaveLength(1);
    expect(detail.papers[0]).toMatchObject({
      examDate: "2025-09-10",
      startTime: "09:30",
      durationMinutes: 180,
      venue: "Hall A",
      maxMarks: "100.00",
      parts: [
        { name: "Theory", maxMarks: "80.00" },
        { name: "Practical", maxMarks: "20.00" },
      ],
    });
    expect(JSON.stringify(detail)).not.toContain("passMarks");

    await expectCode(
      callerFor(parentId).portalExam.schedule.detail({ studentId: child.id, examId: draftExamId }),
      "NOT_FOUND",
    );
  }, 60_000);
});

describe("family fees", () => {
  const FRUN = `pfam-${RUN}`;
  const w = {} as {
    scope: DataScope;
    yearId: string;
    adminId: string;
    parentId: string;
    childId: string;
    siblingId: string;
    paymentId: string;
    receiptNumber: string;
    siblingPaymentId: string;
  };

  async function billed(scope: DataScope, classId: string, tag: string) {
    const row = await studentService.createStudent(scope, {
      admissionNumber: `${FRUN}-${tag}`,
      firstName: tag,
      lastName: "Fees",
      dateOfBirth: "2012-01-01",
      gender: "other",
    } as Parameters<typeof studentService.createStudent>[1]);
    const enrollment = await enrollmentService.createEnrollment(scope, {
      studentId: row.id,
      academicYearId: w.yearId,
      classId,
      enrollmentDate: "2025-04-01",
    } as Parameters<typeof enrollmentService.createEnrollment>[1]);
    await feesBillingService.billEnrollment(scope, { enrollmentId: enrollment.id }, w.adminId);
    const dues = await db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.studentId, row.id))
      .orderBy(feeInstallments.dueDate);
    return { id: row.id, dues };
  }

  const pay = (studentId: string, dues: { id: string; netAmount: string }[]) =>
    feesCollectionService.recordPayment(
      w.scope,
      {
        studentId,
        academicYearId: w.yearId,
        paymentDate: "2025-11-20",
        paymentMode: "cash",
        allocations: dues.map((due) => ({ installmentId: due.id, amount: due.netAmount })),
        remarks: "Staff-only note",
      } as Parameters<typeof feesCollectionService.recordPayment>[1],
      w.adminId,
    );

  beforeAll(async () => {
    const org = await organizationService.createOrganization({
      name: `${FRUN} Org`,
      legalName: `${FRUN} Trust`,
      slug: FRUN,
    });
    const created = await organizationService.createSchool(org.id, {
      name: "Family School",
      legalName: "Family Public School",
      code: "FAM",
      board: "cbse",
    });
    w.scope = { organizationId: org.id, schoolId: created.id, classId: null, sectionId: null };
    const [year] = await db
      .insert(academicYears)
      .values({
        organizationId: org.id,
        schoolId: created.id,
        name: "2025-26",
        startDate: "2025-04-01",
        endDate: "2026-03-31",
        originalEndDate: "2026-03-31",
        isCurrent: true,
      })
      .returning();
    w.yearId = year!.id;
    const klass = await academicService.createClass(w.scope, { name: "Six", numericOrder: 6 });
    w.adminId = await makeUser("fee-admin");
    w.parentId = await makeUser("fee-parent");
    const [tuition] = await db
      .insert(feeHeads)
      .values({ organizationId: org.id, schoolId: created.id, name: "Tuition", category: "regular" })
      .returning();
    const structure = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: "Six fees" },
      w.adminId,
    );
    await feesService.createFeeStructureLine(w.scope, structure.id, {
      feeHeadId: tuition!.id,
      frequency: "monthly",
      amount: "1000.00",
    });

    const childRow = await billed(w.scope, klass.id, "Child");
    const sibling = await billed(w.scope, klass.id, "Other");
    w.childId = childRow.id;
    w.siblingId = sibling.id;
    await grant(w.parentId, childRow.id);
    const payment = await pay(childRow.id, childRow.dues.slice(0, 2));
    w.paymentId = payment.id;
    w.receiptNumber = payment.receiptNumber;
    w.siblingPaymentId = (await pay(sibling.id, sibling.dues.slice(0, 1))).id;
  }, 240_000);

  afterAll(async () => {
    await db.delete(studentPortalAccess).where(eq(studentPortalAccess.userId, w.parentId));
  });

  it("summary: the admin page's figures in the family shape", async () => {
    const summary = await callerFor(w.parentId).portalFees.summary({ studentId: w.childId });
    expect(summary.feeAssigned).toBe(true);
    expect(summary.totals.paid).toBe("2000.00");
    expect(summary.dues.length).toBeGreaterThanOrEqual(12);
    expect(summary.dues[0]).toMatchObject({ feeHeadName: "Tuition", status: "paid", balance: "0.00" });
    expect(summary.payments).toHaveLength(1);
    expect(summary.payments[0]).toMatchObject({
      receiptNumber: w.receiptNumber,
      totalAmount: "2000.00",
      status: "cleared",
      refundedAmount: "0.00",
    });
    const text = JSON.stringify(summary);
    expect(text).not.toContain("collectedBy");
    expect(text).not.toContain("Staff-only note");
  }, 60_000);

  it("payment, receipt and statement: only the child's own", async () => {
    const parent = callerFor(w.parentId);
    const payment = await parent.portalFees.payment({ studentId: w.childId, paymentId: w.paymentId });
    expect(payment.allocations).toHaveLength(2);
    expect(payment.allocations[0]?.feeHeadName).toBe("Tuition");

    const receipt = await parent.portalFees.receipt({ studentId: w.childId, paymentId: w.paymentId });
    expect(receipt.html).toContain(w.receiptNumber);

    const statement = await parent.portalFees.statement({ studentId: w.childId });
    expect(statement.html).toContain(w.receiptNumber);

    // Another child's payment in the same school, through an owned child's id.
    await expectCode(
      parent.portalFees.payment({ studentId: w.childId, paymentId: w.siblingPaymentId }),
      "NOT_FOUND",
    );
    await expectCode(
      parent.portalFees.receipt({ studentId: w.childId, paymentId: w.siblingPaymentId }),
      "NOT_FOUND",
    );
    await expectCode(parent.portalFees.statement({ studentId: w.siblingId }), "NOT_FOUND");
  }, 60_000);
});
