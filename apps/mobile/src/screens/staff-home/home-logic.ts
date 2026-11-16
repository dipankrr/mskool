import type { HomePaper, HomeSectionDay, MyTeaching } from "@repo/contracts";

/**
 * STAFF HOME RULES (ADR-072), pure so they can be tested without a phone.
 *
 * Home is assembled from assignments (personal work), permissions (school
 * areas) and scope (how wide). Nothing here reads a role's name.
 */

export type DayKind = "working" | "holiday" | "half_day" | "weekend" | "exam_day";

// ---------------------------------------------------------------------------
// Your attendance
// ---------------------------------------------------------------------------

/** The caller's own sections (any assignment), in the branch's order. */
export function ownSections(mine: MyTeaching, days: readonly HomeSectionDay[]): HomeSectionDay[] {
  const ids = new Set(mine.map((row) => row.sectionId));
  // A section with nobody in it has nothing to mark.
  return days.filter((day) => ids.has(day.sectionId) && day.students > 0);
}

export const isMarked = (day: HomeSectionDay) => day.marked > 0;

export type AttendanceMode = "none" | "dayOff" | "single" | "list" | "done";

/**
 * One section: the big card. Several: a list. All marked: one green line.
 * A day off on the calendar replaces it all with the day card.
 */
export function attendanceMode(own: readonly HomeSectionDay[], day: DayKind | null): AttendanceMode {
  if (own.length === 0) return "none";
  if (day === "holiday" || day === "weekend") return "dayOff";
  if (own.every(isMarked)) return "done";
  return own.length === 1 ? "single" : "list";
}

/** Six or more sections: unmarked ones stay, the marked fold into one line. */
export const FOLD_AT = 6;

export function attendanceList(own: readonly HomeSectionDay[]) {
  const waiting = own.filter((d) => !isMarked(d));
  const marked = own.filter(isMarked);
  const fold = own.length >= FOLD_AT;
  return { waiting, marked: fold ? [] : marked, folded: fold ? marked.length : 0, allMarked: marked };
}

// ---------------------------------------------------------------------------
// You teach
// ---------------------------------------------------------------------------

export type Pair = {
  sectionId: string;
  label: string;
  classId: string;
  subjectId: string;
  subjectName: string;
  cover: string | null;
};

const sectionLabel = (className: string, sectionName: string) => {
  const numeric = className.match(/\d+/)?.[0];
  return numeric ? `${numeric}-${sectionName}` : `${className} ${sectionName}`;
};

/** Subject pairs only; a class-teacher row carries no subject. */
export function teachingPairs(mine: MyTeaching): Pair[] {
  return mine
    .filter((row) => row.subjectId && row.subjectName)
    .map((row) => ({
      sectionId: row.sectionId,
      label: sectionLabel(row.className, row.sectionName),
      classId: row.classId,
      subjectId: row.subjectId as string,
      subjectName: row.subjectName as string,
      cover: row.effectiveTo,
    }));
}

export function sectionShort(day: { className: string; sectionName: string }) {
  return sectionLabel(day.className, day.sectionName);
}

/** The sections the caller is class teacher of. */
export function classTeacherOf(mine: MyTeaching) {
  return mine.filter((row) => row.role === "class_teacher");
}

export function bySubject(pairs: readonly Pair[]) {
  const groups = new Map<string, { subjectId: string; subjectName: string; pairs: Pair[] }>();
  for (const pair of pairs) {
    const group = groups.get(pair.subjectId) ?? { subjectId: pair.subjectId, subjectName: pair.subjectName, pairs: [] };
    group.pairs.push(pair);
    groups.set(pair.subjectId, group);
  }
  return [...groups.values()];
}

/** Rows are sections, columns subjects; a missing cell means "not yours". */
export function byClass(pairs: readonly Pair[]) {
  const subjects = bySubject(pairs).map((g) => ({ subjectId: g.subjectId, subjectName: g.subjectName }));
  const rows = new Map<string, { sectionId: string; label: string; cells: Map<string, Pair> }>();
  for (const pair of pairs) {
    const row = rows.get(pair.sectionId) ?? { sectionId: pair.sectionId, label: pair.label, cells: new Map() };
    row.cells.set(pair.subjectId, pair);
    rows.set(pair.sectionId, row);
  }
  return { subjects, rows: [...rows.values()] };
}

export type PairState =
  | { kind: "done"; text: string }
  | { kind: "due"; text: string }
  | { kind: "notYet"; text: string }
  | { kind: "none"; text: null };

/** One word of state for a pair: marks done, 12/40, or nothing to say. */
export function pairState(pair: Pair, papers: readonly HomePaper[], today: string): PairState {
  const paper = papers.find((p) => p.sectionId === pair.sectionId && p.subjectId === pair.subjectId);
  if (!paper) return { kind: "none", text: null };
  if (paper.examDate > today) return { kind: "notYet", text: "not sat" };
  if (paper.students > 0 && paper.entered >= paper.students) return { kind: "done", text: "marks done" };
  return { kind: "due", text: `${paper.entered}/${paper.students}` };
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

export function paperProgress(papers: readonly HomePaper[], today: string) {
  const sat = papers.filter((p) => p.examDate <= today);
  const done = sat.filter((p) => p.students > 0 && p.entered >= p.students);
  const left = papers
    .filter((p) => !(p.students > 0 && p.entered >= p.students))
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
  return { total: papers.length, done: done.length, left };
}

// ---------------------------------------------------------------------------
// Waiting on you
// ---------------------------------------------------------------------------

export type WaitingKind = "teaching" | "admin";
/** Lower is more urgent. */
export type Urgency = 0 | 1 | 2 | 3;

export type WaitingItem = {
  key: string;
  kind: WaitingKind;
  urgency: Urgency;
};

/** Most urgent first; within a level, teaching before admin (the caller's own work). */
export function sortWaiting<T extends WaitingItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.urgency - b.urgency || (a.kind === b.kind ? 0 : a.kind === "teaching" ? -1 : 1));
}

/** Tags only make sense to someone who has both kinds of work. */
export function showWaitingTags(items: readonly WaitingItem[]): boolean {
  return items.some((i) => i.kind === "teaching") && items.some((i) => i.kind === "admin");
}

// ---------------------------------------------------------------------------
// Page order
// ---------------------------------------------------------------------------

export type Part =
  | "dayCard"
  | "myAttendance"
  | "waiting"
  | "schoolToday"
  | "youTeach"
  | "staff"
  | "fees"
  | "exams"
  | "students"
  | "comingUp";

/**
 * The fixed order, with the one time rule: once the caller's own sections
 * are marked, "you teach" moves below the school's cards. Parts the caller
 * doesn't have are dropped by the screen, never re-ordered here.
 */
export function pageOrder(ownDone: boolean): Part[] {
  const school: Part[] = ["schoolToday", "staff", "fees", "exams", "students"];
  return ownDone
    ? ["dayCard", "myAttendance", "waiting", "schoolToday", "fees", "youTeach", "staff", "exams", "students", "comingUp"]
    : ["dayCard", "myAttendance", "waiting", "youTeach", ...school, "comingUp"];
}

// ---------------------------------------------------------------------------
// Small formatting
// ---------------------------------------------------------------------------

/** The hour now in the school's time (IST), for the greeting. */
export function istHour(now: number = Date.now()): number {
  return new Date(now + 5.5 * 3600 * 1000).getUTCHours();
}

export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The first word of a name, for the greeting. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** ₹48,250 → ₹48.2k; ₹1,12,000 → ₹1.12L; ₹2,30,00,000 → ₹2.3Cr. Whole rupees only. */
export function shortMoney(value: string | null | undefined): string {
  const rupees = Math.round(Number(value ?? 0));
  if (!Number.isFinite(rupees)) return "₹0";
  const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));
  if (rupees >= 1_00_00_000) return `₹${trim(rupees / 1_00_00_000, 2)}Cr`;
  if (rupees >= 1_00_000) return `₹${trim(rupees / 1_00_000, 2)}L`;
  if (rupees >= 1_000) return `₹${trim(rupees / 1_000, 1)}k`;
  return `₹${rupees}`;
}

/** Whole-number percentage, or null when there is nothing to divide. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
