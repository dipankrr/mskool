import {
  DEFAULT_ROLE_PERMISSIONS,
  invalidateOrgAuthCache,
  invalidateUserAuthCache,
  isPermission,
  RESOURCE_ACTIONS,
  RESOURCE_CATEGORIES,
  SENSITIVE_PERMISSIONS,
} from "@repo/authz";
import type {
  AssignRoleInput,
  PermissionCategory,
  RevokeRoleInput,
  RoleAssignmentView,
  RoleType,
  StaffRoleView,
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
  staffPendingRoles,
  schools,
  user,
} from "@repo/db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray, or } from "drizzle-orm";
import { ServiceRefusal } from "./service-error";

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
    // ADR-068: teaching access comes from teaching assignments, which write
    // these grants themselves. A hand-made one would drift from the timetable.
    if (input.roleType === "class_teacher" || input.roleType === "subject_teacher") {
      throw new ServiceRefusal(
        "BAD_REQUEST",
        "Teachers get their access from what they teach. Give them classes in Teaching instead.",
      );
    }
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
    sensitive: string[];
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

    return { catalog, defaults, sensitive: [...SENSITIVE_PERMISSIONS] };
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

  // ── Staff roles on the phone (2026-11-15) ────────────────────────────────

  /**
   * One staff member's office roles: the live grants (if they have a login)
   * and the ones waiting for them to join. Teacher roles are left out: they
   * come from Teaching and are shown there.
   */
  async forStaff(organizationId: string, staffId: string): Promise<StaffRoleView[]> {
    const [member] = await db
      .select({ userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.organizationId, organizationId)));
    if (!member) return [];

    const live = member.userId
      ? await db
          .select()
          .from(roleAssignments)
          .where(
            and(
              eq(roleAssignments.organizationId, organizationId),
              eq(roleAssignments.userId, member.userId),
              isNull(roleAssignments.revokedAt),
              notInArray(roleAssignments.roleType, ["class_teacher", "subject_teacher"]),
            ),
          )
          .orderBy(asc(roleAssignments.grantedAt))
      : [];
    const waiting = await db
      .select()
      .from(staffPendingRoles)
      .where(
        and(
          eq(staffPendingRoles.organizationId, organizationId),
          eq(staffPendingRoles.staffId, staffId),
          isNull(staffPendingRoles.appliedAt),
          isNull(staffPendingRoles.cancelledAt),
        ),
      )
      .orderBy(asc(staffPendingRoles.createdAt));

    const labels = await this.scopeLabels(organizationId, [...live, ...waiting]);
    return [
      ...live.map((r) => ({
        id: r.id,
        waiting: false,
        roleType: r.roleType,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        scopeLabel: labels.get(r.scopeId) ?? "Unknown",
        expiresAt: r.expiresAt?.toISOString() ?? null,
      })),
      ...waiting.map((r) => ({
        id: r.id,
        waiting: true,
        roleType: r.roleType,
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        scopeLabel: labels.get(r.scopeId) ?? "Unknown",
        expiresAt: r.expiresAt?.toISOString() ?? null,
      })),
    ];
  }

  /**
   * Gives a role to a staff member. With a sign-in it is granted now (the
   * same checks as `assign`); without one it waits on the staff record and
   * is granted when they join. Returns which happened.
   */
  async assignToStaff(
    organizationId: string,
    actorUserId: string,
    input: {
      staffId: string;
      roleType: RoleType;
      scopeType: "org" | "school" | "class" | "section";
      scopeId: string;
      expiresAt?: string | null;
    },
  ): Promise<{ waiting: boolean; id: string }> {
    const [member] = await db
      .select({ userId: staff.userId, status: staff.status, username: user.username })
      .from(staff)
      .leftJoin(user, eq(staff.userId, user.id))
      .where(and(eq(staff.id, input.staffId), eq(staff.organizationId, organizationId)));
    if (!member) throw new ServiceRefusal("NOT_FOUND", "Staff member not found.");
    if (!["active", "on_leave", "suspended"].includes(member.status)) {
      throw new ServiceRefusal("BAD_REQUEST", "They have left. Bring them back first.");
    }
    const hasLogin = Boolean(member.userId && !member.username?.startsWith("left."));

    if (hasLogin) {
      const row = await this.assign(organizationId, actorUserId, {
        userId: member.userId!,
        roleType: input.roleType,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        expiresAt: input.expiresAt ?? null,
      });
      return { waiting: false, id: row.id };
    }

    // The same refusals `assign` makes, before anything is stored.
    if (input.roleType === "class_teacher" || input.roleType === "subject_teacher") {
      throw new ServiceRefusal(
        "BAD_REQUEST",
        "Teachers get their access from what they teach. Give them classes in Teaching instead.",
      );
    }
    await this.assertScope(organizationId, input.scopeType, input.scopeId);
    const [dupe] = await db
      .select({ id: staffPendingRoles.id })
      .from(staffPendingRoles)
      .where(
        and(
          eq(staffPendingRoles.staffId, input.staffId),
          eq(staffPendingRoles.roleType, input.roleType),
          eq(staffPendingRoles.scopeId, input.scopeId),
          isNull(staffPendingRoles.appliedAt),
          isNull(staffPendingRoles.cancelledAt),
        ),
      );
    if (dupe) throw new ServiceRefusal("CONFLICT", "They already have this role.");

    const [row] = await db
      .insert(staffPendingRoles)
      .values({
        organizationId,
        staffId: input.staffId,
        roleType: input.roleType,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdBy: actorUserId,
      })
      .returning({ id: staffPendingRoles.id });
    return { waiting: true, id: row!.id };
  }

  /** The waiting role's owning scope, for the builder's gate on cancel. */
  async getPendingOwner(organizationId: string, id: string) {
    const [row] = await db
      .select({ scopeType: staffPendingRoles.scopeType, scopeId: staffPendingRoles.scopeId })
      .from(staffPendingRoles)
      .where(
        and(
          eq(staffPendingRoles.id, id),
          eq(staffPendingRoles.organizationId, organizationId),
          isNull(staffPendingRoles.appliedAt),
          isNull(staffPendingRoles.cancelledAt),
        ),
      );
    return row ?? null;
  }

  /** Takes back a role that was waiting for someone to join. */
  async cancelPending(organizationId: string, actorUserId: string, id: string) {
    const [row] = await db
      .update(staffPendingRoles)
      .set({ cancelledAt: new Date(), cancelledBy: actorUserId })
      .where(
        and(
          eq(staffPendingRoles.id, id),
          eq(staffPendingRoles.organizationId, organizationId),
          isNull(staffPendingRoles.appliedAt),
          isNull(staffPendingRoles.cancelledAt),
        ),
      )
      .returning({ id: staffPendingRoles.id });
    return row ?? null;
  }

  /**
   * At join: every waiting role becomes a real grant, made in the name of
   * whoever picked it. A waiting role that has expired meanwhile, or that
   * the grant refuses (a scope since closed), is cancelled instead.
   */
  async applyPending(organizationId: string, staffId: string, userId: string): Promise<number> {
    const waiting = await db
      .select()
      .from(staffPendingRoles)
      .where(
        and(
          eq(staffPendingRoles.organizationId, organizationId),
          eq(staffPendingRoles.staffId, staffId),
          isNull(staffPendingRoles.appliedAt),
          isNull(staffPendingRoles.cancelledAt),
        ),
      );
    let applied = 0;
    for (const pick of waiting) {
      const now = new Date();
      if (pick.expiresAt && pick.expiresAt <= now) {
        await db
          .update(staffPendingRoles)
          .set({ cancelledAt: now })
          .where(eq(staffPendingRoles.id, pick.id));
        continue;
      }
      try {
        const grant = await this.assign(organizationId, pick.createdBy, {
          userId,
          roleType: pick.roleType,
          scopeType: pick.scopeType,
          scopeId: pick.scopeId,
          expiresAt: pick.expiresAt?.toISOString() ?? null,
        });
        await db
          .update(staffPendingRoles)
          .set({ appliedAt: now, assignmentId: grant.id })
          .where(eq(staffPendingRoles.id, pick.id));
        applied += 1;
      } catch {
        await db
          .update(staffPendingRoles)
          .set({ cancelledAt: now })
          .where(eq(staffPendingRoles.id, pick.id));
      }
    }
    return applied;
  }

  /**
   * Pushes out (or removes) a live grant's end date, including one that has
   * just ended. Audited like a grant.
   */
  async extend(
    organizationId: string,
    actorUserId: string,
    assignmentId: string,
    expiresAt: string | null,
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
    if (row.roleType === "class_teacher" || row.roleType === "subject_teacher") {
      throw new ServiceRefusal("BAD_REQUEST", "Teacher roles follow Teaching. Change it there.");
    }
    const [updated] = await db
      .update(roleAssignments)
      .set({ expiresAt: expiresAt ? new Date(expiresAt) : null })
      .where(eq(roleAssignments.id, assignmentId))
      .returning();
    await db.insert(authzAuditLog).values({
      organizationId,
      action: "role_extended",
      actorUserId,
      targetUserId: row.userId,
      roleType: row.roleType,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      permission: "role_assignment:assign",
      details: { from: row.expiresAt?.toISOString() ?? null, to: expiresAt },
    });
    await invalidateUserAuthCache(row.userId);
    return updated ?? null;
  }

  /**
   * Office roles with an end date in the last 7 days or the next 7, for one
   * branch (its own grants plus org-wide ones). Teacher roles excluded.
   */
  async ending(organizationId: string, schoolId: string) {
    const now = Date.now();
    const from = new Date(now - 7 * 86_400_000);
    const to = new Date(now + 7 * 86_400_000);
    const rows = await db
      .select({
        id: roleAssignments.id,
        roleType: roleAssignments.roleType,
        scopeType: roleAssignments.scopeType,
        scopeId: roleAssignments.scopeId,
        expiresAt: roleAssignments.expiresAt,
        staffId: staff.id,
        firstName: staff.firstName,
        lastName: staff.lastName,
      })
      .from(roleAssignments)
      .innerJoin(
        staff,
        and(eq(staff.userId, roleAssignments.userId), eq(staff.organizationId, organizationId)),
      )
      .where(
        and(
          eq(roleAssignments.organizationId, organizationId),
          isNull(roleAssignments.revokedAt),
          notInArray(roleAssignments.roleType, ["class_teacher", "subject_teacher"]),
          gte(roleAssignments.expiresAt, from),
          lte(roleAssignments.expiresAt, to),
          or(eq(roleAssignments.scopeId, schoolId), eq(roleAssignments.scopeType, "org")),
        ),
      )
      .orderBy(asc(roleAssignments.expiresAt));
    const labels = await this.scopeLabels(organizationId, rows);
    return rows.map((r) => ({
      id: r.id,
      roleType: r.roleType,
      scopeLabel: labels.get(r.scopeId) ?? "Unknown",
      expiresAt: r.expiresAt!.toISOString(),
      staffId: r.staffId,
      name: `${r.firstName} ${r.lastName}`.trim(),
    }));
  }

  /**
   * One staff member's history from the audit log: roles given, taken away
   * and extended, sign-in events and status changes, newest first.
   */
  async history(organizationId: string, staffId: string, limit = 100) {
    const [member] = await db
      .select({ userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.organizationId, organizationId)));
    if (!member) return [];
    const about = member.userId
      ? or(eq(authzAuditLog.scopeId, staffId), eq(authzAuditLog.targetUserId, member.userId))
      : eq(authzAuditLog.scopeId, staffId);
    const rows = await db
      .select({
        id: authzAuditLog.id,
        action: authzAuditLog.action,
        at: authzAuditLog.createdAt,
        roleType: authzAuditLog.roleType,
        scopeType: authzAuditLog.scopeType,
        scopeId: authzAuditLog.scopeId,
        details: authzAuditLog.details,
        actorUserId: authzAuditLog.actorUserId,
        actorName: user.name,
      })
      .from(authzAuditLog)
      .leftJoin(user, eq(user.id, authzAuditLog.actorUserId))
      .where(and(eq(authzAuditLog.organizationId, organizationId), about))
      .orderBy(desc(authzAuditLog.createdAt))
      .limit(limit);

    // The actor's name from their staff record here, when they have one.
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
    const actorStaff = actorIds.length
      ? await db
          .select({ userId: staff.userId, firstName: staff.firstName, lastName: staff.lastName })
          .from(staff)
          .where(and(eq(staff.organizationId, organizationId), inArray(staff.userId, actorIds)))
      : [];
    const names = new Map(actorStaff.map((s) => [s.userId!, `${s.firstName} ${s.lastName}`.trim()]));
    const roleRows = rows.filter((r) => r.roleType && r.scopeType && r.scopeId);
    const labels = await this.scopeLabels(
      organizationId,
      roleRows.map((r) => ({ scopeType: r.scopeType!, scopeId: r.scopeId! })),
    );
    return rows
      .filter((r) => r.roleType !== "class_teacher" && r.roleType !== "subject_teacher")
      .map((r) => {
        const details = (r.details ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          action: r.action,
          at: r.at.toISOString(),
          roleType: r.roleType ?? null,
          scopeLabel: r.roleType && r.scopeId ? (labels.get(r.scopeId) ?? null) : null,
          by: r.actorUserId ? (names.get(r.actorUserId) ?? r.actorName ?? null) : null,
          self: r.actorUserId != null && r.actorUserId === member.userId,
          reason: typeof details.reason === "string" ? details.reason : null,
          until: typeof details.to === "string" && r.action === "role_extended" ? details.to : null,
        };
      });
  }

  /** The scope checks `assign` makes, shared with waiting roles. */
  private async assertScope(organizationId: string, scopeType: string, scopeId: string) {
    if (scopeType === "org") {
      if (scopeId !== organizationId) {
        throw new Error(
          "An organisation-scoped role is granted at the organisation itself — the scope must be the organisation id.",
        );
      }
      return;
    }
    const [node] = await db
      .select({ id: scopeNodes.id, type: scopeNodes.type })
      .from(scopeNodes)
      .where(and(eq(scopeNodes.id, scopeId), eq(scopeNodes.organizationId, organizationId)));
    if (!node || node.type !== scopeType) {
      throw new Error(
        "The scope named for this role does not exist in this organisation, or does not match the chosen scope type.",
      );
    }
  }
}

export const roleService = new RoleService();
