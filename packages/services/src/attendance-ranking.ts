/**
 * The family attendance ranking (ADR-062). Pure: no database.
 *
 * - Each student's figure is the "so far" count (ADR-061): days that have
 *   happened and that the student was on the books for.
 * - A student needs `minWorkingDays` counted working days to be ranked.
 * - Equal percentages (as shown, two decimals) share a rank: 1, 2, 2, 4.
 * - The top list holds every student ranked 10th or better, so ties at 10th
 *   are all shown. Within a tie it is ordered by name.
 */

export const TOP_LIST_RANK = 10;
/** Term and year: the fewest counted working days to be ranked. */
export const MIN_DAYS_LONG_PERIOD = 15;

/** A month: half of the school's working days so far, at least one. */
export function minDaysForMonth(schoolWorkingDaysSoFar: number): number {
  return Math.max(1, Math.ceil(schoolWorkingDaysSoFar / 2));
}

export type RankingEntry = {
  studentId: string;
  name: string;
  workingDays: number;
  daysAttended: number;
  /** Two decimals, as shown. Null when nothing was marked in the period. */
  percentage: string | null;
};

export type RankedEntry = RankingEntry & { rank: number; percentage: string };

export function rankEntries(
  entries: readonly RankingEntry[],
  minWorkingDays: number,
): RankedEntry[] {
  const eligible = entries.filter(
    (e): e is RankingEntry & { percentage: string } =>
      e.percentage != null && e.workingDays >= minWorkingDays,
  );
  eligible.sort((a, b) => {
    const diff = Number(b.percentage) - Number(a.percentage);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });

  const ranked: RankedEntry[] = [];
  let previous: string | null = null;
  let rank = 0;
  eligible.forEach((entry, index) => {
    if (entry.percentage !== previous) {
      rank = index + 1;
      previous = entry.percentage;
    }
    ranked.push({ ...entry, rank });
  });
  return ranked;
}

export function topList(ranked: readonly RankedEntry[]): RankedEntry[] {
  return ranked.filter((e) => e.rank <= TOP_LIST_RANK);
}
