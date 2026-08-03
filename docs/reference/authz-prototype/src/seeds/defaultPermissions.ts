import { db } from '../db/client';
import { orgRolePermissions } from '../db/schema';
import type { RoleType } from '../types/roles';
import type { Permission } from '../types/permissions';

// ============================================================================
// Default permissions per role type.
//
// These are the permissions each role gets when a new org is provisioned.
// Org admins can add or remove permissions from any role type after provisioning
// via the permissions editor (role.routes.ts).
//
// Design notes:
//   - No inheritance chains. Each role's permissions are fully explicit.
//   - "Less is more" for narrow roles: subject_teacher starts with minimal
//     permissions. Org admins can expand if needed.
//   - Fee domain is split into sub-resources so accountant gets exactly the
//     right access (fee_payment:create but not fee_head:create).
//   - All sensitive permissions (approve, publish, delete) only go to roles
//     whose job description warrants them.
// ============================================================================

const DEFAULT_PERMISSIONS: Record<RoleType, Permission[]> = {

  // ── Org Admin ────────────────────────────────────────────────────────────
  // Full access. The only role that can touch org_settings.
  org_admin: [
    'student:create', 'student:read', 'student:update', 'student:delete', 'student:export',
    'attendance:create', 'attendance:read', 'attendance:update', 'attendance:delete', 'attendance:export',
    'marks:create', 'marks:read', 'marks:update', 'marks:delete', 'marks:publish', 'marks:export',
    'report_card:read', 'report_card:publish', 'report_card:export',
    'homework:create', 'homework:read', 'homework:update', 'homework:delete',
    'timetable:create', 'timetable:read', 'timetable:update', 'timetable:delete',
    'syllabus:create', 'syllabus:read', 'syllabus:update', 'syllabus:delete',
    'fee_head:create', 'fee_head:read', 'fee_head:update', 'fee_head:delete',
    'fee_payment:create', 'fee_payment:read', 'fee_payment:update', 'fee_payment:delete', 'fee_payment:approve', 'fee_payment:export',
    'student_fee_assignment:create', 'student_fee_assignment:read', 'student_fee_assignment:update', 'student_fee_assignment:delete',
    'fee_waiver:create', 'fee_waiver:read', 'fee_waiver:update', 'fee_waiver:delete', 'fee_waiver:approve',
    'fee_report:read', 'fee_report:export',
    'staff:create', 'staff:read', 'staff:update', 'staff:delete', 'staff:export',
    'leave:create', 'leave:read', 'leave:update', 'leave:delete', 'leave:approve',
    'announcement:create', 'announcement:read', 'announcement:update', 'announcement:delete', 'announcement:publish',
    'class:create', 'class:read', 'class:update', 'class:delete',
    'section:create', 'section:read', 'section:update', 'section:delete',
    'school_settings:read', 'school_settings:update',
    'org_settings:read', 'org_settings:update',
    'role_permission:read', 'role_permission:update',
    'role_assignment:read', 'role_assignment:assign', 'role_assignment:revoke',
  ],

  // ── Principal ────────────────────────────────────────────────────────────
  // Full school management. No org_settings. Can approve but not create fee structures.
  principal: [
    'student:create', 'student:read', 'student:update', 'student:delete', 'student:export',
    'attendance:read', 'attendance:update', 'attendance:export',
    'marks:read', 'marks:update', 'marks:publish', 'marks:export',
    'report_card:read', 'report_card:publish', 'report_card:export',
    'homework:read', 'homework:update',
    'timetable:create', 'timetable:read', 'timetable:update', 'timetable:delete',
    'syllabus:create', 'syllabus:read', 'syllabus:update', 'syllabus:delete',
    'fee_head:read',
    'fee_payment:read', 'fee_payment:approve', 'fee_payment:export',
    'student_fee_assignment:create', 'student_fee_assignment:read', 'student_fee_assignment:update',
    'fee_waiver:read', 'fee_waiver:approve',
    'fee_report:read', 'fee_report:export',
    'staff:create', 'staff:read', 'staff:update', 'staff:export',
    'leave:read', 'leave:update', 'leave:approve',
    'announcement:create', 'announcement:read', 'announcement:update', 'announcement:delete', 'announcement:publish',
    'class:create', 'class:read', 'class:update', 'class:delete',
    'section:create', 'section:read', 'section:update', 'section:delete',
    'school_settings:read', 'school_settings:update',
    'role_permission:read',
    'role_assignment:read', 'role_assignment:assign', 'role_assignment:revoke',
  ],

  // ── Vice Principal ────────────────────────────────────────────────────────
  // Most of principal's access, minus financial approvals and some admin.
  vice_principal: [
    'student:create', 'student:read', 'student:update', 'student:export',
    'attendance:create', 'attendance:read', 'attendance:update', 'attendance:export',
    'marks:read', 'marks:update', 'marks:export',
    'report_card:read',
    'homework:create', 'homework:read', 'homework:update', 'homework:delete',
    'timetable:create', 'timetable:read', 'timetable:update', 'timetable:delete',
    'syllabus:create', 'syllabus:read', 'syllabus:update',
    'fee_payment:read',
    'fee_report:read',
    'staff:read', 'staff:update',
    'leave:read', 'leave:update', 'leave:approve',
    'announcement:create', 'announcement:read', 'announcement:update', 'announcement:publish',
    'class:read',
    'section:read',
    'school_settings:read',
    'role_assignment:read',
  ],

  // ── Class Teacher ─────────────────────────────────────────────────────────
  // Manages their class. Can mark attendance and enter marks for all sections in their class.
  // No subject restriction (subject_teacher is for that).
  class_teacher: [
    'student:read', 'student:export',
    'attendance:create', 'attendance:read', 'attendance:update', 'attendance:export',
    'marks:create', 'marks:read', 'marks:update', 'marks:export',
    'report_card:read',
    'homework:create', 'homework:read', 'homework:update', 'homework:delete',
    'timetable:read',
    'syllabus:read',
    'announcement:create', 'announcement:read', 'announcement:publish',
    'leave:create', 'leave:read',
  ],

  // ── Subject / Section Teacher ─────────────────────────────────────────────
  // Most granular teaching role. Assigned at section scope.
  // Subject restriction is enforced via staff_subject_assignments table at the
  // business logic layer — not here. These are just the permissions for the section.
  subject_teacher: [
    'student:read',
    'attendance:create', 'attendance:read', 'attendance:update',
    'marks:create', 'marks:read', 'marks:update',
    'homework:create', 'homework:read', 'homework:update',
    'timetable:read',
    'syllabus:read',
    'announcement:read',
    'leave:create', 'leave:read',
  ],

  // ── Accountant ────────────────────────────────────────────────────────────
  // Records and views payments. Cannot create fee structures or approve waivers.
  // Org accountants are assigned this role at org scope (schoolId: null).
  accountant: [
    'fee_head:read',
    'fee_payment:create', 'fee_payment:read', 'fee_payment:update', 'fee_payment:export',
    'student_fee_assignment:create', 'student_fee_assignment:read',
    'fee_waiver:read',
    'fee_report:read', 'fee_report:export',
    'student:read', // to look up students for fee allocation
  ],

  // ── Librarian ─────────────────────────────────────────────────────────────
  // Basic library operations. Minimal permissions — add domain-specific
  // library resources when you build that feature.
  librarian: [
    'student:read',
    'announcement:read',
    'leave:create', 'leave:read',
  ],

  // ── Staff Coordinator ─────────────────────────────────────────────────────
  // HR-adjacent: manages staff, leave, and announcements across the org.
  staff_coordinator: [
    'staff:create', 'staff:read', 'staff:update', 'staff:export',
    'leave:read', 'leave:update', 'leave:approve',
    'announcement:create', 'announcement:read', 'announcement:update', 'announcement:publish',
  ],
};

// ── seedOrg ──────────────────────────────────────────────────────────────────
// Call when provisioning a new org. Copies default permissions into
// org_role_permissions for every role type.
// Safe to call multiple times (onConflictDoNothing).
export async function seedOrg(orgId: string): Promise<void> {
  const rows: { orgId: string; roleType: RoleType; permission: Permission }[] = [];

  for (const [roleType, permissions] of Object.entries(DEFAULT_PERMISSIONS) as [RoleType, Permission[]][]) {
    for (const permission of permissions) {
      rows.push({ orgId, roleType, permission });
    }
  }

  if (rows.length === 0) return;

  // Batch insert in chunks of 500 to avoid parameter limit
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db.insert(orgRolePermissions)
      .values(rows.slice(i, i + chunkSize) as any)
      .onConflictDoNothing();
  }
}

export { DEFAULT_PERMISSIONS };
