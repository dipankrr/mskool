import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { getRedis } from '../db/redis';
import { roleAssignments, orgRolePermissions, users } from '../db/schema';
import type { Permission } from '../types/permissions';
import type { RoleType } from '../types/roles';
import type { UserAuthCache, RoleAssignment, ScopeNode } from './types';
import { dataScopeFromNode, loadScopeNode } from './scope';

const CACHE_TTL = 5 * 60; // 5 minutes

function cacheKey(userId: string) { return `authz:v2:user:${userId}`; }

// ── buildAuthCache ────────────────────────────────────────────────────────────
//
// The only function that queries the DB for authorization data.
// Runs at: login, cache miss (Redis expired), or after explicit invalidation.
//
// Complexity comparison vs the previous system:
//   Old: load org_roles → build parent map → call expandPermissions() → walk chain
//   New: load org_role_permissions directly → no chain to walk, fixed role types
//
// Because role types are fixed (no parentRoleId chains), building the cache is
// two queries per org: one for assignments (already loaded), one for permissions.
// No recursive expansion needed.
export async function buildAuthCache(userId: string): Promise<UserAuthCache> {
  // 1. Load the user's auth version (for sensitive-route staleness checks)
  const [userRow] = await db
    .select({ authVersion: users.authVersion })
    .from(users)
    .where(eq(users.id, userId));

  const authVersion = userRow?.authVersion ?? 1;

  // 2. Load all role assignments for this user
  const assignmentRows = await db
    .select()
    .from(roleAssignments)
    .where(eq(roleAssignments.userId, userId));

  // 3. Resolve scope nodes for each assignment (Redis-cached, 24h TTL)
  //    This bakes the DataScope into each assignment so getDataScope() is zero I/O.
  const resolvedAssignments: RoleAssignment[] = await Promise.all(
    assignmentRows.map(async (row) => {
      let scopeNode: ScopeNode;

      if (row.scopeType === 'org') {
        // Synthetic org node — no DB lookup
        scopeNode = { id: row.scopeId, type: 'org', orgId: row.orgId, schoolId: null, classId: null };
      } else {
        scopeNode = await loadScopeNode(row.scopeId, row.orgId);
      }

      return {
        id:                row.id,
        userId:            row.userId,
        roleType:          row.roleType as RoleType,
        orgId:             row.orgId,
        scopeType:         row.scopeType,
        scopeId:           row.scopeId,
        expiresAt:         row.expiresAt,
        resolvedDataScope: dataScopeFromNode(scopeNode),
      };
    })
  );

  // 4. Load permissions for each org this user is assigned to
  const distinctOrgIds = [...new Set(resolvedAssignments.map(a => a.orgId))];
  const orgPermissions: UserAuthCache['orgPermissions'] = {};

  for (const orgId of distinctOrgIds) {
    const permRows = await db
      .select()
      .from(orgRolePermissions)
      .where(eq(orgRolePermissions.orgId, orgId));

    const permsMap = new Map<RoleType, Set<Permission>>();
    for (const row of permRows) {
      const roleType = row.roleType as RoleType;
      if (!permsMap.has(roleType)) permsMap.set(roleType, new Set());
      permsMap.get(roleType)!.add(row.permission as Permission);
    }
    orgPermissions[orgId] = permsMap;
  }

  return { userId, authVersion, assignments: resolvedAssignments, orgPermissions, builtAt: Date.now() };
}

// ── Serialization ─────────────────────────────────────────────────────────────
// Map<RoleType, Set<Permission>> doesn't survive JSON.stringify.
function serialize(cache: UserAuthCache): string {
  const orgPermPlain: Record<string, [string, string[]][]> = {};
  for (const [orgId, roleMap] of Object.entries(cache.orgPermissions)) {
    orgPermPlain[orgId] = [...roleMap.entries()].map(([rt, perms]) => [rt, [...perms]]);
  }
  return JSON.stringify({ ...cache, orgPermissions: orgPermPlain });
}

function deserialize(raw: string): UserAuthCache {
  const parsed = JSON.parse(raw);
  const orgPermissions: UserAuthCache['orgPermissions'] = {};

  for (const [orgId, entries] of Object.entries(parsed.orgPermissions as Record<string, [string, string[]][]>)) {
    orgPermissions[orgId] = new Map(
      entries.map(([rt, perms]) => [rt as RoleType, new Set(perms as Permission[])])
    );
  }

  return {
    ...parsed,
    orgPermissions,
    assignments: (parsed.assignments as RoleAssignment[]).map(a => ({
      ...a,
      expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
    })),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getOrBuildAuthCache(userId: string): Promise<UserAuthCache> {
  const redis = getRedis();
  const cached = await redis.get(cacheKey(userId));
  if (cached) return deserialize(cached);
  const fresh = await buildAuthCache(userId);
  await redis.set(cacheKey(userId), serialize(fresh), 'EX', CACHE_TTL);
  return fresh;
}

export async function setAuthCache(userId: string, cache: UserAuthCache): Promise<void> {
  await getRedis().set(cacheKey(userId), serialize(cache), 'EX', CACHE_TTL);
}

// ── invalidateAuthCache ───────────────────────────────────────────────────────
// Call when a specific user's role_assignments change.
// Also bumps auth_version so sensitive routes detect the change even within
// a 5-minute cache window.
export async function invalidateAuthCache(userId: string): Promise<void> {
  await Promise.all([
    getRedis().del(cacheKey(userId)),
    db.update(users)
      .set({ authVersion: sql`auth_version + 1` })
      .where(eq(users.id, userId)),
  ]);
}

// Call when org_role_permissions change — affects ALL users in that org.
export async function invalidateOrgCache(orgId: string): Promise<void> {
  const rows = await db
    .select({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .where(eq(roleAssignments.orgId, orgId));

  const userIds = [...new Set(rows.map(r => r.userId))];
  if (!userIds.length) return;

  await Promise.all([
    getRedis().del(userIds.map(cacheKey)),
    db.update(users)
      .set({ authVersion: sql`auth_version + 1` })
      .where(sql`id = ANY(ARRAY[${sql.join(userIds.map(id => sql`${id}::uuid`), sql`, `)}])`),
  ]);
}

// ── checkAndRefreshCache ──────────────────────────────────────────────────────
// Used by sensitive routes (fee:approve, role_assignment:assign, etc.).
// Compares the cached auth_version against the DB value.
// If they differ (someone changed permissions mid-session), rebuilds the cache.
// Returns the authoritative (possibly refreshed) cache.
export async function checkAndRefreshCache(cache: UserAuthCache): Promise<UserAuthCache> {
  const [row] = await db
    .select({ authVersion: users.authVersion })
    .from(users)
    .where(eq(users.id, cache.userId));

  if (!row || row.authVersion === cache.authVersion) return cache;

  // Version mismatch — permissions changed since this cache was built. Rebuild.
  const fresh = await buildAuthCache(cache.userId);
  await setAuthCache(cache.userId, fresh);
  return fresh;
}
