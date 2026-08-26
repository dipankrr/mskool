import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cache layer (ADR-016) is everything between Redis and can(): the user
 * snapshot build, the node and portal reads, and the invalidators. The pure
 * decision functions were already covered; these tests pin the wiring around
 * them — including the self-healing path, where a corrupt entry is evicted
 * and rebuilt from Postgres instead of 500ing until its TTL expires.
 *
 * Everything is mocked at the socket boundary: ioredis becomes an in-memory
 * Map, the drizzle chain returns fixture rows keyed by table name, and ./env
 * is stubbed so importing this module needs no credentials.
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

/** table name → fixture rows; `selects` counts Postgres reads. */
const dbState = vi.hoisted(() => ({
  rows: new Map<string, Record<string, any>[]>(),
  selects: 0,
}));

vi.mock("@repo/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  // The drizzle chain is reduced to "rows for this table": every query in
  // cache.ts filters within a single table, and each test scopes its fixture.
  const from = (table: unknown) => ({
    where: async () =>
      dbState.rows.get(getTableName(table as never)) ?? [],
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

import { getTableName } from "drizzle-orm";
import {
  orgRolePermissions,
  roleAssignments,
  scopeNodes,
  studentPortalAccess,
} from "@repo/db/schema";
import {
  buildUserAuthCache,
  getOwnedStudentIds,
  getUserAuthCache,
  invalidateOrgAuthCache,
  invalidateScopeNode,
  invalidateUserAuthCache,
  loadScopeNode,
} from "./cache";

const TABLE = {
  assignments: getTableName(roleAssignments),
  permissions: getTableName(orgRolePermissions),
  nodes: getTableName(scopeNodes),
  portal: getTableName(studentPortalAccess),
};

// --- fixtures ---------------------------------------------------------------

const assignmentRow = (over: Record<string, any> = {}) => ({
  id: "ra-1",
  userId: "user-1",
  roleType: "class_teacher",
  organizationId: "org-1",
  scopeType: "org",
  scopeId: "org-1",
  expiresAt: null,
  revokedAt: null,
  ...over,
});

const nodeRow = (over: Record<string, any> = {}) => ({
  id: "school-1",
  type: "school",
  organizationId: "org-1",
  schoolId: null,
  classId: null,
  ...over,
});

const NODE_JSON = JSON.stringify({
  id: "school-1",
  type: "school",
  organizationId: "org-1",
  schoolId: null,
  classId: null,
});

const USER_KEY = "authz:user:user-1";
const NODE_KEY = "authz:node:school-1";
const PORTAL_KEY = "authz:portal:user-1";

beforeEach(() => {
  store.clear();
  dbState.rows.clear();
  dbState.selects = 0;
  vi.clearAllMocks();
});

// --- buildUserAuthCache -----------------------------------------------------

describe("buildUserAuthCache", () => {
  it("keeps a merely-expired assignment — expiry is checked per request, not at build", async () => {
    // The revokedAt IS NULL filter lives in the SQL query and is pinned by
    // the integration suite; here the fixture is what that query returns.
    dbState.rows.set(TABLE.assignments, [
      assignmentRow({ id: "ra-live", roleType: "class_teacher" }),
      assignmentRow({
        id: "ra-expired",
        roleType: "librarian",
        // Deliberately NOT filtered here — checked against the live clock
        // on every request, so a cache entry cannot outlive a grant that
        // lapses inside its TTL.
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ]);

    const cache = await buildUserAuthCache("user-1");

    expect(cache.assignments.map((a) => a.id)).toEqual([
      "ra-live",
      "ra-expired",
    ]);
  });

  it("skips an assignment whose scope node does not exist (hard rule 12 drift)", async () => {
    dbState.rows.set(TABLE.assignments, [
      assignmentRow({ scopeType: "school", scopeId: "school-gone" }),
    ]);

    const cache = await buildUserAuthCache("user-1");

    // Skipped, not granted an unresolvable scope — and with no surviving
    // assignment, no org permission matrix is loaded at all.
    expect(cache.assignments).toEqual([]);
    expect(cache.orgPermissions).toEqual({});
  });

  it("resolves each assignment's DataScope from its node", async () => {
    dbState.rows.set(TABLE.assignments, [
      assignmentRow({ scopeType: "school", scopeId: "school-1" }),
    ]);
    dbState.rows.set(TABLE.nodes, [nodeRow()]);

    const cache = await buildUserAuthCache("user-1");

    expect(cache.assignments[0]?.resolvedDataScope).toEqual({
      organizationId: "org-1",
      schoolId: "school-1",
      classId: null,
      sectionId: null,
    });
  });

  it("loads the permission matrix for every org with an assignment", async () => {
    // The eq(organizationId) filter lives in the SQL query; the JS logic
    // under test is WHICH orgs get a matrix at all — the orgs that survived
    // assignment resolution, and no others.
    dbState.rows.set(TABLE.assignments, [
      assignmentRow({ id: "ra-a", organizationId: "org-1" }),
      assignmentRow({ id: "ra-b", organizationId: "org-2", roleType: "principal" }),
    ]);
    dbState.rows.set(TABLE.permissions, [
      { organizationId: "org-1", roleType: "class_teacher", permission: "school:read" },
      { organizationId: "org-2", roleType: "principal", permission: "class:read" },
    ]);

    const cache = await buildUserAuthCache("user-1");

    expect(Object.keys(cache.orgPermissions)).toEqual(["org-1", "org-2"]);
    expect(cache.orgPermissions["org-1"]?.class_teacher).toEqual([
      "school:read",
    ]);
  });
});

// --- getUserAuthCache -------------------------------------------------------

describe("getUserAuthCache", () => {
  it("serves a cache hit without touching Postgres, reviving Dates", async () => {
    store.set(
      USER_KEY,
      JSON.stringify({
        userId: "user-1",
        assignments: [
          {
            id: "ra-cached",
            userId: "user-1",
            roleType: "principal",
            organizationId: "org-1",
            scopeType: "org",
            scopeId: "org-1",
            expiresAt: "2027-01-01T00:00:00.000Z",
            resolvedDataScope: {
              organizationId: "org-1",
              schoolId: null,
              classId: null,
              sectionId: null,
            },
          },
        ],
        orgPermissions: {},
        builtAt: 0,
      }),
    );

    const cache = await getUserAuthCache("user-1");

    expect(cache.assignments[0]?.expiresAt).toBeInstanceOf(Date);
    expect(dbState.selects).toBe(0);
  });

  it("skipCache re-reads Postgres and rewrites the entry", async () => {
    store.set(
      USER_KEY,
      JSON.stringify({ userId: "user-1", assignments: [], orgPermissions: {}, builtAt: 0 }),
    );
    dbState.rows.set(TABLE.assignments, [assignmentRow({ id: "ra-fresh" })]);

    const cache = await getUserAuthCache("user-1", { skipCache: true });

    expect(cache.assignments.map((a) => a.id)).toEqual(["ra-fresh"]);
    // Sensitive-permission reads must not leave the stale snapshot in place
    // for the next non-sensitive caller.
    expect(mocks.set).toHaveBeenCalled();
    expect(JSON.parse(store.get(USER_KEY)!).assignments).toHaveLength(1);
  });

  it("evicts a corrupt entry and rebuilds from Postgres", async () => {
    store.set(USER_KEY, "{not json");
    dbState.rows.set(TABLE.assignments, [assignmentRow({ id: "ra-rebuilt" })]);

    const cache = await getUserAuthCache("user-1");

    expect(cache.assignments.map((a) => a.id)).toEqual(["ra-rebuilt"]);
    expect(mocks.del).toHaveBeenCalledWith(USER_KEY);
    expect(JSON.parse(store.get(USER_KEY)!).assignments).toHaveLength(1);
  });
});

// --- loadScopeNode ----------------------------------------------------------

describe("loadScopeNode", () => {
  it("answers the org's own id with a synthetic node, no I/O", async () => {
    const node = await loadScopeNode("org-1", "org-1");

    expect(node).toEqual({
      id: "org-1",
      type: "org",
      organizationId: "org-1",
      schoolId: null,
      classId: null,
    });
    expect(dbState.selects).toBe(0);
  });

  it("returns a cached node for its own org and null for a foreign org", async () => {
    store.set(NODE_KEY, NODE_JSON);

    expect((await loadScopeNode("school-1", "org-1"))?.id).toBe("school-1");
    expect(await loadScopeNode("school-1", "org-2")).toBeNull();
    // Both answers came from the cache; the org check is per-read.
    expect(dbState.selects).toBe(0);
  });

  it("reads through to Postgres on a miss; a cross-tenant row is still a miss for this org", async () => {
    dbState.rows.set(TABLE.nodes, [nodeRow()]);

    // The row is cached even though THIS org may not see it — it is a valid
    // node entry; organization is checked on every read against it.
    expect(await loadScopeNode("school-1", "org-2")).toBeNull();
    expect(store.has(NODE_KEY)).toBe(true);

    expect((await loadScopeNode("school-1", "org-1"))?.id).toBe("school-1");
    expect(dbState.selects).toBe(1);
  });

  it("returns null on a database miss and caches nothing", async () => {
    expect(await loadScopeNode("school-404", "org-1")).toBeNull();
    expect(store.has("authz:node:school-404")).toBe(false);
  });

  it("evicts a corrupt node entry and falls through to Postgres", async () => {
    store.set(NODE_KEY, '"school-1"');
    dbState.rows.set(TABLE.nodes, [nodeRow()]);

    const node = await loadScopeNode("school-1", "org-1");

    expect(node?.id).toBe("school-1");
    expect(mocks.del).toHaveBeenCalledWith(NODE_KEY);
    expect(dbState.selects).toBe(1);
  });
});

// --- getOwnedStudentIds -----------------------------------------------------

describe("getOwnedStudentIds", () => {
  it("maps the active access rows to student ids", async () => {
    // isActive = true lives in the SQL query and is pinned by the
    // integration suite; the fixture is what that query returns.
    dbState.rows.set(TABLE.portal, [
      { userId: "user-1", studentId: "stu-1", isActive: true },
      { userId: "user-1", studentId: "stu-2", isActive: true },
    ]);

    expect(await getOwnedStudentIds("user-1")).toEqual(["stu-1", "stu-2"]);
  });

  it("caches after the first read", async () => {
    dbState.rows.set(TABLE.portal, [
      { userId: "user-1", studentId: "stu-active", isActive: true },
    ]);

    await getOwnedStudentIds("user-1");
    expect(store.has(PORTAL_KEY)).toBe(true);

    await getOwnedStudentIds("user-1");
    expect(dbState.selects).toBe(1);
  });

  it("evicts a corrupt portal entry and rebuilds", async () => {
    store.set(PORTAL_KEY, "null");
    dbState.rows.set(TABLE.portal, [
      { userId: "user-1", studentId: "stu-active", isActive: true },
    ]);

    expect(await getOwnedStudentIds("user-1")).toEqual(["stu-active"]);
    expect(mocks.del).toHaveBeenCalledWith(PORTAL_KEY);
  });
});

// --- invalidators -----------------------------------------------------------

describe("cache invalidators", () => {
  it("invalidateUserAuthCache drops both the user and portal keys", async () => {
    store.set(USER_KEY, "{}");
    store.set(PORTAL_KEY, "[]");

    await invalidateUserAuthCache("user-1");

    // One DEL with both keys, not one round-trip each.
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del.mock.calls[0]).toEqual([USER_KEY, PORTAL_KEY]);
  });

  it("invalidateOrgAuthCache drops the user key of every role-holder in the org", async () => {
    dbState.rows.set(TABLE.assignments, [
      { userId: "user-111" },
      { userId: "user-222" },
    ]);

    await invalidateOrgAuthCache("org-1");

    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del.mock.calls[0]).toEqual([
      "authz:user:user-111",
      "authz:user:user-222",
    ]);
  });

  it("invalidateScopeNode drops exactly that node's key", async () => {
    await invalidateScopeNode("node-9");

    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del).toHaveBeenCalledWith("authz:node:node-9");
  });
});
