// ============================================================================
// RESOURCE_ACTIONS — the single source of truth for valid resource:action pairs.
//
// Key design choice: not every action is valid on every resource.
// `attendance:publish` is meaningless, so it's not allowed — compile error.
// The Permission type is derived from this map, making typos impossible.
//
// Groups:  Academic | Finance | Staff | Communication | Structure | Auth
// ============================================================================

export const RESOURCE_ACTIONS = {
  // ── Academic ──────────────────────────────────────────────────────────────
  student:                ['create', 'read', 'update', 'delete', 'export'],
  attendance:             ['create', 'read', 'update', 'delete', 'export'],
  marks:                  ['create', 'read', 'update', 'delete', 'publish', 'export'],
  report_card:            ['read', 'publish', 'export'],
  homework:               ['create', 'read', 'update', 'delete'],
  timetable:              ['create', 'read', 'update', 'delete'],
  syllabus:               ['create', 'read', 'update', 'delete'],

  // ── Finance ───────────────────────────────────────────────────────────────
  // Deliberately split into sub-resources so permissions can be fine-grained.
  // "accountant can see fee heads, can't create them" = fee_head:read without fee_head:create.
  fee_head:               ['create', 'read', 'update', 'delete'],
  fee_payment:            ['create', 'read', 'update', 'delete', 'approve', 'export'],
  student_fee_assignment: ['create', 'read', 'update', 'delete'],
  fee_waiver:             ['create', 'read', 'update', 'delete', 'approve'],
  fee_report:             ['read', 'export'],

  // ── Staff ─────────────────────────────────────────────────────────────────
  staff:                  ['create', 'read', 'update', 'delete', 'export'],
  leave:                  ['create', 'read', 'update', 'delete', 'approve'],

  // ── Communication ─────────────────────────────────────────────────────────
  announcement:           ['create', 'read', 'update', 'delete', 'publish'],

  // ── Structure (school skeleton, rarely changed) ───────────────────────────
  class:                  ['create', 'read', 'update', 'delete'],
  section:                ['create', 'read', 'update', 'delete'],

  // ── Config ────────────────────────────────────────────────────────────────
  school_settings:        ['read', 'update'],
  org_settings:           ['read', 'update'],

  // ── Auth management ───────────────────────────────────────────────────────
  role_permission:        ['read', 'update'],      // editing what a role can do
  role_assignment:        ['read', 'assign', 'revoke'], // assigning roles to staff
} as const satisfies Record<string, readonly string[]>;

export type Resource = keyof typeof RESOURCE_ACTIONS;

// ValidPermissionsFor<'fee_head'> = 'fee_head:create' | 'fee_head:read' | ...
export type ValidPermissionsFor<R extends Resource> =
  `${R}:${typeof RESOURCE_ACTIONS[R][number]}`;

// Permission = union of all valid resource:action strings.
// 'attendance:publish' doesn't exist in RESOURCE_ACTIONS['attendance'], so it's a compile error.
export type Permission = { [R in Resource]: ValidPermissionsFor<R> }[Resource];

export function isPermission(value: string): value is Permission {
  const [resource, action] = value.split(':') as [string, string];
  const validActions = RESOURCE_ACTIONS[resource as Resource] as readonly string[] | undefined;
  return !!validActions?.includes(action);
}

// ── Catalog (serialisable, sent to frontend permissions editor) ──────────────

export const RESOURCE_CATEGORIES: Record<string, Resource[]> = {
  'Academic':       ['student', 'attendance', 'marks', 'report_card', 'homework', 'timetable', 'syllabus'],
  'Finance':        ['fee_head', 'fee_payment', 'student_fee_assignment', 'fee_waiver', 'fee_report'],
  'Staff':          ['staff', 'leave'],
  'Communication':  ['announcement'],
  'Structure':      ['class', 'section'],
  'Configuration':  ['school_settings', 'org_settings'],
  'Auth':           ['role_permission', 'role_assignment'],
};

// Permissions that require a fresh DB auth-version check before proceeding.
// These cover operations that are hard to reverse or carry financial / access-control risk.
export const SENSITIVE_PERMISSIONS = new Set<Permission>([
  'fee_payment:approve',
  'fee_payment:delete',
  'fee_waiver:approve',
  'fee_waiver:create',
  'marks:publish',
  'marks:delete',
  'student:delete',
  'role_permission:update',
  'role_assignment:assign',
  'role_assignment:revoke',
]);
