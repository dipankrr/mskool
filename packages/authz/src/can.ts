import type { Permission } from "./permissions";
import type { RoleType } from "./roles";
import { isAssignmentExpired, scopeCovers } from "./scope";
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
 * The DataScope for a single-resource request — "which rows may this user
 * touch?" Returns the scope of the first assignment that grants the
 * permission, or null if none does.
 *
 * Services take the result as a required argument and filter on it, so a
 * missing tenancy filter cannot compile (hard rule 1).
 */
export function getDataScope(
  cache: UserAuthCache,
  permission: Permission,
  ctx: ResourceContext,
): DataScope | null {
  const orgPerms = cache.orgPermissions[ctx.organizationId];
  if (!orgPerms) return null;
  if (ctx.node.organizationId !== ctx.organizationId) return null;

  const now = new Date();

  for (const assignment of cache.assignments) {
    if (assignment.organizationId !== ctx.organizationId) continue;
    if (isAssignmentExpired(assignment, now)) continue;
    if (!scopeCovers(assignment, ctx.node)) continue;
    if (!roleHas(orgPerms, assignment.roleType, permission)) continue;
    return assignment.resolvedDataScope;
  }

  return null;
}

/**
 * All DataScopes granting the permission in an org, for LIST endpoints.
 *
 * A subject teacher may hold non-overlapping assignments — 3A and 5B — which
 * no single DataScope can express. The caller ORs these together, otherwise
 * the teacher would see only whichever section happened to be matched first.
 *
 * No node here: we are listing, not addressing one resource.
 */
export function getDataScopes(
  cache: UserAuthCache,
  permission: Permission,
  organizationId: string,
): DataScope[] {
  const orgPerms = cache.orgPermissions[organizationId];
  if (!orgPerms) return [];

  const now = new Date();
  const scopes: DataScope[] = [];

  for (const assignment of cache.assignments) {
    if (assignment.organizationId !== organizationId) continue;
    if (isAssignmentExpired(assignment, now)) continue;
    if (!roleHas(orgPerms, assignment.roleType, permission)) continue;
    scopes.push(assignment.resolvedDataScope);
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
