import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The adversarial layer. The existing suites pin FIXED cases — truth tables,
 * hand-built caches, named attack patterns. This suite asks a different
 * question: do the fail-closed properties hold across THOUSANDS of generated
 * combinations, including ones nobody thought of?
 *
 * The randomness is seeded, so a failure here reproduces exactly on every
 * run and in CI — this is property-based testing without a framework
 * dependency, in the same spirit as scope.test.ts's generated truth tables,
 * just with the inputs randomized instead of enumerated.
 *
 * Redis and Postgres are mocked at the socket boundary (same harness as
 * cache.test.ts); only the poisoning sweep touches them.
 */

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

vi.mock("./env", () => ({ env: { REDIS_URL: "redis://test:6379" } }));

const dbState = vi.hoisted(() => ({ rows: new Map<string, Record<string, any>[]>() }));

vi.mock("@repo/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => dbState.rows.get(getTableName(table as never)) ?? [],
        }),
      }),
      selectDistinct: () => ({
        from: (table: unknown) => ({
          where: async () => dbState.rows.get(getTableName(table as never)) ?? [],
        }),
      }),
    },
  };
});

import { getTableName } from "drizzle-orm";
import { orgRolePermissions, roleAssignments, scopeNodes } from "@repo/db/schema";
import { can, permissionsInOrg } from "./can";
import { getUserAuthCache } from "./cache";
import { ALL_PERMISSIONS, type Permission } from "./permissions";
import { ROLE_TYPES, type RoleType } from "./roles";
import {
  dataScopeFromNode,
  intersectScopes,
  isAssignmentExpired,
  orgScopeNode,
  scopeCovers,
} from "./scope";
import type { DataScope, RoleAssignment, ScopeNode, UserAuthCache } from "./types";

// --- deterministic randomness -------------------------------------------------

/** mulberry32 — tiny, seedable, good enough to generate test worlds. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rand() * arr.length)]!;
const uid = (rand: () => number, prefix: string) =>
  `${prefix}-${Math.floor(rand() * 1e12).toString(36)}`;

/**
 * A full role→permission matrix in which exactly one role holds `perms` —
 * org_role_permissions rows exist for every role a fixture mentions, and the
 * cache's type demands all eight keys.
 */
function matrixFor(role: RoleType, perms: Permission[]): Record<RoleType, Permission[]> {
  const matrix = Object.fromEntries(ROLE_TYPES.map((r) => [r, []])) as unknown as Record<
    RoleType,
    Permission[]
  >;
  matrix[role] = perms;
  return matrix;
}

const SCOPE_TYPES = ["org", "school", "class", "section"] as const;

/** Ancestry-coherent node, per the shapes ADR-019's CHECK constraints allow. */
function coherentNode(rand: () => number, organizationId = uid(rand, "org")): ScopeNode {
  const type = pick(rand, SCOPE_TYPES);
  switch (type) {
    case "org":
      return { id: organizationId, type, organizationId, schoolId: null, classId: null };
    case "school": {
      const schoolId = uid(rand, "sch");
      return { id: schoolId, type, organizationId, schoolId: null, classId: null };
    }
    case "class": {
      const schoolId = uid(rand, "sch");
      const classId = uid(rand, "cls");
      return { id: classId, type, organizationId, schoolId, classId: null };
    }
    case "section": {
      const schoolId = uid(rand, "sch");
      const classId = uid(rand, "cls");
      const sectionId = uid(rand, "sec");
      return { id: sectionId, type, organizationId, schoolId, classId };
    }
  }
}

/** Sometimes coherent, sometimes deliberately incoherent (mixed ancestry). */
function anyScope(rand: () => number): DataScope {
  const base = dataScopeFromNode(coherentNode(rand));
  if (rand() < 0.3) {
    // Incoherent: a classId from one family under a schoolId from another.
    return { ...base, classId: rand() < 0.5 ? uid(rand, "other-cls") : null };
  }
  return base;
}

function assignmentCovering(
  node: ScopeNode,
  over: Partial<Pick<RoleAssignment, "roleType" | "expiresAt">> = {},
): Pick<RoleAssignment, "organizationId" | "scopeType" | "scopeId" | "roleType" | "expiresAt"> {
  return {
    organizationId: node.organizationId,
    scopeType: node.type === "org" ? "org" : node.type,
    scopeId: node.type === "org" ? node.organizationId : node.id,
    roleType: "class_teacher",
    expiresAt: null,
    ...over,
  };
}

// --- scopeCovers --------------------------------------------------------------

describe("scopeCovers — generated invariants", () => {
  it("NEVER covers a node in another organization (1000 random pairs)", () => {
    const rand = makeRng(101);
    for (let i = 0; i < 1000; i++) {
      const grant = assignmentCovering(coherentNode(rand));
      const node = coherentNode(rand);
      if (node.organizationId !== grant.organizationId) {
        expect(scopeCovers(grant, node), JSON.stringify({ grant, node })).toBe(false);
      }
    }
  });

  it("a grant always covers the very node it was derived from (1000 nodes)", () => {
    const rand = makeRng(102);
    for (let i = 0; i < 1000; i++) {
      const node = coherentNode(rand);
      expect(scopeCovers(assignmentCovering(node), node)).toBe(true);
    }
  });

  it("org grants reach every same-org node; section grants reach only themselves", () => {
    const rand = makeRng(103);
    for (let i = 0; i < 1000; i++) {
      const org = uid(rand, "org");
      const node = coherentNode(rand, org);

      const orgGrant = {
        organizationId: org,
        scopeType: "org",
        scopeId: org,
        expiresAt: null,
      } as const;
      expect(scopeCovers(orgGrant, node)).toBe(true);

      const sectionGrant = {
        organizationId: org,
        scopeType: "section",
        scopeId: uid(rand, "sec"),
        expiresAt: null,
      } as const;
      expect(scopeCovers(sectionGrant, node)).toBe(
        node.type === "section" && node.id === sectionGrant.scopeId,
      );
    }
  });
});

// --- intersectScopes -----------------------------------------------------------

describe("intersectScopes — generated invariants", () => {
  it("cross-org requests are ALWAYS disjoint (1000 pairs)", () => {
    const rand = makeRng(201);
    for (let i = 0; i < 1000; i++) {
      const a = dataScopeFromNode(coherentNode(rand));
      const b = dataScopeFromNode(coherentNode(rand));
      if (a.organizationId !== b.organizationId) {
        expect(intersectScopes(a, b), JSON.stringify({ a, b })).toBeNull();
        expect(intersectScopes(b, a)).toBeNull();
      }
    }
  });

  it("is symmetric (1000 same-org pairs)", () => {
    const rand = makeRng(202);
    for (let i = 0; i < 1000; i++) {
      const org = uid(rand, "org");
      const a = dataScopeFromNode(coherentNode(rand, org));
      const b = dataScopeFromNode(coherentNode(rand, org));
      expect(intersectScopes(a, b)).toEqual(intersectScopes(b, a));
    }
  });

  it("never widens: every surviving level comes from one of the two inputs", () => {
    const rand = makeRng(203);
    const levels = ["organizationId", "schoolId", "classId", "sectionId"] as const;
    for (let i = 0; i < 1000; i++) {
      const org = uid(rand, "org");
      const a = dataScopeFromNode(coherentNode(rand, org));
      const b = dataScopeFromNode(coherentNode(rand, org));
      const result = intersectScopes(a, b);
      if (!result) continue;
      for (const level of levels) {
        expect([a[level], b[level], null]).toContain(result[level]);
      }
    }
  });

  it("an org-wide request intersects to EXACTLY the narrower grant", () => {
    const rand = makeRng(204);
    for (let i = 0; i < 1000; i++) {
      const org = uid(rand, "org");
      const grant = dataScopeFromNode(coherentNode(rand, org));
      expect(intersectScopes(dataScopeFromNode(orgScopeNode(org)), grant)).toEqual(grant);
    }
  });
});

// --- dataScopeFromNode -----------------------------------------------------------

describe("dataScopeFromNode — generated invariants", () => {
  it("always carries the node's own organization and round-trips through intersection", () => {
    const rand = makeRng(301);
    for (let i = 0; i < 1000; i++) {
      const node = coherentNode(rand);
      const scope = dataScopeFromNode(node);
      expect(scope.organizationId).toBe(node.organizationId);
      expect(intersectScopes(scope, scope)).toEqual(scope);
    }
  });

  it("the ancestry levels match the node's type, whatever the node looks like", () => {
    const rand = makeRng(302);
    for (let i = 0; i < 1000; i++) {
      const node = coherentNode(rand);
      const scope = dataScopeFromNode(node);
      if (node.type === "school") {
        expect(scope.schoolId).toBe(node.id);
        expect(scope.classId).toBeNull();
        expect(scope.sectionId).toBeNull();
      }
      if (node.type === "class") {
        expect(scope.classId).toBe(node.id);
        expect(scope.sectionId).toBeNull();
      }
      if (node.type === "section") {
        expect(scope.sectionId).toBe(node.id);
        expect(scope.classId).toBe(node.classId);
      }
    }
  });
});

// --- expiry -----------------------------------------------------------------------

describe("isAssignmentExpired — boundary sweep", () => {
  it("the exact instant counts as expired; anything after does not", () => {
    const rand = makeRng(401);
    const now = new Date();
    for (let i = 0; i < 500; i++) {
      const offsets = [-86_400_000 * rand(), -1, 0, 1, 86_400_000 * rand()];
      for (const offset of offsets) {
        const assignment = { expiresAt: new Date(now.getTime() + offset) };
        expect(isAssignmentExpired(assignment, now)).toBe(offset <= 0);
      }
    }
  });

  it("a permanent assignment (null) never expires at any clock reading", () => {
    const rand = makeRng(402);
    const assignment = { expiresAt: null };
    for (let i = 0; i < 200; i++) {
      const when = new Date(Date.now() + (rand() - 0.5) * 1e12);
      expect(isAssignmentExpired(assignment, when)).toBe(false);
    }
  });
});

// --- can() — adversarial mutation sweep --------------------------------------------

describe("can — adversarial mutation sweep", () => {
  /**
   * Each iteration builds a configuration where the answer is KNOWN (true),
   * then applies exactly ONE hostile mutation whose effect is also known.
   * If any single mutation ever fails to deny, the sweep names it.
   */
  it("every single defect denies; only the intact configuration allows", () => {
    const rand = makeRng(501);

    function buildWorld(node: ScopeNode, permission: Permission) {
      const grant = assignmentCovering(node);
      const assignment = {
        id: uid(rand, "ra"),
        userId: "user-u",
        ...grant,
      } as RoleAssignment;
      const cache: UserAuthCache = {
        userId: "user-u",
        assignments: [assignment],
        orgPermissions: { [node.organizationId]: matrixFor("class_teacher", [permission]) },
        builtAt: 0,
      };
      return { cache, resourceCtx: { organizationId: node.organizationId, nodeId: node.id, node } };
    }

    for (let i = 0; i < 400; i++) {
      const node = coherentNode(rand);
      const permission = pick(rand, ALL_PERMISSIONS);
      const { cache, resourceCtx } = buildWorld(node, permission);

      // Control: intact world allows.
      expect(can(cache, permission, resourceCtx)).toBe(true);

      // Mutation 1 — permission held by the WRONG ROLE only.
      const wrongRole: UserAuthCache = {
        ...cache,
        orgPermissions: {
          [node.organizationId]: {
            ...matrixFor("class_teacher", []),
            accountant: [permission],
          },
        },
      };
      expect(can(wrongRole, permission, resourceCtx)).toBe(false);

      // Mutation 2 — matrix exists but carries GARBAGE strings alongside.
      const garbage: UserAuthCache = {
        ...cache,
        orgPermissions: {
          [node.organizationId]: matrixFor("class_teacher", [
            "school:raed" as Permission,
            "" as Permission,
            permission,
          ]),
        },
      };
      expect(can(garbage, permission, resourceCtx)).toBe(true);
      const stripped: UserAuthCache = {
        ...cache,
        orgPermissions: { [node.organizationId]: matrixFor("class_teacher", []) },
      };
      expect(can(stripped, permission, resourceCtx)).toBe(false);

      // Mutation 3 — the grant lapses before the request.
      const expired: UserAuthCache = {
        ...cache,
        assignments: [
          { ...cache.assignments[0]!, expiresAt: new Date(Date.now() - 1) },
        ],
      };
      expect(can(expired, permission, resourceCtx)).toBe(false);

      // Mutation 4 — the matrix is keyed under a DIFFERENT org than the node.
      const foreignMatrix: UserAuthCache = {
        ...cache,
        orgPermissions: { [uid(rand, "other-org")]: matrixFor("class_teacher", [permission]) },
      };
      expect(can(foreignMatrix, permission, resourceCtx)).toBe(false);
    }

    // Mutation 5 needs both sides pinned to the SAME iteration's world:
    const rand2 = makeRng(502);
    for (let i = 0; i < 400; i++) {
      const node = coherentNode(rand2);
      const permission = pick(rand2, ALL_PERMISSIONS);
      const { cache, resourceCtx } = buildWorldLocal(node, permission);
      const invader = coherentNode(rand2, uid(rand2, "elsewhere-org"));
      expect(
        can(cache, permission, {
          organizationId: invader.organizationId,
          nodeId: invader.id,
          node: invader,
        }),
      ).toBe(false);
    }

    function buildWorldLocal(node: ScopeNode, permission: Permission) {
      const grant = assignmentCovering(node);
      const cache: UserAuthCache = {
        userId: "user-u",
        assignments: [{ id: uid(rand2, "ra"), userId: "user-u", ...grant } as RoleAssignment],
        orgPermissions: { [node.organizationId]: matrixFor("class_teacher", [permission]) },
        builtAt: 0,
      };
      return { cache, resourceCtx: { organizationId: node.organizationId, nodeId: node.id, node } };
    }

    // And permissionsInOrg agrees with what can() consumed: the union is the
    // exact permission set of the org's matrix for the roles actually held.
    const rand3 = makeRng(503);
    for (let i = 0; i < 200; i++) {
      const node = coherentNode(rand3);
      const perms = [
        pick(rand3, ALL_PERMISSIONS),
        pick(rand3, ALL_PERMISSIONS),
      ] as Permission[];
      const cache: UserAuthCache = {
        userId: "user-u",
        assignments: [
          {
            id: uid(rand3, "ra"),
            userId: "user-u",
            organizationId: node.organizationId,
            scopeType: node.type === "org" ? "org" : node.type,
            scopeId: node.type === "org" ? node.organizationId : node.id,
            roleType: "class_teacher",
            expiresAt: null,
          } as RoleAssignment,
        ],
        orgPermissions: { [node.organizationId]: matrixFor("class_teacher", perms) },
        builtAt: 0,
      };
      expect(new Set(permissionsInOrg(cache, node.organizationId))).toEqual(new Set(perms));
    }
  });
});

// --- poisoned-cache sweep ---------------------------------------------------------

describe("poisoned cache entries — self-healing sweep", () => {
  const USER_KEY = "authz:user:u";

  beforeEach(() => {
    store.clear();
    dbState.rows.clear();
    vi.clearAllMocks();
    dbState.rows.set(getTableName(roleAssignments), [
      {
        id: "ra-1",
        userId: "u",
        roleType: "class_teacher",
        organizationId: "org-1",
        scopeType: "org",
        scopeId: "org-1",
        expiresAt: null,
        revokedAt: null,
      },
    ]);
    dbState.rows.set(getTableName(orgRolePermissions), [
      { organizationId: "org-1", roleType: "class_teacher", permission: "student:read" },
    ]);
  });

  it("every malformed shape is evicted and rebuilt, never thrown (14 shapes)", async () => {
    const poisons = [
      "",
      "null",
      "undefined",
      "{",
      "}",
      "[]",
      '"just a string"',
      "42",
      "{}",
      '{"assignments":{}}',
      '{"assignments":null}',
      '{"assignments":"many"}',
      '{"assignments":[null]}',
      '{"assignments":[{"id":1}]}',
    ];

    for (const poison of poisons) {
      store.set(USER_KEY, poison);
      const snapshot = await getUserAuthCache("u");
      // Rebuilt from Postgres, correct, and the cache now holds a good copy.
      expect(snapshot.assignments.map((a) => a.roleType), `poison: ${JSON.stringify(poison)}`).toEqual([
        "class_teacher",
      ]);
      expect(JSON.parse(store.get(USER_KEY)!).assignments).toHaveLength(1);
      expect(mocks.del).toHaveBeenCalledWith(USER_KEY);
      mocks.del.mockClear();
    }
  });

  it("a well-formed snapshot is served as-is, untouched", async () => {
    const good = {
      userId: "u",
      assignments: [],
      orgPermissions: {},
      builtAt: 1,
    };
    store.set(USER_KEY, JSON.stringify(good));

    const snapshot = await getUserAuthCache("u");

    expect(snapshot.assignments).toEqual([]);
    expect(dbState.rows.get(getTableName(scopeNodes))).toBeUndefined();
  });
});
