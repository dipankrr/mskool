import type { MonthDay } from "./attendance";
import { isOpen } from "./homework";
import type { PortalItem } from "./homework";

/**
 * The rules behind family Home, the evening loop: what counts as tonight's
 * work, what goes in the bag, what the next school day is, what happened
 * today, and the one line Bookie says. Pure, so they are tested without a
 * screen.
 */

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A Date's own calendar day as ISO, never through UTC. */
export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-11-30" + 1 → "2026-12-01". */
export function addDays(iso: string, by: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + by);
  return isoOf(d);
}

function isSunday(iso: string): boolean {
  return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay() === 0;
}

export type DayKind = "school" | "half_day" | "exam_day" | "holiday" | "weekend";

/**
 * What kind of day a date is. The school's calendar decides; a day it has
 * not filled in yet is taken as a school day, except a Sunday.
 */
export function dayKind(info: Pick<MonthDay, "dayType"> | undefined, iso: string): DayKind {
  switch (info?.dayType) {
    case "working":
      return "school";
    case "half_day":
      return "half_day";
    case "exam_day":
      return "exam_day";
    case "holiday":
      return "holiday";
    case "weekend":
      return "weekend";
    default:
      return isSunday(iso) ? "weekend" : "school";
  }
}

export function isOff(kind: DayKind): boolean {
  return kind === "holiday" || kind === "weekend";
}

export type Ahead = {
  /** Tomorrow, whatever it is. */
  tomorrow: { date: string; kind: DayKind; label: string | null };
  /** The next day with school, within the next ten days; null in a long break. */
  next: { date: string; kind: DayKind; daysAway: number } | null;
};

/** Tomorrow and the next school day, from the calendar days the phone has. */
export function lookAhead(days: readonly MonthDay[], today: string): Ahead {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const tomorrowDate = addDays(today, 1);
  const tomorrowInfo = byDate.get(tomorrowDate);
  const tomorrowKind = dayKind(tomorrowInfo, tomorrowDate);
  let next: Ahead["next"] = null;
  for (let i = 1; i <= 10; i += 1) {
    const date = addDays(today, i);
    const kind = dayKind(byDate.get(date), date);
    if (!isOff(kind)) {
      next = { date, kind, daysAway: i };
      break;
    }
  }
  return {
    tomorrow: { date: tomorrowDate, kind: tomorrowKind, label: isOff(tomorrowKind) ? (tomorrowInfo?.label ?? null) : null },
    next,
  };
}

// ---------------------------------------------------------------------------
// Tonight and the bag
// ---------------------------------------------------------------------------

/** How a row gets finished from Home. */
export type TonightAction =
  /** Ticked on the server, right on Home. */
  | "tick"
  /** Nothing goes back to the teacher: a tick kept on this phone only. */
  | "local"
  /** Opens its own page: photos or typed work. */
  | "send"
  | "quiz";

export type TonightRow = { item: PortalItem; done: boolean; action: TonightAction };

export type TonightPlan = {
  work: TonightRow[];
  bag: TonightRow[];
  total: number;
  left: number;
  bagLeft: number;
  /** The teachers' estimates for the work still left, added up. */
  minutes: number;
  /** Something was sent back to redo. */
  hasRedo: boolean;
};

function actionOf(item: PortalItem): TonightAction {
  if (item.comesBack === "tick") return "tick";
  if (item.comesBack === "brought" || item.comesBack === "none") return "local";
  if (item.comesBack === "questions" || item.kind === "quiz") return "quiz";
  return "send";
}

/**
 * Tonight: everything due by the end of the next school day (`until`), so a
 * Saturday evening already shows Monday's work. Work finished for those days
 * stays on the list as done, in its place (a ticked row must not jump away
 * from the finger), so the count means something. Things to carry to
 * class go to the bag instead of the work list.
 *
 * `localTicks` are the phone-only ticks: bag items, and homework that sends
 * nothing back.
 */
export function tonightPlan(
  items: readonly PortalItem[],
  now: Date,
  until: string,
  localTicks: ReadonlySet<string>,
): TonightPlan {
  const today = isoOf(now);
  const rows: TonightRow[] = [];
  for (const item of items) {
    if (item.word === "missed" || item.word === "over") continue;
    const dueDay = isoOf(new Date(item.dueAt));
    if (dueDay > until) continue;
    const open = isOpen(item);
    // Finished work for a day already gone is history, not tonight.
    if (!open && dueDay < today) continue;
    const action = actionOf(item);
    const done = action === "local" && open ? localTicks.has(item.studentAssignmentId) : !open;
    rows.push({ item, done, action });
  }
  rows.sort(
    (a, b) =>
      Number(b.item.word === "redo") - Number(a.item.word === "redo") ||
      new Date(a.item.dueAt).getTime() - new Date(b.item.dueAt).getTime(),
  );
  const work = rows.filter((r) => r.item.comesBack !== "brought");
  const bag = rows.filter((r) => r.item.comesBack === "brought");
  const leftRows = work.filter((r) => !r.done);
  return {
    work,
    bag,
    total: work.length,
    left: leftRows.length,
    bagLeft: bag.filter((r) => !r.done).length,
    minutes: leftRows.reduce((sum, r) => sum + (r.item.estimatedMinutes ?? 0), 0),
    hasRedo: leftRows.some((r) => r.item.word === "redo"),
  };
}

/** Subjects with something due on `date`, in due order, each once. */
export function subjectsDue(items: readonly PortalItem[], date: string): string[] {
  const seen = new Set<string>();
  [...items]
    .filter((i) => i.word !== "missed" && i.word !== "over" && isoOf(new Date(i.dueAt)) === date)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
    .forEach((i) => seen.add(i.subjectName));
  return [...seen];
}

// ---------------------------------------------------------------------------
// Today at school
// ---------------------------------------------------------------------------

export type TodayAttendance =
  | { kind: "status"; status: NonNullable<MonthDay["status"]> }
  | { kind: "off"; day: "holiday" | "weekend"; label: string | null }
  | { kind: "none" };

/** Today's line on the timeline: the mark, or why there is none. */
export function todayAttendance(days: readonly MonthDay[], today: string): TodayAttendance {
  const info = days.find((d) => d.date === today);
  const kind = dayKind(info, today);
  if (isOff(kind)) return { kind: "off", day: kind as "holiday" | "weekend", label: info?.label ?? null };
  if (!info || !info.enrolled || info.status === null) return { kind: "none" };
  return { kind: "status", status: info.status };
}

export type TodayStory = {
  /** Homework given today, oldest first. */
  given: PortalItem[];
  /** Results and send-backs not opened yet. */
  back: PortalItem[];
  /** Homework with teacher messages not read yet (and nothing else new). */
  replies: PortalItem[];
};

export function todayStory(items: readonly PortalItem[], now: Date): TodayStory {
  const today = isoOf(now);
  const back = items.filter((i) => i.isNew);
  const backIds = new Set(back.map((i) => i.studentAssignmentId));
  return {
    given: items
      .filter((i) => isoOf(new Date(i.givenAt)) === today)
      .sort((a, b) => new Date(a.givenAt).getTime() - new Date(b.givenAt).getTime()),
    back,
    replies: items.filter((i) => i.newReplies > 0 && !backIds.has(i.studentAssignmentId)),
  };
}

// ---------------------------------------------------------------------------
// Bookie
// ---------------------------------------------------------------------------

export type BookieMoodName = "calm" | "happy" | "cheer" | "worried" | "focus" | "sleepy";

export type BookieLineKey =
  | "allSet"
  | "allSetTomorrow"
  | "bagNext"
  | "packBag"
  | "examTomorrow"
  | "examNext"
  | "redo"
  | "missedToday"
  | "noSchool"
  | "things"
  | "oneMore"
  | "goodStart"
  | "examsOn"
  | "examsSoon"
  | "nothing";

export type BookieSays = {
  mood: BookieMoodName;
  line: BookieLineKey;
  count?: number;
  subject?: string;
};

/**
 * Bookie's one line: the most pressing thing wins. An exam on the next school
 * day beats everything while there is work left; a finished list and a packed
 * bag is the cheer.
 */
export function bookieSays(input: {
  plan: Pick<TonightPlan, "total" | "left" | "bagLeft" | "hasRedo"> & { bagTotal: number };
  ahead: Ahead | null;
  /** The subject of the first paper on the next school day, if any. */
  examSubject: string | null;
  /** An exam is running, or days until the next one starts (within a week). */
  exam: { on: boolean; inDays: number | null };
  absentToday: boolean;
}): BookieSays {
  const { plan, ahead, examSubject, exam, absentToday } = input;
  const nextIsTomorrow = ahead?.next?.daysAway === 1;
  const hasAnything = plan.total > 0 || plan.bagTotal > 0;

  if (hasAnything && plan.left === 0 && plan.bagLeft === 0) {
    return { mood: "cheer", line: nextIsTomorrow ? "allSetTomorrow" : "allSet" };
  }
  if (examSubject !== null) {
    return { mood: "focus", line: nextIsTomorrow ? "examTomorrow" : "examNext", subject: examSubject };
  }
  if (plan.total > 0 && plan.left === 0) return { mood: "happy", line: "bagNext", count: plan.bagLeft };
  if (plan.hasRedo) return { mood: "worried", line: "redo" };
  if (plan.left > 0) {
    if (absentToday && plan.left === plan.total) return { mood: "worried", line: "missedToday" };
    if (plan.left === plan.total) return { mood: "calm", line: "things", count: plan.left };
    if (plan.left === 1) return { mood: "happy", line: "oneMore" };
    return { mood: "calm", line: "goodStart", count: plan.left };
  }
  if (plan.bagLeft > 0) return { mood: "calm", line: "packBag", count: plan.bagLeft };
  // Nothing to do tonight.
  if (exam.on) return { mood: "focus", line: "examsOn" };
  if (exam.inDays !== null && exam.inDays <= 7) return { mood: "focus", line: "examsSoon", count: exam.inDays };
  if (ahead && isOff(ahead.tomorrow.kind)) return { mood: "sleepy", line: "noSchool" };
  return { mood: "happy", line: "nothing" };
}
