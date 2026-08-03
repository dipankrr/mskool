import type { Permission } from '../types/permissions';
import { scopeCovers, isAssignmentExpired } from './scope';
import type { UserAuthCache, ResourceContext, DataScope } from './types';

// ── can ──────────────────────────────────────────────────────────────────────
// Pure, synchronous, in-memory. Zero I/O.
// Called by the policy layer on every request.
//
// For each of the user's assignments:
//   1. Correct org?
//   2. Not expired?
//   3. Does the assignment's scope cover the requested resource node?
//   4. Does this role type have the requested permission in this org?
// First assignment that passes all four = allowed.
export function can(
  cache:      UserAuthCache,
  permission: Permission,
  ctx:        ResourceContext
): boolean {
  const orgPerms = cache.orgPermissions[ctx.orgId];
  if (!orgPerms) return false;

  // Cross-tenant guard: the requested node must belong to the org in the request.
  // resolveCtx() already does this check, but defence-in-depth.
  if (ctx.node.orgId !== ctx.orgId) return false;

  const now = new Date();

  for (const assignment of cache.assignments) {
    if (assignment.orgId !== ctx.orgId) continue;
    if (isAssignmentExpired(assignment, now)) continue;
    if (!scopeCovers(assignment, ctx.node)) continue;
    if (orgPerms.get(assignment.roleType)?.has(permission)) return true;
  }

  return false;
}

// ── getDataScope ─────────────────────────────────────────────────────────────
// The "which records can this user touch?" answer for single-resource requests.
// Returns the DataScope of the FIRST matching assignment.
// Route handlers use buildScopeWhere(scope, table) to convert this to WHERE conditions.
//
// The resolvedDataScope was pre-computed at cache-build time (from the scope_node
// for the assignment's scope_id), so this function is zero I/O.
export function getDataScope(
  cache:      UserAuthCache,
  permission: Permission,
  ctx:        ResourceContext
): DataScope | null {
  const orgPerms = cache.orgPermissions[ctx.orgId];
  if (!orgPerms) return null;
  if (ctx.node.orgId !== ctx.orgId) return null;

  const now = new Date();

  for (const assignment of cache.assignments) {
    if (assignment.orgId !== ctx.orgId) continue;
    if (isAssignmentExpired(assignment, now)) continue;
    if (!scopeCovers(assignment, ctx.node)) continue;
    if (!orgPerms.get(assignment.roleType)?.has(permission)) continue;
    return assignment.resolvedDataScope;
  }

  return null;
}

// ── getDataScopes ─────────────────────────────────────────────────────────────
// For LIST endpoints where a user may have multiple non-overlapping assignments.
// E.g. subject teacher assigned to Class 3A AND Class 5B = two assignments.
// Returns all matching DataScopes; route handler ORs them in the query.
//
// ctx here is orgId-only (we're listing, not looking at one specific resource).
export function getDataScopes(
  cache:      UserAuthCache,
  permission: Permission,
  orgId:      string
): DataScope[] {
  const orgPerms = cache.orgPermissions[orgId];
  if (!orgPerms) return [];

  const now    = new Date();
  const scopes: DataScope[] = [];

  for (const assignment of cache.assignments) {
    if (assignment.orgId !== orgId) continue;
    if (isAssignmentExpired(assignment, now)) continue;
    if (!orgPerms.get(assignment.roleType)?.has(permission)) continue;
    scopes.push(assignment.resolvedDataScope);
  }

  return scopes;
}
