import type { Href } from "expo-router";

import type { AppIconName } from "../../components/app-icon";
import { copy } from "../../lib/copy";

/**
 * The sidebar's map: the web sidebar's three groups (Daily, Academics,
 * Administration) and its fold-open items, filled with the screens the phone
 * has. Every line is filtered by the caller's permission hints, item by item,
 * so a sub-line never rescues a parent the caller cannot open; the server
 * re-checks every screen anyway.
 *
 * Only screens that open with no parameters belong here. A screen that needs a
 * student, a staff member or a paper is reached from that record.
 */

export type NavSub = {
  key: string;
  label: string;
  href: Href;
  /** Starts something (Admit a student) rather than opening a list. */
  action?: boolean;
  /** A bottom tab: switch to it instead of pushing a screen over the tabs. */
  tab?: boolean;
};

export type NavItem = {
  key: string;
  label: string;
  icon: AppIconName;
  /** Where the item itself goes when it has no sub-lines. */
  href?: Href;
  tab?: boolean;
  /** Not built yet: shown, tagged, not tappable. */
  soon?: boolean;
  subs: NavSub[];
};

export type NavGroup = { key: string; label: string | null; items: NavItem[] };

type Has = (permission: string) => boolean;

/** Lands on a list with its add sheet already open. */
const CREATE = { create: "1" } as const;

type SubDraft = NavSub & { can: boolean };
type ItemDraft = Omit<NavItem, "subs"> & { can: boolean; subs?: SubDraft[] };

export function buildNav(has: Has): NavGroup[] {
  const any = (...permissions: string[]) => permissions.some(has);
  const n = copy.shell.nav;
  const canPhotos = has("student:update") && has("student:read");
  const canExamSetup = has("exam:create") || has("exam:update");

  const groups: { key: string; label: string | null; items: ItemDraft[] }[] = [
    {
      key: "top",
      label: null,
      items: [{ key: "home", label: n.home, icon: "home", href: "/home", tab: true, can: true }],
    },
    {
      key: "daily",
      label: copy.shell.groups.daily,
      items: [
        {
          key: "students",
          label: n.students,
          icon: "students",
          can: has("student:read"),
          subs: [
            { key: "students-all", label: n.allStudents, href: "/(staff)/(tabs)/students", tab: true, can: true },
            { key: "students-admit", label: n.admit, href: "/admit-student", action: true, can: has("student:create") },
            { key: "students-photos", label: n.bulkPhotos, href: "/students/photos", can: canPhotos },
            { key: "students-photo-day", label: n.photoDay, href: "/students/photo-day", can: canPhotos },
          ],
        },
        {
          key: "attendance",
          label: n.attendance,
          icon: "attendance",
          can: any("attendance:read", "attendance:create"),
          subs: [
            { key: "attendance-mark", label: n.markAttendance, href: "/attendance", tab: true, action: has("attendance:create"), can: true },
            { key: "attendance-setup", label: n.attendanceSetup, href: "/attendance/manage", can: has("attendance:update") },
          ],
        },
        {
          key: "homework",
          label: n.homework,
          icon: "homework",
          can: has("homework:read"),
          subs: [
            { key: "homework-tab", label: n.homeworkToday, href: "/homework", tab: true, can: true },
            { key: "homework-give", label: n.giveHomework, href: "/homework/give", action: true, can: has("homework:create") },
            { key: "homework-all", label: n.allHomework, href: "/homework/all", can: true },
          ],
        },
        {
          key: "fees",
          label: n.fees,
          icon: "fees",
          can: any("fee_report:read", "student_fee_assignment:read"),
          subs: [
            { key: "fees-desk", label: n.feesOverview, href: "/fees", tab: true, can: true },
            { key: "fees-collect", label: n.collect, href: "/fees/collect", action: true, can: has("fee_payment:create") },
            { key: "fees-payments", label: n.payments, href: "/fees/payments", can: has("fee_payment:read") },
            { key: "fees-ledger", label: n.ledger, href: "/fees/ledger", can: has("fee_report:read") },
            { key: "fees-setup", label: n.feeSetup, href: "/fees/setup", can: has("fee_structure:read") },
            {
              key: "fees-add-head",
              label: n.addFeeHead,
              href: { pathname: "/fees/setup/heads", params: CREATE },
              action: true,
              can: has("fee_head:read") && has("fee_head:create"),
            },
            {
              key: "fees-add-structure",
              label: n.addFeeStructure,
              href: { pathname: "/fees/setup/structures", params: CREATE },
              action: true,
              can: has("fee_structure:read") && has("fee_structure:create"),
            },
          ],
        },
      ],
    },
    {
      key: "academics",
      label: copy.shell.groups.academics,
      items: [
        {
          key: "classes",
          label: n.classes,
          icon: "stack",
          can: has("class:read"),
          subs: [
            { key: "classes-all", label: n.classSection, href: "/class-section", can: true },
            {
              key: "classes-create",
              label: n.createClass,
              href: { pathname: "/class-section", params: CREATE },
              action: true,
              can: has("class:create"),
            },
            { key: "classes-terms", label: n.terms, href: "/terms", can: has("academic_year:read") },
            {
              key: "classes-add-term",
              label: n.addTerm,
              href: "/term-form",
              action: true,
              can: has("academic_year:read") && has("academic_year:create"),
            },
            { key: "classes-setup", label: n.academicSetup, href: "/academic-setup", can: true },
          ],
        },
        {
          key: "subjects",
          label: n.subjects,
          icon: "subject",
          can: has("subject:read"),
          subs: [
            { key: "subjects-all", label: n.allSubjects, href: "/subject-mapping", can: true },
            {
              key: "subjects-add",
              label: n.addSubject,
              href: { pathname: "/subject-mapping", params: CREATE },
              action: true,
              can: has("subject:create"),
            },
          ],
        },
        {
          key: "exams",
          label: n.exams,
          icon: "exams",
          can: has("exam:read"),
          subs: [
            { key: "exams-all", label: n.allExams, href: "/exams", can: true },
            { key: "exams-create", label: n.createExam, href: "/exams/exam-form", action: true, can: has("exam:create") },
            { key: "exams-term-grades", label: n.termGrades, href: "/exams/term-grades", can: true },
            { key: "exams-final", label: n.finalResults, href: "/exams/final", can: has("exam:update") },
            { key: "exams-setup", label: n.examSetup, href: "/exams/setup", can: canExamSetup },
            {
              key: "exams-add-scale",
              label: n.addGradingScale,
              href: "/exams/setup/grading-scales/new",
              action: true,
              can: has("exam:create"),
            },
          ],
        },
        {
          key: "teaching",
          label: n.teaching,
          icon: "school",
          can: has("teacher_assignment:read"),
          subs: [
            { key: "teaching-overview", label: n.teachingOverview, href: "/teaching", can: true },
            { key: "teaching-settings", label: n.teachingSettings, href: "/teaching-settings", can: has("school_settings:update") },
          ],
        },
        { key: "timetable", label: n.timetable, icon: "clock", soon: true, can: true },
      ],
    },
    {
      key: "administration",
      label: copy.shell.groups.administration,
      items: [
        {
          key: "staff",
          label: n.staff,
          icon: "person",
          can: has("staff:read"),
          subs: [
            { key: "staff-all", label: n.allStaff, href: "/staff-list", can: true },
            { key: "staff-add", label: n.addStaff, href: "/staff-form", action: true, can: has("staff:create") },
          ],
        },
        {
          key: "roles",
          label: n.roles,
          icon: "shield",
          href: "/roles",
          can: any("role_assignment:read", "role_permission:read"),
        },
        {
          key: "branches",
          label: n.branches,
          icon: "branches",
          can: has("school:read") && any("school:create", "school:update", "school:delete"),
          subs: [
            { key: "branches-all", label: n.allBranches, href: "/branches", can: true },
            { key: "branches-add", label: n.addBranch, href: "/branch-form", action: true, can: has("school:create") },
          ],
        },
        {
          key: "sessions",
          label: n.sessions,
          icon: "sessions",
          can: has("academic_year:read") && any("academic_year:create", "academic_year:update"),
          subs: [
            { key: "sessions-all", label: n.allSessions, href: "/sessions", can: true },
            { key: "sessions-create", label: n.createSession, href: "/session-form", action: true, can: has("academic_year:create") },
          ],
        },
      ],
    },
  ];

  return groups
    .map((group) => ({
      key: group.key,
      label: group.label,
      items: group.items
        .filter((item) => item.can)
        .map(({ can: _can, subs, ...item }) => ({
          ...item,
          subs: (subs ?? []).filter((sub) => sub.can).map(({ can: _subCan, ...sub }) => sub),
        }))
        // Timetable is the only line allowed to lead nowhere, and it says so.
        .filter((item) => item.soon || item.href || item.subs.length > 0)
        .map(collapseSingle),
    }))
    // A group the caller holds nothing in is left out, heading and all. A
    // group holding only the "Soon" line would be a heading over nothing.
    .filter((group) => group.items.some((item) => !item.soon));
}

/** One sub-line is not worth a fold: the item opens it directly. */
function collapseSingle(item: NavItem): NavItem {
  if (item.subs.length !== 1) return item;
  const only = item.subs[0]!;
  return { ...item, href: only.href, tab: only.tab, subs: [] };
}

export type NavMatch = {
  key: string;
  label: string;
  /** The item a sub-line sits under; null for the item itself. */
  parent: string | null;
  icon: AppIconName;
  href: Href;
  tab?: boolean;
  action?: boolean;
};

/** Every line that opens something, matched on its own name or its item's. */
export function searchNav(groups: readonly NavGroup[], query: string): NavMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: NavMatch[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      const itemHit = item.label.toLowerCase().includes(q);
      if (item.href && itemHit) {
        matches.push({ key: item.key, label: item.label, parent: null, icon: item.icon, href: item.href, tab: item.tab });
      }
      for (const sub of item.subs) {
        if (itemHit || sub.label.toLowerCase().includes(q)) {
          matches.push({
            key: sub.key,
            label: sub.label,
            parent: item.label,
            icon: item.icon,
            href: sub.href,
            tab: sub.tab,
            action: sub.action,
          });
        }
      }
    }
  }
  return matches;
}

/** The item whose own line or sub-line is the screen now showing. */
export function itemForPath(groups: readonly NavGroup[], pathname: string): string | null {
  const same = (href: Href) => typeof href === "string" && stripGroups(href) === pathname;
  for (const group of groups) {
    for (const item of group.items) {
      if ((item.href && same(item.href)) || item.subs.some((sub) => same(sub.href))) return item.key;
    }
  }
  return null;
}

/** "/(staff)/(tabs)/students" is "/students" once it is a pathname. */
function stripGroups(href: string): string {
  return href.replace(/\/\([^)]+\)/g, "") || "/";
}
