import { and, eq, type SQL } from "drizzle-orm";
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
 */
export function scopeCovers(
  assignment: Pick<RoleAssignment, "organizationId" | "scopeType" | "scopeId">,
  node: ScopeNode,
): boolean {
  // Cross-tenant guard. Belt and braces: resolveScopeNode already checked, but
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
 * Turns a DataScope into Drizzle conditions for a table with any of
 * organizationId / schoolId / classId / sectionId.
 *
 * Call it as: `.where(scopeWhere(scope, table))`
 *
 * A null level adds no condition — the user covers everything there. Skipping
 * this on a query is the classic tenancy leak (hard rule 1), which is why
 * services accept DataScope as a required argument.
 */
export function scopeWhere(
  scope: DataScope, //should it also accept a RoleAssignment instead of DataScope? because we can get the scope from the assignment
  // shouldnt it also acccept DataScopes 
  table: {
    organizationId: unknown;
    schoolId?: unknown;
    classId?: unknown;
    sectionId?: unknown;
  },
): SQL | undefined {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const conditions: SQL[] = [
    eq(table.organizationId as any, scope.organizationId),
  ];

  if (scope.schoolId && table.schoolId) {
    conditions.push(eq(table.schoolId as any, scope.schoolId));
  }
  if (scope.classId && table.classId) {
    conditions.push(eq(table.classId as any, scope.classId));
  }
  if (scope.sectionId && table.sectionId) {
    conditions.push(eq(table.sectionId as any, scope.sectionId));
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return and(...conditions);
}
