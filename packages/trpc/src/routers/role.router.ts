import {
  assignRoleSchema,
  assignStaffRoleSchema,
  endingRoleSchema,
  extendRoleSchema,
  staffHistoryEntrySchema,
  staffRoleViewSchema,
  resetRolePermissionsInput,
  revokeRoleSchema,
  roleAssignmentSelectSchema,
  roleAssignmentViewSchema,
  roleHolderSchema,
  rolePermissionChangeResultSchema,
  rolePermissionDefaultsSchema,
  rolePermissionRowSchema,
  updateRolePermissionsInput,
} from "@repo/contracts";
import { roleService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { orgListProcedure, router, staffProcedure } from "../trpc";

/**
 * ROLES — granting, revoking, and reading `role_assignments` (ADR-005,
 * ADR-035).
 *
 * **Authorization is evaluated against the node the grant is made AT.**
 * `assign` uses `addressedBy: "id"` with the TARGET scope node as the id —
 * the caller must cover the very node they are granting at, never a node
 * merely described alongside the grant. `revoke` resolves the assignment to
 * its own scope node the same way. Both permissions are SENSITIVE, so the
 * gate reads assignments fresh rather than trusting the five-minute cache —
 * exactly the property a privilege change needs.
 *
 * Every mutation appends to `authz_audit_log` and invalidates the TARGET
 * user's cache snapshot — the change lands on their next request, not in
 * five minutes (ADR-035 closes the Phase 1 "no audit writer" debt).
 *
 * The matrix read powers the editor (ADR-036): `permissionDefaults` serves
 * the grouped catalog + shipped defaults as data, `permissionUpdate` applies
 * a batched diff, `permissionReset` restores one role. Both writes carry
 * ADR-036's two locks (never org_admin, never a role you hold) in the
 * service, audit every changed permission, and end with an org-wide cache
 * invalidation — a matrix change touches every holder of the role.
 */
const resolveAssignmentOwner = async (organizationId: string, id: string) => {
  const owner = await roleService.getAssignmentOwnerId(organizationId, id);

  if (!owner) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Role assignment not found." });
  }

  // The org root is synthetic — no scope_nodes row exists for it, and
  // resolveNode answers the organization id with the org node itself.
  return { type: owner.scopeType, id: owner.scopeId };
};

export const roleRouter = router({
  // The ACTIVE assignments of one staff member, labeled for display. The
  // caller needs `role_assignment:read` SOMEWHERE in the org (permissive
  // list); the rows themselves belong to the caller's org by construction.
  assignments: orgListProcedure("role_assignment:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/role/assignments",
        tags: ["roles"],
        summary: "List a staff member's active role assignments",
        protect: true,
      },
    })
    .input(z.object({ userId: z.string().min(1) }))
    .output(z.array(roleAssignmentViewSchema))
    .query(async ({ ctx, input }) => {
      return roleService.listForUser(ctx.organizationId, input.userId);
    }),

  assign: staffProcedure("role_assignment:assign", { addressedBy: "id" })
    .meta({
      openapi: {
        method: "POST",
        path: "/role/assignments",
        tags: ["roles"],
        summary: "Grant a role at the addressed scope",
        protect: true,
      },
    })
    .input(assignRoleSchema.extend({ id: z.uuid() }))
    .output(roleAssignmentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // `input.id` is the target scope node — attached and gated by the
      // builder, so the service only re-checks the grant's own facts.
      return roleService.assign(ctx.organizationId, ctx.userId, {
        userId: input.userId,
        roleType: input.roleType,
        scopeType: input.scopeType,
        expiresAt: input.expiresAt ?? null,
        scopeId: input.id,
      });
    }),

  revoke: staffProcedure("role_assignment:revoke", {
    resolveOwner: resolveAssignmentOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/role/assignments/{id}/revoke",
        tags: ["roles"],
        summary: "Revoke a role assignment (reason required)",
        protect: true,
      },
    })
    .input(revokeRoleSchema.extend({ id: z.uuid() }))
    .output(roleAssignmentSelectSchema.nullable())
    .mutation(async ({ ctx, input }) => {
      const row = await roleService.revoke(
        ctx.organizationId,
        ctx.userId,
        input.id,
        input,
      );

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Role assignment not found." });
      }

      return row;
    }),

  // The org's permission matrix, read-only. Editing lives in the ADR-036
  // procedures below.
  permissions: orgListProcedure("role_permission:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/role/permissions",
        tags: ["roles"],
        summary: "The organisation's role → permission matrix",
        protect: true,
      },
    })
    .output(z.array(rolePermissionRowSchema))
    .query(async ({ ctx }) => {
      return roleService.listPermissions(ctx.organizationId);
    }),

  // WHO holds each role — the Roles area's companion read. Same permission
  // as the matrix: knowing who has power is part of seeing the power.
  holders: orgListProcedure("role_permission:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/role/holders",
        tags: ["roles"],
        summary: "Active role assignments with each holder's name",
        protect: true,
      },
    })
    .output(z.array(roleHolderSchema))
    .query(async ({ ctx }) => {
      return roleService.listHolders(ctx.organizationId);
    }),

  // The editor's vocabulary: the grouped catalog (resource → actions, by
  // display category) and the shipped defaults, as DATA — the web never
  // imports @repo/authz runtime code (ADR-036).
  permissionDefaults: orgListProcedure("role_permission:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/role/permissions/defaults",
        tags: ["roles"],
        summary: "The permission catalog and the shipped default matrix",
        protect: true,
      },
    })
    .output(rolePermissionDefaultsSchema)
    .query(async () => {
      return roleService.permissionDefaults();
    }),

  /**
   * The batched matrix edit (ADR-036). The two locks live in the service;
   * the actor's own role types are resolved here from the caller's auth
   * cache (expiry-filtered — an expired grant must not protect a role from
   * its holder's edit, it simply isn't held). `role_permission:update` is
   * SENSITIVE, so the gate itself read fresh.
   */
  permissionUpdate: staffProcedure("role_permission:update")
    .meta({
      openapi: {
        method: "POST",
        path: "/role/permissions/update",
        tags: ["roles"],
        summary: "Apply a batched permission diff to one role",
        protect: true,
      },
    })
    .input(updateRolePermissionsInput)
    .output(rolePermissionChangeResultSchema)
    .mutation(async ({ ctx, input }) => {
      const actorRoleTypes = ctx.authCache.assignments
        .filter(
          (a) =>
            a.organizationId === ctx.organizationId &&
            (a.expiresAt === null || a.expiresAt > new Date()),
        )
        .map((a) => a.roleType);

      return roleService.updatePermissions(
        ctx.organizationId,
        ctx.userId,
        actorRoleTypes,
        input,
      );
    }),

  // The safety hatch: restore one role to the shipped defaults, diff-only.
  permissionReset: staffProcedure("role_permission:update")
    .meta({
      openapi: {
        method: "POST",
        path: "/role/permissions/reset",
        tags: ["roles"],
        summary: "Restore one role to the shipped default matrix",
        protect: true,
      },
    })
    .input(resetRolePermissionsInput)
    .output(rolePermissionChangeResultSchema)
    .mutation(async ({ ctx, input }) => {
      const actorRoleTypes = ctx.authCache.assignments
        .filter(
          (a) =>
            a.organizationId === ctx.organizationId &&
            (a.expiresAt === null || a.expiresAt > new Date()),
        )
        .map((a) => a.roleType);

      return roleService.resetPermissions(
        ctx.organizationId,
        ctx.userId,
        actorRoleTypes,
        input.roleType,
      );
    }),

  // ── Staff roles on the phone (2026-11-15) ──────────────────────────────

  // A staff member's office roles, live and waiting. Same gate as assignments.
  forStaff: orgListProcedure("role_assignment:read")
    .meta({ openapi: { method: "GET", path: "/role/staff/{staffId}", tags: ["roles"], summary: "A staff member's office roles, live and waiting", protect: true } })
    .input(z.object({ staffId: z.uuid() }))
    .output(z.array(staffRoleViewSchema))
    .query(({ ctx, input }) => roleService.forStaff(ctx.organizationId, input.staffId)),

  // Give a role to a staff member, joined or not. The id is the node the role
  // is given AT, so the caller must hold role_assignment:assign there.
  assignStaff: staffProcedure("role_assignment:assign", { addressedBy: "id" })
    .meta({ openapi: { method: "POST", path: "/role/staff-assignments", tags: ["roles"], summary: "Give a staff member a role (waits until they join)", protect: true } })
    .input(assignStaffRoleSchema.extend({ id: z.uuid() }))
    .output(z.object({ waiting: z.boolean(), id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      roleService.assignToStaff(ctx.organizationId, ctx.userId, {
        staffId: input.staffId,
        roleType: input.roleType,
        scopeType: input.scopeType,
        scopeId: input.id,
        expiresAt: input.expiresAt ?? null,
      }),
    ),

  // Take back a role that was waiting for someone to join.
  cancelPending: staffProcedure("role_assignment:revoke", {
    resolveOwner: async (organizationId: string, id: string) => {
      const owner = await roleService.getPendingOwner(organizationId, id);
      if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "Role not found." });
      return { type: owner.scopeType, id: owner.scopeId };
    },
  })
    .meta({ openapi: { method: "POST", path: "/role/pending/{id}/cancel", tags: ["roles"], summary: "Cancel a waiting role", protect: true } })
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await roleService.cancelPending(ctx.organizationId, ctx.userId, input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Role not found." });
      return row;
    }),

  // Push out or remove a role's end date (also brings back one just ended).
  extend: staffProcedure("role_assignment:assign", { resolveOwner: resolveAssignmentOwner })
    .meta({ openapi: { method: "POST", path: "/role/assignments/{id}/extend", tags: ["roles"], summary: "Change a role's end date", protect: true } })
    .input(extendRoleSchema.extend({ id: z.uuid() }))
    .output(roleAssignmentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await roleService.extend(ctx.organizationId, ctx.userId, input.id, input.expiresAt);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Role assignment not found." });
      return row;
    }),

  // Office roles ending in the next 7 days or ended in the last 7, per branch.
  ending: orgListProcedure("role_assignment:read")
    .meta({ openapi: { method: "GET", path: "/role/ending", tags: ["roles"], summary: "Roles ending soon", protect: true } })
    .input(z.object({ forSchoolId: z.uuid() }))
    .output(z.array(endingRoleSchema))
    .query(({ ctx, input }) => roleService.ending(ctx.organizationId, input.forSchoolId)),

  // One staff member's history: roles, sign-in and status changes.
  history: orgListProcedure("role_assignment:read")
    .meta({ openapi: { method: "GET", path: "/role/history/{staffId}", tags: ["roles"], summary: "A staff member's role and sign-in history", protect: true } })
    .input(z.object({ staffId: z.uuid() }))
    .output(z.array(staffHistoryEntrySchema))
    .query(({ ctx, input }) => roleService.history(ctx.organizationId, input.staffId)),
});
