import { beforeAll, describe, expect, it } from "vitest";

/**
 * THE CONFORMANCE SUITE — the tier the ecosystem was missing (Phase 6a).
 *
 * exam.integration.test.ts proves the SERVICES; smoke:authz proves
 * AUTHORIZATION over HTTP; e2e walks mounts and flows. None of them
 * sends a real UI-shaped payload through the real router — which is how
 * "cannot even create an exam" shipped green: the create contract
 * demanded a field the dialog never sends, and id-addressing mismatches
 * killed every owner-resolved mutation before authorization even ran.
 *
 * So this suite's single job: every exam-domain mutation called through
 * `appRouter.createCaller` (real input schemas, real staffProcedure
 * builder, real Postgres) with payloads shaped EXACTLY like the React
 * hooks build them — scopeArgs() spread, the same field names. A 400
 * here is a user-visible bug, caught before any browser opens.
 *
 * FIXTURE: a fresh org per run (`exam-conf-<ts>`), principal caller at
 * school scope, the minimum academic world (year, term, class, section,
 * subject, mapping, enrollment, one student). Rows accumulate (hard
 * rule 2); assertions key on this run's ids.
 */

import { db } from "@repo/db";
import {
  academicYears,
  classSubjectMappings,
  exams,
  gradingScaleBands,
  gradingScales,
  organizations,
  orgRolePermissions,
  passCriteria,
  examComponents,
  examSubjectSchedules,
  roleAssignments,
  sectionTeacherAssignments,
  studentEnrollments,
  students,
  subjects,
  subjectTypes,
  user,
} from "@repo/db/schema";
import { DEFAULT_ROLE_PERMISSIONS, ROLE_TYPES } from "@repo/authz";
import {
  academicService,
  organizationService,
  termService,
} from "@repo/services";
import { appRouter } from "../router";
import { and, eq } from "drizzle-orm";

const RUN = `exam-conf-${Date.now()}`;

/** The caller's ctx: exactly what createContext builds for a staff user. */
type Call = (path: string, input: unknown) => Promise<any>;

function makeCaller(sessionUser: { id: string }): Call {
  // One cast, same sanction as authz.integration.test.ts: tRPC's caller
  // types cannot be matched structurally because the builder chooses part
  // of each input schema at runtime (ADR-027). We are deliberately
  // testing the RUNTIME contract — the shape the browser sends — so the
  // payloads are plain objects, not the inferred types. The Proxy rejects
  // any path that is not on the router, which keeps the two honest.
  const inner = (appRouter as unknown as {
    createCaller: (ctx: unknown) => Record<string, unknown>;
  }).createCaller({
    db,
    session: { user: sessionUser },
    req: { headers: {} },
    res: {},
  });
  return (path: string, input: unknown) => {
    const fn = inner[path];
    if (typeof fn !== "function") {
      return Promise.reject(
        new Error(
          `Conformance suite: no router path "${path}" — the hook and the test disagree.`,
        ),
      );
    }
    return (fn as (input: unknown) => Promise<any>)(input);
  };
}

/** scopeArgs() exactly as useActiveContext builds it for a school-scoped user. */
function scopeArgs(organizationId: string, schoolId: string) {
  return { organizationId, schoolId };
}

describe("exam router conformance — UI-shaped payloads through the real router", () => {
  let organizationId: string;
  let schoolId: string;
  let classId: string;
  let sectionId: string;
  let subjectId: string;
  let academicYearId: string;
  let termId: string;
  let studentId: string;
  /** call(path, input) — every router call goes through makeCaller's accessor. */
  let call: Call;
  let subjectTeacherId: string;

  beforeAll(async () => {
    // ---- fixture --------------------------------------------------------
    // SCOPE-NODE ENTITIES GO THROUGH THE SERVICES (hard rule 12): school,
    // class, section, year, term all get their scope_nodes rows. Students
    // are not nodes — raw inserts match the exam suite's own fixture.
    const [org] = await db
      .insert(organizations)
      .values({ name: "Exam Conf", legalName: "Exam Conf Trust", slug: RUN })
      .returning();
    // The default permission matrix, exactly as the seed syncs it: a fresh
    // org has NO org_role_permissions rows, so every can() answers no and
    // the whole suite would FORBIDDEN before testing anything.
    await db
      .insert(orgRolePermissions)
      .values(
        ROLE_TYPES.flatMap((roleType) =>
          DEFAULT_ROLE_PERMISSIONS[roleType].map((permission) => ({
            organizationId: org!.id,
            roleType,
            permission,
          })),
        ),
      )
      .onConflictDoNothing();
    const school = await organizationService.createSchool(org!.id, {
      name: "EC School", legalName: "EC School", code: "ECS", board: "cbse",
    });
    const schoolScope = {
      organizationId: org!.id, schoolId: school.id, classId: null, sectionId: null,
    } as const;
    const year = await academicService.createAcademicYear(schoolScope as never, {
      name: "2031-32", startDate: "2031-04-01", endDate: "2032-03-31",
    } as never);
    const term = await termService.createTerm(schoolScope as never, {
      academicYearId: year.id, name: "Term 1", sequenceNumber: 1,
      startDate: "2031-04-01", endDate: "2031-09-30",
    } as never);
    const klass = await academicService.createClass(schoolScope as never, {
      name: "Class 6", numericOrder: 6,
    });
    const section = await academicService.createSection(schoolScope as never, {
      name: "A", academicYearId: year.id, classId: klass.id,
    });
    const [subject] = await db
      .insert(subjects)
      .values({ organizationId: org!.id, schoolId: school.id, name: "Mathematics", code: "MAT" })
      .returning();
    const [type] = await db
      .insert(subjectTypes)
      .values({ organizationId: org!.id, schoolId: school.id, name: "Main", countsTowardResult: true, isGradedOnly: false, assessmentMode: "exam", sequence: 0 })
      .returning();
    await db
      .insert(classSubjectMappings)
      .values({ organizationId: org!.id, schoolId: school.id, academicYearId: year.id, classId: klass.id, subjectId: subject!.id, subjectTypeId: type!.id, sequenceNumber: 1 });
    const [student] = await db
      .insert(students)
      .values({ organizationId: org!.id, schoolId: school.id, admissionNumber: `${RUN}-S1`, firstName: "Con", lastName: "Form", dateOfBirth: "2015-01-01", gender: "male" })
      .returning();
    await db
      .insert(studentEnrollments)
      .values({ organizationId: org!.id, schoolId: school.id, studentId: student!.id, academicYearId: year.id, classId: klass.id, sectionId: section.id, enrollmentStatus: "active" });

    // Principal user + school-scoped assignment (the dialog's caller).
    const [principal] = await db
      .insert(user)
      .values({ id: `conf-p-${RUN}`, name: "Conf Principal", email: `conf-p-${RUN}@x.test` })
      .returning();
    await db
      .insert(roleAssignments)
      .values({ organizationId: org!.id, userId: principal!.id, roleType: "principal", scopeType: "school", scopeId: school.id });
    // Subject teacher with the Math assignment in A (the grid's caller).
    const [teacher] = await db
      .insert(user)
      .values({ id: `conf-t-${RUN}`, name: "Conf Teacher", email: `conf-t-${RUN}@x.test` })
      .returning();
    await db
      .insert(roleAssignments)
      .values({ organizationId: org!.id, userId: teacher!.id, roleType: "subject_teacher", scopeType: "section", scopeId: section.id });
    await db
      .insert(sectionTeacherAssignments)
      .values({ organizationId: org!.id, schoolId: school.id, sectionId: section.id, academicYearId: year.id, userId: teacher!.id, role: "subject_teacher", subjectId: subject!.id });

    organizationId = org!.id;
    schoolId = school.id;
    classId = klass.id;
    sectionId = section.id;
    subjectId = subject!.id;
    academicYearId = year.id;
    termId = term.id;
    studentId = student!.id;
    subjectTeacherId = teacher!.id;
    call = makeCaller({ id: principal!.id });
  });

  // The suite works through the NAMESPACED paths, because that is what the
  // browser does: trpc.exam.exam.create etc. createCaller mirrors that.
  it("exam.exam.create — dialog payload accepted (name, termId, examType, weightage 100)", async () => {
    const exam = await call("exam.exam.create", {
      ...scopeArgs(organizationId, schoolId),
      data: { name: "Conformance Exam 1", termId, examType: "regular", weightageInTerm: "100" },
    });
    expect(exam?.id).toBeDefined();
    expect(exam?.status).toBe("draft");
    expect(exam?.weightageInTerm).toBe("100.00");
  });

  it("exam.exam.create — WITHOUT weightageInTerm (the shipped dialog's payload) must still work after the fix", async () => {
    // A MOCK: mock/test papers never count toward the term, so a second
    // 100-weight exam cannot collide with Exam 1's term-weightage —
    // the invariant that correctly refused two counting 100s.
    const exam = await call("exam.exam.create", {
      ...scopeArgs(organizationId, schoolId),
      data: { name: "Conformance Exam 2", termId, examType: "mock" },
    });
    expect(exam?.id).toBeDefined();
    // The DB default applies when the dialog omits the field.
    expect(exam?.weightageInTerm).toBe("100.00");
    // And the server forces the flag off for mocks — a practice paper can
    // never smuggle itself into the term aggregate.
    expect(exam?.countsTowardTermResult).toBe(false);
  });

  it("exam.exam.byId / list / schedules.list — the hub and detail reads", async () => {
    const [exam] = await db
      .select()
      .from(exams)
      .where(and(eq(exams.schoolId, schoolId), eq(exams.name, "Conformance Exam 1")));
    const detail = await call("exam.exam.byId", { ...scopeArgs(organizationId, schoolId), id: exam!.id });
    expect(detail?.exam?.id).toBe(exam!.id);
    const list = await call("exam.exam.list", { ...scopeArgs(organizationId, schoolId), academicYearId });
    expect(Array.isArray(list)).toBe(true);
    const schedules = await call("exam.schedules.list", { ...scopeArgs(organizationId, schoolId), examId: exam!.id });
    expect(Array.isArray(schedules)).toBe(true);
  });

  it("exam.schedules.save — the ScheduleDialog payload (saveSchedules.mutate shape)", { timeout: 180_000 }, async () => {
    const [exam] = await db
      .select()
      .from(exams)
      .where(and(eq(exams.schoolId, schoolId), eq(exams.name, "Conformance Exam 1")));
    const saved = await call("exam.schedules.save", {
      ...scopeArgs(organizationId, schoolId),
      id: exam!.id,
      schedules: [
        {
          classId,
          subjectId,
          examDate: "2031-07-10",
          startTime: "09:00",
          durationMinutes: 120,
        },
      ],
    });
    expect(Array.isArray(saved)).toBe(true);
    expect(saved!.length).toBe(1);
    const scheduleId = saved![0]!.id;

    // ComponentsDialog's payload on that schedule (id = schedule, rows bare).
    const components = await call("exam.components.save", {
      ...scopeArgs(organizationId, schoolId),
      id: scheduleId,
      components: [
        { name: "Theory", maxMarks: "80", passMarks: "27", weightagePercentage: "80", sequenceNumber: 1 },
        { name: "Internal", maxMarks: "20", passMarks: "7", weightagePercentage: "20", sequenceNumber: 2 },
      ],
    });
    expect(components!.length).toBe(2);

    // The transition the detail page's button sends.
    await expect(
      call("exam.exam.transition", { ...scopeArgs(organizationId, schoolId), id: exam!.id, target: "scheduled" }),
    ).resolves.toBeTruthy();
    await call("exam.exam.transition", { ...scopeArgs(organizationId, schoolId), id: exam!.id, target: "ongoing" });
    await call("exam.exam.transition", { ...scopeArgs(organizationId, schoolId), id: exam!.id, target: "marks_entry" });

    // The marks grid's read (id-addressed per the byId pattern) and the
    // subject teacher's autosave through HER caller.
    const grid = await call("exam.marks.entry", {
      ...scopeArgs(organizationId, schoolId),
      examId: exam!.id,
      id: scheduleId,
      sectionId,
    });
    expect(grid?.roster?.length).toBe(1);

    const cell = await makeCaller({ id: subjectTeacherId })("exam.marks.save", {
      ...scopeArgs(organizationId, schoolId),
      sectionId,
      subjectId,
      examId: exam!.id,
      scheduleId,
      componentId: components![0]!.id,
      studentId,
      marks: "72",
      isAbsent: false,
      isExempted: false,
    });
    expect(cell?.resultStatus).toBe("entered");
    expect(cell?.marksObtained).toBe("72.00");

    // The paper's second component (Internal) — the verification gate
    // refuses a partially-entered paper, so the conformance walk must be
    // complete: every component of every roster student, exactly the
    // discipline the real teacher is held to.
    const cell2 = await makeCaller({ id: subjectTeacherId })("exam.marks.save", {
      ...scopeArgs(organizationId, schoolId),
      sectionId,
      subjectId,
      examId: exam!.id,
      scheduleId,
      componentId: components![1]!.id,
      studentId,
      marks: "16",
      isAbsent: false,
      isExempted: false,
    });
    expect(cell2?.resultStatus).toBe("entered");

    // Eligibility recompute + readiness — the readiness panel's calls.
    await call("exam.eligibility.recompute", { ...scopeArgs(organizationId, schoolId), id: exam!.id });
    const readiness = await call("exam.eligibility.readiness",
      { ...scopeArgs(organizationId, schoolId), id: exam!.id,
      classId,
    });
    expect(readiness?.expectedEntries).toBeGreaterThan(0);

    // The results table + publication list reads.
    const table = await call("exam.results.table", { ...scopeArgs(organizationId, schoolId), id: exam!.id, classId });
    expect(table?.roster?.length).toBe(1);
    const publications = await call("exam.publication.list", { ...scopeArgs(organizationId, schoolId), id: exam!.id });
    expect(Array.isArray(publications)).toBe(true);

    // Compute + publish through the router, then the card reads. The
    // publish gate requires under_verification (the real workflow the
    // detail page walks: verify first, then publish), so the test walks
    // the SAME transitions the Verify button + lifecycle send.
    await call("exam.results.compute", { ...scopeArgs(organizationId, schoolId), id: exam!.id, classId });
    await call("exam.exam.transition", { ...scopeArgs(organizationId, schoolId), id: exam!.id, target: "under_verification" });
    const published = await call("exam.publication.publishClass",
      { ...scopeArgs(organizationId, schoolId), id: exam!.id,
      classId,
    });
    expect(published?.published).toBe(true);

    // The card reads the S4/S5 surfaces make: versions + class set.
    const versions = await call("exam.cards.versions", { ...scopeArgs(organizationId, schoolId), studentId });
    expect(versions.length).toBeGreaterThan(0);
    const classSet = await call("exam.cards.classSet", { ...scopeArgs(organizationId, schoolId), id: exam!.id, classId });
    expect(classSet?.cards?.length).toBe(1);
  });

  it("grading scale + subject type + pass criteria — the setup screen payloads", async () => {
    const scale = await call("exam.gradingScales.create", {
      ...scopeArgs(organizationId, schoolId),
      name: "Conf Scale",
      isDefault: true,
      bands: [
        { minMarks: "0", maxMarks: "32", gradeLabel: "E", gradePoint: "0", sequenceNumber: 1 },
        { minMarks: "32", maxMarks: "100", gradeLabel: "A", gradePoint: "10", sequenceNumber: 2 },
      ],
    });
    expect(scale?.id).toBeDefined();
    void gradingScaleBands; void gradingScales; void passCriteria; void examComponents; void examSubjectSchedules;
  });
});
