import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations } from "./organization";

export const scopeTypeEnum = pgEnum("scope_type", [
  "org",
  "school",
  "class",
  "section",
]);

export const roleTypeEnum = pgEnum("role_type", [
  "org_admin",
  "principal",
  "vice_principal",
  "class_teacher",
  "subject_teacher",
  "accountant",
  "librarian",
  "staff_coordinator",
]);

/**
 * The tree authorization walks. One row per school / class / section, plus a
 * synthetic org root.
 *
 * This table is what makes "a role granted at org level covers every school
 * beneath it" work without recursive queries: each node carries its own
 * ancestry denormalised into schoolId / classId.
 *
 * HARD RULE 12: creating a school, class, or section MUST insert its row here
 * in the SAME transaction. A node missing from this tree is unreachable —
 * every request touching it 403s, including from the user who created it.
 */
export const scopeNodes = pgTable(
  "scope_nodes",
  {
    // NOT defaultRandom: the id is the id of the entity this node represents
    // (the school's id, the class's id). That equality is what lets a request
    // resolve a node straight from a URL parameter.
    id: uuid().primaryKey(),
    type: scopeTypeEnum().notNull(),

    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),

    // Denormalised ancestry. null at a level means "this node IS that level".
    // For a school node, schoolId is null because `id` is the school id.
    schoolId: uuid(),
    classId: uuid(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scope_nodes_org_idx").on(t.organizationId),
    index("scope_nodes_school_idx").on(t.schoolId),
    index("scope_nodes_class_idx").on(t.classId),
  ],
);

/**
 * Which permissions each role type has, PER ORGANIZATION.
 *
 * Permissions are data, not code (ADR-011). One trust may let class teachers
 * edit marks after publication; another may not. Seeded from defaults when an
 * org is provisioned, then editable by that org's admin.
 *
 * This is the single source of truth for "may this role do X" — no other table
 * may answer that question (ADR-012).
 */
export const orgRolePermissions = pgTable(
  "org_role_permissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),

    roleType: roleTypeEnum().notNull(),
    // A `resource:action` string, e.g. "fee_payment:approve". Validated
    // against RESOURCE_ACTIONS in @repo/authz before insert; stored as text
    // so adding a permission needs no migration.
    permission: varchar({ length: 100 }).notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_role_permissions_uq").on(
      t.organizationId,
      t.roleType,
      t.permission,
    ),
    index("org_role_permissions_org_role_idx").on(t.organizationId, t.roleType),
  ],
);

/**
 * Staff → role → scope. STAFF ONLY (ADR-005).
 *
 * Students never have rows here; they are authorized through
 * student_portal_access by ownership instead. If you are writing a query that
 * joins students to this table, something has gone wrong.
 */
export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: uuid().primaryKey().defaultRandom(),

    // text, not uuid — better-auth owns the user table (hard rule 10).
    userId: text()
      .notNull()
      .references(() => user.id),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),

    roleType: roleTypeEnum().notNull(),

    // Where this role applies. scopeId points at a scope_nodes row; for
    // scopeType 'org' it is the organization id itself.
    scopeType: scopeTypeEnum().notNull(),
    scopeId: uuid().notNull(),

    // Temporary delegation — "cover this class while the teacher is on leave".
    // null means indefinite. Checked on every can() call, so an expired
    // assignment stops working without anyone running a cleanup job.
    expiresAt: timestamp({ withTimezone: true }),

    grantedBy: text().references(() => user.id),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    // Revocation is a soft delete (hard rule 2): who removed this access, and
    // when, is exactly what an audit asks about.
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("role_assignments_user_idx").on(t.userId),
    index("role_assignments_org_idx").on(t.organizationId),
    index("role_assignments_scope_idx").on(t.scopeType, t.scopeId),
  ],
);

export const authzAuditActionEnum = pgEnum("authz_audit_action", [
  "role_granted",
  "role_revoked",
  "role_expired",
  "permission_added",
  "permission_removed",
]);

/**
 * Append-only log of authorization changes. Who granted whom what, and when.
 *
 * Never updated or deleted. When an ex-employee turns out to have had fee
 * approval rights for six months, this is the table that says who gave them.
 */
export const authzAuditLog = pgTable(
  "authz_audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),

    action: authzAuditActionEnum().notNull(),

    // The user whose access changed.
    targetUserId: text().references(() => user.id),
    // The user who made the change. Null only for system actions.
    actorUserId: text().references(() => user.id),

    roleType: roleTypeEnum(),
    scopeType: scopeTypeEnum(),
    scopeId: uuid(),
    permission: varchar({ length: 100 }),

    // Free-form context: previous values, reason, request id.
    details: jsonb(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("authz_audit_log_org_idx").on(t.organizationId),
    index("authz_audit_log_target_idx").on(t.targetUserId),
    index("authz_audit_log_created_idx").on(t.createdAt),
  ],
);

export const scopeNodeRelations = relations(scopeNodes, ({ one }) => ({
  organization: one(organizations, {
    fields: [scopeNodes.organizationId],
    references: [organizations.id],
  }),
}));

export const roleAssignmentRelations = relations(roleAssignments, ({ one }) => ({
  user: one(user, {
    fields: [roleAssignments.userId],
    references: [user.id],
  }),
  organization: one(organizations, {
    fields: [roleAssignments.organizationId],
    references: [organizations.id],
  }),
}));

export const orgRolePermissionRelations = relations(
  orgRolePermissions,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [orgRolePermissions.organizationId],
      references: [organizations.id],
    }),
  }),
);
