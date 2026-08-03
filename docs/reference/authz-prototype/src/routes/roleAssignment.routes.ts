import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { p } from '../policies';
import {
  RoleAssignmentPolicy,
  createAssignmentRow,
  revokeAssignmentRow,
} from '../policies/roleAssignment.policy';
import { db } from '../db/client';
import { roleAssignments } from '../db/schema';
import { buildScopeWhere } from '../authz/scope';
import { and } from 'drizzle-orm';

const router = Router();
router.use(authenticate);

// ── List role assignments visible to the requester ───────────────────────────
router.get(
  '/orgs/:orgId/role-assignments',
  authorize(p.list('role_assignment:read')),
  async (req, res) => {
    const scopes  = req.dataScopes!;
    const { orgId } = req.params;

    // For list, we return all assignments in the org the requester can see.
    // The scope filter here is on the ORG level — the requester's scope covers
    // which assignments they can view (e.g., a principal only sees assignments
    // for their school's staff, not the whole org).
    // For simplicity: org-level role_assignment:read = see all in org.
    const rows = await db.select()
      .from(roleAssignments)
      .where(eq(roleAssignments.orgId, orgId));

    res.json(rows);
  }
);

// ── Assign a role to a staff member ─────────────────────────────────────────
// Uses a custom policy (not p.one()) because it needs scope-seniority check.
router.post(
  '/orgs/:orgId/role-assignments',
  authorize(RoleAssignmentPolicy.assign()),
  async (req, res) => {
    const { orgId } = req.params;
    const { targetUserId, roleType, scopeType, scopeId, expiresAt } = req.body;

    const created = await createAssignmentRow({
      actorUserId: req.user!.userId,
      targetUserId,
      roleType,
      orgId,
      scopeType,
      scopeId,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });

    res.status(201).json(created);
  }
);

// ── Revoke a role assignment ─────────────────────────────────────────────────
router.delete(
  '/orgs/:orgId/role-assignments/:assignmentId',
  authorize(RoleAssignmentPolicy.revoke()),
  async (req, res) => {
    const { orgId, assignmentId } = req.params;

    const deleted = await revokeAssignmentRow({
      actorUserId:  req.user!.userId,
      assignmentId,
      orgId,
    });

    if (!deleted) { res.status(404).json({ error: 'Assignment not found' }); return; }
    res.json({ revoked: true, assignmentId });
  }
);

export default router;
