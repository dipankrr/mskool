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
