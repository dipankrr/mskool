/**
 * Pure rules for the family Exams screens: which exams are current, how far
 * away an exam is, and the date sheet grouped by day.
 */

export type ExamState = "upcoming" | "ongoing" | "marks_being_checked" | "results_out";
export type Tone = "positive" | "caution" | "critical" | "info" | "neutral";

type ExamLike = { id: string; state: ExamState; firstDate: string | null; lastDate: string | null };

export const EXAM_TONE: Record<ExamState, Tone> = {
  upcoming: "info",
  ongoing: "caution",
  marks_being_checked: "neutral",
  results_out: "positive",
};

/** Coming up and running now (soonest first), then the rest (latest first). */
export function splitExams<T extends ExamLike>(exams: readonly T[]): { current: T[]; past: T[] } {
  const current = exams
    .filter((e) => e.state === "upcoming" || e.state === "ongoing")
    .sort((a, b) => (a.firstDate ?? "9999").localeCompare(b.firstDate ?? "9999") || a.id.localeCompare(b.id));
  const past = exams
    .filter((e) => e.state === "marks_being_checked" || e.state === "results_out")
    .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? "") || a.id.localeCompare(b.id));
  return { current, past };
}

/** Whole days from `today` to `date` (both ISO); negative when past. */
export function daysUntil(date: string, today: string): number {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = date.split("-").map(Number);
  const a = Date.UTC(y1!, m1! - 1, d1!);
  const b = Date.UTC(y2!, m2! - 1, d2!);
  return Math.round((b - a) / 86_400_000);
}

type PaperLike = { examDate: string; startTime: string; subjectName: string };

/** The date sheet as days, each day's papers by start time. */
export function papersByDay<T extends PaperLike>(papers: readonly T[]): { date: string; papers: T[] }[] {
  const sorted = [...papers].sort(
    (a, b) =>
      a.examDate.localeCompare(b.examDate) ||
      a.startTime.localeCompare(b.startTime) ||
      a.subjectName.localeCompare(b.subjectName),
  );
  const days: { date: string; papers: T[] }[] = [];
  for (const paper of sorted) {
    const last = days[days.length - 1];
    if (last && last.date === paper.examDate) last.papers.push(paper);
    else days.push({ date: paper.examDate, papers: [paper] });
  }
  return days;
}

/** The first day with a paper on or after today, to highlight. */
export function nextDay(days: readonly { date: string }[], today: string): string | null {
  return days.find((day) => day.date >= today)?.date ?? null;
}
