import { and, eq, or, type Column, type SQL } from "drizzle-orm";
import type { DataScope, RoleAssignment, ScopeNode } from "./types";

/**
 * Does this assignment's scope cover the requested node?
 *
 * One switch, one comparison per level — the whole point of storing ancestry
 * denormalised on scope_nodes. No recursive CTE, no parent-chain walk.
 *
 *   org      covers everything in that organization
 *   school   covers every class and section under that school
 *   class    covers every section of that class
 *   section  covers only that section
 *
 * Note the direction: this answers "is the node at or below the assignment?".
 * It is deliberately false for a section-scoped assignment against the org
 * node — a section teacher does not "cover" the organization. List endpoints
 * ask the opposite question and use intersectScopes() instead.
 */
export function scopeCovers(
  assignment: Pick<RoleAssignment, "organizationId" | "scopeType" | "scopeId">,
  node: ScopeNode,
): boolean {
  // Cross-tenant guard. Belt and braces: loadScopeNode already checked, but
  // this function is the one every permission decision funnels through.
  if (node.organizationId !== assignment.organizationId) return false;

  switch (assignment.scopeType) {
    case "org":
      return node.organizationId === assignment.scopeId;
    case "school":
      // For a school node, `id` IS the schoolId; deeper nodes carry schoolId.
      return (
        (node.type === "school" ? node.id : node.schoolId) === assignment.scopeId
      );
    case "class":
      return (
        (node.type === "class" ? node.id : node.classId) === assignment.scopeId
      );
    case "section":
      return node.type === "section" && node.id === assignment.scopeId;
  }
}

/**
 * Expiry is evaluated on every check rather than by a cleanup job, so a
 * time-boxed delegation stops working the moment it lapses even if nothing has
 * run to tidy the row.
 */
export function isAssignmentExpired(
  assignment: Pick<RoleAssignment, "expiresAt">,
  now = new Date(),
): boolean {
  return assignment.expiresAt !== null && assignment.expiresAt <= now;
}

/** Turns a scope node into the DataScope a service filters queries by. */
export function dataScopeFromNode(node: ScopeNode): DataScope {
  switch (node.type) {
    case "org":
      return {
        organizationId: node.organizationId,
        schoolId: null,
        classId: null,
        sectionId: null,
      };
    case "school":
      return {
        organizationId: node.organizationId,
        schoolId: node.id,
        classId: null,
        sectionId: null,
      };
    case "class":
      return {
        organizationId: node.organizationId,
        schoolId: node.schoolId,
        classId: node.id,
        sectionId: null,
      };
    case "section":
      return {
        organizationId: node.organizationId,
        schoolId: node.schoolId,
        classId: node.classId,
        sectionId: node.id,
      };
  }
}

/** A synthetic org-root node. Org scope has no scope_nodes row to load. */
export function orgScopeNode(organizationId: string): ScopeNode {
  return {
    id: organizationId,
    type: "org",
    organizationId,
    schoolId: null,
    classId: null,
  };
}

/**
 * The overlap between the subtree a request addressed and a subtree the user
 * was granted. Returns null when the two are disjoint.
 *
 * This is the LIST counterpart to scopeCovers(). A request naming a school and
 * a teacher granted one section inside it do not "cover" each other in either
 * direction, but their overlap is exactly that section — which is what the
 * teacher should see when they open a school-wide list.
 *
 *   requested { school: A }   granted { school: A, class: 9, section: 9A }  → 9A
 *   requested { school: A }   granted { school: B, section: 8B }            → null
 *   requested { org }         granted { school: A }                         → A
 *
 * Intersecting before building SQL is what makes a cross-school leak
 * structurally impossible: a grant in school B cannot survive intersection
 * with a request addressed at school A, so it never reaches the OR.
 */
export function intersectScopes(
  requested: DataScope,
  granted: DataScope,
): DataScope | null {
  if (requested.organizationId !== granted.organizationId) return null;

  // At each level: if both sides restrict and disagree, the subtrees are
  // disjoint. Otherwise the surviving restriction is whichever is non-null —
  // that is the deeper, narrower one.
  const schoolId = narrowest(requested.schoolId, granted.schoolId);
  if (schoolId === DISJOINT) return null;

  const classId = narrowest(requested.classId, granted.classId);
  if (classId === DISJOINT) return null;

  const sectionId = narrowest(requested.sectionId, granted.sectionId);
  if (sectionId === DISJOINT) return null;

  return {
    organizationId: requested.organizationId,
    schoolId,
    classId,
    sectionId,
  };
}

const DISJOINT = Symbol("disjoint");

function narrowest(
  a: string | null,
  b: string | null,
): string | null | typeof DISJOINT {
  if (a !== null && b !== null && a !== b) return DISJOINT;
  return a ?? b;
}

/**
 * The columns a table uses to express each scope level.
 *
 * Passed explicitly rather than inferred from property names, because the
 * mapping is not always the obvious one. On `schools` the school level is the
 * table's OWN primary key:
 *
 *   scopeWhere(scopes, {
 *     organizationId: schools.organizationId,
 *     schoolId: schools.id,          // a school IS its id
 *   })
 *
 * Guessing that by name is what produced the original bug: `schools` has no
 * column literally called `schoolId`, so the school restriction was quietly
 * dropped and a branch-scoped principal listed every school in the trust.
 */
export interface ScopeColumns {
  organizationId: Column;
  schoolId?: Column;
  classId?: Column;
  sectionId?: Column;
}

/**
 * Turns one or more DataScopes into a WHERE condition — the tenancy filter
 * hard rule 1 is about.
 *
 *   .where(and(scopeWhere(ctx.scopes, cols), eq(t.isActive, true)))
 *
 * Several scopes are ORed: a teacher holding 3A and 5B must see both, and no
 * single scope can say that.
 *
 * THROWS when a scope restricts a level the table cannot express. That case
 * used to be skipped silently, which turned "you may see one section" into
 * "you may see the whole organization" — the failure was invisible precisely
 * when it mattered most. If you hit this, the table needs a join to reach the
 * level, not a weaker filter.
 */
export function scopeWhere(
  scopes: DataScope | DataScope[],
  columns: ScopeColumns,
): SQL {
  const list = Array.isArray(scopes) ? scopes : [scopes];

  // No scopes means no access. Returning undefined here would drop the WHERE
  // clause entirely and return the table — the caller must 403 instead.
  if (list.length === 0) {
    throw new Error(
      "scopeWhere: no scopes supplied. A caller with no granting scope must be rejected before it reaches a query.",
    );
  }

  const conditions = list.map((scope) => scopeCondition(scope, columns));

  // or() is only undefined for an empty list, which is excluded above.
  return conditions.length === 1 ? conditions[0]! : or(...conditions)!;
}

function scopeCondition(scope: DataScope, columns: ScopeColumns): SQL {
  const parts: SQL[] = [eq(columns.organizationId, scope.organizationId)];

  parts.push(...level("schoolId", scope.schoolId, columns.schoolId));
  parts.push(...level("classId", scope.classId, columns.classId));
  parts.push(...level("sectionId", scope.sectionId, columns.sectionId));

  return parts.length === 1 ? parts[0]! : and(...parts)!;
}

function level(
  name: keyof ScopeColumns,
  value: string | null,
  column: Column | undefined,
): SQL[] {
  // Not restricted at this level: the user covers everything below, so the
  // absence of a column is fine.
  if (value === null) return [];

  if (!column) {
    throw new Error(
      `scopeWhere: scope restricts ${name} but no ${name} column was given. ` +
        `Filtering without it would widen access beyond the caller's scope. ` +
        `Map the column explicitly, or join to a table that has it.`,
    );
  }

  return [eq(column, value)];
}
