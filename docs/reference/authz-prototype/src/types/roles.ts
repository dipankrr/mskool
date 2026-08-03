import type { ScopeType } from './hierarchy';

// ============================================================================
// Fixed role types — not fully dynamic.
//
// Why fixed: every school has the same org structure. The real variability
// is in *permissions* per role, not in role *concepts*. Fully dynamic roles
// added cycle detection, parent-chain walking, and an `org_roles` table to
// solve a problem that doesn't exist in practice.
//
// Orgs cannot create new role types. They can:
//   - Configure which permissions each role type has (via org_role_permissions)
//   - Rename how the role is displayed in their UI (a UI concern, not authz)
//   - Assign any role type at any valid scope level
//
// To add a new role type: add it here + add default permissions in
// seeds/defaultPermissions.ts. One code change, no DB migration needed.
// ============================================================================

export const ROLE_TYPES = [
  'org_admin',
  'principal',
  'vice_principal',
  'class_teacher',
  'subject_teacher',
  'accountant',
  'librarian',
  'staff_coordinator',
] as const;

export type RoleType = typeof ROLE_TYPES[number];

export function isRoleType(value: string): value is RoleType {
  return (ROLE_TYPES as readonly string[]).includes(value);
}

// Advisory default scope level for each role type.
// Used by the assignment UI to pre-select the right scope level.
// NOT enforced at the authz level — the assignment's actual scope_type is authoritative.
// A 'principal' can technically be assigned at org scope if the org admin chooses to.
export const DEFAULT_SCOPE_LEVEL: Record<RoleType, ScopeType> = {
  org_admin:        'org',
  principal:        'school',
  vice_principal:   'school',
  class_teacher:    'class',
  subject_teacher:  'section',
  accountant:       'school',
  librarian:        'school',
  staff_coordinator:'org',
};

// Human-readable labels for UI display.
export const ROLE_LABELS: Record<RoleType, string> = {
  org_admin:        'Organisation Admin',
  principal:        'Principal',
  vice_principal:   'Vice Principal',
  class_teacher:    'Class Teacher',
  subject_teacher:  'Subject / Section Teacher',
  accountant:       'Accountant',
  librarian:        'Librarian',
  staff_coordinator:'Staff Coordinator',
};
