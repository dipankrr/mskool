import {
  assignRoleSchema,
  revokeRoleSchema,
  roleAssignmentSelectSchema,
  roleAssignmentViewSchema,
  rolePermissionRowSchema,
} from "@repo/contracts";
import { roleService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure } from "../trpc";

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
 * The matrix read is deliberately read-only: `role_permission:update` is
 * deferred (ADR-035) — orgs run on the seeded defaults.
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
  assignments: staffListProcedure("role_assignment:read")
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

  // The org's permission matrix, read-only. Display is the v1 scope;
  // editing waits for a real tenant's request (ADR-035).
  permissions: staffListProcedure("role_permission:read")
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
});
