/**
 * Office roles and permissions in plain words (frames R1-R24,
 * prototype/staff-roles.html). Pure; unit-tested in role-logic.test.ts.
 *
 * Teacher is not a role here: it is the staff record's `teachesClasses`
 * flag, and teaching access comes from Teaching (ADR-068).
 */
import type { AppIconName } from "../../components/app-icon";

export type OfficeRole =
  | "org_admin"
  | "principal"
  | "vice_principal"
  | "accountant"
  | "librarian"
  | "staff_coordinator";

export type RoleMeta = {
  type: OfficeRole;
  label: string;
  /** One line under the name in the picker. */
  short: string;
  /** What the job title fills with when this is the first pick. */
  title: string;
  icon: AppIconName;
  bg: string;
  fg: string;
};

export const OFFICE_ROLES: readonly RoleMeta[] = [
  { type: "principal", label: "Principal", short: "Runs the branch", title: "Principal", icon: "star", bg: "#E6EEFF", fg: "#2556D9" },
  { type: "vice_principal", label: "Vice principal", short: "Helps run it", title: "Vice Principal", icon: "shield", bg: "#E6EEFF", fg: "#2556D9" },
  { type: "accountant", label: "Accountant", short: "Fees and receipts", title: "Accountant", icon: "fees", bg: "#FFF1DE", fg: "#B54708" },
  { type: "librarian", label: "Librarian", short: "Library", title: "Librarian", icon: "reading", bg: "#EFEAFE", fg: "#6440D8" },
  { type: "staff_coordinator", label: "Coordinator", short: "Staff records", title: "Coordinator", icon: "students", bg: "#E3F5F2", fg: "#0E8274" },
  { type: "org_admin", label: "Org admin", short: "Everything, every branch", title: "", icon: "globe", bg: "#101828", fg: "#FFFFFF" },
];

const META = new Map(OFFICE_ROLES.map((r) => [r.type as string, r]));

export function roleMeta(type: string): RoleMeta | null {
  return META.get(type) ?? null;
}

export function roleLabel(type: string): string {
  if (type === "class_teacher") return "Class teacher";
  if (type === "subject_teacher") return "Subject teacher";
  return META.get(type)?.label ?? type.replace(/_/g, " ");
}

/** Org admin is always given for the whole organisation. */
export const isOrgOnly = (type: OfficeRole) => type === "org_admin";

/** The job title to fill from the picks: the first office role's title. */
export function titleFromPicks(picks: readonly OfficeRole[]): string {
  for (const role of OFFICE_ROLES) {
    if (picks.includes(role.type) && role.title) return role.title;
  }
  return "";
}

/** The office roles this person may give in the add form and the sheet. */
export function givableRoles(opts: { canAssign: boolean; canAssignOrgWide: boolean }): RoleMeta[] {
  if (!opts.canAssign) return [];
  return OFFICE_ROLES.filter((r) => !isOrgOnly(r.type) || opts.canAssignOrgWide);
}

// ── Permissions in plain words ─────────────────────────────────────────────

export const GROUP_LABELS: Record<string, { label: string; icon: AppIconName; bg: string; fg: string }> = {
  Finance: { label: "Fees", icon: "fees", bg: "#FFF1DE", fg: "#B54708" },
  Academic: { label: "Students and teaching", icon: "students", bg: "#E6EEFF", fg: "#2556D9" },
  Structure: { label: "School setup", icon: "school", bg: "#E3F5F2", fg: "#0E8274" },
  Staff: { label: "Staff and leave", icon: "person", bg: "#EFEAFE", fg: "#6440D8" },
  Communication: { label: "Notices", icon: "message", bg: "#EEF0F4", fg: "#475467" },
  Auth: { label: "Access and logins", icon: "shield", bg: "#EEF0F4", fg: "#475467" },
  Configuration: { label: "Settings", icon: "settings", bg: "#EEF0F4", fg: "#475467" },
  Website: { label: "Website", icon: "globe", bg: "#EEF0F4", fg: "#475467" },
};

/** The order groups are listed in: the busiest first. */
export const GROUP_ORDER = ["Finance", "Academic", "Structure", "Staff", "Communication", "Auth", "Configuration", "Website"];

const RESOURCE_LABELS: Record<string, string> = {
  student: "Students",
  attendance: "Attendance",
  marks: "Marks",
  report_card: "Report cards",
  homework: "Homework",
  timetable: "Timetable",
  syllabus: "Syllabus",
  enrollment: "Students' classes",
  id_card: "ID cards",
  fee_payment: "Collecting fees",
  fee_waiver: "Concessions",
  fee_refund: "Refunds",
  fee_report: "Fee reports",
  fee_head: "Fee heads",
  fee_structure: "Fee plans",
  student_fee_assignment: "Fees per student",
  staff: "Staff",
  leave: "Leave",
  announcement: "Notices",
  school: "Branches",
  class: "Classes",
  section: "Sections",
  subject: "Subjects",
  academic_year: "Sessions",
  exam: "Exams",
  teacher_assignment: "Teaching",
  school_settings: "Branch settings",
  org_settings: "Organisation settings",
  role_permission: "What roles can do",
  role_assignment: "Giving roles",
  portal_access: "Family logins",
  public_site: "Website",
};

const ACTION_LABELS: Record<string, string> = {
  read: "See",
  create: "Add",
  update: "Change",
  delete: "Delete",
  export: "Export",
  verify: "Verify",
  publish: "Publish",
  grade: "Grade",
  comment: "Comment",
  approve: "Approve",
  manage: "Manage",
  print: "Print",
  edit: "Edit",
  read_history: "Past sessions",
  assign: "Give",
  revoke: "Take away",
  grant: "Grant",
  activate: "Activate",
  reset_password: "Reset password",
  change_phone: "Change phone",
};

const ACTION_OVERRIDES: Record<string, string> = {
  "fee_payment:create": "Collect",
  "fee_waiver:create": "Give",
  "fee_refund:create": "Refund",
  "homework:create": "Give",
  "staff:delete": "Mark as left",
};

export const resourceLabel = (resource: string) => RESOURCE_LABELS[resource] ?? resource.replace(/_/g, " ");

export function actionLabel(permission: string): string {
  const action = permission.split(":")[1] ?? permission;
  return ACTION_OVERRIDES[permission] ?? ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

/** "Collecting fees: Approve", for review and reset lists. */
export function permissionLabel(permission: string): string {
  const [resource = ""] = permission.split(":");
  return `${resourceLabel(resource)}: ${actionLabel(permission)}`;
}

/** Actions are listed see-first, then the rest in catalog order. */
export function orderedActions(resource: string, actions: readonly string[]): string[] {
  const read = actions.includes("read") ? ["read"] : [];
  return [...read, ...actions.filter((a) => a !== "read")].map((a) => `${resource}:${a}`);
}

// ── The editor's changes ───────────────────────────────────────────────────

/** What saving would add and remove, against what the role has now. */
export function diffPermissions(current: ReadonlySet<string>, draft: ReadonlySet<string>) {
  const add = [...draft].filter((p) => !current.has(p)).sort();
  const remove = [...current].filter((p) => !draft.has(p)).sort();
  return { add, remove, count: add.length + remove.length };
}

/** Counts per group: how many of the group's permissions the role has. */
export function groupCounts(
  catalog: readonly { category: string; resources: readonly { resource: string; actions: readonly string[] }[] }[],
  held: ReadonlySet<string>,
) {
  return catalog.map((group) => {
    const all = group.resources.flatMap((r) => r.actions.map((a) => `${r.resource}:${a}`));
    return { category: group.category, total: all.length, held: all.filter((p) => held.has(p)).length };
  });
}

/** Why this person can't edit this role, or null when they can. */
export function editLock(roleType: string, myRoleTypes: readonly string[]): "org_admin" | "self" | null {
  if (roleType === "org_admin") return "org_admin";
  if (myRoleTypes.includes(roleType)) return "self";
  return null;
}
