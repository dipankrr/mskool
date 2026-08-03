import {
  pgTable, pgEnum, uuid, varchar, boolean, integer,
  timestamp, primaryKey, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────────────────────────────

// Scope type is an enum — the DB rejects invalid values at the constraint level.
export const scopeTypeEnum = pgEnum('scope_type', ['org', 'school', 'class', 'section']);

// Role type is an enum — prevents typos, DB-enforced.
export const roleTypeEnum = pgEnum('role_type', [
  'org_admin', 'principal', 'vice_principal', 'class_teacher',
  'subject_teacher', 'accountant', 'librarian', 'staff_coordinator',
]);

// ── Core tables ────────────────────────────────────────────────────────────

export const organisations = pgTable('organisations', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      varchar('name', { length: 255 }).notNull(),
  slug:      varchar('slug', { length: 64 }).notNull().unique(),
  isActive:  boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id:              uuid('id').primaryKey().defaultRandom(),
  name:            varchar('name', { length: 255 }).notNull(),
  email:           varchar('email', { length: 255 }).notNull().unique(),
  isPlatformAdmin: boolean('is_platform_admin').default(false).notNull(),
  // auth_version is bumped on every permission change affecting this user.
  // Sensitive routes compare cache.authVersion to this value.
  // Mismatch = rebuild cache before proceeding.
  authVersion:     integer('auth_version').default(1).notNull(),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
});

// ── scope_nodes — the hierarchy cache ─────────────────────────────────────
//
// Every school, class, and section gets a row here when it is created.
// Stores the full ancestry so authorization checks need only one lookup:
//   "Does section SA belong to class C3?" → look up SA, check classId === C3.
//
// This table is what makes the clean scope_type+scope_id model possible.
// Without it, scopeCovers() would need recursive DB queries.
//
// Populated by: domain route handlers when creating schools/classes/sections.
// Cached in Redis with 24h TTL, invalidated on school structure changes.
// Org nodes are synthetic — they're never inserted here, resolved in code.
export const scopeNodes = pgTable('scope_nodes', {
  id:       uuid('id').primaryKey(),   // same UUID as the school/class/section row
  type:     scopeTypeEnum('type').notNull(),
  orgId:    uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  schoolId: uuid('school_id'),         // null only for school-type nodes (that IS the school)
  classId:  uuid('class_id'),          // set for class and section nodes
  // For section nodes: id IS the sectionId (no separate sectionId column needed)
}, (table) => ({
  orgIdx:    index('scope_nodes_org_idx').on(table.orgId),
  typeIdx:   index('scope_nodes_type_idx').on(table.type, table.orgId),
}));

// ── org_role_permissions — WHAT each role can do, per org ─────────────────
//
// Dynamic: org admins edit this via the permissions dashboard. No code changes.
// Seeded from defaultPermissions.ts on org provisioning.
//
// Because role types are fixed, there's no join to an org_roles table.
// (orgId, roleType, permission) is the full triple.
export const orgRolePermissions = pgTable('org_role_permissions', {
  orgId:      uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  roleType:   roleTypeEnum('role_type').notNull(),
  permission: varchar('permission', { length: 128 }).notNull(),
}, (table) => ({
  pk:     primaryKey({ columns: [table.orgId, table.roleType, table.permission] }),
  orgIdx: index('org_role_permissions_org_idx').on(table.orgId),
}));

// ── role_assignments — WHERE a user can act ────────────────────────────────
//
// The clean scope model: two columns replace the old nullable quadruple.
//   scope_type = 'org' | 'school' | 'class' | 'section'
//   scope_id   = UUID of the matching org/school/class/section
//
// Invalid states like (classId=C3, schoolId=null) structurally cannot exist
// because scope is expressed as a single (type, id) pair, not nullable columns.
//
// Examples:
//   scope_type='org',     scope_id=O1   → org-wide access
//   scope_type='school',  scope_id=S1   → only school S1
//   scope_type='class',   scope_id=C3   → only class C3 (all its sections)
//   scope_type='section', scope_id=SA   → only section A of class C3
export const roleAssignments = pgTable('role_assignments', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleType:  roleTypeEnum('role_type').notNull(),
  orgId:     uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  scopeType: scopeTypeEnum('scope_type').notNull(),
  scopeId:   uuid('scope_id').notNull(),  // FK to org/school/class/section, enforced in app
  grantedBy: uuid('granted_by').references(() => users.id),
  grantedAt: timestamp('granted_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
}, (table) => ({
  userIdx:    index('role_assignments_user_idx').on(table.userId),
  userOrgIdx: index('role_assignments_user_org_idx').on(table.userId, table.orgId),
  orgIdx:     index('role_assignments_org_idx').on(table.orgId),
  // Prevents duplicate assignments of the same role+scope to the same user.
  uniqueAssignment: uniqueIndex('role_assignments_unique')
    .on(table.userId, table.orgId, table.roleType, table.scopeType, table.scopeId),
}));

// ── authz_audit_log — immutable record of auth mutations ──────────────────
//
// Every grant/revoke/permission-change is written here.
// Answers: "who changed what, when, and what did it look like before?"
export const authzAuditLog = pgTable('authz_audit_log', {
  id:           uuid('id').primaryKey().defaultRandom(),
  actorUserId:  uuid('actor_user_id').notNull(),
  orgId:        uuid('org_id').notNull(),
  action:       varchar('action', { length: 64 }).notNull(),
  // permission_granted | permission_revoked | role_assigned | role_revoked
  targetUserId: uuid('target_user_id'),
  targetRole:   roleTypeEnum('target_role'),
  scopeType:    scopeTypeEnum('scope_type'),
  scopeId:      uuid('scope_id'),
  details:      varchar('details', { length: 2048 }), // JSON context snapshot
  createdAt:    timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  orgIdx:   index('authz_audit_log_org_idx').on(table.orgId),
  actorIdx: index('authz_audit_log_actor_idx').on(table.actorUserId),
}));
