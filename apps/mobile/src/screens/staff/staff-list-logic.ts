/**
 * The staff list's rules as pure functions (frame: prototype/staff-list.html,
 * v2): which tab a person belongs to, who left, and the teaching tags.
 * Unit-tested in staff-list-logic.test.ts.
 */
import { sectionLabel } from "./teaching-logic";
import { looksLikeTeacher } from "./staff-logic";

export type StaffTab = "all" | "teaching" | "office";

type Section = { className: string; sectionName: string };
export type ListPerson = {
  firstName: string;
  lastName: string;
  employeeCode: string;
  phone: string | null;
  designation: string | null;
  teachesClasses: boolean;
  status: string;
  joinState: "joined" | "invited" | "not_invited";
  teaching: { classTeacherOf: Section | null; subjects: { subjectName: string; sections: Section[] }[] };
};

const CURRENT = new Set(["active", "on_leave", "suspended"]);

export const hasLeft = (p: Pick<ListPerson, "status">) => !CURRENT.has(p.status);
export const isTeaching = (p: Pick<ListPerson, "teachesClasses">) => p.teachesClasses;
/**
 * Office = has a non-teaching job. A principal who teaches is in both tabs;
 * a plain "Subject Teacher" is only in Teaching. Everyone lands in at least one.
 */
export const isOffice = (p: Pick<ListPerson, "teachesClasses" | "designation">) =>
  !p.teachesClasses || (Boolean(p.designation?.trim()) && !looksLikeTeacher(p.designation ?? ""));

export const fullName = (p: Pick<ListPerson, "firstName" | "lastName">) => `${p.firstName} ${p.lastName}`.trim();

const byName = <T extends Pick<ListPerson, "firstName" | "lastName">>(a: T, b: T) =>
  fullName(a).localeCompare(fullName(b));

export function matches(p: ListPerson, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  return (
    fullName(p).toLowerCase().includes(q) ||
    p.employeeCode.toLowerCase().includes(q) ||
    (digits.length >= 3 && (p.phone ?? "").includes(digits))
  );
}

export type ListGroup<T> = { key: string; title: string | null; rows: T[] };

/**
 * The groups to draw. "All" groups Teaching then Office, each person once
 * (teachers who also hold an office job sit under Teaching). The other tabs
 * are one A–Z list. Search ignores the tab. People who left show only with
 * `showLeft`, in their usual place.
 */
export function staffGroups<T extends ListPerson>(
  people: T[],
  opts: { tab: StaffTab; query: string; showLeft: boolean },
): ListGroup<T>[] {
  const pool = people.filter((p) => opts.showLeft || !hasLeft(p)).sort(byName);
  if (opts.query.trim()) {
    return [{ key: "search", title: null, rows: pool.filter((p) => matches(p, opts.query)) }];
  }
  if (opts.tab === "teaching") return [{ key: "teaching", title: null, rows: pool.filter(isTeaching) }];
  if (opts.tab === "office") return [{ key: "office", title: null, rows: pool.filter(isOffice) }];
  return [
    { key: "teaching", title: "Teaching", rows: pool.filter(isTeaching) },
    { key: "office", title: "Office", rows: pool.filter((p) => !isTeaching(p)) },
  ].filter((g) => g.rows.length > 0);
}

export function staffCounts(people: ListPerson[]) {
  const current = people.filter((p) => !hasLeft(p));
  return {
    all: current.length,
    teaching: current.filter(isTeaching).length,
    office: current.filter(isOffice).length,
    left: people.length - current.length,
    notOnApp: current.filter((p) => p.joinState !== "joined"),
  };
}

/** The row's tags: ★ class-teacher section first, then "Science · 6-A 6-B". */
export function teachingTags(t: ListPerson["teaching"], max = 3) {
  const tags: { key: string; label: string; classTeacher: boolean }[] = [];
  if (t.classTeacherOf) {
    tags.push({
      key: "ct",
      label: sectionLabel(t.classTeacherOf.className, t.classTeacherOf.sectionName),
      classTeacher: true,
    });
  }
  for (const s of t.subjects) {
    tags.push({
      key: `s:${s.subjectName}`,
      label: `${s.subjectName} · ${s.sections.map((x) => sectionLabel(x.className, x.sectionName)).join(" ")}`,
      classTeacher: false,
    });
  }
  return { shown: tags.slice(0, max), more: Math.max(0, tags.length - max) };
}
