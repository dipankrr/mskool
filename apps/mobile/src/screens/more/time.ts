/**
 * Date arithmetic for More's heroes: where today sits in a term or a session.
 * Dates are ISO `YYYY-MM-DD` strings and compare as text; days are counted in
 * UTC so a time zone never shifts a boundary.
 */

type Span = { startDate: string; endDate: string };

const DAY = 86_400_000;

function ms(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** Whole days from `today` to `iso`; negative when it has passed. */
export function daysUntil(iso: string, today: string): number {
  return Math.round((ms(iso) - ms(today)) / DAY);
}

/** Where `today` falls between `from` and `to`, clamped to 0..1. */
export function fraction(from: string, to: string, today: string): number {
  const whole = ms(to) - ms(from);
  if (whole <= 0) return 0;
  return Math.min(1, Math.max(0, (ms(today) - ms(from)) / whole));
}

/** The term running today; terms are sorted by start date first. */
export function currentTerm<T extends Span>(terms: readonly T[], today: string): T | null {
  return [...terms]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .find((term) => term.startDate <= today && today <= term.endDate) ?? null;
}

/** "Week 6 of 14": 1-based week of `today` in a span, and the span's weeks. */
export function weekOf(span: Span, today: string): { week: number; weeks: number } {
  const weeks = Math.max(1, Math.ceil((daysUntil(span.endDate, span.startDate) + 1) / 7));
  const week = Math.min(weeks, Math.max(1, Math.floor(daysUntil(today, span.startDate) / 7) + 1));
  return { week, weeks };
}

/** The twelve month initials from a session's first month: "A M J J …". */
export function monthInitials(startIso: string): string[] {
  const names = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const first = Number(startIso.slice(5, 7)) - 1;
  return Array.from({ length: 12 }, (_, i) => names[(first + i) % 12]!);
}
