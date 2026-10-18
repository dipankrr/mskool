/**
 * The attendance draft — pure state maths, no React and no network, so the
 * rules the web page proved are unit-testable here (proof item 4 of the slice
 * plan). Ported from apps/web's marking page: prefill rules, changed-set
 * comparison, derived done, correction-reason scope. ONE owner-approved
 * divergence: an unmarked day defaults to ALL PRESENT, not the web's absent —
 * "everyone is here" is the fact the teacher is confirming.
 */

export type Status = "present" | "absent" | "late" | "half_day" | "on_leave";

export const STATUSES: readonly Status[] = [
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
];

/** What a row shows when the authoritative layer holds no mark for it. */
export const DEFAULT_STATUS: Status = "present";

export type Draft = ReadonlyMap<string, Status>;

export type StatusCounts = Record<Status, number>;

export function buildDraft(
  rosterIds: readonly string[],
  stored: ReadonlyMap<string, Status>,
): Map<string, Status> {
  const next = new Map<string, Status>();
  for (const studentId of rosterIds) {
    next.set(studentId, stored.get(studentId) ?? DEFAULT_STATUS);
  }
  return next;
}

/**
 * One tap on a row: present ⇄ absent, and every exception status (late / half
 * day / on leave) returns to present. The five exact choices live in the
 * long-press sheet — the one-tap cycle stays a two-state toggle a thumb
 * learns without thinking.
 */
export function toggleStatus(current: Status): Status {
  return current === "present" ? "absent" : "present";
}

export function withStatus(
  draft: Draft,
  studentId: string,
  status: Status,
): Map<string, Status> {
  const next = new Map(draft);
  next.set(studentId, status);
  return next;
}

export function bulkDraft(
  rosterIds: readonly string[],
  status: Status,
): Map<string, Status> {
  return new Map(rosterIds.map((studentId) => [studentId, status]));
}

export function countStatuses(
  rosterIds: readonly string[],
  draft: Draft,
): StatusCounts {
  const counts: StatusCounts = {
    present: 0,
    absent: 0,
    late: 0,
    half_day: 0,
    on_leave: 0,
  };
  for (const studentId of rosterIds) {
    counts[draft.get(studentId) ?? DEFAULT_STATUS] += 1;
  }
  return counts;
}

/**
 * Who is actually CHANGING relative to the stored marks — the correction
 * reason's scope AND the done derivation. A roster student with no stored row
 * compares as the prefill's own default, so a never-marked student whose pill
 * still reads present is not a pending change (otherwise no partially-marked
 * day could ever be clean).
 */
export function changingIds(
  rosterIds: readonly string[],
  draft: Draft,
  stored: ReadonlyMap<string, Status>,
): string[] {
  return rosterIds.filter(
    (studentId) =>
      (stored.get(studentId) ?? DEFAULT_STATUS) !==
      (draft.get(studentId) ?? DEFAULT_STATUS),
  );
}

/** One student's entry in the `attendance.mark` payload. */
export type AttendanceEntry = {
  studentId: string;
  status: Status;
  correctionReason?: string;
};

/**
 * The submit payload: EVERY roster entry (the server upserts), with the
 * correction reason riding only on entries whose status changed from what the
 * authoritative layer holds and only on a past date — an unchanged row has no
 * edit to explain, and same-day marking never asks (ADR-030).
 */
export function buildEntries(
  rosterIds: readonly string[],
  draft: Draft,
  stored: ReadonlyMap<string, Status>,
  options: { isPast: boolean; reason: string },
): AttendanceEntry[] {
  const reason = options.reason.trim();
  return rosterIds.map((studentId) => {
    const status = draft.get(studentId) ?? DEFAULT_STATUS;
    const changed =
      (stored.get(studentId) ?? DEFAULT_STATUS) !== status;
    return {
      studentId,
      status,
      ...(changed && options.isPast && reason
        ? { correctionReason: reason }
        : {}),
    };
  });
}

/**
 * DONE, derived — never remembered. The day is clean when the authoritative
 * layer holds marks AND nothing on screen differs from them AND the teacher
 * has not re-opened editing via the saved bar's Edit pill. The saved bar
 * shows exactly then; any edit flips the screen back to the Save CTA.
 */
export function deriveClean(input: {
  dayIsMarked: boolean;
  changingCount: number;
  editing: boolean;
}): boolean {
  return input.dayIsMarked && input.changingCount === 0 && !input.editing;
}
