import { beforeAll, describe, expect, it } from "vitest";

/**
 * THE ANNUAL CONFORMANCE SUITE: every annual endpoint called through
 * `appRouter.createCaller` (real input schemas, the real staffProcedure
 * builder, real error translation, real Postgres) with payloads shaped
 * EXACTLY like the mobile screens build them. exam-annual.integration proves
 * the SERVICE; this proves what a phone actually receives - the tier that
 * would have caught "the Final results screen and the rule editor both fail
 * with generic errors".
 */

import { db } from "@repo/db";
import {
  classSubjectMappings,
  organizations,
  orgRolePermissions,
  roleAssignments,
  studentEnrollments,
  students,
  subjectTypes,
  subjects,
  user,
} from "@repo/db/schema";
import { DEFAULT_ROLE_PERMISSIONS, ROLE_TYPES } from "@repo/authz";
import { academicService, organizationService, termService } from "@repo/services";
import { appRouter } from "../router";

const RUN = `annual-conf-${Date.now()}`;

type Call = (path: string, input: unknown) => Promise<any>;

function makeCaller(sessionUser: { id: string }): Call {
  const inner = (appRouter as unknown as {
    createCaller: (ctx: unknown) => Record<string, unknown>;
  }).createCaller({ db, session: { user: sessionUser }, req: { headers: {} }, res: {} });
  return (path, input) => {
    // Namespaced paths ("exam.annual.generate") exactly as the phone calls them.
    const fn = path.split(".").reduce<any>((acc, key) => acc?.[key], inner);
    if (typeof fn !== "function") {
      return Promise.reject(new Error(`Conformance suite: no router path "${path}".`));
    }
    return fn(input);
  };
}

/** What the phone sends for a human-readable refusal: the code and the message. */
async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (cause) {
    const e = cause as { code?: string; message?: string };
    return { code: e.code ?? "?", message: e.message ?? "" };
  }
  throw new Error("expected the call to be refused");
}

describe("annual router conformance - the phone's payloads through the real router", () => {
  let organizationId: string;
  let schoolId: string;
  let classId: string;
  let academicYearId: string;
  let termIds: string[];
  let call: Call;
  const scopeArgs = () => ({ organizationId, schoolId });

  beforeAll(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Annual Conf", legalName: "Annual Conf Trust", slug: RUN })
      .returning();
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
      name: "AC School", legalName: "AC School", code: "ACS", board: "cbse",
    });
    const schoolScope = {
      organizationId: org!.id, schoolId: school.id, classId: null, sectionId: null,
    } as const;
    const year = await academicService.createAcademicYear(schoolScope as never, {
      name: "2041-42", startDate: "2041-04-01", endDate: "2042-03-31",
    } as never);
    const termInputs = [
      ["Term 1", 1, "2041-04-01", "2041-07-31"],
      ["Term 2", 2, "2041-08-01", "2041-11-30"],
      ["Term 3", 3, "2041-12-01", "2042-03-31"],
    ] as const;
    const terms = [];
    for (const [name, n, start, end] of termInputs) {
      terms.push(
        await termService.createTerm(schoolScope as never, {
          academicYearId: year.id, name, sequenceNumber: n, startDate: start, endDate: end,
        } as never),
      );
    }
    const klass = await academicService.createClass(schoolScope as never, { name: "Class 6", numericOrder: 6 });
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
    await db.insert(classSubjectMappings).values({
      organizationId: org!.id, schoolId: school.id, academicYearId: year.id,
      classId: klass.id, subjectId: subject!.id, subjectTypeId: type!.id, sequenceNumber: 1,
    });
    const [student] = await db
      .insert(students)
      .values({ organizationId: org!.id, schoolId: school.id, admissionNumber: `${RUN}-S1`, firstName: "Con", lastName: "Form", dateOfBirth: "2015-01-01", gender: "male" })
      .returning();
    await db.insert(studentEnrollments).values({
      organizationId: org!.id, schoolId: school.id, studentId: student!.id,
      academicYearId: year.id, classId: klass.id, sectionId: section.id, enrollmentStatus: "active",
    });
    const [principal] = await db
      .insert(user)
      .values({ id: `annual-conf-p-${RUN}`, name: "Conf Principal", email: `annual-conf-p-${RUN}@x.test` })
      .returning();
    await db.insert(roleAssignments).values({
      organizationId: org!.id, userId: principal!.id, roleType: "principal", scopeType: "school", scopeId: school.id,
    });

    organizationId = org!.id;
    schoolId = school.id;
    classId = klass.id;
    academicYearId = year.id;
    termIds = terms.map((t) => t.id);
    call = makeCaller({ id: principal!.id });
  });

  // The payload apps/mobile `annualPayload()` builds for a new school default.
  const weighted = (over: Record<string, unknown> = {}) => ({
    ...scopeArgs(),
    academicYearId,
    appliesToClassId: null,
    method: "weighted",
    bestN: null,
    totalDisplay: "average",
    annualSubjectPassPercent: "33",
    useOwnPassRules: false,
    minSubjectsToPass: null,
    mandatoryPassSubjectIds: [],
    compartmentAllowed: false,
    maxSubjectsForCompartment: null,
    minAttendancePct: "75",
    terms: [
      { termId: termIds[0], weightage: "33.33" },
      { termId: termIds[1], weightage: "33.33" },
      { termId: termIds[2], weightage: "33.34" },
    ],
    ...over,
  });

  it("the Final results list answers before any year is generated", async () => {
    const overview = await call("exam.annual.overview", { ...scopeArgs(), academicYearId });
    expect(overview).toEqual([]);
  });

  it("the class screen's reads answer before any rule exists, and say what is missing", async () => {
    const readiness = await call("exam.annual.readiness", { ...scopeArgs(), academicYearId, classId });
    expect(readiness?.policy).toBeNull();
    expect(readiness?.blockers.map((b: { code: string }) => b.code)).toContain("no_policy");
    const table = await call("exam.annual.table", { ...scopeArgs(), academicYearId, classId });
    expect(table).toMatchObject({ status: "none", students: [] });
  });

  it("Generate with no rule is a worded refusal, not a generic server error", async () => {
    const out = await refusal(call("exam.annual.generate", { ...scopeArgs(), academicYearId, classId }));
    expect(out.code).toBe("CONFLICT");
    expect(out.message).toMatch(/Set the annual rules/);
  });

  it("saves the school default exactly as the rule editor sends it (own rules off)", async () => {
    const saved = await call("exam.annual.policies.save", weighted());
    expect(saved).toMatchObject({ method: "weighted", classId: null, useOwnPassRules: false });
    expect(saved.summary).toMatch(/^Weighted: Term 1 33\.33%/);
  });

  it("refuses a second default with the sentence, as a conflict", async () => {
    const out = await refusal(call("exam.annual.policies.save", weighted()));
    expect(out.code).toBe("CONFLICT");
    expect(out.message).toMatch(/already has a default annual rule/);
  });

  it("edits the rule with its own promotion rules switched on (blank minimum, no compartment)", async () => {
    const [existing] = await call("exam.annual.policies.list", { ...scopeArgs(), academicYearId });
    const saved = await call(
      "exam.annual.policies.save",
      weighted({
        id: existing.id,
        useOwnPassRules: true,
        minSubjectsToPass: null,
        compartmentAllowed: false,
        maxSubjectsForCompartment: null,
        minAttendancePct: "75",
      }),
    );
    expect(saved).toMatchObject({ id: existing.id, useOwnPassRules: true });
  });

  it("saves a class rule, the other four methods, and reads the list back", async () => {
    const three = termIds.map((termId) => ({ termId, weightage: null }));
    const classRule = await call(
      "exam.annual.policies.save",
      weighted({
        appliesToClassId: classId,
        method: "best_n",
        bestN: 2,
        annualSubjectPassPercent: null,
        terms: three,
      }),
    );
    expect(classRule.summary).toMatch(/Best 2 of 3 terms/);
    // The year pass mark is optional: left blank, the papers' own pass marks decide.
    expect(classRule.summary).toMatch(/papers' own pass marks/);
    expect(classRule.annualSubjectPassPercent).toBeNull();
    const list = await call("exam.annual.policies.list", { ...scopeArgs(), academicYearId });
    expect(list).toHaveLength(2);
  });

  it("Generate after a rule exists succeeds (nothing to compute yet is a clean zero)", async () => {
    const out = await call("exam.annual.generate", { ...scopeArgs(), academicYearId, classId });
    expect(out).toMatchObject({ generated: 0 });
    const overview = await call("exam.annual.overview", { ...scopeArgs(), academicYearId });
    expect(Array.isArray(overview)).toBe(true);
  });
});
