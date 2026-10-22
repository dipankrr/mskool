/**
 * The generate sheet's logic, pure: the Monday-first weekday rows, the
 * three-state cycle, the minimum guard, and the payload's two sets.
 * Weekday numbers are JS `getUTCDay` values (0 = Sunday … 6 = Saturday) —
 * the same convention the contract and the service's date walk speak.
 */

export type WeekdayState = "working" | "half_day" | "off";

export type WeekdayRow = {
  /** 0 = Sunday … 6 = Saturday. */
  jsDay: number;
  state: WeekdayState;
};

/** The sheet renders Monday-first: the week reads Monday-first at school. */
export const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/** Mon–Fri in session, the weekend off — the web's default, kept. */
export function defaultWeekdayRows(): WeekdayRow[] {
  return WEEKDAY_ORDER.map((jsDay) => ({
    jsDay,
    state: jsDay >= 1 && jsDay <= 5 ? "working" : "off",
  }));
}

/** One tap cycles Working → Half day → Off → Working. */
export function cycleWeekdayState(state: WeekdayState): WeekdayState {
  if (state === "working") return "half_day";
  if (state === "half_day") return "off";
  return "working";
}

/** At least one in-session day a week — the contract's refine, client-side. */
export function hasAnyWorkingDay(rows: WeekdayRow[]): boolean {
  return rows.some((row) => row.state !== "off");
}

/**
 * The generator's payload: every non-off day is a working day; the half-day
 * set is the subset of those marked half day (the contract's refine ties
 * the two lists together).
 */
export function buildGenerateInput(rows: WeekdayRow[]): {
  workingWeekdays: number[];
  halfDayWeekdays: number[];
} {
  const working = rows.filter((row) => row.state !== "off");
  return {
    workingWeekdays: working.map((row) => row.jsDay),
    halfDayWeekdays: working
      .filter((row) => row.state === "half_day")
      .map((row) => row.jsDay),
  };
}
