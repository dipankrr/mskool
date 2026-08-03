import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { roleAssignments, authzAuditLog } from '../db/schema';
import { getDataScope } from '../authz/can';
import { resolveCtx } from '../authz/scope';
import { checkAndRefreshCache, invalidateAuthCache } from '../authz/cache';
import { ForbiddenError } from '../middleware/authorize';
import { scopeDepth, isScopeType } from '../types/hierarchy';
import { isRoleType } from '../types/roles';
import type { DataScope } from '../authz/types';
import type { PolicyFn } from '../middleware/authorize';
import type { ScopeType } from '../types/hierarchy';

// ============================================================================
// RoleAssignmentPolicy — who can assign/revoke roles.
//
// Two checks always run together:
//   1. Permission check: does this user have role_assignment:assign at a scope
//      that covers the org? (standard can() check)
//   2. Scope seniority: the TARGET assignment's scope must be at equal or
//      NARROWER depth than the assigner's own broadest scope in the org.
//      A class teacher (class scope) cannot assign an org-level role.
//      A principal (school S1) cannot assign a role scoped to school S2.
//
// This prevents privilege escalation through delegation — the key hole in
// naive "can assign roles" permission systems.
// ============================================================================

// Find the broadest scope the actor has for role_assignment:assign in this org.
// Returns null if they have no such permission.
function getActorBroadestScope(cache: NonNullable<Request['authz']>, orgId: string) {
  const orgPerms = cache.orgPermissions[orgId];
  if (!orgPerms) return null;

  let broadest: { scopeType: ScopeType; scopeId: string } | null = null;

  for (const assignment of cache.assignments) {
    if (assignment.orgId !== orgId) continue;
    if (!orgPerms.get(assignment.roleType)?.has('role_assignment:assign')) continue;

    if (!broadest || scopeDepth(assignment.scopeType) < scopeDepth(broadest.scopeType)) {
      broadest = { scopeType: assignment.scopeType, scopeId: assignment.scopeId };
    }
  }
  return broadest;
}

// For the target scope to be valid:
//   - Its depth must be >= actor's scope depth (narrower or equal, not broader)
//   - If actor is school-scoped, target school must be THE SAME school
//   - If actor is class-scoped, target class must be THE SAME class
function validateScopeSeniority(
  actorScope: { scopeType: ScopeType; scopeId: string },
  targetType: ScopeType,
  targetId:   string,
): void {
  const actorDepth  = scopeDepth(actorScope.scopeType);
  const targetDepth = scopeDepth(targetType);

  if (targetDepth < actorDepth) {
    throw new ForbiddenError(
      `Cannot assign a role at '${targetType}' scope — your own scope is '${actorScope.scopeType}'`
    );
  }

  // If actor is school-scoped, the target scope must be within the same school.
  // We can't check this fully here without loading the target scope_node —
  // the route handler does that check after calling this function.
}

export const RoleAssignmentPolicy = {

  read(): PolicyFn {
    return async (req: Request) => {
      const ctx = await resolveCtx(req);
      const scope = getDataScope(req.authz!, 'role_assignment:read', ctx);
      if (!scope) throw new ForbiddenError();
      return scope;
    };
  },

  assign(): PolicyFn {
    return async (req: Request) => {
      // Sensitive operation: refresh cache first
      req.authz = await checkAndRefreshCache(req.authz!);

      const { orgId } = req.params;
      const { targetUserId, roleType, scopeType, scopeId } = req.body ?? {};

      if (!targetUserId || !roleType || !scopeType || !scopeId) {
        throw new ForbiddenError('targetUserId, roleType, scopeType, and scopeId are required');
      }
      if (!isRoleType(roleType))   throw new ForbiddenError(`Invalid roleType: ${roleType}`);
      if (!isScopeType(scopeType)) throw new ForbiddenError(`Invalid scopeType: ${scopeType}`);

      const actorScope = getActorBroadestScope(req.authz!, orgId);
      if (!actorScope) throw new ForbiddenError();

      validateScopeSeniority(actorScope, scopeType, scopeId);

      // If actor is school-scoped (or narrower), verify the target scopeId is
      // within the actor's school. Load the target scope node to check.
      if (actorScope.scopeType !== 'org' && scopeType !== 'org') {
        const { loadScopeNode } = await import('../authz/scope');
        const targetNode = await loadScopeNode(scopeId, orgId);
        const actorNode  = await loadScopeNode(actorScope.scopeId, orgId);

        if (actorScope.scopeType === 'school' && targetNode.schoolId !== actorScope.scopeId) {
          throw new ForbiddenError('Cannot assign a role outside your school');
        }
        if (actorScope.scopeType === 'class' && targetNode.classId !== actorScope.scopeId) {
          throw new ForbiddenError('Cannot assign a role outside your class');
        }
      }

      // No DataScope to return here — the route handler uses req.body directly
      // (the assignment creation itself is the operation, not a data read).
    };
  },

  revoke(): PolicyFn {
    return async (req: Request) => {
      req.authz = await checkAndRefreshCache(req.authz!);

      const { orgId, assignmentId } = req.params;

      // Load the assignment being revoked
      const [existing] = await db.select()
        .from(roleAssignments)
        .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.orgId, orgId)));

      if (!existing) throw new ForbiddenError('Assignment not found');

      const actorScope = getActorBroadestScope(req.authz!, orgId);
      if (!actorScope) throw new ForbiddenError();

      validateScopeSeniority(actorScope, existing.scopeType, existing.scopeId);
    };
  },
};

// ── Side-effect helpers ───────────────────────────────────────────────────────
// Called by route handlers AFTER policy check passes.

export async function createAssignmentRow(opts: {
  actorUserId:  string;
  targetUserId: string;
  roleType:     string;
  orgId:        string;
  scopeType:    string;
  scopeId:      string;
  expiresAt?:   Date | null;
}) {
  const { actorUserId, targetUserId, roleType, orgId, scopeType, scopeId, expiresAt } = opts;

  const [created] = await db.insert(roleAssignments)
    .values({ userId: targetUserId, roleType: roleType as any, orgId, scopeType: scopeType as any, scopeId, grantedBy: actorUserId, expiresAt: expiresAt ?? null })
    .returning();

  await db.insert(authzAuditLog).values({
    actorUserId, orgId, action: 'role_assigned',
    targetUserId, targetRole: roleType as any,
    scopeType: scopeType as any, scopeId,
    details: JSON.stringify({ expiresAt }),
  });

  await invalidateAuthCache(targetUserId);
  return created;
}

export async function revokeAssignmentRow(opts: {
  actorUserId:  string;
  assignmentId: string;
  orgId:        string;
}) {
  const { actorUserId, assignmentId, orgId } = opts;

  const [deleted] = await db.delete(roleAssignments)
    .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.orgId, orgId)))
    .returning();

  if (!deleted) return null;

  await db.insert(authzAuditLog).values({
    actorUserId, orgId, action: 'role_revoked',
    targetUserId: deleted.userId, targetRole: deleted.roleType,
    scopeType: deleted.scopeType, scopeId: deleted.scopeId,
    details: JSON.stringify({ assignmentId }),
  });

  await invalidateAuthCache(deleted.userId);
  return deleted;
}
