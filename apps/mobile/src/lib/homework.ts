import type { CheckStatus, ComesBack, GradingMode, HomeworkKind, Remark } from "@repo/contracts";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { copy } from "./copy";
import { formatClock, localDateToIso } from "./format";

/**
 * HOMEWORK on the phone (ADR-064, the H2 screens). Pure helpers only: what each
 * type allows, the due presets, the check list's tap cycle and counts, and
 * the labels the screens print. Every rule here mirrors the server's; the
 * server still decides.
 */

type Outputs = inferRouterOutputs<AppRouter>;
export type HomeworkSummary = Outputs["homework"]["list"][number];
export type HomeworkHome = Outputs["homework"]["home"];
export type GivePairs = Outputs["homework"]["pairs"];
export type GiveDefaults = Outputs["homework"]["defaults"];
export type Register = Outputs["homework"]["register"]["get"];
export type RegisterRow = Register["rows"][number];
export type BankItemRow = Outputs["homework"]["bank"]["list"][number];

/** `2.50` → `2.5`, `3.00` → `3`; marks as people write them. */
export function formatMarks(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || !/^-?d+(.d+)?$/.test(text)) return text;
  if (!text.includes(".")) return text;
  return text.replace(/.?0+$/, "");
}

/** The four types Give offers today; Quiz arrives with H4. */
export const GIVE_KINDS = ["homework", "practice", "project", "reading"] as const satisfies readonly HomeworkKind[];
export type GiveKind = (typeof GIVE_KINDS)[number];

/** Which ways back each type allows, its default first. Mirrors `KIND_COMES_BACK` in the contract. */
export const KIND_COMES_BACK = {
  homework: ["brought", "sent", "tick", "none"],
  practice: ["none", "tick", "brought"],
  project: ["brought", "sent"],
  reading: ["tick", "none"],
  quiz: ["questions"],
} as const satisfies Record<HomeworkKind, readonly ComesBack[]>;

/** Which grading each type allows, its default first. Mirrors `KIND_GRADING`. */
export const KIND_GRADING = {
  homework: ["none", "marks", "grade", "remark"],
  practice: ["none", "remark"],
  project: ["marks", "grade", "remark"],
  reading: ["none"],
  quiz: ["marks"],
} as const satisfies Record<HomeworkKind, readonly GradingMode[]>;

/** Grading applies only when the work comes back to the teacher. */
export function gradingApplies(comesBack: ComesBack): boolean {
  return comesBack === "brought" || comesBack === "sent" || comesBack === "questions";
}

/** A type's choices after picking how it comes back: the grading row may disappear. */
export function gradingOptions(kind: HomeworkKind, comesBack: ComesBack): readonly GradingMode[] {
  return gradingApplies(comesBack) ? KIND_GRADING[kind] : ["none"];
}

// ── Dates ─────────────────────────────────────────────────────────────────

/** The time homework is due on a school day: first period. */
export const DUE_TIME = "08:00";

function addDays(iso: string, days: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  d.setDate(d.getDate() + days);
  return localDateToIso(d);
}

function isSunday(iso: string): boolean {
  return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay() === 0;
}

/** The n-th school day after `fromIso` (Sundays skipped). */
export function nextSchoolDay(fromIso: string, n = 1): string {
  let day = fromIso;
  let left = n;
  while (left > 0) {
    day = addDays(day, 1);
    if (!isSunday(day)) left -= 1;
  }
  return day;
}

/** `fromIso` plus whole weeks, moved off a Sunday. */
export function weeksAhead(fromIso: string, weeks: number): string {
  const day = addDays(fromIso, weeks * 7);
  return isSunday(day) ? addDays(day, 1) : day;
}

/** A local day and clock time as the ISO instant the API takes. */
export function dueInstant(dayIso: string, hhmm = DUE_TIME): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(
    Number(dayIso.slice(0, 4)),
    Number(dayIso.slice(5, 7)) - 1,
    Number(dayIso.slice(8, 10)),
    h ?? 8,
    m ?? 0,
  );
  return d.toISOString();
}

/** Due presets per type: [label, day]. "Pick" is added by the screen. */
export function duePresets(kind: GiveKind, todayIso: string): { label: string; day: string }[] {
  if (kind === "project") {
    return [
      { label: copy.homework.give.oneWeek, day: weeksAhead(todayIso, 1) },
      { label: copy.homework.give.twoWeeks, day: weeksAhead(todayIso, 2) },
    ];
  }
  const first = nextSchoolDay(todayIso, 1);
  const second = nextSchoolDay(todayIso, 2);
  return [
    { label: copy.homework.give.tomorrow(first === addDays(todayIso, 1)), day: first },
    { label: shortDay(second), day: second },
  ];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `Wed` for a local ISO day. */
export function shortDay(iso: string): string {
  return WEEKDAYS[new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay()]!;
}

/** `Tue 3 Nov, 8:00 am` for an instant, in the phone's own time. */
export function formatDue(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${formatClock(hhmm)}`;
}

/** `Due today`, `Due tomorrow`, `Due Wed 4 Nov`, or `Was due …` for the lists. */
export function dueLine(value: Date | string, now = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const day = localDateToIso(d);
  const today = localDateToIso(now);
  if (day === today) return copy.homework.due.today;
  if (day === addDays(today, 1)) return copy.homework.due.tomorrow;
  const label = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d < now ? copy.homework.due.past(label) : copy.homework.due.on(label);
}

/** How long is left: under an hour in minutes, under a day in hours, else days. */
function span(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * "⏰ 40m left", "23h left", "2d left", or "Overdue 3h": the countdown the
 * lists show instead of a date. The tone warns as the time runs out.
 */
export function timeLeft(
  value: Date | string,
  now = new Date(),
): { label: string; tone: "critical" | "caution" | "neutral" } {
  const due = typeof value === "string" ? new Date(value) : value;
  const ms = due.getTime() - now.getTime();
  if (ms <= 0) return { label: copy.homework.due.overdue(span(-ms)), tone: "critical" };
  const label = copy.homework.due.left(span(ms));
  if (ms < 3600_000) return { label, tone: "critical" };
  if (ms < 24 * 3600_000) return { label, tone: "caution" };
  return { label, tone: "neutral" };
}

// ── Classes ───────────────────────────────────────────────────────────────

/** `6A` for Class 6, section A; `6 · Rose` when the section is a word. */
export function sectionLabel(className: string, sectionName: string): string {
  const cls = className.replace(/^class\s+/i, "").trim();
  return sectionName.length <= 2 ? `${cls}${sectionName}` : `${cls} · ${sectionName}`;
}

/** `6A, 6B` — the names of the picked sections, in the pairs' order. */
export function pickedLabel(pairs: GivePairs, subjectId: string | null, sectionIds: readonly string[]): string {
  const subject = pairs.find((p) => p.subjectId === subjectId);
  if (!subject) return "";
  return subject.sections
    .filter((s) => sectionIds.includes(s.sectionId))
    .map((s) => sectionLabel(s.className, s.sectionName))
    .join(", ");
}

/** How many students the picked sections hold. */
export function pickedStudents(pairs: GivePairs, subjectId: string | null, sectionIds: readonly string[]): number {
  const subject = pairs.find((p) => p.subjectId === subjectId);
  return (subject?.sections ?? [])
    .filter((s) => sectionIds.includes(s.sectionId))
    .reduce((sum, s) => sum + s.studentCount, 0);
}

// ── Checking ──────────────────────────────────────────────────────────────

/** One child's mark on the phone before it is saved. */
export type CheckDraft = {
  checkStatus: CheckStatus | null;
  marks: string | null;
  grade: string | null;
  remark: Remark | null;
  note: string | null;
};

/** A tap moves Done → Incomplete → Not done → Absent → Done; an unset child becomes Done. */
export function nextStatus(current: CheckStatus | null): CheckStatus {
  switch (current) {
    case null:
      return "done";
    case "done":
      return "incomplete";
    case "incomplete":
      return "not_done";
    case "not_done":
      return "absent";
    default:
      return "done";
  }
}

/** The list's starting marks: what was saved, else Absent for a child absent today. */
export function initialDrafts(rows: readonly RegisterRow[]): Record<string, CheckDraft> {
  const out: Record<string, CheckDraft> = {};
  for (const row of rows) {
    out[row.studentAssignmentId] = {
      checkStatus: row.checkStatus ?? (row.absentToday ? "absent" : null),
      marks: row.marks,
      grade: row.grade,
      remark: row.remark,
      note: row.note,
    };
  }
  return out;
}

/** "All done": every unset child becomes Done; children already marked keep theirs. */
export function markAllDone(drafts: Record<string, CheckDraft>): Record<string, CheckDraft> {
  const out: Record<string, CheckDraft> = {};
  for (const [id, d] of Object.entries(drafts)) {
    out[id] = d.checkStatus === null ? { ...d, checkStatus: "done" } : d;
  }
  return out;
}

export type CheckCounts = { done: number; incomplete: number; notDone: number; absent: number; left: number };

export function countDrafts(drafts: Record<string, CheckDraft>): CheckCounts {
  const counts: CheckCounts = { done: 0, incomplete: 0, notDone: 0, absent: 0, left: 0 };
  for (const d of Object.values(drafts)) {
    if (d.checkStatus === "done") counts.done += 1;
    else if (d.checkStatus === "incomplete") counts.incomplete += 1;
    else if (d.checkStatus === "not_done") counts.notDone += 1;
    else if (d.checkStatus === "absent") counts.absent += 1;
    else counts.left += 1;
  }
  return counts;
}

function sameDraft(a: CheckDraft, b: CheckDraft): boolean {
  return (
    a.checkStatus === b.checkStatus &&
    a.marks === b.marks &&
    a.grade === b.grade &&
    a.remark === b.remark &&
    (a.note ?? "") === (b.note ?? "")
  );
}

/** Only the children whose mark differs from what the server holds. */
export function changedResults(rows: readonly RegisterRow[], drafts: Record<string, CheckDraft>) {
  return rows
    .map((row) => ({ row, draft: drafts[row.studentAssignmentId] }))
    .filter(
      (x): x is { row: RegisterRow; draft: CheckDraft } =>
        Boolean(x.draft) &&
        !sameDraft(x.draft!, {
          checkStatus: x.row.checkStatus,
          marks: x.row.marks,
          grade: x.row.grade,
          remark: x.row.remark,
          note: x.row.note,
        }),
    )
    .map(({ row, draft }) => ({
      studentAssignmentId: row.studentAssignmentId,
      checkStatus: draft.checkStatus,
      marks: draft.marks,
      grade: draft.grade,
      remark: draft.remark,
      note: draft.note && draft.note.trim() ? draft.note.trim() : null,
    }));
}

/** Marks typed on the pad: digits and one decimal point, at most two decimals. */
export function appendMarkKey(current: string, key: string): string {
  if (key === "⌫") return current.slice(0, -1);
  if (key === ".") return current.includes(".") || current === "" ? current : `${current}.`;
  const next = current === "0" ? key : `${current}${key}`;
  return /^\d{1,5}(\.\d{0,2})?$/.test(next) ? next : current;
}

/** Whether typed marks are a usable value within `max`. */
export function marksValid(value: string, max: string | null): boolean {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value)) return false;
  return max === null || Number(value) <= Number(max);
}
