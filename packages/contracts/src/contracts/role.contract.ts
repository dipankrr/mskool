import {
  orgRolePermissions,
  roleAssignments,
  roleTypeEnum,
  scopeTypeEnum,
} from "@repo/db/schema";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * ROLES — role assignments and the permission matrix (ADR-005, ADR-011).
 *
 * An assignment is STAFF → role → scope: "Priya is a principal AT school A".
 * The scope target is a `scope_nodes` id (`role_assignments_scope_id_fk`
 * via the ADR-019 CHECKs); for `scopeType: "org"` the scope id IS the
 * organization id. Grants are REVOKED, never deleted (hard rule 2) —
 * `revokedAt`/`revokedBy` are the audit.
 *
 * The permission matrix (`org_role_permissions`) is DATA, not code
 * (ADR-011) — this slice reads it only. Editing it
 * (`role_permission:update`) is deliberately deferred (ADR-035): orgs run
 * on the seeded defaults until a real tenant asks.
 */

export const roleTypeSchema = z.enum(roleTypeEnum.enumValues);
export type RoleType = z.infer<typeof roleTypeSchema>;

export const scopeTypeSchema = z.enum(scopeTypeEnum.enumValues);
export type ScopeType = z.infer<typeof scopeTypeSchema>;

export const roleAssignmentSelectSchema = createSelectSchema(roleAssignments);
export type RoleAssignment = z.infer<typeof roleAssignmentSelectSchema>;

/**
 * GRANT a role. The scope TARGET is the node the request is addressed at —
 * the router binds `id` to it (addressedBy: "id"), so authorization is
 * evaluated against exactly the node being granted AT, never a node the
 * client merely described alongside it. `scopeType` must agree with the
 * node's real type; the service re-checks (REST callers are not
 * type-checked against this router).
 */
export const assignRoleSchema = z.object({
  /**
   * better-auth's own id — TEXT, not a uuid (hard rule 10's exception).
   * z.uuid() here rejected every real user id.
   */
  userId: z.string().min(1),
  roleType: roleTypeSchema,
  scopeType: scopeTypeSchema,
  /** Temporary delegation — "cover this class while she is on leave". */
  expiresAt: z.iso.datetime({ offset: true }).nullish(),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

/**
 * REVOKE a grant. The reason is REQUIRED — the audit row is the point
 * (the same rule as the portal's phone change).
 */
export const revokeRoleSchema = z.object({
  reason: z.string().min(3, "Say why — the reason is recorded.").max(500),
});
export type RevokeRoleInput = z.infer<typeof revokeRoleSchema>;

/** One row of the org's permission matrix, grouped client-side. */
export const rolePermissionRowSchema = z.object({
  roleType: roleTypeSchema,
  permission: z.string(),
});
export type RolePermissionRow = z.infer<typeof rolePermissionRowSchema>;

/**
 * The EDITOR's vocabulary (ADR-036), served rather than imported — the web
 * never imports @repo/authz runtime code. One category holds the resources
 * it groups; each resource carries its selectable actions.
 */
export const permissionCategorySchema = z.object({
  category: z.string(),
  resources: z.array(
    z.object({
      resource: z.string(),
      actions: z.array(z.string()),
    }),
  ),
});
export type PermissionCategory = z.infer<typeof permissionCategorySchema>;

export const rolePermissionDefaultsSchema = z.object({
  catalog: z.array(permissionCategorySchema),
  defaults: z.array(rolePermissionRowSchema),
});
export type RolePermissionDefaults = z.infer<typeof rolePermissionDefaultsSchema>;

/**
 * BATCHED matrix edit (ADR-036): the UI collects checkbox toggles behind a
 * dirty bar and saves the whole diff in one call. `add`/`remove` are plain
 * `resource:action` strings — validated against the union server-side with
 * `isPermission`, so an invalid permission is refused, never stored.
 */
export const updateRolePermissionsInput = z.object({
  roleType: roleTypeSchema,
  add: z.array(z.string().min(1)).max(200).default([]),
  remove: z.array(z.string().min(1)).max(200).default([]),
});
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsInput>;

export const resetRolePermissionsInput = z.object({
  roleType: roleTypeSchema,
});
export type ResetRolePermissionsInput = z.infer<typeof resetRolePermissionsInput>;

export const rolePermissionChangeResultSchema = z.object({
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
});
export type RolePermissionChangeResult = z.infer<typeof rolePermissionChangeResultSchema>;

/** An assignment joined with a human-readable label for its target node. */
export const roleAssignmentViewSchema = roleAssignmentSelectSchema.extend({
  scopeLabel: z.string(),
});
export type RoleAssignmentView = z.infer<typeof roleAssignmentViewSchema>;

/** One active assignment, flattened to "who holds what" for the Roles area. */
export const roleHolderSchema = z.object({
  roleType: roleTypeSchema,
  staffId: z.uuid(),
  name: z.string(),
  userId: z.string(),
});
export type RoleHolder = z.infer<typeof roleHolderSchema>;
