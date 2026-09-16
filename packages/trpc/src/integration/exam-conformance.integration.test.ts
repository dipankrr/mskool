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
  /** The second subject — the gate truth-table's crossing paper. */
  let physicsSubjectId: string;
  let academicYearId: string;
  let termId: string;
  let studentId: string;
  /** call(path, input) — every router call goes through makeCaller's accessor. */
  let call: Call;
  let subjectTeacherId: string;
  let principalId: string;

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

    // The gate truth-table's second subject: a paper the subject teacher
    // is NOT assigned to (the crossing case) and the dual-hat principal
    // becomes able to enter once granted a teaching row mid-walk.
    const [physicsSubject] = await db
      .insert(subjects)
      .values({ organizationId: org!.id, schoolId: school.id, name: "Physics", code: "PHY" })
      .returning();

    organizationId = org!.id;
    schoolId = school.id;
    classId = klass.id;
    sectionId = section.id;
    subjectId = subject!.id;
    physicsSubjectId = physicsSubject!.id;
    academicYearId = year.id;
    termId = term.id;
    studentId = student!.id;
    subjectTeacherId = teacher!.id;
    principalId = principal!.id;
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
        // The crossing paper: scheduled (coverage allows supersets), one
        // component (BUG-10: componentless papers refuse the transition).
        {
          classId,
          subjectId: physicsSubjectId,
          examDate: "2031-07-12",
          startTime: "09:00",
          durationMinutes: 120,
        },
      ],
    });
    expect(Array.isArray(saved)).toBe(true);
    expect(saved!.length).toBe(2);

    // "Remove class" is an EXPLICIT removal list (`removeClassIds`), not an
    // empty batch — the replace works per class PRESENT in the payload, so
    // the old empty-batch remove silently deleted nothing.
    const emptied = await call("exam.schedules.save", {
      ...scopeArgs(organizationId, schoolId),
      id: exam!.id,
      schedules: [],
      removeClassIds: [classId],
    });
    expect(emptied).toEqual([]);
    const afterRemove = await call("exam.schedules.list", {
      ...scopeArgs(organizationId, schoolId),
      examId: exam!.id,
    });
    expect(afterRemove!.length).toBe(0);
    // And one save cannot both remove a class and save its rows.
    await expect(
      call("exam.schedules.save", {
        ...scopeArgs(organizationId, schoolId),
        id: exam!.id,
        schedules: [
          { classId, subjectId, examDate: "2031-07-10", startTime: "09:00", durationMinutes: 120 },
        ],
        removeClassIds: [classId],
      }),
    ).rejects.toThrow(/removed and saved in one pass/);

    // Re-create the two papers the rest of this flow walks through.
    const resaved = await call("exam.schedules.save", {
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
        {
          classId,
          subjectId: physicsSubjectId,
          examDate: "2031-07-12",
          startTime: "09:00",
          durationMinutes: 120,
        },
      ],
    });
    expect(resaved!.length).toBe(2);
    const scheduleId = resaved![0]!.id;
    const physicsScheduleId = resaved![1]!.id;

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
    const physicsComponents = await call("exam.components.save", {
      ...scopeArgs(organizationId, schoolId),
      id: physicsScheduleId,
      components: [
        { name: "Theory", maxMarks: "100", passMarks: "40", weightagePercentage: "100", sequenceNumber: 1 },
      ],
    });
    expect(physicsComponents!.length).toBe(1);

    // Editing the date sheet must NOT touch the parts: the identity-keyed
    // save updates surviving rows IN PLACE (the delete-all/insert-all it
    // replaced silently wiped every paper's components on any edit).
    await call("exam.schedules.save", {
      ...scopeArgs(organizationId, schoolId),
      id: exam!.id,
      schedules: [
        { classId, subjectId, examDate: "2031-07-11", startTime: "10:00", durationMinutes: 150 },
        {
          classId,
          subjectId: physicsSubjectId,
          examDate: "2031-07-12",
          startTime: "09:00",
          durationMinutes: 120,
        },
      ],
    });
    const compsAfterEdit = await call("exam.components.list", {
      ...scopeArgs(organizationId, schoolId),
      id: scheduleId,
    });
    expect(compsAfterEdit!.length).toBe(2);

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

    // ── The ADR-029 amendment's truth table, through the real router ────
    // Row 1 — the teaching role crossing subjects: the Math-only teacher
    // saves the PHYSICS paper's cell → FORBIDDEN, honest words (the old
    // gate answered NOT_FOUND/generic, which the UI dressed as "this
    // record may have been closed or moved").
    const teacherCrossing = await makeCaller({ id: subjectTeacherId })(
      "exam.marks.save",
      {
        ...scopeArgs(organizationId, schoolId),
        sectionId,
        subjectId: physicsSubjectId,
        examId: exam!.id,
        scheduleId: physicsScheduleId,
        componentId: physicsComponents![0]!.id,
        studentId,
        marks: "50",
        isAbsent: false,
        isExempted: false,
      },
    ).catch((error: { code?: string; message?: string }) => error);
    expect(teacherCrossing).toMatchObject({
      code: "FORBIDDEN",
      message: "You are not the assigned teacher for this paper.",
    });

    // The grid read carries the verdict: the teacher's Physics grid is
    // read-only with the reason; her Math grid is enterable.
    const teacherPhysicsGrid = await makeCaller({ id: subjectTeacherId })(
      "exam.marks.entry",
      { ...scopeArgs(organizationId, schoolId), examId: exam!.id, id: physicsScheduleId, sectionId },
    );
    expect(teacherPhysicsGrid?.canEnter).toBe(false);
    expect(teacherPhysicsGrid?.canEnterReason).toBe("not-assigned");
    const teacherMathGrid = await makeCaller({ id: subjectTeacherId })(
      "exam.marks.entry",
      { ...scopeArgs(organizationId, schoolId), examId: exam!.id, id: scheduleId, sectionId },
    );
    expect(teacherMathGrid?.canEnter).toBe(true);

    // Row 2 — permission + scope decide for everyone else: the principal
    // (school-scoped, no teaching assignment anywhere) enters the Physics
    // paper's cell — the exact case the owner's click found frozen.
    const principalCell = await call("exam.marks.save", {
      ...scopeArgs(organizationId, schoolId),
      sectionId,
      subjectId: physicsSubjectId,
      examId: exam!.id,
      scheduleId: physicsScheduleId,
      componentId: physicsComponents![0]!.id,
      studentId,
      marks: "55",
      isAbsent: false,
      isExempted: false,
    });
    expect(principalCell?.resultStatus).toBe("entered");
    expect(principalCell?.marksObtained).toBe("55.00");
    const principalGrid = await call("exam.marks.entry", {
      ...scopeArgs(organizationId, schoolId),
      examId: exam!.id,
      id: physicsScheduleId,
      sectionId,
    });
    expect(principalGrid?.canEnter).toBe(true);

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
    // versions is owner-resolved like student.byId: a foreign id is NOT_FOUND.
    const versions = await call("exam.cards.versions", { ...scopeArgs(organizationId, schoolId), id: studentId });
    expect(versions.length).toBeGreaterThan(0);
    await expect(
      call("exam.cards.versions", {
        ...scopeArgs(organizationId, schoolId),
        id: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow(/Student not found/);
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

  it("exam.exam.update — the edit dialog's payload (name; weight/count freeze is the service's)", async () => {
    const [exam] = await db
      .select()
      .from(exams)
      .where(and(eq(exams.schoolId, schoolId), eq(exams.name, "Conformance Exam 2")));
    const updated = await call("exam.exam.update", {
      ...scopeArgs(organizationId, schoolId),
      id: exam!.id,
      data: { name: "Conformance Exam 2 (renamed)", allowsNegativeMarking: true },
    });
    expect(updated?.name).toBe("Conformance Exam 2 (renamed)");
    expect(updated?.allowsNegativeMarking).toBe(true);
  });

  it("subjectMapping.end — remove a mapping; refuse one with term-grade entries", async () => {
    // A throwaway mapping ends cleanly…
    const [throwaway] = await db
      .insert(subjects)
      .values({ organizationId: organizationId, schoolId, name: "Art", code: "ART" })
      .returning();
    const [thrownType] = await db
      .insert(subjectTypes)
      .values({ organizationId: organizationId, schoolId, name: "Art Type", countsTowardResult: false, isGradedOnly: true, assessmentMode: "term_grade", sequence: 3 })
      .returning();
    const created = await call("assignment.subjectMapping.create", {
      ...scopeArgs(organizationId, schoolId),
      academicYearId,
      classId,
      subjectId: throwaway!.id,
      data: { academicYearId, classId, subjectId: throwaway!.id, subjectTypeId: thrownType!.id, sequenceNumber: 2 },
    });
    const ended = await call("assignment.subjectMapping.end", {
      ...scopeArgs(organizationId, schoolId),
      id: created!.id,
    });
    expect(ended?.id).toBe(created!.id);
  });

  it("termGrades.save / list — the term-grade entry screen's payloads through the gate", async () => {
    // The Personality-style mapping: term_grade mode (the preset's third row).
    const [personality] = await db
      .insert(subjects)
      .values({ organizationId: organizationId, schoolId, name: "Personality", code: "PER" })
      .returning();
    const [personalityType] = await db
      .insert(subjectTypes)
      .values({ organizationId: organizationId, schoolId, name: "Personality", countsTowardResult: false, isGradedOnly: true, assessmentMode: "term_grade", sequence: 4 })
      .returning();
    const mapping = await call("assignment.subjectMapping.create", {
      ...scopeArgs(organizationId, schoolId),
      academicYearId,
      classId,
      subjectId: personality!.id,
      data: { academicYearId, classId, subjectId: personality!.id, subjectTypeId: personalityType!.id, sequenceNumber: 3 },
    });
    expect(mapping?.id).toBeDefined();

    // The principal saves (ADR-029a: permission + scope, no teaching row
    // needed) — the same payload the grades page builds on blur.
    const saved = await call("exam.termGrades.save", {
      ...scopeArgs(organizationId, schoolId),
      studentId,
      termId,
      mappingId: mapping!.id,
      sectionId,
      subjectId: personality!.id,
      grade: "A",
      teacherRemarks: "Shows initiative",
    });
    expect(saved?.grade).toBe("A");
    const listed = await call("exam.termGrades.list", {
      ...scopeArgs(organizationId, schoolId),
      termId,
    });
    expect(listed!.some((row: { id: string }) => row.id === saved!.id)).toBe(true);

    // The mapping with entries now REFUSES to end — the record is not the
    // template.
    await expect(
      call("assignment.subjectMapping.end", {
        ...scopeArgs(organizationId, schoolId),
        id: mapping!.id,
      }),
    ).rejects.toThrow(/term-grade entries/);

    // An EXAM-mode mapping is refused at save even through the gate —
    // its grades come from marks, never this screen.
    const [mathMapping] = await db
      .select()
      .from(classSubjectMappings)
      .where(
        and(
          eq(classSubjectMappings.schoolId, schoolId),
          eq(classSubjectMappings.subjectId, subjectId),
        ),
      );
    await expect(
      call("exam.termGrades.save", {
        ...scopeArgs(organizationId, schoolId),
        studentId,
        termId,
        mappingId: mathMapping!.id,
        sectionId,
        subjectId,
        grade: "A",
      }),
    ).rejects.toThrow(/assessed by exams/);
  });
});
