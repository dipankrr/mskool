import type { Permission } from "./permissions";
import type { RoleType } from "./roles";
import { intersectScopes, isAssignmentExpired, scopeCovers } from "./scope";
import type { DataScope, ResourceContext, UserAuthCache } from "./types";

/**
 * The permission check. Pure, synchronous, zero I/O — everything it needs was
 * loaded into the cache before the request reached it. That matters because
 * this runs on every single staff request.
 *
 * An assignment grants the permission when all four hold:
 *   1. it belongs to the org being addressed
 *   2. it has not expired
 *   3. its scope covers the requested node
 *   4. its role type holds the permission in that org
 *
 * The first assignment satisfying all four wins. A user with several roles
 * gets the union of what those roles allow.
 *
 * This is the STRICT question — "may you act on this node?" — and it is the
 * one to ask before a mutation. A section teacher does not cover the org node,
 * so asking it at org level correctly says no. List endpoints want the other
 * question; see getDataScopes().
 */
export function can(
  cache: UserAuthCache,
  permission: Permission,
  ctx: ResourceContext,
): boolean {
  const orgPerms = cache.orgPermissions[ctx.organizationId];
  if (!orgPerms) return false;

  // Cross-tenant guard: the node must belong to the org in the request.
  if (ctx.node.organizationId !== ctx.organizationId) return false;

  const now = new Date();

  for (const assignment of cache.assignments) {
    if (assignment.organizationId !== ctx.organizationId) continue;
    if (isAssignmentExpired(assignment, now)) continue;
    if (!scopeCovers(assignment, ctx.node)) continue;
    if (roleHas(orgPerms, assignment.roleType, permission)) return true;
  }

  return false;
}

/**
 * Every subtree this user may see for a permission, clipped to the subtree the
 * request addressed. The caller ORs them into one WHERE clause via
 * scopeWhere().
 *
 * The clipping is the point. A teacher holding 3A in one school and 5B in
 * another opens a school-scoped list: only the grant inside that school
 * survives intersectScopes(), so the other cannot reach the query. Returning
 * raw grants — as this function used to — leaked rows across schools the
 * moment the caller ORed them together.
 *
 * Returns [] when nothing overlaps, which the caller must treat as 403. It is
 * never safe to read that as "no restriction".
 *
 * Note there is no separate getDataScope() for single-resource reads. Once
 * can() has approved a node, the filter is simply that node's own scope
 * (dataScopeFromNode) — deriving it from the matching assignment instead
 * returned the assignment's whole subtree, so asking about one section
 * answered with the entire class.
 */
export function getDataScopes(
  cache: UserAuthCache,
  permission: Permission,
  requested: DataScope,
): DataScope[] {
  const orgPerms = cache.orgPermissions[requested.organizationId];
  if (!orgPerms) return [];

  const now = new Date();
  const scopes: DataScope[] = [];

  for (const assignment of cache.assignments) {
    if (assignment.organizationId !== requested.organizationId) continue;
    if (isAssignmentExpired(assignment, now)) continue;
    if (!roleHas(orgPerms, assignment.roleType, permission)) continue;

    const overlap = intersectScopes(requested, assignment.resolvedDataScope);
    if (overlap) scopes.push(overlap);
  }

  return scopes;
}

/** Every permission the user holds in an org. For "what can I see" UI calls. */
export function permissionsInOrg(
  cache: UserAuthCache,
  organizationId: string,
): Permission[] {
  const orgPerms = cache.orgPermissions[organizationId];
  if (!orgPerms) return [];

  const now = new Date();
  const held = new Set<Permission>();

  for (const assignment of cache.assignments) {
    if (assignment.organizationId !== organizationId) continue;
    if (isAssignmentExpired(assignment, now)) continue;
    for (const p of orgPerms[assignment.roleType] ?? []) held.add(p);
  }

  return [...held];
}

function roleHas(
  orgPerms: Record<RoleType, Permission[]>,
  roleType: RoleType,
  permission: Permission,
): boolean {
  return orgPerms[roleType]?.includes(permission) ?? false;
}
