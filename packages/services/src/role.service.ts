import {
  DEFAULT_ROLE_PERMISSIONS,
  invalidateOrgAuthCache,
  invalidateUserAuthCache,
  isPermission,
  RESOURCE_ACTIONS,
  RESOURCE_CATEGORIES,
} from "@repo/authz";
import type {
  AssignRoleInput,
  PermissionCategory,
  RevokeRoleInput,
  RoleAssignmentView,
  RoleType,
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
   * read-only display. Editing lives in the ADR-036 editor below.
   */
  async listPermissions(organizationId: string) {
    return db
      .select({ roleType: orgRolePermissions.roleType, permission: orgRolePermissions.permission })
      .from(orgRolePermissions)
      .where(eq(orgRolePermissions.organizationId, organizationId))
      .orderBy(asc(orgRolePermissions.roleType), asc(orgRolePermissions.permission));
  }

  /**
   * WHO holds each role — the Roles area's companion view. Joins each
   * ACTIVE assignment to the holder's staff record (the person's name is
   * the register's, not the login's); users with no staff row cannot exist
   * among active assignments, because the grant guard requires one.
   */
  async listHolders(organizationId: string) {
    const rows = await db
      .select({
        roleType: roleAssignments.roleType,
        staffId: staff.id,
        firstName: staff.firstName,
        middleName: staff.middleName,
        lastName: staff.lastName,
        userId: roleAssignments.userId,
      })
      .from(roleAssignments)
      // Both sides of the join are org-filtered: a user with staff rows in
      // two orgs must resolve to THIS org's record (M8) — otherwise org A
      // shows org B's staffId (a 404) and name.
      .innerJoin(
        staff,
        and(
          eq(staff.userId, roleAssignments.userId),
          eq(staff.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(roleAssignments.organizationId, organizationId),
          isNull(roleAssignments.revokedAt),
        ),
      )
      .orderBy(asc(roleAssignments.roleType), asc(staff.lastName), asc(staff.firstName));

    return rows.map((row) => ({
      roleType: row.roleType,
      staffId: row.staffId,
      name: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
      userId: row.userId,
    }));
  }

  // --- The permission EDITOR (ADR-036) --------------------------------------

  /**
   * The editor's vocabulary, served rather than imported: the web never
   * imports @repo/authz runtime code, so the catalog (resources grouped by
   * display category) and the shipped defaults cross this boundary as data.
   */
  permissionDefaults(): {
    catalog: PermissionCategory[];
    defaults: { roleType: RoleType; permission: string }[];
  } {
    const byCategory = new Map<string, PermissionCategory["resources"]>();
    for (const [category, resources] of Object.entries(RESOURCE_CATEGORIES)) {
      byCategory.set(
        category,
        resources.map((resource) => ({
          resource,
          actions: [...(RESOURCE_ACTIONS[resource] ?? [])],
        })),
      );
    }

    const catalog: PermissionCategory[] = [...byCategory.entries()].map(
      ([category, resources]) => ({ category, resources }),
    );

    const defaults = Object.entries(DEFAULT_ROLE_PERMISSIONS).flatMap(
      ([roleType, permissions]) =>
        (permissions as string[]).map((permission) => ({
          roleType: roleType as RoleType,
          permission,
        })),
    );

    return { catalog, defaults };
  }

  /**
   * ADR-036's two hard locks, shared by update and reset. Both are refused
   * with the fix named; the UI renders the same locks read-only, but the
   * check lives HERE because a REST caller does not read the UI.
   */
  private assertRoleEditable(roleType: RoleType, actorRoleTypes: string[]) {
    if (roleType === "org_admin") {
      throw new Error(
        "The organisation admin role cannot be edited — it is the bootstrap role. Grant another role instead.",
      );
    }
    if (actorRoleTypes.includes(roleType)) {
      throw new Error(
        "You hold this role yourself — have a colleague with the permission make this change.",
      );
    }
  }

  /**
   * Applies a batched matrix diff for one role. Every CHANGED permission
   * writes its own audit row (added or removed — unchanged permissions are
   * not audited, so a no-op save writes nothing), and the change ends with
   * an ORG-WIDE cache invalidation: every holder of the role is affected,
   * so per-user invalidation cannot be enough.
   */
  async updatePermissions(
    organizationId: string,
    actorUserId: string,
    actorRoleTypes: string[],
    input: { roleType: RoleType; add: string[]; remove: string[] },
  ) {
    this.assertRoleEditable(input.roleType, actorRoleTypes);

    const invalid = [...input.add, ...input.remove].find((p) => !isPermission(p));
    if (invalid) {
      throw new Error(`"${invalid}" is not a permission this system knows.`);
    }
    const overlap = input.add.find((p) => input.remove.includes(p));
    if (overlap) {
      throw new Error(
        `"${overlap}" is both added and removed — the request contradicts itself.`,
      );
    }

    let added = 0;
    if (input.add.length > 0) {
      const inserted = await db
        .insert(orgRolePermissions)
        .values(
          input.add.map((permission) => ({
            organizationId,
            roleType: input.roleType,
            permission,
          })),
        )
        .onConflictDoNothing({
          target: [
            orgRolePermissions.organizationId,
            orgRolePermissions.roleType,
            orgRolePermissions.permission,
          ],
        })
        .returning({ permission: orgRolePermissions.permission });

      added = inserted.length;
      if (added > 0) {
        await db.insert(authzAuditLog).values(
          inserted.map((row) => ({
            organizationId,
            action: "permission_added" as const,
            actorUserId,
            roleType: input.roleType,
            permission: row.permission,
            details: { source: "permission_editor" },
          })),
        );
      }
    }

    let removed = 0;
    if (input.remove.length > 0) {
      const deleted = await db
        .delete(orgRolePermissions)
        .where(
          and(
            eq(orgRolePermissions.organizationId, organizationId),
            eq(orgRolePermissions.roleType, input.roleType),
            inArray(orgRolePermissions.permission, input.remove),
          ),
        )
        .returning({ permission: orgRolePermissions.permission });

      removed = deleted.length;
      if (removed > 0) {
        await db.insert(authzAuditLog).values(
          deleted.map((row) => ({
            organizationId,
            action: "permission_removed" as const,
            actorUserId,
            roleType: input.roleType,
            permission: row.permission,
            details: { source: "permission_editor" },
          })),
        );
      }
    }

    if (added > 0 || removed > 0) {
      await invalidateOrgAuthCache(organizationId);
    }

    return { added, removed };
  }

  /**
   * Restores one role to the shipped defaults — the editor's safety hatch.
   * Only the DIFF is written (and audited): permissions the role already
   * holds that the defaults also contain are left untouched.
   */
  async resetPermissions(
    organizationId: string,
    actorUserId: string,
    actorRoleTypes: string[],
    roleType: RoleType,
  ) {
    this.assertRoleEditable(roleType, actorRoleTypes);

    const defaults = DEFAULT_ROLE_PERMISSIONS[roleType] ?? [];
    const current = await db
      .select({ permission: orgRolePermissions.permission })
      .from(orgRolePermissions)
      .where(
        and(
          eq(orgRolePermissions.organizationId, organizationId),
          eq(orgRolePermissions.roleType, roleType),
        ),
      );
    const currentSet = new Set<string>(current.map((r) => r.permission));
    const defaultSet = new Set<string>(defaults);

    const toAdd = defaults.filter((p) => !currentSet.has(p));
    const toRemove = [...currentSet].filter((p) => !defaultSet.has(p));

    return this.updatePermissions(organizationId, actorUserId, actorRoleTypes, {
      roleType,
      add: toAdd,
      remove: toRemove,
    });
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
