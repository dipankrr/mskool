import type { Resource } from './permissions';
import { RESOURCE_ACTIONS } from './permissions';

export const SCOPE_TYPES = ['org', 'school', 'class', 'section'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export function isScopeType(v: string): v is ScopeType {
  return (SCOPE_TYPES as readonly string[]).includes(v);
}

// Broader scope = lower index. org(0) > school(1) > class(2) > section(3).
export function scopeDepth(type: ScopeType): number {
  return SCOPE_TYPES.indexOf(type);
}

export function isBroaderOrEqual(a: ScopeType, b: ScopeType): boolean {
  return scopeDepth(a) <= scopeDepth(b);
}

// ── Resource → minimum meaningful scope level ─────────────────────────────
// Used by the permissions editor UI to show only relevant resources for a
// given role's default scope. Advisory only — NOT enforced in can().
export const RESOURCE_MIN_SCOPE: Record<Resource, ScopeType> = {
  org_settings:           'org',
  role_permission:        'org',
  role_assignment:        'org',     // delegatable at any level, but defined at org
  staff_coordinator:      'org',
  staff:                  'school',
  leave:                  'school',
  announcement:           'school',
  class:                  'school',
  section:                'school',
  school_settings:        'school',
  fee_head:               'school',
  fee_payment:            'school',
  student_fee_assignment: 'school',
  fee_waiver:             'school',
  fee_report:             'school',
  timetable:              'class',
  syllabus:               'class',
  student:                'section',
  attendance:             'section',
  marks:                  'section',
  report_card:            'section',
  homework:               'section',
} as Record<Resource, ScopeType>;

// Returns resources whose minimum scope is at or below `scopeType`.
// An org-level role can be granted any resource.
// A section-level role can only be granted section-level resources.
export function resourcesForScope(scopeType: ScopeType): Resource[] {
  const depth = scopeDepth(scopeType);
  return (Object.keys(RESOURCE_ACTIONS) as Resource[]).filter(resource => {
    const min = RESOURCE_MIN_SCOPE[resource];
    return min ? scopeDepth(min) >= depth : true;
  });
}
