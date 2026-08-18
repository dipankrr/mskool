/**
 * RESOURCE_ACTIONS — the single source of truth for valid `resource:action`
 * pairs.
 *
 * Not every action is valid on every resource. `attendance:publish` is
 * meaningless, so it is not listed, and writing it is a compile error rather
 * than a permission that silently never matches. The Permission type is
 * derived from this map, which makes typos impossible at the call site.
 */
export const RESOURCE_ACTIONS = {
  // ── Academic ──────────────────────────────────────────────────────────────
  student: ["create", "read", "update", "delete", "export"],
  attendance: ["create", "read", "update", "delete", "export"],
  marks: ["create", "read", "update", "delete", "publish", "export"],
  report_card: ["read", "publish", "export"],
  homework: ["create", "read", "update", "delete"],
  timetable: ["create", "read", "update", "delete"],
  syllabus: ["create", "read", "update", "delete"],

  // ── Finance ───────────────────────────────────────────────────────────────
  // Split into sub-resources so grants can be fine-grained: "the accountant
  // may see fee heads but not create them" is fee_head:read without
  // fee_head:create.
  fee_head: ["create", "read", "update", "delete"],
  fee_structure: ["create", "read", "update", "delete"],
  fee_payment: ["create", "read", "update", "delete", "approve", "export"],
  student_fee_assignment: ["create", "read", "update", "delete"],
  fee_waiver: ["create", "read", "update", "delete", "approve"],
  fee_refund: ["create", "read", "approve"],
  fee_report: ["read", "export"],

  // ── Staff ─────────────────────────────────────────────────────────────────
  staff: ["create", "read", "update", "delete", "export"],
  leave: ["create", "read", "update", "delete", "approve"],

  // ── Communication ─────────────────────────────────────────────────────────
  announcement: ["create", "read", "update", "delete", "publish"],

  // ── Structure (the school skeleton — rarely changed) ──────────────────────
  school: ["create", "read", "update", "delete"],
  class: ["create", "read", "update", "delete"],
  section: ["create", "read", "update", "delete"],
  subject: ["create", "read", "update", "delete"],
  // `read_history` is a distinct action, not a scope inference (ADR-024): it
  // decides whether the caller may address a NON-current year at all. The year
  // picker offers past sessions only to a holder; every year-scoped read of a
  // past year is gated on it. Editable per org like any other permission
  // (ADR-011) — a school may hand it to whichever roles it trusts with history.
  academic_year: ["create", "read", "update", "delete", "read_history"],
  exam: ["create", "read", "update", "delete", "publish"],
  enrollment: ["create", "read", "update", "delete"],

  // ── Config ────────────────────────────────────────────────────────────────
  school_settings: ["read", "update"],
  org_settings: ["read", "update"],

  // ── Auth management ───────────────────────────────────────────────────────
  role_permission: ["read", "update"], // editing what a role may do
  role_assignment: ["read", "assign", "revoke"], // granting roles to staff
  portal_access: ["read", "grant", "revoke"], // student/parent portal logins
} as const satisfies Record<string, readonly string[]>;

export type Resource = keyof typeof RESOURCE_ACTIONS;

/** ValidPermissionsFor<'fee_head'> = 'fee_head:create' | 'fee_head:read' | … */
export type ValidPermissionsFor<R extends Resource> =
  `${R}:${(typeof RESOURCE_ACTIONS)[R][number]}`;

/**
 * The union of every valid `resource:action` string. `attendance:publish` is
 * not in it, so passing that to can() will not compile.
 */
export type Permission = {
  [R in Resource]: ValidPermissionsFor<R>;
}[Resource];

/**
 * Runtime guard for permission strings arriving from outside the type system —
 * the permissions editor, a seed file, a database row.
 */
export function isPermission(value: string): value is Permission {
  const [resource, action] = value.split(":") as [string, string];
  const validActions = RESOURCE_ACTIONS[resource as Resource] as
    | readonly string[]
    | undefined;
  return !!validActions?.includes(action);
}

export const ALL_PERMISSIONS: Permission[] = Object.entries(
  RESOURCE_ACTIONS,
).flatMap(([resource, actions]) =>
  (actions as readonly string[]).map((a) => `${resource}:${a}` as Permission),
);

/** Grouping for the permissions editor UI. Display only. */
export const RESOURCE_CATEGORIES: Record<string, Resource[]> = {
  Academic: [
    "student",
    "attendance",
    "marks",
    "report_card",
    "homework",
    "timetable",
    "syllabus",
    "enrollment",
  ],
  Finance: [
    "fee_head",
    "fee_structure",
    "fee_payment",
    "student_fee_assignment",
    "fee_waiver",
    "fee_refund",
    "fee_report",
  ],
  Staff: ["staff", "leave"],
  Communication: ["announcement"],
  Structure: ["school", "class", "section", "subject", "academic_year", "exam"],
  Configuration: ["school_settings", "org_settings"],
  Auth: ["role_permission", "role_assignment", "portal_access"],
};

/**
 * Permissions where a stale cache is unacceptable. For these, the caller
 * re-reads assignments from the database instead of trusting the Redis
 * snapshot — the cost of one extra query is nothing next to letting someone
 * approve a payment with access that was revoked a minute ago.
 *
 * Everything here is either financial, irreversible, or grants access.
 */
export const SENSITIVE_PERMISSIONS = new Set<Permission>([
  "fee_payment:approve",
  "fee_payment:delete",
  "fee_waiver:approve",
  "fee_waiver:create",
  "fee_refund:approve",
  "marks:publish",
  "marks:delete",
  "report_card:publish",
  "student:delete",
  "role_permission:update",
  "role_assignment:assign",
  "role_assignment:revoke",
  "portal_access:grant",
  "portal_access:revoke",
]);
