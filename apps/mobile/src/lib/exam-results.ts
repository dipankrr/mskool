import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReportCardSnapshotV1 } from "@repo/contracts";

import { checkMarks } from "./exams";

/**
 * RESULTS, PUBLICATION AND CORRECTIONS (chunk 7C) — the pure layer. The wire
 * shapes are inferred once (ADR-048: `@repo/trpc` and `@repo/contracts` are
 * type-only imports; the snapshot guard below is hand-rolled because no
 * runtime schema may cross into the mobile bundle).
 *
 * Timestamps arrive as ISO strings at runtime although the contracts type them
 * `Date` — the display helpers accept `string | Date`.
 */
type Out = inferRouterOutputs<AppRouter>["exam"];

export type ClassResults = NonNullable<Out["results"]["table"]>;
export type ResultStudent = ClassResults["roster"][number];
export type SubjectResult = ClassResults["subjectResults"][number];
export type TermResult = ClassResults["termResults"][number];
export type SubjectStat = ClassResults["stats"][number];
export type PublicationRow = NonNullable<Out["publication"]["list"]>[number];
export type StudentEntry = NonNullable<Out["marks"]["studentEntries"]>[number];
export type CardVersion = Out["cards"]["versions"][number];
export type ClassCard = NonNullable<Out["cards"]["classSet"]>["cards"][number];

export type ResultFilter = "all" | "failed" | "attention" | "absent";

export type ResultRow = {
  student: ResultStudent;
  /** The student's term result, when a compute has produced one. */
  term: TermResult | null;
  /** The student's subject results, in the order given by the read. */
  subjects: SubjectResult[];
  anyAbsent: boolean;
};

/**
 * The one list the screen renders: every rostered student with their term
 * result (or the honest absence of one — "Not computed"), plus the flags the
 * filters need. Order is the read's roll order; the list adds nothing.
 */
export function resultRows(table: ClassResults): ResultRow[] {
  const termByStudent = new Map(table.termResults.map((row) => [row.studentId, row]));
  const subjectsByStudent = new Map<string, SubjectResult[]>();
  for (const row of table.subjectResults) {
    const list = subjectsByStudent.get(row.studentId);
    if (list) list.push(row);
    else subjectsByStudent.set(row.studentId, [row]);
  }
  return table.roster.map((student) => {
    const subjects = subjectsByStudent.get(student.studentId) ?? [];
    return {
      student,
      term: termByStudent.get(student.studentId) ?? null,
      subjects,
      anyAbsent: subjects.some((row) => row.isAbsent),
    };
  });
}

/**
 * The three filters beside the list. "Absent" wins first (an absent student
 * is not a failed one — the marks simply do not exist), then failed, then the
 * quiet ones: passed overall but carrying failed subjects, the compartment
 * risk the principal should see before publication.
 */
export function matchesResultFilter(row: ResultRow, filter: ResultFilter): boolean {
  if (filter === "all") return true;
  if (filter === "absent") return row.anyAbsent;
  if (!row.term) return false;
  if (filter === "failed") return !row.anyAbsent && !row.term.isPassed;
  return !row.anyAbsent && row.term.isPassed && row.term.subjectsFailedCount > 0;
}

/**
 * The GPA branch (every counted subject graded-only): percentage is
 * suppressed, the grade is the row's number. True when the row should print
 * the grade where a percentage would sit.
 */
export function isGradeOnlyRow(row: ResultRow): boolean {
  return Boolean(row.term && row.term.percentage === null && row.term.grade !== null);
}

/** "82.40" → "82.4", "60.00" → "60", nothing → "—". */
export function displayPercent(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const trimmed = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return trimmed === "" ? "—" : trimmed;
}

/**
 * Timestamps arrive as ISO strings on the wire although the contracts type
 * them `Date`; this normalizes both into what `formatIsoDate` accepts.
 */
export function isoOf(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : value.toISOString();
}

export type ResultVerdict = "pass" | "fail" | "absent" | "none";

/** The row's pill, decided with the tone's word so colour is never alone. */
export function resultVerdict(row: ResultRow): ResultVerdict {
  if (row.term === null) return "none";
  if (row.anyAbsent) return "absent";
  return row.term.isPassed ? "pass" : "fail";
}

/** The rank words under the name; section first, class second. */
export function rankLine(
  term: TermResult | null,
): { section: number | null; class: number | null } | null {
  if (!term) return null;
  if (term.rankInSection === null && term.rankInClass === null) return null;
  return { section: term.rankInSection, class: term.rankInClass };
}

// ---------------------------------------------------------------------------
// Publication states
// ---------------------------------------------------------------------------

export type PublicationState = "published" | "revision_open" | "re_issued";

export function publicationState(row: PublicationRow | undefined): PublicationState | null {
  if (!row) return null;
  return (["published", "revision_open", "re_issued"] as const).includes(
    row.state as PublicationState,
  )
    ? (row.state as PublicationState)
    : null;
}

// ---------------------------------------------------------------------------
// The report-card snapshot — the guard that keeps a bad row off the screen
// ---------------------------------------------------------------------------

/**
 * Hand-rolled structural guard for `reportCardSnapshotV1` (ADR-048 keeps the
 * zod schema out of the bundle). It asks exactly what the renderer touches —
 * header, subjects, totals — and answers null for anything else, so a bad
 * card renders "unreadable" instead of crashing the set.
 */
export function asSnapshot(data: unknown): ReportCardSnapshotV1 | null {
  if (typeof data !== "object" || data === null) return null;
  const card = data as Record<string, unknown>;
  const student = card.student as Record<string, unknown> | undefined;
  const totals = card.totals as Record<string, unknown> | undefined;
  if (
    typeof student?.name !== "string" ||
    typeof card.school !== "object" ||
    card.school === null ||
    !Array.isArray(card.subjects) ||
    typeof totals !== "object" ||
    totals === null
  ) {
    return null;
  }
  const subjects = card.subjects.every(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as Record<string, unknown>).subjectName === "string",
  );
  if (!subjects) return null;
  return data as ReportCardSnapshotV1;
}

/**
 * What changed between two versions of one card, in the words the versions
 * list prints ("Mathematics 62 → 65"). Totals first, then the subjects whose
 * marks or grade moved. Absent/exempt flips read as the state they became.
 */
export function versionChanges(
  previous: ReportCardSnapshotV1 | null,
  next: ReportCardSnapshotV1 | null,
  limit = 4,
): string[] {
  if (!previous || !next) return [];
  const changes: string[] = [];
  const push = (text: string) => {
    if (changes.length < limit) changes.push(text);
  };
  const pair = (
    label: string,
    before: string | null | undefined,
    after: string | null | undefined,
    absentBefore?: boolean,
    absentAfter?: boolean,
  ) => {
    const oldText = absentBefore ? "AB" : (before ?? "—");
    const newText = absentAfter ? "AB" : (after ?? "—");
    if (oldText !== newText) push(`${label} ${oldText} → ${newText}`);
  };

  pair("Total", previous.totals.totalMarks, next.totals.totalMarks);
  pair("Grade", previous.totals.grade, next.totals.grade);
  pair(
    "Rank in class",
    previous.totals.rankInClass === null ? null : String(previous.totals.rankInClass),
    next.totals.rankInClass === null ? null : String(next.totals.rankInClass),
  );

  const before = new Map(previous.subjects.map((row) => [row.subjectName, row]));
  for (const row of next.subjects) {
    const was = before.get(row.subjectName);
    if (!was) continue;
    pair(row.subjectName, was.marksObtained, row.marksObtained, was.isAbsent, row.isAbsent);
  }
  return changes;
}

// ---------------------------------------------------------------------------
// The correction form
// ---------------------------------------------------------------------------

export const REVISION_TYPES = [
  "marks_correction",
  "re_evaluation",
  "data_entry_error",
  "other",
] as const;
export type RevisionType = (typeof REVISION_TYPES)[number];

export type CorrectionInput = {
  /** The component's maximum, for the client-side range check (server gap 21). */
  max: number;
  gradedOnly: boolean;
  text: string;
  revisionType: RevisionType | null;
  reason: string;
};

export type CorrectionCheck =
  | { ok: true; revisedMarks: string | null; revisedGrade: string | null }
  | { ok: false; reason: "format" | "range" | "type" | "reason" };

/**
 * Judge the correction sheet the way the entry grid judges a cell, plus the
 * two fields the ledger demands. Blank marks are valid (they clear the mark);
 * an over-max value is refused HERE because the server has no friendly wording
 * for it (gap 21), and the reason must be at least three real characters.
 */
export function checkCorrection(input: CorrectionInput): CorrectionCheck {
  if (input.revisionType === null) return { ok: false, reason: "type" };
  if (input.reason.trim().length < 3) return { ok: false, reason: "reason" };
  if (input.gradedOnly) {
    const grade = input.text.trim().toUpperCase();
    return {
      ok: true,
      revisedMarks: null,
      revisedGrade: grade === "" ? null : grade.slice(0, 10),
    };
  }
  const verdict = checkMarks(input.text, { max: input.max, allowNegative: false });
  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason === "range" ? "range" : "format" };
  }
  return { ok: true, revisedMarks: verdict.value, revisedGrade: null };
}

/** The component entries of one subject, in the read's order. */
export function entriesForSubject(
  entries: StudentEntry[],
  subjectId: string,
): StudentEntry[] {
  return entries.filter((row) => row.subjectId === subjectId);
}

/** A published (correctable) entry. Locked rows refuse — the exam is sealed. */
export function isCorrectableEntry(entry: StudentEntry): boolean {
  return entry.resultStatus === "published";
}
