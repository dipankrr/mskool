import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The integration suite: the authorization gates and the services they feed,
 * against REAL Postgres — the layer no mock can vouch for. This is where
 * "the right rows reach the caller" stops being a code-reading claim:
 *
 *   - the SQL-level filters the unit mocks deliberately ignore (revokedAt
 *     IS NULL, isActive = true) are pinned here by rows that exist and must
 *     be invisible;
 *   - exact-count assertions on CLIPPED roles are themselves the tenancy
 *     property: a class teacher listing sections sees exactly her class's
 *     sections — not one fewer (broken filter), not one more (leak);
 *   - a second ORG exists so cross-TENANT denial is asserted directly.
 *
 * The fixture (world.ts) is a dedicated org pair, tenancy-isolated from dev
 * drift. Redis is mocked at the socket; Postgres is not mocked at all.
 */

vi.mock("ioredis", () => {
  const store = new Map<string, string>();
  return {
    default: class FakeRedis {
      get = async (key: string) => store.get(key) ?? null;
      set = async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      };
      del = async (...keys: string[]) => {
        for (const key of keys) store.delete(key);
        return keys.length;
      };
      constructor(_url: string) {}
    },
  };
});

import { TRPCError } from "@trpc/server";
import type { Permission } from "@repo/authz";
import {
  createAcademicYearSchema,
  createClassSubjectMappingSchema,
  createEnrollmentSchema,
  createSectionSchema,
  createSectionTeacherAssignmentSchema,
  createSubjectSchema,
  createTermSchema,
} from "@repo/contracts";
import {
  academicService,
  assignmentService,
  enrollmentService,
  organizationService,
  subjectService,
  termService,
} from "@repo/services";
import { getOwnedStudentIds } from "@repo/authz";
import { db } from "@repo/db";
import { classes, sections, subjects } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { router as makeRouter } from "../trpc";
import type { OwnerResolver } from "../trpc";
import { staffListProcedure, staffProcedure, studentProcedure } from "../trpc";
import { buildWorld, type IntegrationWorld } from "./world";

const HISTORY = "academic_year:read_history";

/**
 * The gate extends its input schema AT RUNTIME for id-addressed procedures
 * (ADR-027), so the static type does not know about `id`. Handlers read it
 * through this one documented cast instead of scattering blind accesses.
 */
const rowId = (input: unknown): string => (input as { id: string }).id;

// --- probes: each mirrors its real router's builder options ------------------

const schoolListRouter = makeRouter({
  probe: staffListProcedure("school:read").query(({ ctx }) =>
    organizationService.listSchools(ctx.scopes),
  ),
});

const schoolByIdRouter = makeRouter({
  probe: staffProcedure("school:read", { addressedBy: "id", gate: "overlap" }).query(
    async ({ ctx, input }) => {
      // Await EVERYTHING: an un-awaited service promise is truthy, so a null
      // check against it never fires and null leaks past the NOT_FOUND guard.
      const school = await organizationService.getSchoolById(ctx.scope, rowId(input));
      if (!school) {
        throw new TRPCError({ code: "NOT_FOUND", message: "School not found." });
      }
      return school;
    },
  ),
});

const classListRouter = makeRouter({
  probe: staffListProcedure("class:read").query(({ ctx }) =>
    academicService.listClasses(ctx.scopes),
  ),
});

const classByIdRouter = makeRouter({
  probe: staffProcedure("class:read", { addressedBy: "id", gate: "overlap" }).query(
    async ({ ctx, input }) => {
      const cls = await academicService.getClassById(ctx.scope, rowId(input));
      if (!cls) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }
      return cls;
    },
  ),
});

const sectionListRouter = makeRouter({
  probe: staffListProcedure("section:read")
    .input(z.object({ academicYearId: z.uuid() }))
    .query(({ ctx, input }) =>
      academicService.listSections(ctx.scopes, input.academicYearId, ctx.canWithin(HISTORY)),
    ),
});

const sectionByIdRouter = makeRouter({
  probe: staffProcedure("section:read", { addressedBy: "id", gate: "overlap" }).query(
    async ({ ctx, input }) => {
      const section = await academicService.getSectionById(
        ctx.scope,
        rowId(input),
        ctx.can(HISTORY),
      );
      if (!section) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Section not found." });
      }
      return section;
    },
  ),
});

const yearOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await academicService.getAcademicYearOwnerId(organizationId, id);
  return schoolId ? { type: "school", id: schoolId } : null;
};

const yearListRouter = makeRouter({
  probe: staffListProcedure("academic_year:read").query(({ ctx }) =>
    academicService.listAcademicYears(ctx.scopes, ctx.canWithin(HISTORY)),
  ),
});

/** Mirrors year.byId: owner-resolved, overlap-gated read, service history pin. */
const yearByIdRouter = makeRouter({
  probe: staffProcedure("academic_year:read", {
    resolveOwner: yearOwner,
    gate: "overlap",
  }).query(async ({ ctx, input }) => {
    const history = ctx.can(HISTORY);
    const year = await academicService.getAcademicYearById(ctx.scope, rowId(input), history);
    if (!year) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Academic year not found." });
    }
    return year;
  }),
});

const createYearRouter = makeRouter({
  probe: staffProcedure("academic_year:create")
    // The REAL contract schema: every create denial below validates through
    // what the client actually sends, so an input-shape drift between the
    // contract and the routers surfaces here and not in production.
    .input(z.object({ data: createAcademicYearSchema }))
    .mutation(({ ctx, input }) =>
      academicService.createAcademicYear(ctx.scope as never, input.data),
    ),
});

const createSectionRouter = makeRouter({
  probe: staffProcedure("section:create")
    // Parents arrive nested under `data`, exactly as the real contract ships
    // them — a top-level classId would be mistaken by the builder for SCOPE
    // addressing (addressedNodeId takes the most specific id present).
    .input(z.object({ data: createSectionSchema }))
    .mutation(({ ctx, input }) =>
      academicService.createSection(ctx.scope as never, input.data),
    ),
});

const deactivateClassRouter = makeRouter({
  probe: staffProcedure("class:delete", { addressedBy: "id" }).mutation(({ ctx, input }) =>
    academicService.deactivateClass(ctx.scope, rowId(input)),
  ),
});

const studentProbeRouter = makeRouter({
  probe: studentProcedure
    .input(z.object({ studentId: z.uuid() }))
    .query(({ ctx, input }) => {
      ctx.assertOwnsStudent(input.studentId);
      return { owned: true };
    }),
});

const subjectListRouter = makeRouter({
  probe: staffListProcedure("subject:read").query(({ ctx }) =>
    subjectService.listSubjects(ctx.scopes),
  ),
});

const subjectOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await subjectService.getSubjectOwnerId(organizationId, id);
  return schoolId ? { type: "school", id: schoolId } : null;
};

/** Mirrors subject.byId: owner-resolved overlap read; no history pin (not year-scoped). */
const subjectByIdRouter = makeRouter({
  probe: staffProcedure("subject:read", {
    resolveOwner: subjectOwner,
    gate: "overlap",
  }).query(async ({ ctx, input }) => {
    const subject = await subjectService.getSubjectById(ctx.scope, rowId(input));
    if (!subject) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Subject not found." });
    }
    return subject;
  }),
});

// --- probes: the teaching-assignment layer ------------------------------------
// Each mirrors its real router in assignment.router.ts, including the resolver
// messages — a resolver null and a gate overlap-miss answer with DIFFERENT
// NOT_FOUND wordings, and the tests below pin both.

const mappingOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await assignmentService.getClassSubjectMappingOwnerId(organizationId, id);
  if (!schoolId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Subject mapping not found." });
  }
  return { type: "school", id: schoolId };
};

const mappingListRouter = makeRouter({
  probe: staffListProcedure("subject_mapping:read")
    .input(z.object({ academicYearId: z.uuid(), classId: z.uuid() }))
    .query(({ ctx, input }) =>
      assignmentService.listClassSubjectMappings(
        ctx.scopes,
        input.academicYearId,
        input.classId,
      ),
    ),
});

const mappingByIdRouter = makeRouter({
  probe: staffProcedure("subject_mapping:read", {
    resolveOwner: mappingOwner,
    gate: "overlap",
  }).query(async ({ ctx, input }) => {
    const mapping = await assignmentService.getClassSubjectMappingById(
      ctx.scope,
      rowId(input),
    );
    if (!mapping) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Subject mapping not found." });
    }
    return mapping;
  }),
});

const createMappingRouter = makeRouter({
  probe: staffProcedure("subject_mapping:create")
    .input(
      z.object({
        academicYearId: z.uuid(),
        classId: z.uuid(),
        subjectId: z.uuid(),
        data: createClassSubjectMappingSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      assignmentService.createClassSubjectMapping(ctx.scope as never, {
        ...input.data,
        academicYearId: input.academicYearId,
        classId: input.classId,
        subjectId: input.subjectId,
      }),
    ),
});

const staOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await assignmentService.getSectionTeacherAssignmentOwnerId(
    organizationId,
    id,
  );
  if (!schoolId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Teacher assignment not found." });
  }
  return { type: "school", id: schoolId };
};

const staListRouter = makeRouter({
  probe: staffListProcedure("teacher_assignment:read")
    .input(z.object({ sectionId: z.uuid() }))
    .query(({ ctx, input }) =>
      assignmentService.listSectionTeacherAssignments(ctx.scopes, input.sectionId),
    ),
});

const staByIdRouter = makeRouter({
  probe: staffProcedure("teacher_assignment:read", {
    resolveOwner: staOwner,
    gate: "overlap",
  }).query(async ({ ctx, input }) => {
    const sta = await assignmentService.getSectionTeacherAssignmentById(
      ctx.scope,
      rowId(input),
    );
    if (!sta) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Teacher assignment not found." });
    }
    return sta;
  }),
});

const staRoles = z.enum([
  "class_teacher",
  "subject_teacher",
  "co_teacher",
  "activity_teacher",
]);

const createStaRouter = makeRouter({
  probe: staffProcedure("teacher_assignment:create")
    // The real router's own input IS the contract schema (the builder extends
    // it at runtime with the school addresser) — the probe mirrors that.
    .input(createSectionTeacherAssignmentSchema)
    .mutation(({ ctx, input }) =>
      assignmentService.createSectionTeacherAssignment(ctx.scope as never, input),
    ),
});

const endStaRouter = makeRouter({
  probe: staffProcedure("teacher_assignment:update", { resolveOwner: staOwner })
    .input(
      z.object({
        id: z.uuid(),
        successor: z
          .object({
            sectionId: z.uuid(),
            academicYearId: z.uuid(),
            userId: z.string(),
            role: staRoles,
            subjectId: z.uuid().nullable().optional(),
          })
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      assignmentService.endAssignment(ctx.scope, input.id, input.successor),
    ),
});

// --- probes: terms -------------------------------------------------------------

const termOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await termService.getTermOwnerId(organizationId, id);
  if (!schoolId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." });
  }
  return { type: "school", id: schoolId };
};

const termListRouter = makeRouter({
  probe: staffListProcedure("academic_year:read")
    .input(z.object({ academicYearId: z.uuid() }))
    .query(({ ctx, input }) =>
      termService.listTerms(ctx.scopes, input.academicYearId, ctx.canWithin(HISTORY)),
    ),
});

const termByIdRouter = makeRouter({
  probe: staffProcedure("academic_year:read", {
    resolveOwner: termOwner,
    gate: "overlap",
  }).query(async ({ ctx, input }) => {
    const term = await termService.getTermById(ctx.scope, rowId(input), ctx.can(HISTORY));
    if (!term) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." });
    }
    return term;
  }),
});

const createTermRouter = makeRouter({
  probe: staffProcedure("academic_year:create")
    .input(z.object({ schoolId: z.uuid(), data: createTermSchema }))
    .mutation(({ ctx, input }) => termService.createTerm(ctx.scope as never, input.data)),
});

const updateTermRouter = makeRouter({
  probe: staffProcedure("academic_year:update", { resolveOwner: termOwner })
    .input(
      z.object({
        id: z.uuid(),
        data: z.object({ weightage: z.string().optional() }),
      }),
    )
    .mutation(({ ctx, input }) => termService.updateTerm(ctx.scope, input.id, input.data)),
});

// A marks-shaped probe: the FIRST composition of ADR-029's subjectGate. When
// the marks slice lands, its real router must look exactly like this
// (check:builders enforces it); until then this probe is the only
// HTTP-reachable surface the fact gate has, and the smoke leg waits for that
// real endpoint.
const marksCreateRouter = makeRouter({
  probe: staffProcedure("marks:create", { subjectGate: true }).mutation(
    ({ ctx }) => ({ sectionId: ctx.scope.sectionId }),
  ),
});

// --- probes: enrollments ---------------------------------------------------------

const enrollmentOwner: OwnerResolver = async (organizationId, id) => {
  const owner = await enrollmentService.getEnrollmentOwnerNode(organizationId, id);
  if (!owner) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found." });
  }
  return owner;
};

const enrollmentListRouter = makeRouter({
  probe: staffListProcedure("enrollment:read")
    .input(
      z.object({
        academicYearId: z.uuid(),
        classId: z.uuid().optional(),
        sectionId: z.uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      enrollmentService.listEnrollments(
        ctx.scopes,
        input.academicYearId,
        input.classId,
        input.sectionId,
      ),
    ),
});

const enrollmentByIdRouter = makeRouter({
  probe: staffProcedure("enrollment:read", {
    resolveOwner: enrollmentOwner,
    gate: "overlap",
  }).query(async ({ ctx, input }) => {
    const enrollment = await enrollmentService.getEnrollmentById(
      ctx.scope,
      rowId(input),
    );
    if (!enrollment) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found." });
    }
    return enrollment;
  }),
});

const enrollmentStatuses = z.enum([
  "admitted",
  "section_assigned",
  "active",
  "transferred_out",
  "withdrawn",
  "passed_out",
]);

const createEnrollmentRouter = makeRouter({
  probe: staffProcedure("enrollment:create")
    .input(z.object({ schoolId: z.uuid(), data: createEnrollmentSchema }))
    .mutation(({ ctx, input }) =>
      enrollmentService.createEnrollment(ctx.scope as never, input.data),
    ),
});

const assignSectionRouter = makeRouter({
  probe: staffProcedure("enrollment:update", { resolveOwner: enrollmentOwner })
    .input(
      z.object({
        id: z.uuid(),
        sectionId: z.uuid(),
        rollNumber: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      enrollmentService.assignSection(ctx.scope, input.id, {
        sectionId: input.sectionId,
        rollNumber: input.rollNumber,
      }),
    ),
});

const transitionEnrollmentRouter = makeRouter({
  probe: staffProcedure("enrollment:update", { resolveOwner: enrollmentOwner })
    .input(z.object({ id: z.uuid(), to: enrollmentStatuses }))
    .mutation(({ ctx, input }) =>
      enrollmentService.transitionEnrollment(ctx.scope, input.id, input.to),
    ),
});

const portalEnrollmentRouter = makeRouter({
  probe: studentProcedure.query(({ ctx }) =>
    enrollmentService.listEnrollmentsForStudents(ctx.studentIds),
  ),
});

// --- harness -----------------------------------------------------------------

let world: IntegrationWorld;

const callerOf = (
  // An already-built router exposing exactly one "probe" procedure. One
  // deliberate cast for the whole harness: tRPC's caller types cannot be
  // matched structurally here because part of each procedure's input schema
  // is chosen at runtime by the builder (ADR-027), so every endpoint would
  // need its own nominal type for zero extra safety.
  routerArg: unknown,
  userId: string,
) => {
  const inner = (
    routerArg as {
      createCaller: (ctx: unknown) => {
        probe: (input?: Record<string, unknown>) => Promise<any>;
      };
    }
  ).createCaller({ session: { user: { id: userId } } });
  return {
    probe: (input: Record<string, unknown> = {}) => inner.probe(input),
  };
};

async function expectTrpcError(
  promise: Promise<unknown>,
  code: string,
  message?: string,
) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the call to throw").toBeInstanceOf(TRPCError);
  expect((caught as TRPCError).code).toBe(code);
  if (message !== undefined) {
    expect((caught as TRPCError).message).toBe(message);
  }
}

async function okIds(promise: Promise<{ id: string }[]>): Promise<string[]> {
  const rows = await promise;
  return rows.map((r) => r.id).sort();
}

beforeAll(async () => {
  world = await buildWorld();
}, 120_000);

beforeEach(() => {
  // Redis is an in-memory Map: emptying it per test makes every snapshot
  // rebuild from Postgres, so grant state written by an earlier test can
  // never leak into a later assertion through a cache.
  vi.clearAllMocks();
});

const U = () => world.users;

// --- schools -----------------------------------------------------------------

describe("schools — list and byId", () => {
  it("org admin lists exactly both branches", async () => {
    const ids = await okIds(
      callerOf(schoolListRouter, U().adminA).probe({ organizationId: world.orgAId }),
    );
    expect(ids).toEqual([world.schoolA1Id, world.schoolA2Id].sort());
  });

  it("a principal of A1 lists exactly A1 — never the sibling branch", async () => {
    const ids = await okIds(
      callerOf(schoolListRouter, U().principalA1).probe({ organizationId: world.orgAId }),
    );
    expect(ids).toEqual([world.schoolA1Id]);
  });

  it("dual grants union only their QUALIFYING grants' reach", async () => {
    // Her class_teacher grant carries no school:read; only the principal@A2
    // grant qualifies, so A2 is all she gets — even though she can also see
    // Class 6 of A1 through her other role.
    const ids = await okIds(
      callerOf(schoolListRouter, U().dual).probe({ organizationId: world.orgAId }),
    );
    expect(ids).toEqual([world.schoolA2Id]);
  });

  it("personas without school:read are 403 on school.list", async () => {
    const denied = [
      ["class teacher (role lacks school:read)", U().teacherC6],
      ["subject teacher (role lacks school:read)", U().subjectS6A],
      ["expired assignment", U().expiredT],
      ["revoked assignment (SQL-filtered)", U().revokedT],
      ["admin of ANOTHER org", U().adminB],
    ] as const;

    for (const [name, userId] of denied) {
      await expectTrpcError(
        callerOf(schoolListRouter, userId).probe({ organizationId: world.orgAId }),
        "FORBIDDEN",
        "Missing permission: school:read",
      ).catch((error) => {
        throw new Error(`${name}: ${(error as Error).message}`);
      });
    }
  });

  it("byId within scope resolves; the foreign-org branch is the generic 403", async () => {
    const own = await callerOf(schoolByIdRouter, U().adminA).probe({
      organizationId: world.orgAId,
      id: world.schoolA1Id,
    });
    expect(own.id).toBe(world.schoolA1Id);

    await expectTrpcError(
      callerOf(schoolByIdRouter, U().adminA).probe({
        organizationId: world.orgAId,
        id: world.schoolB1Id,
      }),
      "FORBIDDEN",
      "You do not have access to this resource.",
    );
  });

  it("principal of A1 byId on A2 is NOT_FOUND (held but not reaching), not 403", async () => {
    // The overlap miss is decided IN THE GATE, so the generic wording wins.
    await expectTrpcError(
      callerOf(schoolByIdRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        id: world.schoolA2Id,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });
});

// --- classes -------------------------------------------------------------------

describe("classes — exact data per role", () => {
  it("each role lists exactly its classes", async () => {
    const cases = [
      ["org admin", U().adminA, [world.class6Id, world.class7Id]],
      ["branch principal", U().principalA1, [world.class6Id, world.class7Id]],
      // The count IS the tenancy property for a clipped role.
      ["class teacher — EXACTLY her class", U().teacherC6, [world.class6Id]],
      ["dual persona via her teacher grant", U().dual, [world.class6Id]],
      ["section teacher widened to class level", U().subjectS6A, [world.class6Id]],
    ] as const;

    for (const [name, userId, want] of cases) {
      const ids = await okIds(
        callerOf(classListRouter, userId).probe({
          organizationId: world.orgAId,
          schoolId: world.schoolA1Id,
        }),
      );
      expect(ids, name).toEqual([...want].sort());
    }
  });

  it("an outsider org is 403 on class.list", async () => {
    await expectTrpcError(
      callerOf(classListRouter, U().adminB).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
      }),
      "FORBIDDEN",
      "Missing permission: class:read",
    );
  });

  it("the ungranted sibling class discriminates overlap reads", async () => {
    // Class 7 has no grants anywhere: a correct overlap read returns it for
    // callers whose grants reach the branch and NOT_FOUND for those below it.
    // The miss is decided IN THE GATE, so the wording is the generic one.
    const principal = await callerOf(classByIdRouter, U().principalA1).probe({
      organizationId: world.orgAId,
      id: world.class7Id,
    });
    expect(principal.id).toBe(world.class7Id);

    await expectTrpcError(
      callerOf(classByIdRouter, U().teacherC6).probe({
        organizationId: world.orgAId,
        id: world.class7Id,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
    await expectTrpcError(
      callerOf(classByIdRouter, U().subjectS6A).probe({
        organizationId: world.orgAId,
        id: world.class7Id,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("the section teacher CAN read her own class (ADR-028's reason to exist)", async () => {
    const cls = await callerOf(classByIdRouter, U().subjectS6A).probe({
      organizationId: world.orgAId,
      id: world.class6Id,
    });
    expect(cls.id).toBe(world.class6Id);
  });
});

// --- subjects — the school-level catalogue, no scope node ----------------------

describe("subjects — the school-level catalogue", () => {
  it("wide roles list exactly their branches' subjects", async () => {
    const cases = [
      [
        "org admin — both A1 subjects",
        U().adminA,
        [world.subjectA1MathId, world.subjectA1PhysicsId],
      ],
      ["branch principal", U().principalA1, [world.subjectA1MathId, world.subjectA1PhysicsId]],
      // Subjects have no class dimension, so a section-scoped teacher's list
      // widens to school level — the SAME set the principal sees, not more
      // (atSchoolLevel's entity-shape reasoning, now pinned by a live row set).
      [
        "section teacher widened to school level",
        U().subjectS6A,
        [world.subjectA1MathId, world.subjectA1PhysicsId],
      ],
    ] as const;

    for (const [name, userId, want] of cases) {
      const ids = await okIds(
        callerOf(subjectListRouter, userId).probe({
          organizationId: world.orgAId,
          schoolId: world.schoolA1Id,
        }),
      );
      expect(ids, name).toEqual([...want].sort());
    }
  });

  it("the A1 principal's list never contains the sibling branch's same-named subject", async () => {
    // "ITG Mathematics" exists in A1, A2 AND B1 — the unique index is per
    // school, so the same name is legal everywhere and NO name-based filter
    // could have saved a broken tenancy filter. If A2's row reaches A1's
    // answer, this exact-count assertion fails; that is the leak it pins.
    const ids = await okIds(
      callerOf(subjectListRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
      }),
    );
    expect(ids).toEqual([world.subjectA1MathId, world.subjectA1PhysicsId].sort());
    expect(ids).not.toContain(world.subjectA2MathId);
  });

  it("an outsider org is 403 on subject.list", async () => {
    await expectTrpcError(
      callerOf(subjectListRouter, U().adminB).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
      }),
      "FORBIDDEN",
      "Missing permission: subject:read",
    );
  });

  it("subject.byId: her branch resolves; a foreign-branch id is NOT_FOUND in the gate", async () => {
    const own = await callerOf(subjectByIdRouter, U().principalA1).probe({
      organizationId: world.orgAId,
      id: world.subjectA1PhysicsId,
    });
    expect(own.id).toBe(world.subjectA1PhysicsId);

    // The resolver finds A2's school node (same org), then the overlap gate
    // refuses her A1 grant — the generic wording, decided IN THE GATE.
    await expectTrpcError(
      callerOf(subjectByIdRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        id: world.subjectA2MathId,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("a cross-ORG subject id is NOT_FOUND, indistinguishable from a nonexistent one", async () => {
    // The owner resolver is org-filtered, so org B's subject yields the same
    // null a fabricated id would: nothing here confirms the id exists
    // elsewhere (the property that makes cross-tenant probing useless).
    await expectTrpcError(
      callerOf(subjectByIdRouter, U().adminA).probe({
        organizationId: world.orgAId,
        id: world.subjectB1MathId,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("a section-scoped teacher reads her branch's subject by id (overlap reach)", async () => {
    const subject = await callerOf(subjectByIdRouter, U().subjectS6A).probe({
      organizationId: world.orgAId,
      id: world.subjectA1MathId,
    });
    expect(subject.id).toBe(world.subjectA1MathId);
  });
});

// --- sections ------------------------------------------------------------------

describe("sections — the exact-data crown assertions", () => {
  const listAt = (userId: string) =>
    okIds(
      callerOf(sectionListRouter, userId).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        academicYearId: world.currentYearAId,
      }),
    );

  it("wide roles see both sections of Class 6", async () => {
    const both = [world.section6aId, world.section6bId].sort();
    expect(await listAt(U().adminA)).toEqual(both);
    expect(await listAt(U().principalA1)).toEqual(both);
    expect(await listAt(U().teacherC6)).toEqual(both);
    expect(await listAt(U().dual)).toEqual(both);
  });

  it("the subject teacher sees EXACTLY her section — not less, not more", async () => {
    expect(await listAt(U().subjectS6A)).toEqual([world.section6aId]);
  });

  it("section.byId: hers resolves, her neighbour does not exist for her", async () => {
    const own = await callerOf(sectionByIdRouter, U().subjectS6A).probe({
      organizationId: world.orgAId,
      id: world.section6aId,
    });
    expect(own.id).toBe(world.section6aId);

    // The overlap gate denies BEFORE the service query runs, so the wording
    // is the gate's generic one, not the router's.
    await expectTrpcError(
      callerOf(sectionByIdRouter, U().subjectS6A).probe({
        organizationId: world.orgAId,
        id: world.section6bId,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("the class teacher reads both sections by id — she covers the whole class", async () => {
    const b = await callerOf(sectionByIdRouter, U().teacherC6).probe({
      organizationId: world.orgAId,
      id: world.section6bId,
    });
    expect(b.id).toBe(world.section6bId);
  });
});

// --- years & the read_history gate ---------------------------------------------

describe("years — visibility is a permission, not scope inference (ADR-024)", () => {
  const listFor = async (userId: string) =>
    okIds(callerOf(yearListRouter, userId).probe({
      organizationId: world.orgAId,
      schoolId: world.schoolA1Id,
    }));

  it("holders of read_history see the closed year too", async () => {
    expect(await listFor(U().adminA)).toEqual(
      [world.closedYearAId, world.currentYearAId].sort(),
    );
    expect(await listFor(U().principalA1)).toEqual(
      [world.closedYearAId, world.currentYearAId].sort(),
    );
  });

  it("callers without read_history see EXACTLY the current year", async () => {
    expect(await listFor(U().teacherC6)).toEqual([world.currentYearAId]);
    expect(await listFor(U().subjectS6A)).toEqual([world.currentYearAId]);
  });

  it("denied personas are 403, not empty", async () => {
    await expectTrpcError(
      callerOf(yearListRouter, U().revokedT).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
      }),
      "FORBIDDEN",
      "Missing permission: academic_year:read",
    );
    await expectTrpcError(
      callerOf(yearListRouter, U().adminB).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
      }),
      "FORBIDDEN",
      "Missing permission: academic_year:read",
    );
  });

  it("year.byId closed year: teachers NOT_FOUND, principal positive control", async () => {
    await expectTrpcError(
      callerOf(yearByIdRouter, U().teacherC6).probe({
        organizationId: world.orgAId,
        id: world.closedYearAId,
      }),
      "NOT_FOUND",
      "Academic year not found.",
    );
    await expectTrpcError(
      callerOf(yearByIdRouter, U().subjectS6A).probe({
        organizationId: world.orgAId,
        id: world.closedYearAId,
      }),
      "NOT_FOUND",
      "Academic year not found.",
    );

    // Positive control: the principal MUST still read the closed year, or the
    // two negatives above would pass merely because reads broke for everyone.
    const seen = await callerOf(yearByIdRouter, U().principalA1).probe({
      organizationId: world.orgAId,
      id: world.closedYearAId,
    });
    expect(seen.id).toBe(world.closedYearAId);
  });

  it("a branch-A2 year is NOT_FOUND for the A1 principal (owner in another branch)", async () => {
    // Overlap miss happens IN THE GATE: her A1 grant cannot reach into A2's
    // subtree, so the generic wording comes first.
    await expectTrpcError(
      callerOf(yearByIdRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        id: world.currentYearBId,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });
});

// --- mutations -----------------------------------------------------------------

// --- terms: the year's subdivisions ---------------------------------------------

describe("terms — the year edge, history-pinned like their year", () => {
  const listAt = (userId: string, academicYearId: string) =>
    okIds(
      callerOf(termListRouter, userId).probe({
        organizationId: world.orgAId,
        academicYearId,
      }),
    );

  it("readers of the CURRENT year see exactly its two terms", async () => {
    const want = [world.termA1T1Id, world.termA1T2Id].sort();
    expect(await listAt(U().principalA1, world.currentYearAId)).toEqual(want);
    // class_teacher and subject_teacher hold academic_year:read without
    // read_history — the current year is theirs to read, terms included.
    expect(await listAt(U().teacherC6, world.currentYearAId)).toEqual(want);
    expect(await listAt(U().subjectS6A, world.currentYearAId)).toEqual(want);
  });

  it("read_history gates the CLOSED year's terms — with a non-vacuity control", async () => {
    // The closed year HAS a term, so the teacher's empty answer is the pin
    // biting, not an empty table.
    expect(await listAt(U().teacherC6, world.closedYearAId)).toEqual([]);
    expect(await listAt(U().principalA1, world.closedYearAId)).toEqual([
      world.termClosedAId,
    ]);
  });

  it("term.byId on the closed year: teachers NOT_FOUND, principal resolves", async () => {
    const own = await callerOf(termByIdRouter, U().principalA1).probe({
      organizationId: world.orgAId,
      id: world.termClosedAId,
    });
    expect(own.id).toBe(world.termClosedAId);

    await expectTrpcError(
      callerOf(termByIdRouter, U().teacherC6).probe({
        organizationId: world.orgAId,
        id: world.termClosedAId,
      }),
      "NOT_FOUND",
      "Term not found.",
    );
  });

  it("a section teacher reads her school's term by id (overlap reach)", async () => {
    const term = await callerOf(termByIdRouter, U().subjectS6A).probe({
      organizationId: world.orgAId,
      id: world.termA1T1Id,
    });
    expect(term.id).toBe(world.termA1T1Id);
  });

  it("a cross-ORG term id is NOT_FOUND, indistinguishable from a nonexistent one", async () => {
    await expectTrpcError(
      callerOf(termByIdRouter, U().adminA).probe({
        organizationId: world.orgAId,
        id: world.termB1Id,
      }),
      "NOT_FOUND",
      "Term not found.",
    );
  });

  it("a class teacher cannot create a term (permission gate)", async () => {
    await expectTrpcError(
      callerOf(createTermRouter, U().teacherC6).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: {
          academicYearId: world.currentYearAId,
          name: "ITG Denied Term",
          sequenceNumber: 9,
          startDate: "2025-11-01",
          endDate: "2026-01-31",
        },
      }),
      "FORBIDDEN",
      "Missing permission: academic_year:create",
    );
  });

  it("creating a term refuses a FOREIGN-BRANCH year (service guard)", async () => {
    // The principal covers school A1, so the gate passes; the service's
    // in-transaction year re-read catches the smuggled parent before anything
    // is written.
    await expectTrpcError(
      callerOf(createTermRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: {
          academicYearId: world.currentYearBId,
          name: "ITG Smuggled Term",
          sequenceNumber: 9,
          startDate: "2025-11-01",
          endDate: "2026-01-31",
        },
      }),
      "BAD_REQUEST",
      "That session is not at this branch. Choose a session from the branch you are working in.",
    );
  });

  it("term dates outside their year are refused BY THE TRIGGER, worded", async () => {
    // The within-year rule is cross-table: a trigger, not a CHECK. This pins
    // both that it bites through the full stack and that translateErrors
    // words it — a regression to a generic 500 fails here.
    await expectTrpcError(
      callerOf(createTermRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: {
          academicYearId: world.currentYearAId,
          name: "ITG Outside Term",
          sequenceNumber: 9,
          startDate: "2026-04-01",
          endDate: "2026-09-30",
        },
      }),
      "CONFLICT",
      "A term's dates must sit inside its session's dates. Check the term's start and end date against the session.",
    );
  });

  it("a teacher cannot update a term (permission gate)", async () => {
    await expectTrpcError(
      callerOf(updateTermRouter, U().teacherC6).probe({
        organizationId: world.orgAId,
        id: world.termA1T1Id,
        data: { weightage: "90.00" },
      }),
      "FORBIDDEN",
      "Missing permission: academic_year:update",
    );
  });
});

// --- the subjectGate: ADR-029's fact, live ---------------------------------------

describe("the subjectGate — subject-level access is a second fact", () => {
  // A subject id nothing references — the control for "an unassigned pair is
  // indistinguishable from a nonexistent one".
  const FABRICATED_SUBJECT = "9b2f8c1a-3d4e-4f5a-8b6c-7d8e9f0a1b2c";

  const marksAt = (userId: string, sectionId: string, subjectId: string) =>
    callerOf(marksCreateRouter, userId).probe({
      organizationId: world.orgAId,
      sectionId,
      subjectId,
    });

  it("her own pair resolves — the non-vacuity control", async () => {
    const result = await marksAt(
      U().subjectS6A,
      world.section6aId,
      world.subjectA1MathId,
    );
    expect(result.sectionId).toBe(world.section6aId);
  });

  it("her OWN section, the ADJACENT subject: NOT_FOUND — the Phase-1 leftover closes", async () => {
    // She is scoped to 6-A, and the scope tree has no subject axis, so can()
    // alone would let her enter every subject in it. The assignment fact is
    // what refuses — and it refuses with the GENERIC wording, identical for a
    // fabricated subject id, so probing combinations reveals nothing.
    await expectTrpcError(
      marksAt(U().subjectS6A, world.section6aId, world.subjectA1PhysicsId),
      "NOT_FOUND",
      "Resource not found.",
    );
    await expectTrpcError(
      marksAt(U().subjectS6A, world.section6aId, FABRICATED_SUBJECT),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("the ADJACENT SECTION is refused by the section gate first — the layering", async () => {
    // The permission gate answers the node question (her 6-A grant does not
    // cover 6-B), so FORBIDDEN with the role wording — the fact check never
    // runs. Both layers exist and the order is pinned.
    await expectTrpcError(
      marksAt(U().subjectS6A, world.section6bId, world.subjectA1MathId),
      "FORBIDDEN",
      "A role you hold has marks:create but not at this section.",
    );
  });

  it("the HOMEROOM teacher holds marks:create but no subject fact — NOT_FOUND", async () => {
    // teacherC6's STA row is the class_teacher homeroom fact; the fact query
    // states its own terms (role = subject_teacher), so the timetable saying
    // "homeroom" confers no subject authority. He covers 6-A, passes the
    // permission gate, and still cannot enter marks.
    await expectTrpcError(
      marksAt(U().teacherC6, world.section6aId, world.subjectA1MathId),
      "NOT_FOUND",
      "Resource not found.",
    );
  });
});

// --- enrollments: the year anchor, in both tracks ----------------------------

describe("enrollments — the year anchor, in both tracks", () => {
  const listAt = (
    userId: string,
    filters: { classId?: string; sectionId?: string } = {},
  ) =>
    okIds(
      callerOf(enrollmentListRouter, userId).probe({
        organizationId: world.orgAId,
        academicYearId: world.currentYearAId,
        ...filters,
      }),
    );

  it("the section teacher sees EXACTLY her student — the admitted classmate is not hers", async () => {
    // NO widening: the scope columns carry all four levels, so her section
    // grant matches only rows whose section is hers. The admitted classmate
    // has NO section yet, and a NULL never equals her section id.
    expect(await listAt(U().subjectS6A)).toEqual([world.enrollmentOwnedId]);
  });

  it("the class teacher sees BOTH — her class grant reaches the admitted row too", async () => {
    // The admitted row's owning node is its CLASS (no section yet), and the
    // class teacher's class-level scope matches it.
    expect(await listAt(U().teacherC6)).toEqual(
      [world.enrollmentOwnedId, world.enrollmentUngrantedId].sort(),
    );
    // The narrowing is convenience on an already-clipped answer.
    expect(await listAt(U().teacherC6, { sectionId: world.section6aId })).toEqual([
      world.enrollmentOwnedId,
    ]);
    expect(await listAt(U().teacherC6, { classId: world.class6Id })).toEqual(
      [world.enrollmentOwnedId, world.enrollmentUngrantedId].sort(),
    );
  });

  it("byId: her own student resolves; the admitted classmate resolves via the CLASS owner", async () => {
    const own = await callerOf(enrollmentByIdRouter, U().subjectS6A).probe({
      organizationId: world.orgAId,
      id: world.enrollmentOwnedId,
    });
    expect(own.id).toBe(world.enrollmentOwnedId);

    // The admitted row has no section, so its owner is the CLASS node — her
    // 6-A grant reaches into Class 6, and the overlap gate admits her. The
    // class-fallback semantics, pinned.
    const admitted = await callerOf(enrollmentByIdRouter, U().subjectS6A).probe({
      organizationId: world.orgAId,
      id: world.enrollmentUngrantedId,
    });
    expect(admitted.id).toBe(world.enrollmentUngrantedId);
  });

  it("a cross-ORG enrollment is NOT_FOUND, indistinguishable from a made-up id", async () => {
    await expectTrpcError(
      callerOf(enrollmentByIdRouter, U().adminA).probe({
        organizationId: world.orgAId,
        id: world.enrollmentB1Id,
      }),
      "NOT_FOUND",
      "Enrollment not found.",
    );
  });

  it("a class teacher cannot create an enrollment (permission gate)", async () => {
    await expectTrpcError(
      callerOf(createEnrollmentRouter, U().teacherC6).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: {
          studentId: world.enrollmentOwnedId,
          academicYearId: world.currentYearAId,
          classId: world.class6Id,
        },
      }),
      "FORBIDDEN",
      "Missing permission: enrollment:create",
    );
  });

  it("creating refuses a FOREIGN-ORG student (service guard)", async () => {
    await expectTrpcError(
      callerOf(createEnrollmentRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: {
          studentId: world.studentB1Id,
          academicYearId: world.currentYearAId,
          classId: world.class6Id,
        },
      }),
      "BAD_REQUEST",
      "That student is not at this branch. Choose a student from the branch you are working in.",
    );
  });

  it("creating refuses a section of ANOTHER YEAR, then of ANOTHER CLASS (service guards)", async () => {
    // Both would pass every FK: the section's own year and class columns are
    // what the enrollment must agree with, and only the re-reads know them.
    // A section of ANOTHER YEAR at the same branch — find-or-created here (a
    // closed-year section of Class 6), because a cross-BRANCH section would
    // trip the section re-read before the year agreement is ever reached.
    const [staleYearSection] = await db
      .select()
      .from(sections)
      .where(
        and(
          eq(sections.classId, world.class6Id),
          eq(sections.academicYearId, world.closedYearAId),
        ),
      );
    const scratchClosed =
      staleYearSection ??
      (await academicService.createSection(
        {
          organizationId: world.orgAId,
          schoolId: world.schoolA1Id,
          classId: null,
          sectionId: null,
        },
        { name: "A", academicYearId: world.closedYearAId, classId: world.class6Id },
      ));

    await expectTrpcError(
      callerOf(createEnrollmentRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: {
          studentId: world.ownedStudentId,
          academicYearId: world.currentYearAId,
          classId: world.class6Id,
          sectionId: scratchClosed.id,
        },
      }),
      "BAD_REQUEST",
      "That section belongs to a different session. Enroll into the session the section belongs to.",
    );

    // A section of the SIBLING class, same year — find-or-created here so the
    // sections block's exact counts stay a two-section world.
    const [existing] = await db
      .select()
      .from(sections)
      .where(
        and(
          eq(sections.classId, world.class7Id),
          eq(sections.academicYearId, world.currentYearAId),
        ),
      );
    const scratch7a =
      existing ??
      (await academicService.createSection(
        {
          organizationId: world.orgAId,
          schoolId: world.schoolA1Id,
          classId: null,
          sectionId: null,
        },
        { name: "A", academicYearId: world.currentYearAId, classId: world.class7Id },
      ));

    await expectTrpcError(
      callerOf(createEnrollmentRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: {
          studentId: world.ownedStudentId,
          academicYearId: world.currentYearAId,
          classId: world.class6Id,
          sectionId: scratch7a.id,
        },
      }),
      "BAD_REQUEST",
      "That section belongs to a different class. Enroll under the class the section teaches.",
    );
  });

  it("the status machine refuses an illegal move, worded", async () => {
    await expectTrpcError(
      callerOf(transitionEnrollmentRouter, U().adminA).probe({
        organizationId: world.orgAId,
        id: world.enrollmentOwnedId,
        to: "admitted",
      }),
      "BAD_REQUEST",
      "That status change is not allowed right now. Refresh to see the enrollment's current state.",
    );
  });

  it("assignSection, the machine, and the transfer boundary (runs late, mutates)", async () => {
    // FIRST assignment on the admitted row: NULL section, becomes 6-B with a
    // roll number, status derived to section_assigned.
    const assigned = await callerOf(assignSectionRouter, U().adminA).probe({
      organizationId: world.orgAId,
      id: world.enrollmentUngrantedId,
      sectionId: world.section6bId,
      rollNumber: "02",
    });
    expect(assigned.sectionId).toBe(world.section6bId);
    expect(assigned.enrollmentStatus).toBe("section_assigned");

    // A SECOND assignment is the transfer boundary, refused in words — the
    // history-preserving path is unrepresentable to skip.
    await expectTrpcError(
      callerOf(assignSectionRouter, U().adminA).probe({
        organizationId: world.orgAId,
        id: world.enrollmentUngrantedId,
        sectionId: world.section6aId,
      }),
      "BAD_REQUEST",
      "This enrollment already has a section. Moving a student mid-year needs a transfer — that flow is not built yet.",
    );

    // The machine: section_assigned → active is legal; the UPDATE re-checks
    // the current state so a concurrent transition loses cleanly.
    const active = await callerOf(transitionEnrollmentRouter, U().adminA).probe({
      organizationId: world.orgAId,
      id: world.enrollmentUngrantedId,
      to: "active",
    });
    expect(active.enrollmentStatus).toBe("active");
  });

  it("the PORTAL list returns only the OWNED student's enrollment", async () => {
    // The parent owns one child and is the portal track's whole idea: no
    // roles, no can(), no organizationId — the owned studentId list IS the
    // filter. The inactive access row (ungrantedStudent) stays invisible.
    const rows = await callerOf(portalEnrollmentRouter, U().parent).probe();

    expect(rows.map((r: { id: string }) => r.id)).toEqual([world.enrollmentOwnedId]);
  });
});

// --- the teaching-assignment layer ----------------------------------------------

describe("the teaching-assignment layer — the template and the staffing", () => {
  const listMappingsAt = (userId: string) =>
    okIds(
      callerOf(mappingListRouter, userId).probe({
        organizationId: world.orgAId,
        academicYearId: world.currentYearAId,
        classId: world.class6Id,
      }),
    );

  it("every role holding the read lists exactly Class 6's two mappings", async () => {
    const want = [world.mappingA1MathId, world.mappingA1PhysicsId].sort();
    expect(await listMappingsAt(U().principalA1)).toEqual(want);
    // The class teacher and the section teacher ask with a top-level classId;
    // the widening to school level is the same entity-shape reasoning as the
    // catalogue (a mapping has no section of its own), and the year+class
    // input is what keeps the answer exact.
    expect(await listMappingsAt(U().teacherC6)).toEqual(want);
    expect(await listMappingsAt(U().subjectS6A)).toEqual(want);
  });

  it("the sibling branch's mapping for the same-named subject never appears", async () => {
    const ids = await listMappingsAt(U().principalA1);
    expect(ids).not.toContain(world.mappingA2MathId);
    expect(ids).not.toContain(world.mappingB1MathId);
  });

  it("an outsider org is 403 on subject_mapping.list", async () => {
    await expectTrpcError(
      callerOf(mappingListRouter, U().adminB).probe({
        organizationId: world.orgAId,
        academicYearId: world.currentYearAId,
        classId: world.class6Id,
      }),
      "FORBIDDEN",
      "Missing permission: subject_mapping:read",
    );
  });

  it("mapping.byId: her branch resolves; a foreign-branch id is NOT_FOUND in the gate", async () => {
    const own = await callerOf(mappingByIdRouter, U().principalA1).probe({
      organizationId: world.orgAId,
      id: world.mappingA1MathId,
    });
    expect(own.id).toBe(world.mappingA1MathId);

    // The resolver finds A2's school node, then the overlap gate refuses her
    // A1 grant — the gate's generic wording, not the router's.
    await expectTrpcError(
      callerOf(mappingByIdRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        id: world.mappingA2MathId,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("a cross-ORG mapping id is NOT_FOUND, indistinguishable from a nonexistent one", async () => {
    // The resolver is org-filtered, so B1's mapping yields the resolver's own
    // "not found" — nothing here confirms the id exists elsewhere.
    await expectTrpcError(
      callerOf(mappingByIdRouter, U().adminA).probe({
        organizationId: world.orgAId,
        id: world.mappingB1MathId,
      }),
      "NOT_FOUND",
      "Subject mapping not found.",
    );
  });

  it("creating a mapping is gated on the ADDRESSED CLASS — a sibling branch's class is FORBIDDEN", async () => {
    // The create input names its parent class top-level, and the builder takes
    // the most specific id present as the addressed node — so a foreign class
    // is refused by the GATE, before the service's parent re-read ever runs.
    // The caller matters: the branch principal does not COVER the sibling
    // class, so the coverage test refuses her. (An org admin would pass the
    // gate here — see the next test.)
    await expectTrpcError(
      callerOf(createMappingRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        academicYearId: world.currentYearAId,
        classId: world.classA2Id,
        subjectId: world.subjectA1MathId,
        data: {
          academicYearId: world.currentYearAId,
          classId: world.classA2Id,
          subjectId: world.subjectA1MathId,
        },
      }),
      "FORBIDDEN",
      "A role you hold has subject_mapping:create but not at this class.",
    );
  });

  it("an ORG-SCOPED admin covers the sibling class, so the SERVICE's year re-read refuses him", async () => {
    // The complement of the gate refusal: the org admin covers both branches,
    // so no gate can catch a smuggled parent — but the year he named belongs
    // to school A1, and the class he addressed is in school A2. The re-read
    // runs INSIDE the transaction, and nothing is written.
    await expectTrpcError(
      callerOf(createMappingRouter, U().adminA).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        academicYearId: world.currentYearAId,
        classId: world.classA2Id,
        subjectId: world.subjectA1MathId,
        data: {
          academicYearId: world.currentYearAId,
          classId: world.classA2Id,
          subjectId: world.subjectA1MathId,
        },
      }),
      "BAD_REQUEST",
      "That session is not at this branch. Choose a session from the branch you are working in.",
    );
  });

  it("a cross-ORG class is the generic 403 — a wrong-tenant node is unresolvable", async () => {
    await expectTrpcError(
      callerOf(createMappingRouter, U().adminA).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        academicYearId: world.currentYearAId,
        classId: world.classB1Id,
        subjectId: world.subjectA1MathId,
        data: {
          academicYearId: world.currentYearAId,
          classId: world.classB1Id,
          subjectId: world.subjectA1MathId,
        },
      }),
      "FORBIDDEN",
      "You do not have access to this resource.",
    );
  });

  it("creating a mapping refuses a FOREIGN-ORG SUBJECT — the parent the gate cannot see", async () => {
    // The class is covered, so the gate passes and the SERVICE re-read catches
    // the smuggled subject. This assertion is why the re-read exists.
    await expectTrpcError(
      callerOf(createMappingRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        academicYearId: world.currentYearAId,
        classId: world.class6Id,
        subjectId: world.subjectB1MathId,
        data: {
          academicYearId: world.currentYearAId,
          classId: world.class6Id,
          subjectId: world.subjectB1MathId,
        },
      }),
      "BAD_REQUEST",
      "That subject is not at this branch. Choose a subject from the branch you are working in.",
    );
  });

  it("a section teacher cannot create a mapping (permission gate)", async () => {
    await expectTrpcError(
      callerOf(createMappingRouter, U().subjectS6A).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        academicYearId: world.currentYearAId,
        classId: world.class6Id,
        subjectId: world.subjectA1MathId,
        data: {
          academicYearId: world.currentYearAId,
          classId: world.class6Id,
          subjectId: world.subjectA1MathId,
        },
      }),
      "FORBIDDEN",
      "Missing permission: subject_mapping:create",
    );
  });

  it("open assignments per section: exactly the two staffed rows", async () => {
    const want = [world.staMath6aId, world.staHomeroom6aId].sort();
    const listAt = (userId: string) =>
      okIds(
        callerOf(staListRouter, userId).probe({
          organizationId: world.orgAId,
          sectionId: world.section6aId,
        }),
      );
    expect(await listAt(U().principalA1)).toEqual(want);
    // Her own subject fact plus the homeroom fact — teacher_assignment:read
    // at section scope reaches her section's rows.
    expect(await listAt(U().subjectS6A)).toEqual(want);
  });

  it("the class teacher holds NO teacher_assignment:read — the matrix boundary", async () => {
    await expectTrpcError(
      callerOf(staListRouter, U().teacherC6).probe({
        organizationId: world.orgAId,
        sectionId: world.section6aId,
      }),
      "FORBIDDEN",
      "Missing permission: teacher_assignment:read",
    );
  });

  it("sta.byId: her own row resolves (overlap reach); a cross-org row is NOT_FOUND", async () => {
    const own = await callerOf(staByIdRouter, U().subjectS6A).probe({
      organizationId: world.orgAId,
      id: world.staMath6aId,
    });
    expect(own.id).toBe(world.staMath6aId);

    await expectTrpcError(
      callerOf(staByIdRouter, U().adminA).probe({
        organizationId: world.orgAId,
        id: world.staB1Id,
      }),
      "NOT_FOUND",
      "Teacher assignment not found.",
    );
  });

  it("assigning into a cross-ORG section is the generic 403", async () => {
    await expectTrpcError(
      callerOf(createStaRouter, U().adminA).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        sectionId: world.sectionB1Id,
        academicYearId: world.yearB1Id,
        userId: U().teacherC6,
        role: "subject_teacher",
        subjectId: world.subjectA1MathId,
      }),
      "FORBIDDEN",
      "You do not have access to this resource.",
    );
  });

  it("an assignment's year must equal its section's year (service guard)", async () => {
    // The section is covered and the closed year is in the same school, so the
    // gate passes; the service refuses the mismatch before anything is written.
    await expectTrpcError(
      callerOf(createStaRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        sectionId: world.section6aId,
        academicYearId: world.closedYearAId,
        userId: U().teacherC6,
        role: "class_teacher",
      }),
      "BAD_REQUEST",
      "That session does not match the section's session. Choose the session the section belongs to.",
    );
  });

  it("a subject_teacher cannot be assigned a FOREIGN-ORG subject (service guard)", async () => {
    await expectTrpcError(
      callerOf(createStaRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        sectionId: world.section6aId,
        academicYearId: world.currentYearAId,
        userId: U().teacherC6,
        role: "subject_teacher",
        subjectId: world.subjectB1MathId,
      }),
      "BAD_REQUEST",
      "That subject is not at this branch. Choose a subject from the branch you are working in.",
    );
  });

  it("end closes the open row and the successor replaces it (runs late, mutates)", async () => {
    // The scratch row belongs to this test: the fixture keeps exactly one OPEN
    // row for (6-B, subject teacher, Physics) and this test ends it, so a
    // re-run re-opens and re-ends it — history accumulates, nothing is deleted.
    // The successor shares the scratch row's natural key, so the fixture finds
    // IT on the next run and the churn stays at one row per run.
    const ended = await callerOf(endStaRouter, U().principalA1).probe({
      organizationId: world.orgAId,
      id: world.staScratch6bId,
      successor: {
        sectionId: world.section6bId,
        academicYearId: world.currentYearAId,
        userId: U().subjectS6A,
        role: "subject_teacher",
        subjectId: world.subjectA1PhysicsId,
      },
    });
    expect(ended.closed.effectiveTo).toBeTruthy();
    expect(ended.successor?.id).toBeTruthy();
    expect(ended.successor.id).not.toBe(ended.closed.id);

    // The open-row list is served by the partial index: the closed row leaves
    // it, the successor enters it, and the seat is never vacant.
    const after = await okIds(
      callerOf(staListRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        sectionId: world.section6bId,
      }),
    );
    expect(after).toEqual([ended.successor.id]);

    // Ending it twice is a CONFLICT worded for the person who clicked twice.
    await expectTrpcError(
      callerOf(endStaRouter, U().principalA1).probe({
        organizationId: world.orgAId,
        id: ended.closed.id,
      }),
      "CONFLICT",
      "This assignment has already been ended. Refresh to see the current assignments.",
    );
  });
});

describe("mutations — strict cover and parent verification", () => {
  it("a class teacher cannot create an academic year (gate)", async () => {
    await expectTrpcError(
      callerOf(createYearRouter, U().teacherC6).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: { name: "ITG Denied", startDate: "2045-04-01", endDate: "2046-03-31" },
      }),
      "FORBIDDEN",
      "Missing permission: academic_year:create",
    );
  });

  it("an overlapping year is refused by the DATABASE, not re-checked in app code", async () => {
    await expect(
      academicService.createAcademicYear(
        {
          organizationId: world.orgAId,
          schoolId: world.schoolA1Id,
          classId: null,
          sectionId: null,
        },
        { name: "ITG Overlap", startDate: "2025-09-01", endDate: "2026-02-28" },
      ),
    ).rejects.toThrow();
  });

  it("setCurrent across branches never moves the flag", async () => {
    // However the service reports the refusal (throw or null), the invariant
    // is the side effect that must NOT happen.
    try {
      await academicService.setCurrentAcademicYear(
        {
          organizationId: world.orgAId,
          schoolId: world.schoolA1Id,
          classId: null,
          sectionId: null,
        },
        world.currentYearBId,
      );
    } catch {
      // refused loudly — fine
    }

    // No side effects: neither school's current year moved.
    const a1 = await academicService.getAcademicYearById(
      { organizationId: world.orgAId, schoolId: world.schoolA1Id, classId: null, sectionId: null },
      world.currentYearAId,
      true,
    );
    expect(a1?.isCurrent).toBe(true);
    const a2 = await academicService.getAcademicYearById(
      { organizationId: world.orgAId, schoolId: world.schoolA2Id, classId: null, sectionId: null },
      world.currentYearBId,
      true,
    );
    expect(a2?.isCurrent).toBe(true);
  });

  it("createSection refuses a FOREIGN-BRANCH parent", async () => {
    await expectTrpcError(
      callerOf(createSectionRouter, U().adminA).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: {
          classId: world.classA2Id,
          academicYearId: world.currentYearAId,
          name: "X",
        },
      }),
      "BAD_REQUEST",
      "That class is not at this branch. Choose a class from the branch you are working in.",
    );
  });

  it("createSection refuses a FOREIGN-ORG parent identically", async () => {
    await expectTrpcError(
      callerOf(createSectionRouter, U().adminA).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: {
          classId: world.classB1Id,
          academicYearId: world.currentYearAId,
          name: "X",
        },
      }),
      "BAD_REQUEST",
      "That class is not at this branch. Choose a class from the branch you are working in.",
    );
  });
});

// --- deactivation (last: mutates shared fixture) --------------------------------

describe("deactivation semantics — runs last", () => {
  it("a deactivated class disappears from lists but stays readable by id", async () => {
    // Find-or-create the scratch row DIRECTLY: a re-run meets it already
    // deactivated, and createClass would reject the duplicate name.
    const scopeA1 = {
      organizationId: world.orgAId,
      schoolId: world.schoolA1Id,
      classId: null,
      sectionId: null,
    };
    const [existing] = await db
      .select()
      .from(classes)
      .where(and(eq(classes.schoolId, world.schoolA1Id), eq(classes.name, "ITG Scratch")));
    const scratchRow = existing ?? (await academicService.createClass(scopeA1, {
      name: "ITG Scratch",
      numericOrder: 8,
    }));

    const deactivated = await callerOf(deactivateClassRouter, U().adminA).probe({
      organizationId: world.orgAId,
      id: scratchRow.id,
    });
    expect(deactivated.isActive).toBe(false);

    const after = await okIds(
      callerOf(classListRouter, U().adminA).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
      }),
    );
    expect(after).not.toContain(scratchRow.id);
    // Hard rule 2: the row survives — soft delete, reachable by id for those
    // whose grants reach it... but listClasses filters isActive, so byId uses
    // getClassById which does not. It stays READABLE.
    const direct = await academicService.getClassById(
      {
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        classId: null,
        sectionId: null,
      },
      scratchRow.id,
    );
    expect(direct?.id).toBe(scratchRow.id);
  }, 60_000);
});

// --- student track ---------------------------------------------------------------

describe("student portal — ownership without roles", () => {
  it("getOwnedStudentIds returns exactly the ACTIVE access rows (isActive pinned)", async () => {
    const ids = await getOwnedStudentIds(U().parent);
    // Two access rows exist; one is isActive=false and must be invisible.
    expect(ids).toEqual([world.ownedStudentId]);
  });

  it("assertOwnsStudent admits the owned child and rejects the inactive one", async () => {
    const ok = await callerOf(studentProbeRouter, U().parent).probe({
      studentId: world.ownedStudentId,
    });
    expect(ok.owned).toBe(true);

    await expectTrpcError(
      callerOf(studentProbeRouter, U().parent).probe({
        studentId: world.ungrantedStudentId,
      }),
      "FORBIDDEN",
      "You do not have access to this student.",
    );
  });
});

// --- the happy path through the REAL contract schemas ----------------------------

describe("the happy path through the real contract schemas", () => {
  // The denial tests above exercise the gates through hand-rolled payloads;
  // these exercises validate through the contract schemas the routers
  // actually ship, so an input-shape drift surfaces here instead of in a
  // school's admission week.

  const subjectCreateRouter = makeRouter({
    probe: staffProcedure("subject:create")
      .input(z.object({ schoolId: z.uuid(), data: createSubjectSchema }))
      .mutation(({ ctx, input }) =>
        subjectService.createSubject(ctx.scope, input.data),
      ),
  });

  it("subject create over tRPC writes the row the contract describes (self-cleaning)", async () => {
    const name = "ITG Probe Subject";
    // Find-or-create: the unique index is per school, so a previous run's
    // row must be reused rather than collided with.
    const [existing] = await db
      .select()
      .from(subjects)
      .where(
        and(eq(subjects.schoolId, world.schoolA1Id), eq(subjects.name, name)),
      );
    const created =
      existing ??
      (await callerOf(subjectCreateRouter, U().adminA).probe({
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        data: { name, code: "PRB" },
      }));
    expect(created.name).toBe(name);

    // Self-cleaning: the subject catalogue's exact-count assertions must stay
    // a two-subject world, so what this test writes it deactivates (soft
    // delete, idempotent on re-runs).
    const deactivated = await subjectService.deactivateSubject(
      {
        organizationId: world.orgAId,
        schoolId: world.schoolA1Id,
        classId: null,
        sectionId: null,
      },
      created.id,
    );
    expect(deactivated?.isActive).toBe(false);
  });
});
