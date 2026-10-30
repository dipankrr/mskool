import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

/**
 * EXAM BLUEPRINT (chunk 7D) — the pure layer behind the office's screens:
 * the exam form's frozen-field logic, paper generation from a class's
 * subject mappings (web parity: the CBSE default part, 09:30 · 180 min,
 * sequential dates that skip Sundays), and the component checks the save
 * will face. The server remains the referee; this only shows the verdict
 * before the save.
 */
type Out = inferRouterOutputs<AppRouter>;

export type SubjectTypeRow = Out["exam"]["subjectTypes"]["list"][number];
export type MappingRow = Out["assignment"]["subjectMapping"]["list"][number];

/** The web's prefilled part, so a fresh paper can always be scheduled. */
export const DEFAULT_COMPONENT = {
  name: "Theory",
  maxMarks: "100",
  passMarks: "33",
  weightagePercentage: "100",
  isMandatoryPass: true,
  sequenceNumber: 1,
} as const;

export const DEFAULT_START_TIME = "09:30";
export const DEFAULT_DURATION_MINUTES = 180;

// ---------------------------------------------------------------------------
// Paper generation ("Add class")
// ---------------------------------------------------------------------------

/**
 * The class's mapped subjects that become papers: counted, exam-mode (a
 * term_grade subject is assessed by teachers, never a paper). Subjects that
 * already have a paper in this exam are skipped — a re-run must never
 * duplicate or reset an edited row.
 */
export function paperSubjects(args: {
  mappings: readonly MappingRow[];
  typeById: ReadonlyMap<string, SubjectTypeRow>;
  existingSubjectIds: ReadonlySet<string>;
}): MappingRow[] {
  return args.mappings.filter((mapping) => {
    if (args.existingSubjectIds.has(mapping.subjectId)) return false;
    const type = mapping.subjectTypeId
      ? args.typeById.get(mapping.subjectTypeId)
      : undefined;
    if (!type) return false;
    return type.countsTowardResult && type.assessmentMode === "exam";
  });
}

/**
 * The web's date prefill: papers run from tomorrow, skipping Sundays,
 * one counted paper per day slot. ISO strings only — the same trick as
 * `lib/format` (no timezone to get wrong).
 */
export function prefillExamDate(index: number, from: Date = new Date()): string {
  const day = new Date(from);
  day.setDate(day.getDate() + 1);
  while (day.getDay() === 0) day.setDate(day.getDate() + 1);
  let placed = 0;
  while (placed < index) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() !== 0) placed += 1;
  }
  const yyyy = day.getFullYear();
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** A new paper row, prefilled to be valid before any edit. */
export function newPaper(args: {
  classId: string;
  subjectId: string;
  index: number;
}): {
  classId: string;
  subjectId: string;
  sectionId: null;
  examDate: string;
  startTime: string;
  durationMinutes: number;
  venue: undefined;
  passMarks: undefined;
} {
  return {
    classId: args.classId,
    subjectId: args.subjectId,
    sectionId: null,
    examDate: prefillExamDate(args.index),
    startTime: DEFAULT_START_TIME,
    durationMinutes: DEFAULT_DURATION_MINUTES,
    venue: undefined,
    passMarks: undefined,
  };
}

// ---------------------------------------------------------------------------
// Components editor
// ---------------------------------------------------------------------------

export type ComponentDraft = {
  name: string;
  maxMarks: string;
  passMarks: string;
  weightagePercentage: string;
  isMandatoryPass: boolean;
};

/** Sum of the weight column, in whole numbers ("60" + "40" → 100). */
export function weightSum(components: readonly ComponentDraft[]): number {
  return components.reduce(
    (sum, component) => sum + (Number(component.weightagePercentage) || 0),
    0,
  );
}

export type ComponentCheck =
  | { ok: true }
  | { ok: false; row: number; reason: "format" | "passOverMax" | "emptyName" };

/**
 * Judge the editor's rows the way the save will be judged: names present,
 * pass ≤ max, numbers numeric. The weight sum is NOT here — the screen
 * shows the running sum live and the server owns the exactly-100 rule.
 */
export function checkComponents(
  components: readonly ComponentDraft[],
): ComponentCheck {
  for (const [index, component] of components.entries()) {
    if (component.name.trim() === "") {
      return { ok: false, row: index, reason: "emptyName" };
    }
    const max = Number(component.maxMarks);
    const pass = Number(component.passMarks);
    if (!Number.isFinite(max) || !Number.isFinite(pass) || max <= 0) {
      return { ok: false, row: index, reason: "format" };
    }
    if (pass > max) {
      return { ok: false, row: index, reason: "passOverMax" };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The exam form's frozen fields
// ---------------------------------------------------------------------------

export type ExamFormFields = {
  name: string;
  weightageInTerm: string;
  countsTowardTermResult: boolean;
  allowsNegativeMarking: boolean;
};

/**
 * The freeze the form uses: stage-based. `draft` and `scheduled` are
 * editable; from `marks_entry` onward the form treats weight/count/negative
 * as frozen — the server's own key is "any mark exists", and the stage is
 * the honest proxy a byId row can answer without a read per paper. The
 * server remains the referee for the rare race: a late save that the stage
 * thought safe still refuses with its own words, printed inline.
 */
export function editFrozenFields(exam: {
  status: string;
}): { weightage: boolean; countsTowardTerm: boolean; negativeMarking: boolean } {
  const frozen =
    exam.status === "marks_entry" ||
    exam.status === "under_verification" ||
    exam.status === "published" ||
    exam.status === "locked";
  return {
    weightage: frozen,
    countsTowardTerm: frozen,
    negativeMarking: frozen,
  };
}

/** Whether the exam type demands the linked-exam picker (contract refine). */
export function requiresLinkedExam(examType: string): boolean {
  return examType === "supplementary" || examType === "improvement";
}

/**
 * The counted switch's value the form shows: the server forces mock/test to
 * non-counting regardless of the toggle, so the form shows and sends that
 * truth instead of a value the save will silently override.
 */
export function effectiveCountsTowardTerm(
  examType: string,
  toggle: boolean,
): boolean {
  if (examType === "mock" || examType === "test") return false;
  return toggle;
}

/**
 * The form's payload for `exam.create`. Null weight means "server default"
 * (the DB defaults to 100); the counted flag rides effectiveCountsTowardTerm.
 */
export function createExamPayload(args: {
  name: string;
  termId: string;
  examType: string;
  weightageInTerm: string;
  countsTowardTermResult: boolean;
  allowsNegativeMarking: boolean;
  linkedExamId: string | null;
}): Record<string, unknown> {
  const counted = effectiveCountsTowardTerm(
    args.examType,
    args.countsTowardTermResult,
  );
  const weight = Number(args.weightageInTerm);
  return {
    name: args.name.trim(),
    termId: args.termId,
    examType: args.examType,
    ...(Number.isFinite(weight) && args.weightageInTerm.trim() !== ""
      ? { weightageInTerm: String(weight) }
      : {}),
    countsTowardTermResult: counted,
    allowsNegativeMarking: args.allowsNegativeMarking,
    ...(requiresLinkedExam(args.examType) && args.linkedExamId
      ? { linkedExamId: args.linkedExamId }
      : {}),
  };
}

/**
 * The weight a NEW counting exam may still take in a term: 100 minus what the
 * term's other counting exams already hold. Non-counting exams (practice
 * papers, switch-off) never consume the aggregate, and an exam being EDITED
 * does not consume its own current weight — it is replacing it. Over-committed
 * terms (more than 100 was stored) clamp to 0; the server stays the referee.
 */
export type WeightContribution = {
  id: string;
  termId: string;
  countsTowardTermResult: boolean;
  /** The DB numeric arrives as a string ("50.00"). */
  weightageInTerm: string | null;
};

export function weightHeadroom(
  exams: readonly WeightContribution[],
  termId: string | null,
  editingExamId?: string | null,
): number {
  if (!termId) return 100;
  const used = exams
    .filter(
      (exam) =>
        exam.id !== editingExamId &&
        exam.termId === termId &&
        exam.countsTowardTermResult,
    )
    .reduce((sum, exam) => sum + Number(exam.weightageInTerm ?? 0), 0);
  return Math.max(0, Math.min(100, 100 - used));
}

// ---------------------------------------------------------------------------
// Paper identity + the section partition (ADR-052)
// ---------------------------------------------------------------------------

/**
 * A paper IS its (subject, section) within a class — the same identity the
 * server's schedule sync keys on (a null section is one class-wide paper).
 * The partition rule (ADR-052): a subject is either ONE class-wide paper or
 * papers for a subset of the class's sections — never both shapes, never a
 * section twice. Partial section sets are legitimate ("only 6-A sits
 * Mathematics this week").
 */
export function paperKey(subjectId: string, sectionId: string | null): string {
  return `${subjectId}|${sectionId ?? "*"}`;
}

export type PartitionRow = { subjectId: string; sectionId: string | null };

/**
 * The sectioned rows a save would refuse, mirroring the server's
 * `findSchedulePartitionViolations` so the setup screen can name the problem
 * before the server does: a sectioned row under a subject that also has a
 * class-wide paper, or a section appearing twice for one subject.
 */
export function schedulePartitionViolations(
  rows: readonly PartitionRow[],
): PartitionRow[] {
  const bySubject = new Map<string, PartitionRow[]>();
  for (const row of rows) {
    const group = bySubject.get(row.subjectId) ?? [];
    group.push(row);
    bySubject.set(row.subjectId, group);
  }
  const violations: PartitionRow[] = [];
  for (const [subjectId, group] of bySubject) {
    const hasClassWide = group.some((r) => r.sectionId === null);
    const seen = new Set<string>();
    for (const row of group) {
      if (row.sectionId === null) continue;
      if (hasClassWide || seen.has(row.sectionId)) {
        violations.push({ subjectId, sectionId: row.sectionId });
      }
      seen.add(row.sectionId);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The setup screen's draft rows: split, merge and the section lens
// ---------------------------------------------------------------------------

/** One part of a paper, as the parts editor saves it. */
export type PartCopy = {
  name: string;
  maxMarks: string;
  passMarks: string;
  weightagePercentage: string;
  isMandatoryPass: boolean;
  sequenceNumber: number;
};

/** One editable paper row on the setup screen. */
export type PaperDraft = {
  subjectId: string;
  /** Null = one paper for the whole class; otherwise this section only. */
  sectionId: string | null;
  examDate: string;
  startTime: string;
  durationMinutes: number;
  venue: string;
  passMarks: string | null;
  /** A row the server has not seen yet. */
  isNew: boolean;
  /**
   * Parts to copy onto this row once the save has created it — a split or a
   * merge carries the old paper's parts across, because the server deletes
   * them with the row. Null = the default part (or, for a saved row, whatever
   * the server already holds).
   */
  partsFrom: readonly PartCopy[] | null;
};

const timingOf = (row: PaperDraft) =>
  [
    row.examDate,
    row.startTime,
    row.durationMinutes,
    row.venue.trim(),
    row.passMarks ?? "",
  ].join("|");

const partsSignature = (parts: readonly PartCopy[] | null): string =>
  JSON.stringify(
    (parts ?? [{ ...DEFAULT_COMPONENT, sequenceNumber: 1 }]).map((part) => [
      part.name.trim(),
      Number(part.maxMarks),
      Number(part.passMarks),
      Number(part.weightagePercentage),
      part.isMandatoryPass,
    ]),
  );

/** Two papers a sitting apart only by their section: same timing, venue, pass marks and parts. */
export function samePaper(
  a: PaperDraft,
  b: PaperDraft,
  partsOf: (row: PaperDraft) => readonly PartCopy[] | null,
): boolean {
  return (
    timingOf(a) === timingOf(b) &&
    partsSignature(partsOf(a)) === partsSignature(partsOf(b))
  );
}

/**
 * Class-wide → per-section: the subject's class-wide row becomes one copy per
 * section, in place, each carrying the paper's parts. The user then changes
 * only what differs. A subject that is not class-wide is returned untouched.
 */
export function splitClassWide(
  rows: readonly PaperDraft[],
  subjectId: string,
  sectionIds: readonly string[],
  parts: readonly PartCopy[] | null,
): PaperDraft[] {
  const at = rows.findIndex(
    (row) => row.subjectId === subjectId && row.sectionId === null,
  );
  if (at < 0 || sectionIds.length === 0) return [...rows];
  const source = rows[at]!;
  const copies = sectionIds.map(
    (sectionId): PaperDraft => ({
      ...source,
      sectionId,
      isNew: true,
      partsFrom: parts,
    }),
  );
  return [...rows.slice(0, at), ...copies, ...rows.slice(at + 1)];
}

/**
 * Per-section → class-wide, keeping one section's settings for everyone. The
 * class-wide row takes the place of the subject's first section row.
 */
export function mergeToClassWide(
  rows: readonly PaperDraft[],
  subjectId: string,
  keepSectionId: string,
  partsOf: (row: PaperDraft) => readonly PartCopy[] | null,
): PaperDraft[] {
  const kept = rows.find(
    (row) => row.subjectId === subjectId && row.sectionId === keepSectionId,
  );
  if (!kept) return [...rows];
  const merged: PaperDraft = {
    ...kept,
    sectionId: null,
    isNew: true,
    partsFrom: partsOf(kept),
  };
  const next: PaperDraft[] = [];
  let placed = false;
  for (const row of rows) {
    if (row.subjectId !== subjectId) {
      next.push(row);
    } else if (!placed) {
      next.push(merged);
      placed = true;
    }
  }
  return next;
}

/**
 * The subject's section papers when they cover EVERY section of the class and
 * are all identical — the shape that is really one class-wide paper. Null when
 * the subject is not in that shape, so a deliberate partial ("only 6-A sits
 * it") or a genuine difference is never collapsed.
 */
export function collapsibleSubject(
  rows: readonly PaperDraft[],
  subjectId: string,
  classSectionIds: readonly string[],
  partsOf: (row: PaperDraft) => readonly PartCopy[] | null,
): string | null {
  if (classSectionIds.length < 2) return null;
  const own = rows.filter((row) => row.subjectId === subjectId);
  if (own.length !== classSectionIds.length) return null;
  if (own.some((row) => row.sectionId === null)) return null;
  const sections = new Set(own.map((row) => row.sectionId));
  if (!classSectionIds.every((id) => sections.has(id))) return null;
  const first = own[0]!;
  return own.every((row) => samePaper(first, row, partsOf))
    ? (first.sectionId as string)
    : null;
}

/** The distinct subjects of a class's rows, in the order they first appear. */
export function subjectOrder(rows: readonly PaperDraft[]): string[] {
  return [...new Set(rows.map((row) => row.subjectId))];
}

export type SectionLensState = "own" | "inherited" | "notSat";

/**
 * What one section sits for one subject: its own paper, the class-wide paper it
 * inherits, or nothing (the subject is sectioned and this section has no row).
 */
export function sectionLens(
  rows: readonly PaperDraft[],
  subjectId: string,
  sectionId: string,
): { state: SectionLensState; row: PaperDraft | null } {
  const own = rows.filter((row) => row.subjectId === subjectId);
  const classWide = own.find((row) => row.sectionId === null);
  if (classWide) return { state: "inherited", row: classWide };
  const mine = own.find((row) => row.sectionId === sectionId);
  if (mine) return { state: "own", row: mine };
  return { state: "notSat", row: null };
}

export type SubjectShape =
  | { kind: "classWide" }
  | { kind: "differs" }
  | { kind: "subset"; sectionIds: string[] };

/**
 * How the all-sections view should label a subject: one class-wide paper; a
 * subset of the class's sections; or every section with its own paper.
 */
export function subjectShape(
  own: readonly PaperDraft[],
  classSectionIds: readonly string[],
): SubjectShape {
  if (own.some((row) => row.sectionId === null)) return { kind: "classWide" };
  const ids = own.map((row) => row.sectionId as string);
  if (classSectionIds.length > 0 && ids.length < classSectionIds.length) {
    return { kind: "subset", sectionIds: ids };
  }
  return { kind: "differs" };
}

/**
 * What the "Add paper" sheet may offer for one subject, given its existing
 * rows: a class-wide paper only when the subject has none, and a section
 * only when it is untaken and no class-wide paper stands in the way. The
 * caller compares `takenSections` with the class's own section list.
 */
export function paperAddChoices(rows: readonly PartitionRow[]): {
  /** The subject has no papers yet — "All sections" is on the table. */
  canAddClassWide: boolean;
  takenSections: ReadonlySet<string>;
  /** False once a class-wide paper exists (the partition forbids mixing). */
  canAddSections: boolean;
} {
  const classWide = rows.some((r) => r.sectionId === null);
  const takenSections = new Set(
    rows.filter((r) => r.sectionId !== null).map((r) => r.sectionId as string),
  );
  return {
    canAddClassWide: rows.length === 0,
    takenSections,
    canAddSections: !classWide,
  };
}
