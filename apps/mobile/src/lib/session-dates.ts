import { isIsoDate, todayIso } from "./format";

/**
 * The Indian academic session as a pure value, mirroring apps/web's rules so
 * both clients create the same row from the same choice: a start year means
 * 1 April to 31 March, named `2025-26`.
 *
 * Two dates typed by hand is where the overlapping-session mistake comes from;
 * the start-year pills exist so the common case is one tap, while the date
 * fields stay editable for a school that genuinely runs different months.
 * The database's exclusion constraint remains the authority (ADR-022).
 */

export type SessionDates = {
  name: string;
  startDate: string;
  endDate: string;
};

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** The session that starts in `startYear`; `2025` → name `2025-26`. */
export function sessionFromStartYear(startYear: number): SessionDates {
  return {
    name: `${startYear}-${pad((startYear + 1) % 100)}`,
    startDate: `${pad(startYear, 4)}-04-01`,
    endDate: `${pad(startYear + 1, 4)}-03-31`,
  };
}

/** April onwards is this calendar year's session; January–March is the last one. */
export function currentSessionStartYear(today: string = todayIso()): number {
  const year = Number(today.slice(0, 4));
  if (!isIsoDate(today) || Number.isNaN(year)) {
    return new Date().getFullYear();
  }
  const month = Number(today.slice(5, 7));
  return month >= 4 ? year : year - 1;
}

/**
 * The three years a school plausibly needs: next, this, last. Newest first so
 * the coming session — the one an administrator sets up in advance — leads.
 */
export function sessionStartYearOptions(
  today: string = todayIso(),
): number[] {
  const current = currentSessionStartYear(today);
  return [current + 1, current, current - 1];
}

/** Which preset, if any, the current name/dates still match exactly. */
export function matchedStartYear(
  form: { name: string; startDate: string; endDate: string },
  options: number[],
): number | null {
  const match = options.find((year) => {
    const preset = sessionFromStartYear(year);
    return (
      preset.name === form.name &&
      preset.startDate === form.startDate &&
      preset.endDate === form.endDate
    );
  });
  return match ?? null;
}

export type SessionStatus = "running" | "upcoming" | "not_running" | "past";

/**
 * Running beats the calendar: a session marked current is the one staff work
 * in even if its dates have been amended past today. A year that contains
 * today but is not flagged current is `not_running` — the setup mistake the
 * screen must show honestly rather than calling it past (the database allows
 * only one current row even when two date ranges touch today, e.g. before the
 * year-change is made official).
 */
export function sessionStatus(
  year: { isCurrent: boolean; startDate: string; endDate: string },
  today: string = todayIso(),
): SessionStatus {
  if (year.isCurrent) return "running";
  if (isIsoDate(year.endDate) && year.endDate < today) return "past";
  if (isIsoDate(year.startDate) && year.startDate > today) return "upcoming";
  return "not_running";
}
