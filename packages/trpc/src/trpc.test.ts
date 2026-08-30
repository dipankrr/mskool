import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gate machinery had no fast tests: everything between the HTTP smoke
 * matrix runs lived unverified, and the B4–B7 gates (addressedBy, resolveOwner,
 * cover vs overlap) are the most recently changed security code in the repo.
 * These tests drive the REAL builders through tRPC callers. Everything is
 * mocked at the socket boundary: ioredis becomes an in-memory Map and
 * Postgres returns fixture rows, exactly like the authz package's cache
 * tests. ioredis is declared as a devDependency of THIS package for that
 * reason alone: under pnpm's strict layout an undeclared specifier can
 * resolve to a different module instance than the one @repo/authz loads,
 * and the mock would silently miss while a real client times out.
 *
 * SQL-level filters (revokedAt IS NULL) live below this seam and
 * are pinned by the integration suite.
 *
 * Every deny path asserts its exact code AND message: the split 403 wordings
 * and the deliberate indistinguishability of missing-vs-cross-tenant nodes are
 * guarantees clients and support workflows rely on, not implementation detail.
 */

vi.hoisted(() => {
  // @repo/authz validates REDIS_URL at import; no real connection is ever
  // made because ioredis is mocked below.
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
});

const store = vi.hoisted(() => new Map<string, string>());

const mocks = vi.hoisted(() => ({
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return "OK";
  }),
  del: vi.fn(async (...keys: string[]) => {
    for (const key of keys) store.delete(key);
    return keys.length;
  }),
}));

vi.mock("ioredis", () => ({
  default: class FakeRedis {
    get = mocks.get;
    set = mocks.set;
    del = mocks.del;
    constructor(_url: string) {}
  },
}));

const dbState = vi.hoisted(() => ({
  rows: new Map<string, Record<string, any>[]>(),
  selects: 0,
}));

vi.mock("@repo/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();

  // The condition reaching here is the REAL one the code built — compiled to
  // its parameters and applied to the fixtures. A parameter-count mismatch
  // means the query shape drifted, which fails loudly instead of silently
  // returning the wrong persona's rows.
  const from = (table: unknown) => ({
    where: async (condition: unknown) => {
      const name = getTableName(table as never);
      const rows = dbState.rows.get(name) ?? [];
      const { params } = dialect.sqlToQuery(condition as never);

      switch (name) {
        case "role_assignments":
          if (params.length !== 1) throw new Error(`Unexpected role_assignments query: ${params.length} params`);
          return rows.filter((r) => r.userId === params[0]);
        case "scope_nodes":
          if (params.length !== 1) throw new Error(`Unexpected scope_nodes query: ${params.length} params`);
          return rows.filter((r) => r.id === params[0]);
        case "org_role_permissions":
          if (params.length !== 1) throw new Error(`Unexpected org_role_permissions query: ${params.length} params`);
          return rows.filter((r) => r.organizationId === params[0]);
        case "student_portal_access":
          if (params.length !== 2) throw new Error(`Unexpected student_portal_access query: ${params.length} params`);
          return rows.filter((r) => r.userId === params[0] && r.isActive === params[1]);
        // The student B6 adapter: and(eq(id), eq(organizationId)).
        case "students":
          if (params.length !== 2) throw new Error(`Unexpected students query: ${params.length} params`);
          return rows.filter((r) => r.id === params[0] && r.organizationId === params[1]);
        // The ADR-029 fact: and(eq(org), eq(user), eq(section), eq(subject),
        // eq(role)) + isNull(effectiveTo) — five params, the open-row check
        // applied to the fixtures directly.
        case "section_teacher_assignments":
          if (params.length !== 5) throw new Error(`Unexpected section_teacher_assignments query: ${params.length} params`);
          return rows.filter(
            (r) =>
              r.organizationId === params[0] &&
              r.userId === params[1] &&
              r.sectionId === params[2] &&
              r.subjectId === params[3] &&
              r.role === params[4] &&
              r.effectiveTo === null,
          );
        default:
          throw new Error(`No query contract for table ${name}`);
      }
    },
  });

  return {
    db: {
      select: () => {
        dbState.selects += 1;
        return { from };
      },
      selectDistinct: () => ({ from }),
    },
  };
});

import { TRPCError } from "@trpc/server";
import { getTableName } from "drizzle-orm";
import { z } from "zod";
import type { Permission } from "@repo/authz";
import {
  orgRolePermissions,
  roleAssignments,
  scopeNodes,
  sectionTeacherAssignments,
  studentPortalAccess,
  students,
} from "@repo/db/schema";
import {
  assertStudentOwnership,
  protectedProcedure,
  resolveStudentOwner,
  router as makeRouter,
  staffListProcedure,
  staffProcedure,
  studentProcedure,
  type OwnerResolver,
} from "./trpc";

const TABLE = {
  assignments: getTableName(roleAssignments),
  permissions: getTableName(orgRolePermissions),
  nodes: getTableName(scopeNodes),
  portal: getTableName(studentPortalAccess),
  students: getTableName(students),
  sta: getTableName(sectionTeacherAssignments),
};

// --- world ------------------------------------------------------------------
// Realistic uuids everywhere: the builders' z.uuid() input schemas reject
// anything else, so fixtures must be wire-valid.

const ORG = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const SCHOOL_A = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const SCHOOL_B = "6ba7b811-9dad-41d1-80b4-00c04fd430c8";
const CLASS_6 = "6ba7b812-9dad-41d1-80b4-00c04fd430c8";
const SECTION_6A = "6ba7b813-9dad-41d1-80b4-00c04fd430c8";
// Belongs to another tenant entirely.
const FOREIGN_SCHOOL = "6ba7b814-9dad-41d1-80b4-00c04fd430c8";
// Well-formed but absent from scope_nodes.
const MISSING_NODE = "6ba7b815-9dad-41d1-80b4-00c04fd430c8";

const ADMIN = "user-admin";
const PRINCIPAL_A = "user-principal-a";
const PRINCIPAL_B = "user-principal-b";
const TEACHER_6 = "user-teacher-6";

const nodeRow = (over: Record<string, any> = {}) => ({
  id: SCHOOL_A,
  type: "school",
  organizationId: ORG,
  schoolId: null,
  classId: null,
  ...over,
});

function seedWorld(nodes: Record<string, any>[] = []) {
  dbState.rows.set(TABLE.nodes, [
    nodeRow({ id: SCHOOL_A }),
    nodeRow({ id: SCHOOL_B }),
    nodeRow({ id: CLASS_6, type: "class", schoolId: SCHOOL_A }),
    nodeRow({
      id: SECTION_6A,
      type: "section",
      schoolId: SCHOOL_A,
      classId: CLASS_6,
    }),
    nodeRow({ id: FOREIGN_SCHOOL, organizationId: "org-other" }),
    ...nodes,
  ]);
}

interface Grant {
  userId: string;
  roleType: string;
  scopeType: "org" | "school" | "class" | "section";
  scopeId: string;
  expiresAt?: Date;
}

/** Assignments + the org's role→permission matrix, as the SQL layer returns them. */
function seedGrants(grants: Grant[], perms: Array<[string, string]> = []) {
  dbState.rows.set(
    TABLE.assignments,
    grants.map((g, i) => ({
      id: `ra-${i}`,
      userId: g.userId,
      roleType: g.roleType,
      organizationId: ORG,
      scopeType: g.scopeType,
      scopeId: g.scopeId,
      expiresAt: g.expiresAt ?? null,
      revokedAt: null,
    })),
  );
  dbState.rows.set(
    TABLE.permissions,
    perms.map(([roleType, permission]) => ({
      organizationId: ORG,
      roleType,
      permission,
    })),
  );
}

const ORG_ADMIN_PERMS: Array<[string, string]> = [
  ["org_admin", "school:read"],
  ["org_admin", "school:create"],
  ["org_admin", "student:delete"], // SENSITIVE — bypasses the cache
];
const PRINCIPAL_PERMS: Array<[string, string]> = [
  ["principal", "school:read"],
  ["principal", "academic_year:read"],
];

// --- harness ----------------------------------------------------------------

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
  const error = caught as TRPCError;
  expect(error.code).toBe(code);
  if (message !== undefined) {
    expect(error.message).toBe(message);
  }
}

function staffCaller(
  permission: Permission,
  userId: string = ADMIN,
  opts?: Parameters<typeof staffProcedure>[1],
) {
  const probe = makeRouter({
    probe: staffProcedure(permission, opts).query(({ ctx }) => ({
      scope: ctx.scope,
    })),
  });
  const caller = probe.createCaller({
    session: { user: { id: userId } },
  } as never);
  // The gate's input schema is chosen at RUNTIME from opts — id-addressing
  // extends it — so no single static type describes every variant's caller
  // input. That is exactly why the builder validates the id itself.
  return { probe: (input: Record<string, unknown>) => caller.probe(input as never) };
}

function listCaller(permission: Permission, userId: string) {
  const probe = makeRouter({
    probe: staffListProcedure(permission).query(({ ctx }) => ({
      scopes: ctx.scopes,
    })),
  });
  return probe.createCaller({
    session: { user: { id: userId } },
  } as never);
}

beforeEach(() => {
  store.clear();
  dbState.rows.clear();
  dbState.selects = 0;
  vi.clearAllMocks();
  seedWorld();
});

// --- staffProcedure · the cover gate ---------------------------------------

describe("staffProcedure — entry checks", () => {
  it("401s without a session", async () => {
    seedGrants([]);
    const probe = makeRouter({
      probe: staffProcedure("school:read").query(() => "ok"),
    });
    const caller = probe.createCaller({ session: null } as never);

    await expectTrpcError(
      caller.probe({ organizationId: ORG }),
      "UNAUTHORIZED",
      "Sign in required.",
    );
  });

  it("cross-tenant and nonexistent nodes are the SAME generic 403", async () => {
    seedGrants([{ userId: ADMIN, roleType: "org_admin", scopeType: "org", scopeId: ORG }]);
    seedWorld();

    let crossTenantMessage = "";
    try {
      await staffCaller("school:read").probe({
        organizationId: ORG,
        schoolId: FOREIGN_SCHOOL,
      });
    } catch (error) {
      crossTenantMessage = (error as TRPCError).message;
    }

    let nonexistentMessage = "";
    try {
      await staffCaller("school:read").probe({
        organizationId: ORG,
        schoolId: MISSING_NODE,
      });
    } catch (error) {
      nonexistentMessage = (error as TRPCError).message;
    }

    // Deliberately indistinguishable: any difference would let a caller probe
    // which ids exist in other tenants.
    expect(crossTenantMessage).toBe(nonexistentMessage);
    await expectTrpcError(
      staffCaller("school:read").probe({
        organizationId: ORG,
        schoolId: FOREIGN_SCHOOL,
      }),
      "FORBIDDEN",
      "You do not have access to this resource.",
    );
  });

  it("says Missing permission when no role holds it anywhere in the org", async () => {
    seedGrants([
      { userId: TEACHER_6, roleType: "class_teacher", scopeType: "class", scopeId: CLASS_6 },
    ]);

    await expectTrpcError(
      staffCaller("school:read", TEACHER_6).probe({ organizationId: ORG }),
      "FORBIDDEN",
      "Missing permission: school:read",
    );
  });

  it("denies an expired assignment even though the snapshot still carries it", async () => {
    seedGrants([
      {
        userId: PRINCIPAL_A,
        roleType: "principal",
        scopeType: "org",
        scopeId: ORG,
        expiresAt: new Date(Date.now() - 1000),
      },
    ], PRINCIPAL_PERMS);

    await expectTrpcError(
      staffCaller("school:read", PRINCIPAL_A).probe({ organizationId: ORG }),
      "FORBIDDEN",
      "Missing permission: school:read",
    );
  });

  it("distinguishes held-but-out-of-scope from missing", async () => {
    seedGrants([
      {
        userId: PRINCIPAL_A,
        roleType: "principal",
        scopeType: "school",
        scopeId: SCHOOL_A,
      },
    ], PRINCIPAL_PERMS);

    // She holds school:read in this org — just not at the org node she named.
    await expectTrpcError(
      staffCaller("school:read", PRINCIPAL_A).probe({ organizationId: ORG }),
      "FORBIDDEN",
      "A role you hold has school:read but not at this org.",
    );
  });
});

describe("staffProcedure — what success puts on ctx", () => {
  beforeEach(() => {
    seedGrants([
      { userId: ADMIN, roleType: "org_admin", scopeType: "org", scopeId: ORG },
    ], ORG_ADMIN_PERMS);
  });

  it("an org grant at the org node yields the org-wide scope", async () => {
    const result = await staffCaller("school:read").probe({
      organizationId: ORG,
    });

    expect(result.scope).toEqual({
      organizationId: ORG,
      schoolId: null,
      classId: null,
      sectionId: null,
    });
  });

  it("ctx.scope is the ADDRESSED node's own scope, narrower than the grant (ADR-017)", async () => {
    // The regression this pins: taking the filter from the GRANT meant an
    // org-scoped admin acting on one branch filtered queries org-wide.
    const result = await staffCaller("school:read").probe({
      organizationId: ORG,
      schoolId: SCHOOL_A,
    });

    expect(result.scope).toEqual({
      organizationId: ORG,
      schoolId: SCHOOL_A,
      classId: null,
      sectionId: null,
    });
  });
});

describe("staffProcedure — the cache seam", () => {
  const STALE_EMPTY = JSON.stringify({
    userId: ADMIN,
    assignments: [],
    orgPermissions: {},
    builtAt: 0,
  });

  it("a SENSITIVE permission bypasses a stale snapshot and re-reads Postgres", async () => {
    seedGrants([
      { userId: ADMIN, roleType: "org_admin", scopeType: "org", scopeId: ORG },
    ], ORG_ADMIN_PERMS);
    store.set(`authz:user:${ADMIN}`, STALE_EMPTY);

    // student:delete is in SENSITIVE_PERMISSIONS: the stale snapshot must
    // not decide, and the fresh read rewrites the entry for everyone else.
    await staffCaller("student:delete").probe({ organizationId: ORG });
    expect(JSON.parse(store.get(`authz:user:${ADMIN}`)!).assignments).toHaveLength(1);
  });

  it("a non-sensitive permission trusts the snapshot it is given", async () => {
    seedGrants([
      { userId: ADMIN, roleType: "org_admin", scopeType: "org", scopeId: ORG },
    ], ORG_ADMIN_PERMS);
    store.set(`authz:user:${ADMIN}`, STALE_EMPTY);

    // school:create is not sensitive: the five-minute ceiling applies, so
    // the stale empty snapshot denies even though Postgres would allow.
    await expectTrpcError(
      staffCaller("school:create").probe({ organizationId: ORG }),
      "FORBIDDEN",
      "Missing permission: school:create",
    );
  });
});

// --- addressedBy: "id" ------------------------------------------------------

describe("staffProcedure — addressedBy the resource itself", () => {
  beforeEach(() => {
    seedGrants([
      {
        userId: TEACHER_6,
        roleType: "class_teacher",
        scopeType: "class",
        scopeId: CLASS_6,
      },
      {
        userId: PRINCIPAL_A,
        roleType: "principal",
        scopeType: "school",
        scopeId: SCHOOL_A,
      },
    ], [...PRINCIPAL_PERMS, ["class_teacher", "class:read"]]);
  });

  it("authorizes against the ROW's node, not a client-claimed one (ADR-027)", async () => {
    const result = await staffCaller("class:read", TEACHER_6, {
      addressedBy: "id",
    }).probe({ organizationId: ORG, id: CLASS_6 });

    expect(result.scope?.classId).toBe(CLASS_6);
  });

  it("a sibling outside the grant reads as out-of-scope, not missing", async () => {
    await expectTrpcError(
      staffCaller("school:read", PRINCIPAL_A, { addressedBy: "id" }).probe({
        organizationId: ORG,
        id: SCHOOL_B,
      }),
      "FORBIDDEN",
      "A role you hold has school:read but not at this school.",
    );
  });

  it("a foreign-org row id stays behind the generic 403", async () => {
    await expectTrpcError(
      staffCaller("school:read", PRINCIPAL_A, { addressedBy: "id" }).probe({
        organizationId: ORG,
        id: FOREIGN_SCHOOL,
      }),
      "FORBIDDEN",
      "You do not have access to this resource.",
    );
  });
});

// --- resolveOwner + the overlap gate ---------------------------------------

describe("staffProcedure — owner-resolved entities", () => {
  // Academic years are not scope nodes; their owning node is their school.
  const yearOwner: OwnerResolver = async (_org, id) =>
    id === SCHOOL_A ? { type: "school", id: SCHOOL_A } : null;

  function yearCaller(userId: string, gate?: "cover" | "overlap") {
    return staffCaller("academic_year:read", userId, {
      resolveOwner: yearOwner,
      ...(gate ? { gate } : {}),
    });
  }

  beforeEach(() => {
    seedGrants([
      {
        userId: PRINCIPAL_A,
        roleType: "principal",
        scopeType: "school",
        scopeId: SCHOOL_A,
      },
      {
        userId: PRINCIPAL_B,
        roleType: "principal",
        scopeType: "school",
        scopeId: SCHOOL_B,
      },
      {
        userId: "user-subject",
        roleType: "subject_teacher",
        scopeType: "section",
        scopeId: SECTION_6A,
      },
    ], [
      ...PRINCIPAL_PERMS,
      ["subject_teacher", "academic_year:read"],
    ]);
  });

  it("a null owner resolves to NOT_FOUND, indistinguishable from made-up", async () => {
    await expectTrpcError(
      yearCaller(PRINCIPAL_A, "overlap").probe({
        organizationId: ORG,
        id: MISSING_NODE,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("overlap lets a grant reach INTO the owning subtree", async () => {
    const result = await yearCaller(PRINCIPAL_A, "overlap").probe({
      organizationId: ORG,
      id: SCHOOL_A,
    });

    expect(result.scope?.schoolId).toBe(SCHOOL_A);
  });

  it("holding the permission but not reaching this owner is NOT_FOUND, not 403", async () => {
    await expectTrpcError(
      yearCaller(PRINCIPAL_B, "overlap").probe({
        organizationId: ORG,
        id: SCHOOL_A,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("not holding the permission anywhere stays FORBIDDEN under overlap", async () => {
    // The subject teacher holds academic_year:read, so give the denial a
    // caller who truly lacks it: nobody here — swap the matrix out.
    dbState.rows.set(TABLE.permissions, [["librarian", "school:read"]]);

    await expectTrpcError(
      yearCaller(PRINCIPAL_A, "overlap").probe({
        organizationId: ORG,
        id: SCHOOL_A,
      }),
      "FORBIDDEN",
      "Missing permission: academic_year:read",
    );
  });

  it("the default gate stays STRICT over the resolved owner (mutations)", async () => {
    // No gate option = cover: a section-scoped grant does not COVER the
    // school node that owns the year, however much it overlaps. Reads opt
    // into overlap explicitly; mutations never do.
    await expectTrpcError(
      yearCaller("user-subject").probe({
        organizationId: ORG,
        id: SCHOOL_A,
      }),
      "FORBIDDEN",
      "A role you hold has academic_year:read but not at this school.",
    );
  });
});

// --- staffListProcedure -----------------------------------------------------

describe("staffListProcedure", () => {
  beforeEach(() => {
    seedGrants([
      {
        userId: PRINCIPAL_A,
        roleType: "principal",
        scopeType: "school",
        scopeId: SCHOOL_A,
      },
    ], PRINCIPAL_PERMS);
  });

  it("clips grants to the addressed subtree", async () => {
    // She does not COVER the org node, yet listing her own branch is exactly
    // what the school switcher needs — the permissive question.
    const result = await listCaller("school:read", PRINCIPAL_A).probe({
      organizationId: ORG,
    });

    expect(result.scopes).toHaveLength(1);
    expect(result.scopes[0]?.schoolId).toBe(SCHOOL_A);
  });

  it("a grant disjoint from the addressed node is a 403, never a wider filter", async () => {
    await expectTrpcError(
      listCaller("school:read", PRINCIPAL_A).probe({
        organizationId: ORG,
        schoolId: SCHOOL_B,
      }),
      "FORBIDDEN",
      "A role you hold has school:read but not at this school.",
    );
  });
});

// --- error translation on the non-staff tracks ------------------------------

describe("error translation on the non-staff tracks", () => {
  // A realistic infra failure: the resolver's raw exception used to reach the
  // client verbatim on these two tracks, connection string and all.
  const LEAK = "postgres://app:s3cret@db.internal:5432/mskool — connection refused";

  async function thrownMessage(procedure: typeof protectedProcedure, userId?: string) {
    const router = makeRouter({
      probe: procedure.query(async () => {
        throw new Error(LEAK);
      }),
    });
    const inner = router.createCaller({
      session: userId ? { user: { id: userId } } : { user: { id: "user-x" } },
    } as never);
    let caught: unknown;
    try {
      // Procedures without .input() have a `void` input type; call bare.
      await (inner as { probe: () => Promise<unknown> }).probe();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    return (caught as TRPCError).message;
  }

  it("a raw infra failure on /me's track degrades to generic wording", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const message = await thrownMessage(protectedProcedure);
      expect(message).toBe("Something went wrong. Please try again.");
      expect(message).not.toContain("postgres");
    } finally {
      spy.mockRestore();
    }
  });

  it("the student track degrades identically", async () => {
    dbState.rows.set(TABLE.portal, [
      { userId: "user-parent", studentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", isActive: true },
    ]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const message = await thrownMessage(studentProcedure, "user-parent");
      expect(message).toBe("Something went wrong. Please try again.");
      expect(message).not.toContain("postgres");
    } finally {
      spy.mockRestore();
    }
  });
});

// --- studentProcedure -------------------------------------------------------

describe("studentProcedure — ownership without roles", () => {
  const OWNED = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const FOREIGN_STUDENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  function studentCaller(userId: string) {
    const probe = makeRouter({
      probe: studentProcedure
        .input(z.object({ studentId: z.uuid() }))
        .query(({ ctx, input }) => {
          ctx.assertOwnsStudent(input.studentId);
          return { ids: ctx.studentIds };
        }),
    });
    return probe.createCaller({
      session: { user: { id: userId } },
    } as never);
  }

  it("403s a login with no portal access at all", async () => {
    dbState.rows.set(TABLE.portal, []);

    await expectTrpcError(
      studentCaller("user-parent").probe({ studentId: OWNED }),
      "FORBIDDEN",
      "This account has no portal access.",
    );
  });

  it("assertOwnsStudent rejects a student outside the ownership list", async () => {
    dbState.rows.set(TABLE.portal, [
      { userId: "user-parent", studentId: OWNED, isActive: true },
    ]);
    seedGrants([]); // no role_assignments needed — students never reach can()

    await expectTrpcError(
      studentCaller("user-parent").probe({ studentId: FOREIGN_STUDENT }),
      "FORBIDDEN",
      "You do not have access to this student.",
    );
  });

  it("passes an owned student through with the full list on ctx", async () => {
    dbState.rows.set(TABLE.portal, [
      { userId: "user-parent", studentId: OWNED, isActive: true },
      { userId: "user-parent", studentId: FOREIGN_STUDENT, isActive: true },
    ]);

    const result = await studentCaller("user-parent").probe({
      studentId: OWNED,
    });

    expect(result.ids).toEqual([OWNED, FOREIGN_STUDENT]);
  });

  it("the extracted pure gate refuses with the exact wording (S4.2)", () => {
    expect(() => assertStudentOwnership([OWNED], FOREIGN_STUDENT)).toThrow(
      "You do not have access to this student.",
    );
    expect(() => assertStudentOwnership([OWNED], OWNED)).not.toThrow();
  });
});

// --- resolveStudentOwner (S4.2) ----------------------------------------------

describe("resolveStudentOwner — the student B6 adapter", () => {
  const STUDENT_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  // A student of ANOTHER tenant: org-filtered, so it must be the same 404 a
  // fabricated id is.
  const FOREIGN_ORG_STUDENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const WELL_FORMED_ABSENT = "9b2f8c1a-3d4e-4f5a-8b6c-7d8e9f0a1b2c";

  function studentByIdCaller(userId: string) {
    return staffCaller("student:read", userId, {
      resolveOwner: resolveStudentOwner,
      gate: "overlap",
    });
  }

  beforeEach(() => {
    seedGrants([
      {
        userId: PRINCIPAL_A,
        roleType: "principal",
        scopeType: "school",
        scopeId: SCHOOL_A,
      },
    ], [["principal", "student:read"]]);
    dbState.rows.set(TABLE.students, [
      { id: STUDENT_A, organizationId: ORG, schoolId: SCHOOL_A },
      {
        id: FOREIGN_ORG_STUDENT,
        organizationId: "org-other",
        schoolId: FOREIGN_SCHOOL,
      },
    ]);
  });

  it("her school node is the owning branch; overlap admits the branch principal", async () => {
    const result = await studentByIdCaller(PRINCIPAL_A).probe({
      organizationId: ORG,
      id: STUDENT_A,
    });

    expect(result.scope?.schoolId).toBe(SCHOOL_A);
  });

  it("absent and cross-org ids are the SAME NOT_FOUND (S4.2's wording pin)", async () => {
    for (const id of [WELL_FORMED_ABSENT, FOREIGN_ORG_STUDENT]) {
      await expectTrpcError(
        studentByIdCaller(PRINCIPAL_A).probe({ organizationId: ORG, id }),
        "NOT_FOUND",
        "Student not found.",
      );
    }
  });
});

// --- subjectGate (S4.3 / ADR-029) --------------------------------------------

describe("staffProcedure — the subjectGate: the second fact", () => {
  const MATH = "11f0c9d5-1a2b-4c3d-8e4f-a05b6c7d8e9f";
  const PHYSICS = "22e1d8c4-2b3c-4d5e-9f6a-b16c7d8e9f0a";

  const TEACHER_S = "user-subject-teacher";

  function subjectCaller(userId: string) {
    return staffCaller("marks:create", userId, { subjectGate: true });
  }

  const staRow = (over: Record<string, any> = {}) => ({
    id: "sta-1",
    organizationId: ORG,
    userId: TEACHER_S,
    sectionId: SECTION_6A,
    subjectId: MATH,
    role: "subject_teacher",
    effectiveTo: null,
    ...over,
  });

  function seedAssigned(over?: Record<string, any>) {
    seedGrants([
      {
        userId: TEACHER_S,
        roleType: "subject_teacher",
        scopeType: "section",
        scopeId: SECTION_6A,
      },
    ], [["subject_teacher", "marks:create"]]);
    dbState.rows.set(TABLE.sta, [staRow(over)]);
  }

  it("her own (section, subject) resolves — the non-vacuity control", async () => {
    seedAssigned();

    const result = await subjectCaller(TEACHER_S).probe({
      organizationId: ORG,
      sectionId: SECTION_6A,
      subjectId: MATH,
    });

    expect(result.scope?.sectionId).toBe(SECTION_6A);
  });

  it("her OWN section, an ADJACENT subject: NOT_FOUND, generic wording", async () => {
    // THE Phase-1 leftover, pinned at the unit level: the scope tree made her
    // section-wide, and only the assignment fact narrows her to Physics. The
    // denial is indistinguishable from a made-up subject id, so probing
    // combinations reveals nothing about who teaches what where.
    seedAssigned();

    await expectTrpcError(
      subjectCaller(TEACHER_S).probe({
        organizationId: ORG,
        sectionId: SECTION_6A,
        subjectId: PHYSICS,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("an ENDED assignment is the same NOT_FOUND — the fact is open-rows-only", async () => {
    // She used to teach it; the swap must bite immediately (ADR-029's
    // no-cache reasoning), not on a five-minute TTL.
    seedAssigned({ effectiveTo: "2025-01-01" });

    await expectTrpcError(
      subjectCaller(TEACHER_S).probe({
        organizationId: ORG,
        sectionId: SECTION_6A,
        subjectId: MATH,
      }),
      "NOT_FOUND",
      "Resource not found.",
    );
  });

  it("permission first: without marks:create she is FORBIDDEN, not NOT_FOUND", async () => {
    // The shapes are ordered — the permission gate decides 403, the fact
    // decides 404. A caller who holds nothing gets the permission answer even
    // when the fact would also have refused.
    dbState.rows.set(TABLE.sta, [staRow()]);

    await expectTrpcError(
      subjectCaller(TEACHER_S).probe({
        organizationId: ORG,
        sectionId: SECTION_6A,
        subjectId: MATH,
      }),
      "FORBIDDEN",
      "Missing permission: marks:create",
    );
  });

  it("omitting the pair is a VALIDATION failure, never a silent skip", async () => {
    seedAssigned();

    await expectTrpcError(
      subjectCaller(TEACHER_S).probe({ organizationId: ORG }),
      "BAD_REQUEST",
    );
  });
});
