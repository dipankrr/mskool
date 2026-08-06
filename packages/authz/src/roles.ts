import type { Resource } from "./permissions";
import { RESOURCE_ACTIONS } from "./permissions";

/**
 * Role types are FIXED in code, not rows in a table (ADR-011).
 *
 * Every school has the same role concepts — a principal is a principal. The
 * real variability is in which *permissions* each role holds, and that is
 * per-org data in org_role_permissions. Fully dynamic roles would buy cycle
 * detection and parent-chain walking to solve a problem no school actually
 * has.
 *
 * An org may not invent role types. It may: configure each role's permissions,
 * relabel a role in its own UI, and assign any role at any valid scope.
 *
 * To add a role type: add it here, add its defaults in defaultPermissions.ts,
 * and add the value to roleTypeEnum in @repo/db. Keep all three in step.
 */
export const ROLE_TYPES = [
  "org_admin",
  "principal",
  "vice_principal",
  "class_teacher",
  "subject_teacher",
  "accountant",
  "librarian",
  "staff_coordinator",
] as const;

export type RoleType = (typeof ROLE_TYPES)[number];

export function isRoleType(value: string): value is RoleType {
  return (ROLE_TYPES as readonly string[]).includes(value);
}

/** The four levels a role can be granted at. Broader first. */
export const SCOPE_TYPES = ["org", "school", "class", "section"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export function isScopeType(value: string): value is ScopeType {
  return (SCOPE_TYPES as readonly string[]).includes(value);
}

/** Broader scope = lower number. org(0) > school(1) > class(2) > section(3). */
export function scopeDepth(type: ScopeType): number {
  return SCOPE_TYPES.indexOf(type);
}

export function isBroaderOrEqual(a: ScopeType, b: ScopeType): boolean {
  return scopeDepth(a) <= scopeDepth(b);
}

/**
 * Where the assignment UI pre-selects a role. Advisory only — NOT enforced by
 * can(). The assignment's actual scopeType is authoritative, so an org may
 * deliberately grant 'principal' at org level across all its branches.
 */
export const DEFAULT_SCOPE_LEVEL: Record<RoleType, ScopeType> = {
  org_admin: "org",
  principal: "school",
  vice_principal: "school",
  class_teacher: "class",
  subject_teacher: "section",
  accountant: "school",
  librarian: "school",
  staff_coordinator: "org",
};

export const ROLE_LABELS: Record<RoleType, string> = {
  org_admin: "Organisation Admin",
  principal: "Principal",
  vice_principal: "Vice Principal",
  class_teacher: "Class Teacher",
  subject_teacher: "Subject Teacher",
  accountant: "Accountant",
  librarian: "Librarian",
  staff_coordinator: "Staff Coordinator",
};

/**
 * The narrowest scope at which a resource is meaningful. Used by the
 * permissions editor to hide irrelevant rows — org_settings on a
 * section-scoped role is noise. Advisory only, never enforced in can().
 */
export const RESOURCE_MIN_SCOPE: Record<Resource, ScopeType> = {
  org_settings: "org",
  role_permission: "org",
  role_assignment: "org",
  portal_access: "org",
  school: "org",
  staff: "school",
  leave: "school",
  announcement: "school",
  class: "school",
  section: "school",
  subject: "school",
  academic_year: "school",
  school_settings: "school",
  fee_head: "school",
  fee_structure: "school",
  fee_payment: "school",
  student_fee_assignment: "school",
  fee_waiver: "school",
  fee_refund: "school",
  fee_report: "school",
  exam: "school",
  enrollment: "school",
  timetable: "class",
  syllabus: "class",
  student: "section",
  attendance: "section",
  marks: "section",
  report_card: "section",
  homework: "section",
};

/** Resources grantable at `scopeType` or narrower. */
export function resourcesForScope(scopeType: ScopeType): Resource[] {
  const depth = scopeDepth(scopeType);
  return (Object.keys(RESOURCE_ACTIONS) as Resource[]).filter((resource) => {
    const min = RESOURCE_MIN_SCOPE[resource];
    return min ? scopeDepth(min) >= depth : true;
  });
}
