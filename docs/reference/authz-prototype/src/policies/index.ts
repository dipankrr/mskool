import type { Request } from 'express';
import type { Permission } from '../types/permissions';
import { SENSITIVE_PERMISSIONS } from '../types/permissions';
import { getDataScope, getDataScopes } from '../authz/can';
import { resolveCtx } from '../authz/scope';
import { checkAndRefreshCache } from '../authz/cache';
import { ForbiddenError } from '../middleware/authorize';
import type { DataScope, PolicyFn } from '../middleware/authorize';

// ============================================================================
// Policy factory — removes the 3-4 line boilerplate from every route.
//
// Three variants:
//   p.one(permission)       → single-resource access (GET one, POST, PATCH, DELETE)
//   p.list(permission)      → list access (GET all accessible records)
//   p.sensitive(permission) → same as p.one() but first checks auth_version in DB
//
// Use p.sensitive() for any permission in SENSITIVE_PERMISSIONS.
// Write a custom PolicyFn (passed directly to authorize()) when you need
// extra checks: scope seniority (role assignment), subject check (marks/homework).
//
// Examples:
//   router.get('/orgs/:orgId/sections/:sectionId/attendance', authorize(p.one('attendance:read')), handler)
//   router.post('/orgs/:orgId/sections/:sectionId/marks',     authorize(MarksPolicy.create),        handler)
// ============================================================================

export const p = {
  // Standard single-resource gate.
  // Resolves context from URL, checks permission, returns DataScope.
  one(permission: Permission): PolicyFn {
    return async (req: Request) => {
      const ctx   = await resolveCtx(req);
      const scope = getDataScope(req.authz!, permission, ctx);
      if (!scope) throw new ForbiddenError();
      return scope;
    };
  },

  // List gate — returns all scopes the user can see across their assignments.
  // The route handler ORs them together in the DB query.
  list(permission: Permission): PolicyFn {
    return async (req: Request) => {
      const orgId = req.params.orgId;
      if (!orgId) throw new ForbiddenError();
      const scopes = getDataScopes(req.authz!, permission, orgId);
      if (!scopes.length) throw new ForbiddenError();
      return scopes;
    };
  },

  // Sensitive gate — refreshes the auth cache from DB if auth_version changed.
  // Use for: fee approvals, role assignment changes, marks publishing, deletes.
  // Adds one PK DB lookup before the in-memory permission check.
  sensitive(permission: Permission): PolicyFn {
    return async (req: Request) => {
      // Refresh cache if someone's permissions changed mid-session
      req.authz = await checkAndRefreshCache(req.authz!);

      const ctx   = await resolveCtx(req);
      const scope = getDataScope(req.authz!, permission, ctx);
      if (!scope) throw new ForbiddenError();
      return scope;
    };
  },
};

// ── Subject check helper ───────────────────────────────────────────────────
//
// Used by marks and homework routes.
// NOT part of the authz scope system — this is business logic.
//
// Only applies when scope.sectionId is not null (section-level assignment).
// Principals and class teachers have scope.sectionId = null, so they
// can access all subjects without a subject assignment row.
export async function checkSubjectAccess(
  scope:     DataScope,
  userId:    string,
  sectionId: string,
  subjectId: string,
): Promise<void> {
  if (scope.sectionId === null) return; // broader scope: no subject restriction

  // Dynamic import to avoid circular dependency with schema.app.ts
  const { db } = await import('../db/client');
  const { staffSubjectAssignments } = await import('../db/schema.app');
  const { eq, and } = await import('drizzle-orm');

  const [row] = await db.select({ id: staffSubjectAssignments.id })
    .from(staffSubjectAssignments)
    .where(and(
      eq(staffSubjectAssignments.staffUserId, userId),
      eq(staffSubjectAssignments.sectionId,   sectionId),
      eq(staffSubjectAssignments.subjectId,   subjectId),
    ));

  if (!row) throw new ForbiddenError('Not assigned to this subject in this section');
}
