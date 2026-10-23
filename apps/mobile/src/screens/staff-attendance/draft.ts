/**
 * The attendance draft — pure state maths, no React and no network, so the
 * rules the web page proved are unit-testable here (proof item 4 of the slice
 * plan). Ported from apps/web's marking page: prefill rules, changed-set
 * comparison, derived done, correction-reason scope.
 *
 * The owner rejected the web's "unmarked means absent" and our first pass's
 * "unmarked means present" equally: on a phone neither is the teacher's fact
 * yet. An unmarked day therefore has an EMPTY draft. Bulk actions are the
 * fast path; the first tap on a blank row marks that student present.
 */

export type Status = "present" | "absent" | "late" | "half_day" | "on_leave";

export const STATUSES: readonly Status[] = [
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
];

export type Draft = ReadonlyMap<string, Status>;

export type StatusCounts = Record<Status, number> & {
  /** Roster rows with no explicit status in the draft. */
  unmarked: number;
  /** Roster rows with a status (the save progress numerator). */
  marked: number;
};

/**
 * Only the authoritative marks seed the draft. A missing student stays
 * missing — the UI renders "Not marked" and the save payload omits them.
 */
export function buildDraft(
  rosterIds: readonly string[],
  stored: ReadonlyMap<string, Status>,
): Map<string, Status> {
  const next = new Map<string, Status>();
  for (const studentId of rosterIds) {
    const status = stored.get(studentId);
    if (status) next.set(studentId, status);
  }
  return next;
}

/**
 * One tap on a row: blank → present, present ⇄ absent, and every exception
 * status (late / half day / on leave) returns to present. The five exact
 * choices live in the long-press sheet — the one-tap cycle stays a two-state
 * toggle a thumb learns without thinking.
 */
export function toggleStatus(current: Status | undefined): Status {
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
    unmarked: 0,
    marked: 0,
  };
  for (const studentId of rosterIds) {
    const status = draft.get(studentId);
    if (status === undefined) {
      counts.unmarked += 1;
    } else {
      counts[status] += 1;
      counts.marked += 1;
    }
  }
  return counts;
}

/**
 * Who is actually CHANGING relative to the stored marks — the correction
 * reason's scope AND the done derivation. Comparisons are raw: a missing
 * stored row and a missing draft row are both "no fact yet", so a blank day
 * with no draft is clean-by-emptiness (but still not DONE, see
 * `deriveClean`).
 */
export function changingIds(
  rosterIds: readonly string[],
  draft: Draft,
  stored: ReadonlyMap<string, Status>,
): string[] {
  return rosterIds.filter(
    (studentId) => stored.get(studentId) !== draft.get(studentId),
  );
}

/** One student's entry in the `attendance.mark` payload. */
export type AttendanceEntry = {
  studentId: string;
  status: Status;
  correctionReason?: string;
};

/**
 * The submit payload: the MARKED rows only. The server upserts each entry,
 * so a partially marked register saves exactly what the teacher set and
 * leaves everyone else untouched. A blank row is not a present row. The
 * correction reason rides only on entries whose status changed from what the
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
  const entries: AttendanceEntry[] = [];
  for (const studentId of rosterIds) {
    const status = draft.get(studentId);
    if (status === undefined) continue;
    const changed = stored.get(studentId) !== status;
    entries.push({
      studentId,
      status,
      ...(changed && options.isPast && reason
        ? { correctionReason: reason }
        : {}),
    });
  }
  return entries;
}

/**
 * DONE, derived — never remembered. The day is clean when the authoritative
 * layer holds marks, every roster row has a status, nothing on screen differs
 * from the stored marks, and the teacher has not re-opened editing via the
 * completion card's Edit action. The completion card shows exactly then; any
 * edit flips back to the save CTA. A partially stored day therefore stays in
 * the editable state until the missing rows are filled.
 */
export function deriveClean(input: {
  dayIsMarked: boolean;
  changingCount: number;
  unmarkedCount: number;
  editing: boolean;
}): boolean {
  return (
    input.dayIsMarked &&
    input.unmarkedCount === 0 &&
    input.changingCount === 0 &&
    !input.editing
  );
}
