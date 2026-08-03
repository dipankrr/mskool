import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { p } from '../policies';
import { db } from '../db/client';
import { orgRolePermissions, authzAuditLog } from '../db/schema';
import { isPermission } from '../types/permissions';
import { isRoleType, ROLE_TYPES, ROLE_LABELS, DEFAULT_SCOPE_LEVEL } from '../types/roles';
import { resourcesForScope } from '../types/hierarchy';
import { invalidateOrgCache } from '../authz/cache';
import { ForbiddenError } from '../middleware/authorize';

// ============================================================================
// Role routes — managing which permissions each role type has, per org.
//
// Because role types are fixed (no org_roles table), these routes only deal
// with org_role_permissions (the "what can each role do?" table).
//
// Org admins use these to customise their org's role permissions — adding
// or removing individual permissions from role types. The permissions editor
// UI calls GET /roles/:roleType/permissions to see the current state, then
// calls grant/revoke endpoints as the admin toggles checkboxes.
// ============================================================================

const router = Router();
router.use(authenticate);

// ── List all role types with their current permissions for this org ──────────
router.get(
  '/orgs/:orgId/roles',
  authorize(p.one('role_permission:read')),
  async (req, res) => {
    const { orgId } = req.params;
    const permRows = await db.select()
      .from(orgRolePermissions)
      .where(eq(orgRolePermissions.orgId, orgId));

    // Group permissions by role type for a clean response
    const byRole: Record<string, string[]> = {};
    for (const row of permRows) {
      if (!byRole[row.roleType]) byRole[row.roleType] = [];
      byRole[row.roleType].push(row.permission);
    }

    const result = ROLE_TYPES.map(rt => ({
      roleType:          rt,
      label:             ROLE_LABELS[rt],
      defaultScopeLevel: DEFAULT_SCOPE_LEVEL[rt],
      permissions:       byRole[rt] ?? [],
    }));

    res.json(result);
  }
);

// ── Get permissions for a specific role type ─────────────────────────────────
router.get(
  '/orgs/:orgId/roles/:roleType',
  authorize(p.one('role_permission:read')),
  async (req, res) => {
    const { orgId, roleType } = req.params;
    if (!isRoleType(roleType)) { res.status(400).json({ error: 'Invalid role type' }); return; }

    const permRows = await db.select({ permission: orgRolePermissions.permission })
      .from(orgRolePermissions)
      .where(and(eq(orgRolePermissions.orgId, orgId), eq(orgRolePermissions.roleType, roleType as any)));

    // Also return available permissions for the permissions editor UI.
    // Filtered by the role's default scope level — no dead config.
    const available = resourcesForScope(DEFAULT_SCOPE_LEVEL[roleType]);

    res.json({
      roleType,
      label:               ROLE_LABELS[roleType],
      defaultScopeLevel:   DEFAULT_SCOPE_LEVEL[roleType],
      currentPermissions:  permRows.map(r => r.permission),
      availableResources:  available,
    });
  }
);

// ── Grant a permission to a role type ─────────────────────────────────────────
// SENSITIVE: permission changes must check auth_version to prevent race conditions.
router.post(
  '/orgs/:orgId/roles/:roleType/permissions/grant',
  authorize(p.sensitive('role_permission:update')),
  async (req, res) => {
    const { orgId, roleType } = req.params;
    const { permission } = req.body;

    if (!isRoleType(roleType))     { res.status(400).json({ error: 'Invalid role type' }); return; }
    if (!isPermission(permission)) { res.status(400).json({ error: 'Invalid permission' }); return; }

    await db.insert(orgRolePermissions)
      .values({ orgId, roleType: roleType as any, permission })
      .onConflictDoNothing();

    await db.insert(authzAuditLog).values({
      actorUserId: req.user!.userId,
      orgId,
      action:      'permission_granted',
      targetRole:  roleType as any,
      details:     JSON.stringify({ permission }),
    });

    // Invalidate all users in this org — their permission sets just changed.
    await invalidateOrgCache(orgId);

    res.status(201).json({ granted: true, roleType, permission });
  }
);

// ── Revoke a permission from a role type ──────────────────────────────────────
router.post(
  '/orgs/:orgId/roles/:roleType/permissions/revoke',
  authorize(p.sensitive('role_permission:update')),
  async (req, res) => {
    const { orgId, roleType } = req.params;
    const { permission } = req.body;

    if (!isRoleType(roleType))     { res.status(400).json({ error: 'Invalid role type' }); return; }
    if (!isPermission(permission)) { res.status(400).json({ error: 'Invalid permission' }); return; }

    await db.delete(orgRolePermissions)
      .where(and(
        eq(orgRolePermissions.orgId, orgId),
        eq(orgRolePermissions.roleType, roleType as any),
        eq(orgRolePermissions.permission, permission),
      ));

    await db.insert(authzAuditLog).values({
      actorUserId: req.user!.userId,
      orgId,
      action:      'permission_revoked',
      targetRole:  roleType as any,
      details:     JSON.stringify({ permission }),
    });

    await invalidateOrgCache(orgId);

    res.json({ revoked: true, roleType, permission });
  }
);

export default router;
