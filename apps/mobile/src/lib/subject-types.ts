import { copy } from "./copy";

/**
 * SUBJECT TYPES (chunk 7F) — what each kind of subject is for.
 *
 * Three flags decide the report card: how the subject is entered
 * (`assessmentMode`), whether it shows marks or a grade (`isGradedOnly`), and
 * whether it touches totals and pass/fail (`countsTowardResult`). They lock
 * the first time any assessment data exists against the type; name and card
 * order remain editable forever.
 *
 * The sheet explains the combination in one sentence rather than three
 * switches, and the term-grade contradiction is a caution, not a block: the
 * server accepts `term_grade` + `countsTowardResult` today (gap 45).
 */

export type SubjectMode = "exam" | "term_grade";

export type SubjectTypeDraft = {
  name: string;
  assessmentMode: SubjectMode;
  countsTowardResult: boolean;
  isGradedOnly: boolean;
  /** A form string while editing; the save needs a whole number 0–999. */
  sequence: string;
};

export type SubjectTypeLike = {
  name: string;
  assessmentMode: string;
  countsTowardResult: boolean;
  isGradedOnly: boolean;
  sequence: number;
  hasAssessmentData: boolean;
};

/**
 * What a class subject's type picker starts on (ADR-055): the school's default,
 * else the only type there is, else nothing, so the person has to choose.
 */
export function startingSubjectTypeId(
  types: readonly { id: string; isDefault: boolean }[],
): string | null {
  const preferred = types.find((type) => type.isDefault);
  if (preferred) return preferred.id;
  return types.length === 1 ? (types[0]?.id ?? null) : null;
}

export function subjectTypeDraft(row: SubjectTypeLike | null): SubjectTypeDraft {
  return {
    name: row?.name ?? "",
    assessmentMode:
      row?.assessmentMode === "term_grade" ? "term_grade" : "exam",
    countsTowardResult: row?.countsTowardResult ?? true,
    isGradedOnly: row?.isGradedOnly ?? false,
    sequence: row ? String(row.sequence) : "0",
  };
}

/** "Exam papers · Marks · Counted in the result" — the row's one line. */
export function flagSentence(flags: {
  assessmentMode: string;
  isGradedOnly: boolean;
  countsTowardResult: boolean;
}): string {
  const words = copy.exams.grading.types.flags;
  return [
    flags.assessmentMode === "term_grade" ? words.termGrade : words.exam,
    flags.isGradedOnly ? words.grade : words.marks,
    flags.countsTowardResult ? words.counted : words.notCounted,
  ].join(" · ");
}

/** The sheet's live "In short" line, in plain school words. */
export function subjectTypeSummary(draft: SubjectTypeDraft): string {
  const words = copy.exams.grading.types.summaryParts;
  return copy.exams.grading.types.summary(
    draft.name,
    draft.assessmentMode === "term_grade" ? words.termGrade : words.exam,
    draft.isGradedOnly ? words.grade : words.marks,
    draft.countsTowardResult ? words.counted : words.notCounted,
  );
}

/** Term grades have no marks — counting them is a no-op worth naming. */
export function termGradeCaution(draft: SubjectTypeDraft): string | null {
  return draft.assessmentMode === "term_grade" && draft.countsTowardResult
    ? copy.exams.grading.types.termCountsCaution
    : null;
}

export type SubjectTypeErrors = {
  name?: string;
  sequence?: string;
};

export function checkSubjectType(
  draft: SubjectTypeDraft,
): SubjectTypeErrors {
  const errors: SubjectTypeErrors = {};
  if (draft.name.trim().length === 0) {
    errors.name = copy.exams.grading.types.nameRequired;
  }
  if (parseSequence(draft.sequence) === null) {
    errors.sequence = copy.exams.grading.types.sequenceError;
  }
  return errors;
}

export function hasSubjectTypeErrors(errors: SubjectTypeErrors): boolean {
  return Boolean(errors.name || errors.sequence);
}

function parseSequence(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const parsed = Number(text);
  return parsed <= 999 ? parsed : null;
}

/** A create may send only a name, but the sheet sends the full truth. */
export function subjectTypeCreatePayload(draft: SubjectTypeDraft) {
  return {
    name: draft.name.trim(),
    assessmentMode: draft.assessmentMode,
    countsTowardResult: draft.countsTowardResult,
    isGradedOnly: draft.isGradedOnly,
    sequence: parseSequence(draft.sequence) ?? 0,
  };
}

/**
 * Only changed fields. A locked type never sends a behaviour flag — the
 * service refuses the whole save the moment one appears, even unchanged.
 */
export function subjectTypeUpdatePayload(
  draft: SubjectTypeDraft,
  row: SubjectTypeLike,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const name = draft.name.trim();
  if (name !== row.name) data.name = name;
  const sequence = parseSequence(draft.sequence);
  if (sequence !== null && sequence !== row.sequence) data.sequence = sequence;

  if (!row.hasAssessmentData) {
    if (draft.assessmentMode !== row.assessmentMode) {
      data.assessmentMode = draft.assessmentMode;
    }
    if (draft.countsTowardResult !== row.countsTowardResult) {
      data.countsTowardResult = draft.countsTowardResult;
    }
    if (draft.isGradedOnly !== row.isGradedOnly) {
      data.isGradedOnly = draft.isGradedOnly;
    }
  }
  return data;
}

export function subjectTypeDirty(
  draft: SubjectTypeDraft,
  row: SubjectTypeLike,
): boolean {
  return Object.keys(subjectTypeUpdatePayload(draft, row)).length > 0;
}
