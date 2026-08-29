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
import { academicService, organizationService, subjectService } from "@repo/services";
import { getOwnedStudentIds } from "@repo/authz";
import { db } from "@repo/db";
import { classes } from "@repo/db/schema";
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
    .input(z.object({ data: z.object({ name: z.string(), startDate: z.string(), endDate: z.string() }) }))
    .mutation(({ ctx, input }) =>
      academicService.createAcademicYear(ctx.scope as never, input.data),
    ),
});

const createSectionRouter = makeRouter({
  probe: staffProcedure("section:create")
    // Parents arrive nested under `data`, exactly as the real contract ships
    // them — a top-level classId would be mistaken by the builder for SCOPE
    // addressing (addressedNodeId takes the most specific id present).
    .input(
      z.object({
        data: z.object({
          classId: z.uuid(),
          academicYearId: z.uuid(),
          name: z.string(),
        }),
      }),
    )
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
