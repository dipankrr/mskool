import { describe, expect, it } from "vitest";
import { can, getDataScopes, permissionsInOrg } from "./can";
import type { Permission } from "./permissions";
import { ROLE_TYPES, type RoleType } from "./roles";
import { dataScopeFromNode, orgScopeNode } from "./scope";
import type {
  DataScope,
  ResourceContext,
  RoleAssignment,
  ScopeNode,
  UserAuthCache,
} from "./types";

const USER = "user-1";
const ORG = "org-1";
const OTHER_ORG = "org-2";
const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const CLASS_7 = "class-7";
const SECTION_7B = "section-7b";
const SECTION_7C = "section-7c";

const orgNode = orgScopeNode(ORG);

const schoolANode: ScopeNode = {
  id: SCHOOL_A,
  type: "school",
  organizationId: ORG,
  schoolId: null,
  classId: null,
};

const section7BNode: ScopeNode = {
  id: SECTION_7B,
  type: "section",
  organizationId: ORG,
  schoolId: SCHOOL_A,
  classId: CLASS_7,
};

function scope(over: Partial<DataScope> = {}): DataScope {
  return {
    organizationId: ORG,
    schoolId: null,
    classId: null,
    sectionId: null,
    ...over,
  };
}

/** Every role present, holding nothing, then the interesting ones overridden. */
function orgPerms(
  overrides: Partial<Record<RoleType, Permission[]>>,
): Record<RoleType, Permission[]> {
  const empty = Object.fromEntries(
    ROLE_TYPES.map((role) => [role, [] as Permission[]]),
  ) as Record<RoleType, Permission[]>;

  return { ...empty, ...overrides };
}

let nextId = 0;

function assignment(over: Partial<RoleAssignment> = {}): RoleAssignment {
  const scopeId = over.scopeId ?? ORG;
  const scopeType = over.scopeType ?? "org";

  return {
    id: `assignment-${++nextId}`,
    userId: USER,
    roleType: "org_admin",
    organizationId: ORG,
    scopeType,
    scopeId,
    expiresAt: null,
    resolvedDataScope: scope(),
    ...over,
  };
}

function cache(
  assignments: RoleAssignment[],
  perms: Partial<Record<RoleType, Permission[]>> = {
    org_admin: ["school:read", "school:update"],
  },
  organizationId = ORG,
): UserAuthCache {
  return {
    userId: USER,
    assignments,
    orgPermissions: { [organizationId]: orgPerms(perms) },
    builtAt: Date.now(),
  };
}

function ctxFor(node: ScopeNode, organizationId = ORG): ResourceContext {
  return { organizationId, nodeId: node.id, node };
}

describe("can", () => {
  it("allows an org-scoped role to act on a section deep in the tree", () => {
    const auth = cache([assignment()]);
    expect(can(auth, "school:read", ctxFor(section7BNode))).toBe(true);
  });

  it("denies a permission the role does not hold", () => {
    const auth = cache([assignment()]);
    // org_admin holds school:read and school:update in this fixture, not delete.
    expect(can(auth, "school:delete", ctxFor(section7BNode))).toBe(false);
  });

  it("denies an expired assignment", () => {
    const auth = cache([
      assignment({ expiresAt: new Date(Date.now() - 1000) }),
    ]);
    expect(can(auth, "school:read", ctxFor(orgNode))).toBe(false);
  });

  it("allows an assignment that has not expired yet", () => {
    const auth = cache([
      assignment({ expiresAt: new Date(Date.now() + 60_000) }),
    ]);
    expect(can(auth, "school:read", ctxFor(orgNode))).toBe(true);
  });

  it("denies when the org has no permission matrix cached", () => {
    const auth = cache([assignment()], undefined, OTHER_ORG);
    expect(can(auth, "school:read", ctxFor(orgNode))).toBe(false);
  });

  it("denies when the node belongs to a different org than the request", () => {
    const auth = cache([assignment()]);
    const foreignNode: ScopeNode = {
      ...section7BNode,
      organizationId: OTHER_ORG,
    };
    expect(can(auth, "school:read", ctxFor(foreignNode))).toBe(false);
  });

  it("denies a school-scoped role acting at org level", () => {
    // The strict question. A branch principal does not cover the org node —
    // this is why list endpoints need staffListProcedure instead.
    const auth = cache(
      [
        assignment({
          roleType: "principal",
          scopeType: "school",
          scopeId: SCHOOL_A,
          resolvedDataScope: scope({ schoolId: SCHOOL_A }),
        }),
      ],
      { principal: ["school:read"] },
    );

    expect(can(auth, "school:read", ctxFor(orgNode))).toBe(false);
    expect(can(auth, "school:read", ctxFor(schoolANode))).toBe(true);
  });

  it("denies a role scoped to a sibling school", () => {
    const auth = cache(
      [
        assignment({
          roleType: "principal",
          scopeType: "school",
          scopeId: SCHOOL_B,
          resolvedDataScope: scope({ schoolId: SCHOOL_B }),
        }),
      ],
      { principal: ["school:read"] },
    );

    expect(can(auth, "school:read", ctxFor(section7BNode))).toBe(false);
  });

  it("takes the union of several roles", () => {
    const auth = cache(
      [
        assignment({ roleType: "accountant" }),
        assignment({ roleType: "librarian" }),
      ],
      { accountant: ["school:read"], librarian: ["school:update"] },
    );

    expect(can(auth, "school:read", ctxFor(orgNode))).toBe(true);
    expect(can(auth, "school:update", ctxFor(orgNode))).toBe(true);
    expect(can(auth, "school:delete", ctxFor(orgNode))).toBe(false);
  });
});

describe("getDataScopes", () => {
  it("clips an org-wide request down to the granted school", () => {
    // The request addresses the whole org; the grant is one branch. The filter
    // must be the branch — this is what lets a branch principal list schools
    // without a 403.
    const auth = cache(
      [
        assignment({
          roleType: "principal",
          scopeType: "school",
          scopeId: SCHOOL_A,
          resolvedDataScope: scope({ schoolId: SCHOOL_A }),
        }),
      ],
      { principal: ["school:read"] },
    );

    expect(
      getDataScopes(auth, "school:read", dataScopeFromNode(orgNode)),
    ).toEqual([scope({ schoolId: SCHOOL_A })]);
  });

  it("narrows to the addressed node when the grant is broader", () => {
    // ADR-017. Holding all of school A but asking about section 7B must filter
    // to 7B. The old getDataScope returned the grant, i.e. the whole school.
    const auth = cache(
      [
        assignment({
          roleType: "principal",
          scopeType: "school",
          scopeId: SCHOOL_A,
          resolvedDataScope: scope({ schoolId: SCHOOL_A }),
        }),
      ],
      { principal: ["school:read"] },
    );

    expect(
      getDataScopes(auth, "school:read", dataScopeFromNode(section7BNode)),
    ).toEqual([
      scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7B }),
    ]);
  });

  it("drops grants outside the addressed subtree", () => {
    // The cross-school leak. Both grants exist; only the one inside school A
    // may reach the query, because the caller ORs whatever comes back.
    const auth = cache(
      [
        assignment({
          roleType: "class_teacher",
          scopeType: "section",
          scopeId: SECTION_7B,
          resolvedDataScope: scope({
            schoolId: SCHOOL_A,
            classId: CLASS_7,
            sectionId: SECTION_7B,
          }),
        }),
        assignment({
          roleType: "class_teacher",
          scopeType: "section",
          scopeId: SECTION_7C,
          resolvedDataScope: scope({
            schoolId: SCHOOL_B,
            sectionId: SECTION_7C,
          }),
        }),
      ],
      { class_teacher: ["school:read"] },
    );

    const scopes = getDataScopes(
      auth,
      "school:read",
      dataScopeFromNode(schoolANode),
    );

    expect(scopes).toEqual([
      scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7B }),
    ]);
  });

  it("returns every overlapping grant so the caller can OR them", () => {
    const auth = cache(
      [
        assignment({
          roleType: "class_teacher",
          scopeType: "section",
          scopeId: SECTION_7B,
          resolvedDataScope: scope({
            schoolId: SCHOOL_A,
            sectionId: SECTION_7B,
          }),
        }),
        assignment({
          roleType: "class_teacher",
          scopeType: "section",
          scopeId: SECTION_7C,
          resolvedDataScope: scope({
            schoolId: SCHOOL_A,
            sectionId: SECTION_7C,
          }),
        }),
      ],
      { class_teacher: ["school:read"] },
    );

    expect(
      getDataScopes(auth, "school:read", dataScopeFromNode(schoolANode)),
    ).toHaveLength(2);
  });

  it("returns [] when the permission is not held", () => {
    // Must be read as 403, never as "unfiltered".
    const auth = cache([assignment()], { org_admin: ["school:read"] });
    expect(
      getDataScopes(auth, "school:delete", dataScopeFromNode(orgNode)),
    ).toEqual([]);
  });

  it("returns [] for an expired grant", () => {
    const auth = cache([
      assignment({ expiresAt: new Date(Date.now() - 1000) }),
    ]);
    expect(
      getDataScopes(auth, "school:read", dataScopeFromNode(orgNode)),
    ).toEqual([]);
  });

  it("returns [] when no grant overlaps the addressed node", () => {
    const auth = cache(
      [
        assignment({
          roleType: "principal",
          scopeType: "school",
          scopeId: SCHOOL_B,
          resolvedDataScope: scope({ schoolId: SCHOOL_B }),
        }),
      ],
      { principal: ["school:read"] },
    );

    expect(
      getDataScopes(auth, "school:read", dataScopeFromNode(schoolANode)),
    ).toEqual([]);
  });
});

describe("permissionsInOrg", () => {
  it("unions the permissions of every live role", () => {
    const auth = cache(
      [
        assignment({ roleType: "accountant" }),
        assignment({ roleType: "librarian" }),
      ],
      { accountant: ["school:read"], librarian: ["school:read", "school:update"] },
    );

    expect(permissionsInOrg(auth, ORG).sort()).toEqual([
      "school:read",
      "school:update",
    ]);
  });

  it("ignores expired roles", () => {
    const auth = cache(
      [
        assignment({
          roleType: "accountant",
          expiresAt: new Date(Date.now() - 1000),
        }),
      ],
      { accountant: ["school:read"] },
    );

    expect(permissionsInOrg(auth, ORG)).toEqual([]);
  });

  it("returns [] for an org the user holds nothing in", () => {
    expect(permissionsInOrg(cache([assignment()]), OTHER_ORG)).toEqual([]);
  });
});
