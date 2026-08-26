import { db } from "@repo/db";
import {
  orgRolePermissions,
  roleAssignments,
  scopeNodes,
  studentPortalAccess,
} from "@repo/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import Redis from "ioredis";
import { env } from "./env";
import type { Permission } from "./permissions";
import type { RoleType } from "./roles";
import { dataScopeFromNode, orgScopeNode } from "./scope";
import type {
  DataScope,
  RoleAssignment,
  ScopeNode,
  UserAuthCache,
} from "./types";

/**
 * Authorization data changes rarely but is read on every request, so it is
 * cached. Five minutes is the deliberate ceiling on how long a revoked role can
 * still work; anything more sensitive than that is listed in
 * SENSITIVE_PERMISSIONS and bypasses the cache. Role changes also invalidate
 * explicitly, so five minutes is the failure mode, not the normal path.
 */
const AUTH_CACHE_TTL_SECONDS = 5 * 60;
/** School structure changes a few times a year. */
const NODE_CACHE_TTL_SECONDS = 60 * 60 * 24;

let redis: Redis | null = null;

/** Lazy so that importing this module does not open a socket. */
export function getRedis(): Redis {
  redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  return redis;
}

const userCacheKey = (userId: string) => `authz:user:${userId}`;
const nodeCacheKey = (nodeId: string) => `authz:node:${nodeId}`;
const portalCacheKey = (userId: string) => `authz:portal:${userId}`;

/**
 * A corrupt cache entry must not take its readers down with it. An
 * unvalidated JSON.parse turns one bad entry into a 500 on every request
 * that touches it, for as long as the TTL has left to run — and nothing
 * ever repairs it. Instead the entry is evicted and the caller reads
 * through to Postgres, which re-caches a good copy on the way back: the
 * damage is one cold read, not an outage.
 *
 * The revive callback is responsible for shape: it parses, and throws on
 * anything that is not what the caller expects. Null means "not cached";
 * a corrupt value never escapes as data.
 */
async function readCacheJson<T>(
  key: string,
  revive: (raw: string) => T,
): Promise<T | null> {
  const cached = await getRedis().get(key);
  if (cached === null) return null;

  try {
    return revive(cached);
  } catch {
    await getRedis().del(key);
    return null;
  }
}

/**
 * Loads a user's assignments and their org permission sets, resolving each
 * assignment's DataScope as it goes so that can() stays pure.
 *
 * Only non-revoked assignments are loaded. Expiry is NOT filtered here — it is
 * checked per request against the current clock, so a cache entry cannot
 * outlive an assignment that lapses inside its TTL.
 */
export async function buildUserAuthCache(
  userId: string,
): Promise<UserAuthCache> {
  const assignmentRows = await db
    .select()
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        isNull(roleAssignments.revokedAt),
      ),
    );

  const assignments: RoleAssignment[] = [];

  for (const row of assignmentRows) {
    const scope = await resolveAssignmentScope(
      row.organizationId,
      row.scopeType,
      row.scopeId,
    );
    // A scope pointing at a node that does not exist means hard rule 12 was
    // broken somewhere. Skip it rather than granting an unresolvable scope.
    if (!scope) continue;

    assignments.push({
      id: row.id,
      userId: row.userId,
      roleType: row.roleType,
      organizationId: row.organizationId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      expiresAt: row.expiresAt,
      resolvedDataScope: scope,
    });
  }

  // Only the orgs this user actually holds a role in.
  const orgIds = [...new Set(assignments.map((a) => a.organizationId))];
  const orgPermissions: Record<string, Record<RoleType, Permission[]>> = {};

  for (const orgId of orgIds) {
    const permRows = await db
      .select()
      .from(orgRolePermissions)
      .where(eq(orgRolePermissions.organizationId, orgId));

    const byRole = {} as Record<RoleType, Permission[]>;
    for (const row of permRows) {
      (byRole[row.roleType] ??= []).push(row.permission as Permission);
    }
    orgPermissions[orgId] = byRole;
  }

  return { userId, assignments, orgPermissions, builtAt: Date.now() };
}

/** Cache-first read. Pass skipCache for SENSITIVE_PERMISSIONS. */
export async function getUserAuthCache(
  userId: string,
  options: { skipCache?: boolean } = {},
): Promise<UserAuthCache> {
  const key = userCacheKey(userId);

  if (!options.skipCache) {
    const cached = await readCacheJson(key, reviveUserAuthCache);
    if (cached) return cached;
  }

  const built = await buildUserAuthCache(userId);
  await getRedis().set(
    key,
    JSON.stringify(built),
    "EX",
    AUTH_CACHE_TTL_SECONDS,
  );
  return built;
}

/**
 * MUST be called in the same transaction-adjacent flow as any change to
 * role_assignments or org_role_permissions. Without it, a revoked role keeps
 * working for up to the TTL.
 */
export async function invalidateUserAuthCache(userId: string): Promise<void> {
  await getRedis().del(userCacheKey(userId), portalCacheKey(userId));
}

/**
 * Call after editing an org's permission matrix. Every user in that org holds a
 * now-stale snapshot, and there is no index from org back to cached users, so
 * this scans the keyspace. Rare operation; correctness over elegance.
 */
export async function invalidateOrgAuthCache(
  organizationId: string,
): Promise<void> {
  const rows = await db
    .selectDistinct({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .where(eq(roleAssignments.organizationId, organizationId));

  if (rows.length === 0) return;
  await getRedis().del(...rows.map((r) => userCacheKey(r.userId)));
}

/** Drops a node from cache after a rename or a re-parent. */
export async function invalidateScopeNode(nodeId: string): Promise<void> {
  await getRedis().del(nodeCacheKey(nodeId));
}

/** Shape guard for the node cache — anything not shaped like a node is corrupt. */
function reviveScopeNode(raw: string): ScopeNode {
  const node = JSON.parse(raw) as ScopeNode | null;
  if (
    !node ||
    typeof node.id !== "string" ||
    typeof node.organizationId !== "string"
  ) {
    throw new Error("Corrupt scope-node cache entry.");
  }
  return node;
}

/**
 * Loads a scope node, verifying it belongs to the expected org. Returns null on
 * a miss or a cross-tenant mismatch — callers turn that into a 403 without
 * distinguishing the two, so the response cannot be used to probe whether an
 * id exists in another tenant.
 */
export async function loadScopeNode(
  nodeId: string,
  expectedOrganizationId: string,
): Promise<ScopeNode | null> {
  if (nodeId === expectedOrganizationId) {
    return orgScopeNode(expectedOrganizationId);
  }

  const cached = await readCacheJson(nodeCacheKey(nodeId), reviveScopeNode);
  if (cached) {
    return cached.organizationId === expectedOrganizationId ? cached : null;
  }

  const [row] = await db
    .select()
    .from(scopeNodes)
    .where(eq(scopeNodes.id, nodeId));

  if (!row) return null;

  const node: ScopeNode = {
    id: row.id,
    type: row.type,
    organizationId: row.organizationId,
    schoolId: row.schoolId,
    classId: row.classId,
  };

  await getRedis().set(
    nodeCacheKey(nodeId),
    JSON.stringify(node),
    "EX",
    NODE_CACHE_TTL_SECONDS,
  );

  return node.organizationId === expectedOrganizationId ? node : null;
}

/**
 * The student track (ADR-005): which students this login may act for. No roles,
 * no permissions — just ownership. Cached with the same TTL as staff auth.
 */
/** Shape guard for the portal-ownership cache. */
function reviveStudentIds(raw: string): string[] {
  const ids: unknown = JSON.parse(raw);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new Error("Corrupt portal cache entry.");
  }
  return ids as string[];
}

export async function getOwnedStudentIds(userId: string): Promise<string[]> {
  const key = portalCacheKey(userId);
  const cached = await readCacheJson(key, reviveStudentIds);
  if (cached) return cached;

  const rows = await db
    .select({ studentId: studentPortalAccess.studentId })
    .from(studentPortalAccess)
    .where(
      and(
        eq(studentPortalAccess.userId, userId),
        eq(studentPortalAccess.isActive, true),
      ),
    );

  const ids = rows.map((r) => r.studentId);
  await getRedis().set(
    key,
    JSON.stringify(ids),
    "EX",
    AUTH_CACHE_TTL_SECONDS,
  );
  return ids;
}

async function resolveAssignmentScope(
  organizationId: string,
  scopeType: string,
  scopeId: string,
): Promise<DataScope | null> {
  if (scopeType === "org") {
    return dataScopeFromNode(orgScopeNode(organizationId));
  }
  const node = await loadScopeNode(scopeId, organizationId);
  return node ? dataScopeFromNode(node) : null;
}

/** JSON has no Date type, so expiresAt comes back as a string. */
function reviveUserAuthCache(raw: string): UserAuthCache {
  const parsed = JSON.parse(raw) as UserAuthCache;
  // The map below assumes an array. A non-array entry is corrupt, and
  // readCacheJson evicts it — building an empty-but-valid snapshot here
  // instead would silently deny permissions the user actually holds.
  if (!Array.isArray(parsed.assignments)) {
    throw new Error("Corrupt user cache entry.");
  }
  return {
    ...parsed,
    assignments: parsed.assignments.map((a) => ({
      ...a,
      expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
    })),
  };
}
