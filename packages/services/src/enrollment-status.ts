/**
 * The one definition of who counts as what (ADR-057). Working lists read these
 * rather than spelling out their own, because separate spellings are how a
 * student who left ended up on attendance.
 */

/** On the school's books for that session. */
export const ENROLLED_STATUSES = ["admitted", "studying", "completed"] as const;

/** Left before finishing the school. */
export const LEFT_STATUSES = ["transferred_out", "withdrawn", "expelled"] as const;

export type LeftStatus = (typeof LEFT_STATUSES)[number];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today as the school's calendar has it. */
export function todayInIst(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
