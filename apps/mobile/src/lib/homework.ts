/**
 * Homework's date maths, labels and grouping — the parts every homework
 * surface needs and none of them should re-derive.
 *
 * Two clocks meet in this domain and they must not be confused:
 *
 * - **Calendar days** (`dueAt` grouped in the rail, "today", week strips) are
 *   `YYYY-MM-DD` strings in the READER's calendar. They never round-trip
 *   through `new Date(iso)` — `lib/format.ts` owns that rule.
 * - **Moments** (`dueAt`, `closeAt`, `submittedAt`) are timestamps. The API
 *   sends ISO strings at runtime even though the contract types say `Date`,
 *   so every helper here accepts `string | Date` and converts once, locally.
 *
 * Week strips are Monday-first, matching the way Indian school weeks are
 * planned. Day arithmetic uses UTC parts purely as a calendar counter — no
 * timezone is ever read from it — so a DST transition cannot drop or repeat a
 * day.
 */

import {
  formatMonthLong,
  formatShortWeekday,
  isIsoDate,
  todayIso,
} from "./format";

export const ASSIGNMENT_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "closed",
  "cancelled",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export function isAssignmentStatus(value: string): value is AssignmentStatus {
  return (ASSIGNMENT_STATUSES as readonly string[]).includes(value);
}

export const ASSIGNMENT_KINDS = [
  "homework",
  "classwork",
  "project",
  "worksheet",
  "reading",
  "practice",
  "quiz",
] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export function isAssignmentKind(value: string): value is AssignmentKind {
  return (ASSIGNMENT_KINDS as readonly string[]).includes(value);
}

export const SUBMISSION_TYPES = [
  "none",
  "tick",
  "offline",
  "text",
  "file",
  "link",
  "questions",
] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

export function isSubmissionType(value: string): value is SubmissionType {
  return (SUBMISSION_TYPES as readonly string[]).includes(value);
}

/** `file` is excluded from the picker: v1 has no upload path end to end. */
export const SELECTABLE_SUBMISSION_TYPES = [
  "none",
  "offline",
  "tick",
  "text",
  "link",
  "questions",
] as const satisfies readonly SubmissionType[];

export const GRADING_MODES = [
  "none",
  "completion",
  "marks",
  "grade",
  "rubric",
] as const;
export type GradingMode = (typeof GRADING_MODES)[number];

export function isGradingMode(value: string): value is GradingMode {
  return (GRADING_MODES as readonly string[]).includes(value);
}

/** The modes this slice can author. Scale and rubric reads arrive with Step 7. */
export const SELECTABLE_GRADING_MODES = [
  "none",
  "completion",
  "marks",
] as const satisfies readonly GradingMode[];

/** `0 = Sunday … 6 = Saturday`; only local-parts construction reads it. */
function weekdayIndexOf(iso: string): number {
  return new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  ).getDay();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A local `Date` → the reader's calendar day. */
export function localDayKey(value: Date): string {
  return `${pad(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * A timestamp (ISO string or Date) → the reader's calendar day, or null when
 * the value is missing/unparseable. `new Date(timestamp)` is correct here: a
 * timestamp names an instant, not a calendar day.
 */
export function dayKeyOf(
  value: string | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return localDayKey(date);
}

/** A timestamp → the reader's wall clock, `8:00 am`. */
export function clockOf(
  value: string | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatClock(`${pad(date.getHours())}:${pad(date.getMinutes())}`);
}

/** `08:00` (24-hour wire format) → `8:00 am`. */
export function formatClock(hhmm: string): string {
  const [hourText, minuteText] = hhmm.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "—";
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${pad(minute)} ${suffix}`;
}

/** `08:00` or a timestamp → the picker's 24-hour value. */
export function timeKeyOf(
  value: string | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) && /^\d{2}:\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Pure calendar arithmetic on a day key. `2026-12-31 + 1 = 2027-01-01`. */
export function addDays(isoDay: string, delta: number): string {
  if (!isIsoDate(isoDay)) return isoDay;
  const stamp = new Date(
    Date.UTC(
      Number(isoDay.slice(0, 4)),
      Number(isoDay.slice(5, 7)) - 1,
      Number(isoDay.slice(8, 10)) + delta,
    ),
  );
  return `${stamp.getUTCFullYear()}-${pad(stamp.getUTCMonth() + 1)}-${pad(
    stamp.getUTCDate(),
  )}`;
}

/** Monday of the week containing `isoDay`. */
export function startOfWeek(isoDay: string): string {
  if (!isIsoDate(isoDay)) return isoDay;
  const mondayOffset = (weekdayIndexOf(isoDay) + 6) % 7;
  return addDays(isoDay, -mondayOffset);
}

/** The seven day keys Monday → Sunday for the week containing `isoDay`. */
export function weekDays(isoDay: string): string[] {
  const start = startOfWeek(isoDay);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** Shift a week anchor by whole weeks. */
export function shiftWeek(isoDay: string, delta: number): string {
  return addDays(startOfWeek(isoDay), delta * 7);
}

/** Is `isoDay` in the same Monday-first week as `anchor`? */
export function isSameWeek(isoDay: string, anchor: string): boolean {
  return startOfWeek(isoDay) === startOfWeek(anchor);
}

/** `Today` / `Tomorrow` / `Yesterday` / `Wed 15 Oct`. */
export function dayLabel(
  isoDay: string | null | undefined,
  today = todayIso(),
): string {
  if (!isoDay || !isIsoDate(isoDay)) return "—";
  if (isoDay === today) return "Today";
  if (isoDay === addDays(today, 1)) return "Tomorrow";
  if (isoDay === addDays(today, -1)) return "Yesterday";
  return formatShortWeekday(isoDay);
}

/** `October 2026`, or `October – November 2026` when the strip crosses one. */
export function weekMonthLabel(days: readonly string[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "—";
  const firstLabel = formatMonthLong(first);
  const lastLabel = formatMonthLong(last);
  if (firstLabel === lastLabel) return firstLabel;

  const firstMonth = firstLabel.split(" ")[0] ?? firstLabel;
  const lastMonth = lastLabel.split(" ")[0] ?? lastLabel;
  if (first.slice(0, 4) === last.slice(0, 4)) {
    return `${firstMonth} – ${lastMonth} ${first.slice(0, 4)}`;
  }
  return `${firstLabel} – ${lastLabel}`;
}

/**
 * A form's separate date + time fields → the wire timestamp. Local parts,
 * converted once to an instant; returns null when either half is not real.
 */
export function composeTimestamp(
  isoDay: string | null,
  time: string | null,
): string | null {
  if (!isoDay || !time || !isIsoDate(isoDay) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));
  if (hour > 23 || minute > 59) return null;
  return new Date(
    Number(isoDay.slice(0, 4)),
    Number(isoDay.slice(5, 7)) - 1,
    Number(isoDay.slice(8, 10)),
    hour,
    minute,
    0,
    0,
  ).toISOString();
}

/** A wire timestamp → the form's date and time halves, in the reader's zone. */
export function splitTimestamp(value: string | Date | null | undefined): {
  day: string | null;
  time: string | null;
} {
  const day = dayKeyOf(value);
  const time = timeKeyOf(value);
  return { day, time };
}

/** Tomorrow at 08:00 local — the create form's honest starting point. */
export function defaultDueParts(today = todayIso()): {
  day: string;
  time: string;
} {
  return { day: addDays(today, 1), time: "08:00" };
}

/**
 * Move a due moment while keeping the row's existing grace window. The
 * server would otherwise re-derive the close from the SCHOOL default, not
 * the class override, so both edit and per-student extension send the close
 * moment explicitly.
 */
export function preserveLateWindow(
  dueAt: string,
  previousDueAt: string | Date,
  previousCloseAt: string | Date,
): string {
  const due = new Date(dueAt);
  const oldDue = new Date(previousDueAt);
  const oldClose = new Date(previousCloseAt);
  if (Number.isNaN(due.getTime())) return dueAt;
  if (Number.isNaN(oldDue.getTime()) || Number.isNaN(oldClose.getTime())) {
    return dueAt;
  }
  const window = Math.max(0, oldClose.getTime() - oldDue.getTime());
  return new Date(due.getTime() + window).toISOString();
}

/**
 * The close moment an edit should send back. Kept as the edit form's name so
 * the reason it exists stays visible there.
 */
export function closeForEdit(
  dueAt: string,
  existingDueAt: string | Date,
  existingCloseAt: string | Date,
): string {
  return preserveLateWindow(dueAt, existingDueAt, existingCloseAt);
}

/** Has the hard cutoff passed? */
export function isPastClose(
  closeAt: string | Date | null | undefined,
  now = new Date(),
): boolean {
  if (!closeAt) return false;
  const close = closeAt instanceof Date ? closeAt : new Date(closeAt);
  return !Number.isNaN(close.getTime()) && close.getTime() < now.getTime();
}

/**
 * Which statuses count as work that is actually with students. Used by the
 * rail's due-load dots: a draft is not due yet, a cancelled row never will be.
 */
export function countsAsDue(status: string): boolean {
  return status === "published" || status === "scheduled" || status === "closed";
}

/** `day key → number of assignments due` for the rail. */
export function dueLoadsByDay(
  rows: readonly { dueAt: string | Date; status: string }[],
): Record<string, number> {
  const loads: Record<string, number> = {};
  for (const row of rows) {
    if (!countsAsDue(row.status)) continue;
    const key = dayKeyOf(row.dueAt);
    if (!key) continue;
    loads[key] = (loads[key] ?? 0) + 1;
  }
  return loads;
}

/** Chronological sort by a timestamp; unparseable rows sink to the end. */
export function sortByDue<T extends { dueAt: string | Date }>(
  rows: readonly T[],
  direction: "asc" | "desc" = "asc",
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = new Date(a.dueAt).getTime();
    const right = new Date(b.dueAt).getTime();
    const leftRank = Number.isNaN(left) ? Number.POSITIVE_INFINITY : left;
    const rightRank = Number.isNaN(right) ? Number.POSITIVE_INFINITY : right;
    return (leftRank - rightRank) * sign;
  });
}

/** Rows bucketed by the reader's calendar day, in the order supplied. */
export function groupByDay<T extends { dueAt: string | Date }>(
  rows: readonly T[],
): { day: string; rows: T[] }[] {
  const groups: { day: string; rows: T[] }[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    const key = dayKeyOf(row.dueAt);
    if (!key) continue;
    const existing = index.get(key);
    if (existing !== undefined) {
      groups[existing]?.rows.push(row);
      continue;
    }
    index.set(key, groups.length);
    groups.push({ day: key, rows: [row] });
  }
  return groups;
}

/** `30 min` / `1 h` / `1 h 30 min` — the estimated-work line. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A positive decimal string, as the marks fields and the wire both use it. */
export function isPositiveMarks(value: string): boolean {
  return /^\d{1,5}(\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0;
}

/**
 * A score against its ceiling. Unlike a maximum, zero is a real result, so
 * the floor is 0 rather than "positive". A missing ceiling means uncapped.
 */
export function isValidMarks(value: string, max?: number | null): boolean {
  const trimmed = value.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(trimmed)) return false;
  if (max === null || max === undefined) return true;
  return Number(trimmed) <= max;
}

/** `8.00` → `8`, `8.50` → `8.5`; anything non-numeric is returned as-is. */
export function formatMarks(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || !/^-?\d+(\.\d+)?$/.test(text)) return text;
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

// ---------------------------------------------------------------------------
// The grading grid's counts, filters and roster order
// ---------------------------------------------------------------------------

export type StudentWorkCounts = {
  /** Rows that count toward the assignment's stats (late joiners excluded). */
  total: number;
  /** Everyone except excused — the honest denominator of "reviewed". */
  reviewable: number;
  reviewed: number;
  submitted: number;
  resubmit: number;
  /** Submitted or resubmit_requested — work a teacher can act on now. */
  toGrade: number;
  notSubmitted: number;
  missing: number;
  excused: number;
  /** View-only rows (backfilled late joiners); shown, never counted. */
  viewOnly: number;
};

/**
 * Count a student grid. `status` is deliberately a string: a row authored by
 * a newer build must not crash an older one. `countsTowardStats` mirrors the
 * schema's own rule for late joiners.
 */
export function countStudentWork(
  rows: readonly { status: string; countsTowardStats?: boolean }[],
): StudentWorkCounts {
  const counts: StudentWorkCounts = {
    total: 0,
    reviewable: 0,
    reviewed: 0,
    submitted: 0,
    resubmit: 0,
    toGrade: 0,
    notSubmitted: 0,
    missing: 0,
    excused: 0,
    viewOnly: 0,
  };

  for (const row of rows) {
    if (row.countsTowardStats === false) {
      counts.viewOnly += 1;
      continue;
    }
    counts.total += 1;
    if (row.status === "excused") counts.excused += 1;
    else counts.reviewable += 1;

    if (row.status === "reviewed") counts.reviewed += 1;
    else if (row.status === "submitted") counts.submitted += 1;
    else if (row.status === "resubmit_requested") counts.resubmit += 1;
    else if (row.status === "missing") counts.missing += 1;
    else if (row.status !== "excused") counts.notSubmitted += 1;
  }

  counts.toGrade = counts.submitted + counts.resubmit;
  return counts;
}

/** The grading grid's four segments. */
export type StudentGradeFilter = "all" | "to_grade" | "graded" | "missing";

export function matchesStudentFilter(
  status: string,
  filter: StudentGradeFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "to_grade") {
    return status === "submitted" || status === "resubmit_requested";
  }
  if (filter === "graded") return status === "reviewed";
  return status === "missing";
}

/**
 * Roll-number order, the way a teacher reads the register. Numeric rolls sort
 * numerically (so 2 comes before 10); non-numeric rolls follow in their own
 * alphabetical order; a missing roll sinks to the end; ties break on name.
 */
export function sortRoster<
  T extends { rollNumber: string | null; studentName: string },
>(rows: readonly T[]): T[] {
  const rank = (roll: string | null) => {
    const text = roll?.trim() ?? "";
    if (text === "") {
      return { numeric: false, value: Number.POSITIVE_INFINITY, text: "" };
    }
    const numeric = Number(text);
    return Number.isFinite(numeric)
      ? { numeric: true, value: numeric, text }
      : { numeric: false, value: Number.POSITIVE_INFINITY, text };
  };

  return [...rows].sort((a, b) => {
    const left = rank(a.rollNumber);
    const right = rank(b.rollNumber);
    if (left.numeric && right.numeric && left.value !== right.value) {
      return left.value - right.value;
    }
    if (left.numeric !== right.numeric) return left.numeric ? -1 : 1;
    if (!left.numeric && left.text !== right.text) {
      if (left.text === "") return 1;
      if (right.text === "") return -1;
      return left.text.localeCompare(right.text);
    }
    return a.studentName.localeCompare(b.studentName);
  });
}

// ---------------------------------------------------------------------------
// The All view's segmentation + triage helpers
// ---------------------------------------------------------------------------

/**
 * The All view's four segments. `live` is the teacher's working set: rows the
 * students can still see (published, and scheduled rows that will publish).
 * `closed` deliberately includes cancelled — "done with" is the question this
 * segment answers, and hiding a cancelled row from every segment would make
 * the ledger lie.
 */
export type HomeworkSegment = "live" | "drafts" | "closed" | "all";

const SEGMENT_OF: Record<AssignmentStatus, Exclude<HomeworkSegment, "all">> = {
  draft: "drafts",
  scheduled: "live",
  published: "live",
  closed: "closed",
  cancelled: "closed",
};

export function segmentOf(status: string): Exclude<HomeworkSegment, "all"> {
  return status in SEGMENT_OF
    ? SEGMENT_OF[status as AssignmentStatus]
    : "closed";
}

export function matchesSegment(
  status: string,
  segment: HomeworkSegment,
): boolean {
  return segment === "all" || segmentOf(status) === segment;
}

/**
 * Work a teacher can still act on: published rows past their due time. A
 * closed row is not "past due" — it is finished; a draft was never with the
 * students. Used by the Agenda banner, never to colour a card's whole row.
 */
export function isPastDue(
  row: { dueAt: string | Date; status: string },
  now = new Date(),
): boolean {
  if (row.status !== "published") return false;
  const due = row.dueAt instanceof Date ? row.dueAt : new Date(row.dueAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
}

/** The first day on or after `fromDay` with published work still due. */
export function nextDayWithWork(
  rows: readonly { dueAt: string | Date; status: string }[],
  fromDay: string,
): string | null {
  const days = rows
    .filter((row) => countsAsDue(row.status))
    .map((row) => dayKeyOf(row.dueAt))
    .filter((day): day is string => day !== null && day >= fromDay)
    .sort();
  return days[0] ?? null;
}
