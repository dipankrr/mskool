import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

/**
 * The family homework rules that are worked out on the phone: the word a row
 * shows, the countdown, how the list groups, and the Tonight card's numbers.
 * Pure, so they are unit-tested without a screen.
 */

export type PortalItem = inferRouterOutputs<AppRouter>["portalHomework"]["list"][number];
export type PortalDetail = inferRouterOutputs<AppRouter>["portalHomework"]["get"];

/** The six server words plus "done": a ticked homework says Done, not Sent. */
export type ShownWord = PortalItem["word"] | "done";

export function shownWord(item: Pick<PortalItem, "word" | "comesBack">): ShownWord {
  return item.word === "sent" && item.comesBack === "tick" ? "done" : item.word;
}

/** Still the child's to act on: not sent, or sent back. */
export function isOpen(item: Pick<PortalItem, "word">): boolean {
  return item.word === "to_do" || item.word === "redo";
}

/** Finished and waiting on nobody: checked, missed, or over (nothing came back). */
export function isSettled(item: Pick<PortalItem, "word">): boolean {
  return item.word === "checked" || item.word === "missed" || item.word === "over";
}

export type Countdown =
  | { kind: "left"; amount: number; unit: "m" | "h" | "d"; tone: "critical" | "caution" | "neutral" }
  /** Past due, but the teacher's late window is still open. */
  | { kind: "lateOpen"; amount: number; unit: "m" | "h" | "d" }
  | { kind: "closed" };

function span(ms: number): { amount: number; unit: "m" | "h" | "d" } {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return { amount: minutes, unit: "m" };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { amount: hours, unit: "h" };
  return { amount: Math.round(hours / 24), unit: "d" };
}

/** "40m left", "13h left", "5d left"; after the due time, the late window or closed. */
export function countdown(dueAt: Date | string, closeAt: Date | string, now = new Date()): Countdown {
  const due = new Date(dueAt).getTime();
  const close = new Date(closeAt).getTime();
  const t = now.getTime();
  if (t < due) {
    const ms = due - t;
    const tone = ms < 3_600_000 ? "critical" : ms < 86_400_000 ? "caution" : "neutral";
    return { kind: "left", ...span(ms), tone };
  }
  if (t < close) return { kind: "lateOpen", ...span(close - t) };
  return { kind: "closed" };
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export type OpenGroup = "back" | "late" | "today" | "tomorrow" | "week" | "later" | "waiting";

/**
 * The To do tab: sent back first, then by when it is due, then work already
 * sent that the teacher hasn't checked. Each group keeps due order.
 */
export function groupOpen(items: readonly PortalItem[], now = new Date()): { key: OpenGroup; items: PortalItem[] }[] {
  const today = startOfDay(now);
  const day = 86_400_000;
  const buckets: Record<OpenGroup, PortalItem[]> = {
    back: [],
    late: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    waiting: [],
  };
  const sorted = [...items].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  for (const item of sorted) {
    // A new result sits on top until it's opened, then lives in Done.
    if (item.isNew && item.word !== "redo") {
      buckets.back.push(item);
      continue;
    }
    if (isSettled(item)) continue;
    if (item.word === "redo") buckets.back.push(item);
    else if (item.word !== "to_do") buckets.waiting.push(item);
    else {
      const due = new Date(item.dueAt);
      const dueDay = startOfDay(due);
      if (due.getTime() <= now.getTime()) buckets.late.push(item);
      else if (dueDay === today) buckets.today.push(item);
      else if (dueDay === today + day) buckets.tomorrow.push(item);
      else if (dueDay < today + 7 * day) buckets.week.push(item);
      else buckets.later.push(item);
    }
  }
  return (Object.keys(buckets) as OpenGroup[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, items: buckets[key] }));
}

export type DoneGroup = "thisWeek" | "lastWeek" | "earlier";

/** The Done tab: checked and missed work, newest due first, by week. */
export function groupDone(items: readonly PortalItem[], now = new Date()): { key: DoneGroup; items: PortalItem[] }[] {
  const today = startOfDay(now);
  const weekday = (now.getDay() + 6) % 7; // Monday = 0
  const thisWeek = today - weekday * 86_400_000;
  const lastWeek = thisWeek - 7 * 86_400_000;
  const buckets: Record<DoneGroup, PortalItem[]> = { thisWeek: [], lastWeek: [], earlier: [] };
  const sorted = items
    .filter(isSettled)
    .sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime());
  for (const item of sorted) {
    const due = new Date(item.dueAt).getTime();
    if (due >= thisWeek) buckets.thisWeek.push(item);
    else if (due >= lastWeek) buckets.lastWeek.push(item);
    else buckets.earlier.push(item);
  }
  return (Object.keys(buckets) as DoneGroup[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, items: buckets[key] }));
}

/**
 * The Tonight card: homework due today (and anything past due still taking
 * work). `left` still needs doing, `done` is sent or ticked, `minutes` adds up
 * the teachers' estimates for what's left.
 */
export function tonight(items: readonly PortalItem[], now = new Date()) {
  const key = dayKey(now);
  const due = items.filter((item) => dayKey(new Date(item.dueAt)) === key && item.word !== "missed" && item.word !== "over");
  const left = due.filter(isOpen);
  const minutes = left.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
  return { total: due.length, left: left.length, done: due.length - left.length, minutes };
}

/** The next open homework after this one, for "Next: …" after sending. */
export function nextOpen(items: readonly PortalItem[], afterId: string): PortalItem | null {
  return (
    [...items]
      .filter((item) => item.word === "to_do" && item.studentAssignmentId !== afterId)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? null
  );
}

/** A stable colour slot (0–4) for a subject, by its name. */
export function subjectSlot(name: string, slots = 5): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % slots;
}

/** Marks as stored ("8.00") without the decimals; halves keep them. */
export function trimMarks(value: string | null): string | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : value;
}

/** The short result inside a Checked word: "9/10", "A", "Excellent"; null when none. */
export function resultLabel(
  item: Pick<PortalItem, "gradingMode" | "marks" | "maxMarks" | "grade" | "remark">,
): { value: string; unit?: string } | { remark: NonNullable<PortalItem["remark"]> } | null {
  if (item.gradingMode === "marks" && item.marks !== null) {
    return { value: trimMarks(item.marks) ?? "", unit: item.maxMarks ? `/${trimMarks(item.maxMarks)}` : undefined };
  }
  if (item.gradingMode === "grade" && item.grade) return { value: item.grade };
  if (item.gradingMode === "remark" && item.remark) return { remark: item.remark };
  return null;
}
