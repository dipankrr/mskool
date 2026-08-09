import type { SQL } from "drizzle-orm";
import { PgDialect, pgTable, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  dataScopeFromNode,
  intersectScopes,
  isAssignmentExpired,
  orgScopeNode,
  scopeCovers,
  scopeWhere,
  type ScopeColumns,
} from "./scope";
import type { DataScope, RoleAssignment, ScopeNode } from "./types";

/**
 * Everything here is pure: plain objects in, booleans or SQL out. No database,
 * no Redis, no mocks. That is deliberate — the scope maths is the part of authz
 * where a mistake silently widens access, so it must be the cheapest part to
 * test exhaustively.
 */

const ORG = "org-1";
const OTHER_ORG = "org-2";
const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const CLASS_7 = "class-7";
const CLASS_9 = "class-9";
const SECTION_7B = "section-7b";
const SECTION_7C = "section-7c";

const orgNode = orgScopeNode(ORG);

const schoolNode: ScopeNode = {
  id: SCHOOL_A,
  type: "school",
  organizationId: ORG,
  // For a school node its own id IS the school id, so this stays null.
  schoolId: null,
  classId: null,
};

const classNode: ScopeNode = {
  id: CLASS_7,
  type: "class",
  organizationId: ORG,
  schoolId: SCHOOL_A,
  classId: null,
};

const sectionNode: ScopeNode = {
  id: SECTION_7B,
  type: "section",
  organizationId: ORG,
  schoolId: SCHOOL_A,
  classId: CLASS_7,
};

type Assignment = Pick<
  RoleAssignment,
  "organizationId" | "scopeType" | "scopeId"
>;

const atOrg: Assignment = {
  organizationId: ORG,
  scopeType: "org",
  scopeId: ORG,
};
const atSchoolA: Assignment = {
  organizationId: ORG,
  scopeType: "school",
  scopeId: SCHOOL_A,
};
const atClass7: Assignment = {
  organizationId: ORG,
  scopeType: "class",
  scopeId: CLASS_7,
};
const atSection7B: Assignment = {
  organizationId: ORG,
  scopeType: "section",
  scopeId: SECTION_7B,
};

describe("scopeCovers", () => {
  /**
   * The full truth table. Written out rather than generated, because the whole
   * value of this test is that someone reading it can check each row against
   * what they believe the rule is.
   */
  const cases: Array<[string, Assignment, ScopeNode, boolean]> = [
    // An org grant reaches everything in the org.
    ["org grant → org node", atOrg, orgNode, true],
    ["org grant → school node", atOrg, schoolNode, true],
    ["org grant → class node", atOrg, classNode, true],
    ["org grant → section node", atOrg, sectionNode, true],

    // A school grant reaches down, never up.
    ["school grant → org node", atSchoolA, orgNode, false],
    ["school grant → own school node", atSchoolA, schoolNode, true],
    ["school grant → class in that school", atSchoolA, classNode, true],
    ["school grant → section in that school", atSchoolA, sectionNode, true],

    // A class grant reaches its sections only.
    ["class grant → school node", atClass7, schoolNode, false],
    ["class grant → own class node", atClass7, classNode, true],
    ["class grant → section in that class", atClass7, sectionNode, true],

    // A section grant reaches exactly one node.
    ["section grant → class node", atSection7B, classNode, false],
    ["section grant → own section node", atSection7B, sectionNode, true],
  ];

  for (const [name, assignment, node, expected] of cases) {
    it(`${expected ? "covers" : "does not cover"}: ${name}`, () => {
      expect(scopeCovers(assignment, node)).toBe(expected);
    });
  }

  it("does not cover a node in another organization", () => {
    const foreignNode: ScopeNode = { ...sectionNode, organizationId: OTHER_ORG };
    expect(scopeCovers(atOrg, foreignNode)).toBe(false);
  });

  it("does not cover a sibling school's section", () => {
    const siblingSection: ScopeNode = { ...sectionNode, schoolId: SCHOOL_B };
    expect(scopeCovers(atSchoolA, siblingSection)).toBe(false);
  });

  it("does not cover a sibling class's section", () => {
    const siblingSection: ScopeNode = { ...sectionNode, classId: CLASS_9 };
    expect(scopeCovers(atClass7, siblingSection)).toBe(false);
  });
});

describe("isAssignmentExpired", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("treats a null expiry as permanent", () => {
    expect(isAssignmentExpired({ expiresAt: null }, now)).toBe(false);
  });

  it("is expired at the exact expiry instant", () => {
    // Boundary is inclusive: at expiresAt the grant is already gone.
    expect(isAssignmentExpired({ expiresAt: now }, now)).toBe(true);
  });

  it("is live before expiry and dead after", () => {
    const later = new Date("2026-06-02T00:00:00Z");
    const earlier = new Date("2026-05-31T00:00:00Z");
    expect(isAssignmentExpired({ expiresAt: later }, now)).toBe(false);
    expect(isAssignmentExpired({ expiresAt: earlier }, now)).toBe(true);
  });
});

describe("dataScopeFromNode", () => {
  it("leaves everything below the org unrestricted", () => {
    expect(dataScopeFromNode(orgNode)).toEqual({
      organizationId: ORG,
      schoolId: null,
      classId: null,
      sectionId: null,
    });
  });

  it("reads a school node's own id as the school restriction", () => {
    expect(dataScopeFromNode(schoolNode)).toEqual({
      organizationId: ORG,
      schoolId: SCHOOL_A,
      classId: null,
      sectionId: null,
    });
  });

  it("fills the full ancestry for a section node", () => {
    expect(dataScopeFromNode(sectionNode)).toEqual({
      organizationId: ORG,
      schoolId: SCHOOL_A,
      classId: CLASS_7,
      sectionId: SECTION_7B,
    });
  });
});

describe("intersectScopes", () => {
  const scope = (
    over: Partial<DataScope> = {},
  ): DataScope => ({
    organizationId: ORG,
    schoolId: null,
    classId: null,
    sectionId: null,
    ...over,
  });

  it("returns null across organizations", () => {
    expect(
      intersectScopes(scope(), scope({ organizationId: OTHER_ORG })),
    ).toBeNull();
  });

  it("narrows an org-wide request to the granted school", () => {
    expect(intersectScopes(scope(), scope({ schoolId: SCHOOL_A }))).toEqual(
      scope({ schoolId: SCHOOL_A }),
    );
  });

  it("keeps the deeper grant when the request is broader", () => {
    // Asking about a whole school while holding one section: the answer is
    // that section, not the school.
    expect(
      intersectScopes(
        scope({ schoolId: SCHOOL_A }),
        scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7B }),
      ),
    ).toEqual(
      scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7B }),
    );
  });

  it("narrows to the request when the grant is broader", () => {
    // This is the ADR-017 fix: asking about section 7B while holding all of
    // school A answers with 7B alone, not the whole school.
    expect(
      intersectScopes(
        scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7B }),
        scope({ schoolId: SCHOOL_A }),
      ),
    ).toEqual(
      scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7B }),
    );
  });

  it("returns null for a grant in a sibling school", () => {
    // The cross-school leak, pinned. A grant in school B must not survive a
    // request addressed at school A.
    expect(
      intersectScopes(
        scope({ schoolId: SCHOOL_A }),
        scope({ schoolId: SCHOOL_B, sectionId: SECTION_7C }),
      ),
    ).toBeNull();
  });

  it("returns null for disjoint sections of the same class", () => {
    expect(
      intersectScopes(
        scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7B }),
        scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7C }),
      ),
    ).toBeNull();
  });
});

/**
 * `schools` deliberately has no schoolId column — a school IS its id. This
 * mirrors the real table closely enough to pin the leak it caused.
 */
const schoolsTable = pgTable("schools", {
  id: uuid().primaryKey(),
  organizationId: uuid().notNull(),
});

/** A typical operational table, which does carry every level as a column. */
const enrollmentsTable = pgTable("enrollments", {
  id: uuid().primaryKey(),
  organizationId: uuid().notNull(),
  schoolId: uuid().notNull(),
  classId: uuid(),
  sectionId: uuid(),
});

const SCHOOL_COLUMNS: ScopeColumns = {
  organizationId: schoolsTable.organizationId,
  schoolId: schoolsTable.id,
};

const ENROLLMENT_COLUMNS: ScopeColumns = {
  organizationId: enrollmentsTable.organizationId,
  schoolId: enrollmentsTable.schoolId,
  classId: enrollmentsTable.classId,
  sectionId: enrollmentsTable.sectionId,
};

// Mirrors drizzle.config.ts. Without it the compiled SQL comes out camelCase
// and would not match what actually runs against Postgres.
const dialect = new PgDialect({ casing: "snake_case" });

/**
 * Compares against compiled SQL rather than snapshotting the SQL object, so the
 * assertions survive Drizzle's internals changing.
 */

function compile(condition: SQL) {
  const query = dialect.sqlToQuery(condition);
  return { text: query.sql, params: query.params };
}

describe("scopeWhere", () => {
  const scope = (over: Partial<DataScope> = {}): DataScope => ({
    organizationId: ORG,
    schoolId: null,
    classId: null,
    sectionId: null,
    ...over,
  });

  it("emits the school predicate against the table's own id", () => {
    // THE REGRESSION. `schools` has no column named schoolId, so name-matching
    // dropped this filter and every school in the trust came back.
    const { text, params } = compile(
      scopeWhere(scope({ schoolId: SCHOOL_A }), SCHOOL_COLUMNS),
    );

    expect(params).toEqual([ORG, SCHOOL_A]);
    expect(text).toContain('"organization_id"');
    expect(text).toContain('"id"');
  });

  it("filters on the organization alone when nothing narrower is set", () => {
    const { params } = compile(scopeWhere(scope(), SCHOOL_COLUMNS));
    expect(params).toEqual([ORG]);
  });

  it("accepts a bare scope as well as an array", () => {
    const one = compile(scopeWhere(scope({ schoolId: SCHOOL_A }), SCHOOL_COLUMNS));
    const asArray = compile(
      scopeWhere([scope({ schoolId: SCHOOL_A })], SCHOOL_COLUMNS),
    );
    expect(asArray).toEqual(one);
  });

  it("ORs several scopes together", () => {
    // A teacher holding two sections in different classes must see both, and
    // no single DataScope can express that.
    const { text, params } = compile(
      scopeWhere(
        [
          scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7B }),
          scope({ schoolId: SCHOOL_B, classId: CLASS_9 }),
        ],
        ENROLLMENT_COLUMNS,
      ),
    );

    expect(text).toContain(" or ");
    expect(params).toEqual([
      ORG,
      SCHOOL_A,
      CLASS_7,
      SECTION_7B,
      ORG,
      SCHOOL_B,
      CLASS_9,
    ]);
  });

  it("throws on an empty scope list rather than returning everything", () => {
    // No grants must mean no access. Returning undefined here would drop the
    // WHERE clause and hand back the whole table.
    expect(() => scopeWhere([], SCHOOL_COLUMNS)).toThrow(/no scopes/i);
  });

  it("throws when the table cannot express a restricted level", () => {
    // A class-level scope against `schools`: previously skipped in silence,
    // which widened the result to the entire organization.
    expect(() =>
      scopeWhere(scope({ schoolId: SCHOOL_A, classId: CLASS_7 }), SCHOOL_COLUMNS),
    ).toThrow(/classId/);
  });

  it("names the missing level in the error", () => {
    expect(() =>
      scopeWhere(
        scope({ schoolId: SCHOOL_A, classId: CLASS_7, sectionId: SECTION_7B }),
        { organizationId: enrollmentsTable.organizationId, schoolId: enrollmentsTable.schoolId, classId: enrollmentsTable.classId },
      ),
    ).toThrow(/sectionId/);
  });
});
