import { invalidateUserAuthCache } from "@repo/authz";
import type {
  AssignRoleInput,
  RevokeRoleInput,
  RoleAssignmentView,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  authzAuditLog,
  classes,
  orgRolePermissions,
  organizations,
  roleAssignments,
  scopeNodes,
  sections,
  staff,
  schools,
} from "@repo/db/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

/**
 * ROLES — granting and revoking `role_assignments` (ADR-005, ADR-011).
 *
 * An assignment is STAFF → role → scope. The scope target is validated
 * against `scope_nodes` (or, for the org root, against the organization id
 * itself — the org node is synthetic, ADR-019's CHECK enforces the same
 * equality at the row level). Grants are REVOKED, never deleted (hard
 * rule 2): `revokedAt`/`revokedBy` and the audit row are the record.
 *
 * Cache discipline: `role_assignment:assign`/`revoke` are SENSITIVE
 * permissions (the gate re-reads assignments fresh), but the TARGET user's
 * five-minute cache snapshot still holds their OLD permission set — so
 * every grant and revoke ends with `invalidateUserAuthCache(target)`. The
 * change takes effect on the target's next request, not in five minutes.
 *
 * Every grant and revoke appends to `authz_audit_log` — the Phase 1 debt
 * "the table has no writer" closes here (ADR-035).
 *
 * Knows nothing about HTTP. Methods that answer "which assignments may I
 * see" take the caller's scopes; the mutation methods take the org id the
 * builder has already authorized against the addressed node.
 */

export class RoleService {
  /**
   * Grants `roleType` at the node named by `scopeId`. The builder has
   * already confirmed the CALLER covers that node (the request is
   * addressed AT it); this method validates the grant's own facts: the
   * node exists in THIS org with the claimed type, the target is staff of
   * this org, and the same grant is not already live.
   */
  async assign(
    organizationId: string,
    actorUserId: string,
    input: AssignRoleInput & { scopeId: string },
  ) {
    if (input.scopeType === "org") {
      if (input.scopeId !== organizationId) {
        throw new Error(
          "An organisation-scoped role is granted at the organisation itself — the scope must be the organisation id.",
        );
      }
    } else {
      const [node] = await db
        .select({ id: scopeNodes.id, type: scopeNodes.type })
        .from(scopeNodes)
        .where(
          and(
            eq(scopeNodes.id, input.scopeId),
            eq(scopeNodes.organizationId, organizationId),
          ),
        );
      if (!node || node.type !== input.scopeType) {
        throw new Error(
          "The scope named for this role does not exist in this organisation, or does not match the chosen scope type.",
        );
      }
    }

    // A role granted to a non-staff user creates an invisible privilege —
    // the person has no employment record here. Refuse, with the fix named.
    const [member] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.organizationId, organizationId),
          eq(staff.userId, input.userId),
        ),
      );
    if (!member) {
      throw new Error(
        "That user holds no staff record in this organisation — create the staff record before assigning roles.",
      );
    }

    const [dupe] = await db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, input.userId),
          eq(roleAssignments.organizationId, organizationId),
          eq(roleAssignments.roleType, input.roleType),
          eq(roleAssignments.scopeId, input.scopeId),
          isNull(roleAssignments.revokedAt),
        ),
      );
    if (dupe) {
      throw new Error(
        "This role is already granted to this person at this scope — revoke the existing grant first.",
      );
    }

    const [row] = await db
      .insert(roleAssignments)
      .values({
        userId: input.userId,
        organizationId,
        roleType: input.roleType,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        grantedBy: actorUserId,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create the role assignment.");
    }

    await db.insert(authzAuditLog).values({
      organizationId,
      action: "role_granted",
      actorUserId,
      targetUserId: input.userId,
      roleType: input.roleType,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      permission: "role_assignment:assign",
      details: { staffId: member.id },
    });

    await invalidateUserAuthCache(input.userId);

    return row;
  }

  /**
   * Revokes a live grant. The reason is REQUIRED (the contract enforces the
   * minimum; the audit row is the point) and rides in the audit details.
   */
  async revoke(
    organizationId: string,
    actorUserId: string,
    assignmentId: string,
    input: RevokeRoleInput,
  ) {
    const [row] = await db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.id, assignmentId),
          eq(roleAssignments.organizationId, organizationId),
          isNull(roleAssignments.revokedAt),
        ),
      );
    if (!row) return null;

    const [revoked] = await db
      .update(roleAssignments)
      .set({ revokedAt: new Date(), revokedBy: actorUserId })
      .where(eq(roleAssignments.id, assignmentId))
      .returning();

    await db.insert(authzAuditLog).values({
      organizationId,
      action: "role_revoked",
      actorUserId,
      targetUserId: row.userId,
      roleType: row.roleType,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      permission: "role_assignment:revoke",
      details: { reason: input.reason },
    });

    await invalidateUserAuthCache(row.userId);

    return revoked ?? null;
  }

  /**
   * The ACTIVE assignments of one staff member, each with a human-readable
   * label for its target node. Permission-gated upstream; the org filter
   * comes from the caller's own session — a user's assignments never
   * cross an org boundary.
   */
  async listForUser(
    organizationId: string,
    userId: string,
  ): Promise<RoleAssignmentView[]> {
    const rows = await db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.organizationId, organizationId),
          eq(roleAssignments.userId, userId),
          isNull(roleAssignments.revokedAt),
        ),
      )
      .orderBy(asc(roleAssignments.grantedAt));

    const labels = await this.scopeLabels(
      organizationId,
      rows.map((r) => ({ scopeType: r.scopeType, scopeId: r.scopeId })),
    );

    return rows.map((r) => ({
      ...r,
      scopeLabel: labels.get(r.scopeId) ?? "Unknown scope",
    }));
  }

  /**
   * The owning scope node of an assignment — the B6 resolution adapter for
   * revoke: the request is authorized against the node the grant was made
   * AT. Authorization-neutral: answers "who owns it", never "may you see it".
   */
  async getAssignmentOwnerId(
    organizationId: string,
    assignmentId: string,
  ): Promise<{ scopeType: string; scopeId: string } | null> {
    const [row] = await db
      .select({ scopeType: roleAssignments.scopeType, scopeId: roleAssignments.scopeId })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.id, assignmentId),
          eq(roleAssignments.organizationId, organizationId),
          isNull(roleAssignments.revokedAt),
        ),
      );

    return row ?? null;
  }

  /**
   * The org's permission matrix as flat rows (role × permission), for the
   * read-only display. `role_permission:update` is deliberately deferred —
   * orgs run on the seeded defaults (ADR-035).
   */
  async listPermissions(organizationId: string) {
    return db
      .select({ roleType: orgRolePermissions.roleType, permission: orgRolePermissions.permission })
      .from(orgRolePermissions)
      .where(eq(orgRolePermissions.organizationId, organizationId))
      .orderBy(asc(orgRolePermissions.roleType), asc(orgRolePermissions.permission));
  }

  /**
   * Human labels for scope targets, batched per node type: one query per
   * level actually present, never one per row.
   */
  private async scopeLabels(
    organizationId: string,
    targets: { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();

    const byType = (type: string) =>
      targets.filter((t) => t.scopeType === type).map((t) => t.scopeId);

    const org = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    for (const t of byType("org")) labels.set(t, org[0]?.name ?? "Organisation");

    const schoolIds = byType("school");
    if (schoolIds.length > 0) {
      const rows = await db
        .select({ id: schools.id, name: schools.name })
        .from(schools)
        .where(and(eq(schools.organizationId, organizationId), inArray(schools.id, schoolIds)));
      for (const r of rows) labels.set(r.id, r.name);
    }

    const classIds = byType("class");
    if (classIds.length > 0) {
      const rows = await db
        .select({ id: classes.id, name: classes.name })
        .from(classes)
        .where(and(eq(classes.organizationId, organizationId), inArray(classes.id, classIds)));
      for (const r of rows) labels.set(r.id, r.name);
    }

    const sectionIds = byType("section");
    if (sectionIds.length > 0) {
      const rows = await db
        .select({ id: sections.id, name: sections.name })
        .from(sections)
        .where(and(eq(sections.organizationId, organizationId), inArray(sections.id, sectionIds)));
      for (const r of rows) labels.set(r.id, r.name);
    }

    return labels;
  }
}

export const roleService = new RoleService();
