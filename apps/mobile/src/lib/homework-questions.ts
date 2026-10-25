import { copy } from "./copy";

/**
 * The question-set brain: what a draft may contain, how it becomes the
 * snapshot the server stores, and how an attempt's JSON answer reads back to a
 * teacher.
 *
 * Three server facts shape everything here, read from
 * `homework-questions.service.ts` and the contracts rather than guessed:
 *
 * - `questions.set` REPLACES the whole set. A draft list is therefore the
 *   unit of save, and positions are re-derived from the list order.
 * - Option correctness is snapshot-only: MCQ/true-false/numeric/fill-blank are
 *   auto-graded from `options` and `correctAnswer`; short/long answers are
 *   always manual. There is no answer-key read model beyond this snapshot.
 * - The service refuses a closed/cancelled or locked assignment, so the
 *   screen must present the set read-only rather than offer a save it knows
 *   will fail.
 *
 * The authorable types exclude `match` and `file_upload`: the app has no pair
 * editor, and the file channel is image-only with no homework upload endpoint.
 * A bank item of either type can still be attached (it carries its key), and
 * is shown — never silently dropped.
 */

export const ALL_QUESTION_TYPES = [
  "mcq_single",
  "mcq_multi",
  "true_false",
  "fill_blank",
  "numeric",
  "match",
  "short_answer",
  "long_answer",
  "file_upload",
] as const;
export type QuestionType = (typeof ALL_QUESTION_TYPES)[number];

/** The types this build can author and validate. */
export const AUTHORABLE_QUESTION_TYPES = [
  "mcq_single",
  "mcq_multi",
  "true_false",
  "fill_blank",
  "numeric",
  "short_answer",
  "long_answer",
] as const;
export type AuthorableQuestionType =
  (typeof AUTHORABLE_QUESTION_TYPES)[number];

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
export const MAX_BODY = 10_000;
export const MAX_OPTION_TEXT = 2_000;
export const MAX_EXPLANATION = 5_000;
export const MAX_ACCEPTED = 20;

/** The contract's decimal shape: up to 5 integer digits, 2 decimals, >= 0. */
const MARKS_PATTERN = /^\d{1,5}(\.\d{1,2})?$/;

export function isQuestionType(value: string): value is QuestionType {
  return (ALL_QUESTION_TYPES as readonly string[]).includes(value);
}

export function isAuthorableQuestionType(
  value: string,
): value is AuthorableQuestionType {
  return (AUTHORABLE_QUESTION_TYPES as readonly string[]).includes(value);
}

export function isOptionType(value: string): boolean {
  return value === "mcq_single" || value === "mcq_multi";
}

/** A type with a stored key the server can mark without a teacher. */
export function hasAutomaticKey(value: string): boolean {
  return (
    isOptionType(value) ||
    value === "true_false" ||
    value === "numeric" ||
    value === "fill_blank" ||
    value === "match"
  );
}

/** `8.00` → `8`, `8.50` → `8.5`; non-numeric text is returned trimmed. */
export function trimDecimal(value: string): string {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed.length === 0 || !Number.isFinite(parsed)) return trimmed;
  return String(Math.round(parsed * 100) / 100);
}

export function isValidQuestionMarks(value: string): boolean {
  const trimmed = value.trim();
  return MARKS_PATTERN.test(trimmed) && Number(trimmed) > 0;
}

/**
 * An answer's marks may be zero and may not exceed its question's maximum. The
 * server enforces the cap too; the sheet must not offer a save it knows the
 * server will refuse.
 */
export function isValidAnswerMarks(
  value: string,
  max: number | null,
): boolean {
  const trimmed = value.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(trimmed)) return false;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return false;
  return max === null || parsed <= max;
}

export type QuestionOptionDraft = {
  /** Stable list identity; never sent to the server. */
  key: string;
  text: string;
  isCorrect: boolean;
};

export type QuestionDraft = {
  questionType: AuthorableQuestionType;
  body: string;
  marks: string;
  explanation: string;
  options: QuestionOptionDraft[];
  trueFalse: "" | "true" | "false";
  numericValue: string;
  numericTolerance: string;
  acceptedAnswers: string;
  caseSensitive: boolean;
};

let optionSequence = 0;

export function newOptionKey(): string {
  optionSequence += 1;
  return `opt-${optionSequence}`;
}

export function emptyQuestionDraft(
  questionType: AuthorableQuestionType = "mcq_single",
): QuestionDraft {
  return {
    questionType,
    body: "",
    marks: "1",
    explanation: "",
    options: isOptionType(questionType)
      ? [
          { key: newOptionKey(), text: "", isCorrect: true },
          { key: newOptionKey(), text: "", isCorrect: false },
        ]
      : [],
    trueFalse: "",
    numericValue: "",
    numericTolerance: "",
    acceptedAnswers: "",
    caseSensitive: false,
  };
}

/**
 * Switching type keeps the fields the types share and every answer field the
 * teacher already typed, so a mis-tap does not throw work away. Only the
 * fields the new type reads are validated and sent.
 */
export function switchQuestionType(
  draft: QuestionDraft,
  next: AuthorableQuestionType,
): QuestionDraft {
  if (next === draft.questionType) return draft;
  let options = draft.options;
  if (isOptionType(next)) {
    if (options.length < MIN_OPTIONS) {
      options = [
        { key: newOptionKey(), text: "", isCorrect: true },
        { key: newOptionKey(), text: "", isCorrect: false },
      ];
    } else if (next === "mcq_single") {
      const firstCorrect = options.findIndex((option) => option.isCorrect);
      const keep = firstCorrect >= 0 ? firstCorrect : 0;
      options = options.map((option, index) => ({
        ...option,
        isCorrect: index === keep,
      }));
    }
  }
  return { ...draft, questionType: next, options };
}

export type QuestionDraftErrorKey =
  | "body"
  | "marks"
  | "options"
  | "trueFalse"
  | "numericValue"
  | "numericTolerance"
  | "acceptedAnswers"
  | "explanation";

export type QuestionDraftErrors = Partial<Record<QuestionDraftErrorKey, string>>;

export type QuestionDraftCheck = {
  errors: QuestionDraftErrors;
  valid: boolean;
};

/** Splits the accepted-answer textarea on newlines, dropping blanks. */
export function parseAcceptedAnswers(value: string): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    rows.push(trimmed);
  }
  return rows;
}

const OPTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function optionLetter(index: number): string {
  return OPTION_LETTERS[index] ?? `#${index + 1}`;
}

/**
 * Validate one draft. Messages come from `copy` so the sheet and the bank form
 * say the same thing; the shape mirrors the grade form's check.
 */
export function checkQuestionDraft(draft: QuestionDraft): QuestionDraftCheck {
  const text = copy.homework.questions;
  const errors: QuestionDraftErrors = {};

  const body = draft.body.trim();
  if (body.length === 0) errors.body = text.bodyRequired;
  else if (body.length > MAX_BODY) errors.body = text.bodyTooLong;

  if (!isValidQuestionMarks(draft.marks)) errors.marks = text.marksInvalid;

  if (draft.explanation.trim().length > MAX_EXPLANATION) {
    errors.explanation = text.explanationTooLong;
  }

  if (isOptionType(draft.questionType)) {
    const filled = draft.options.map((option) => option.text.trim());
    if (filled.length < MIN_OPTIONS) {
      errors.options = text.optionsTooFew;
    } else if (filled.length > MAX_OPTIONS) {
      errors.options = text.optionLimit;
    } else if (filled.some((option) => option.length === 0)) {
      errors.options = text.optionEmpty;
    } else if (filled.some((option) => option.length > MAX_OPTION_TEXT)) {
      errors.options = text.optionTooLong;
    } else {
      const seen = new Set<string>();
      for (const option of filled) {
        const key = option.toLocaleLowerCase();
        if (seen.has(key)) {
          errors.options = text.optionDuplicate;
          break;
        }
        seen.add(key);
      }
    }

    const correct = draft.options.filter((option) => option.isCorrect).length;
    if (!errors.options) {
      if (correct === 0) errors.options = text.correctMissing;
      else if (draft.questionType === "mcq_single" && correct > 1) {
        errors.options = text.correctMultiple;
      }
    }
  }

  if (draft.questionType === "true_false" && draft.trueFalse === "") {
    errors.trueFalse = text.trueFalseRequired;
  }

  if (draft.questionType === "numeric") {
    const value = draft.numericValue.trim();
    if (value.length === 0) errors.numericValue = text.numericValueRequired;
    else if (!/^-?\d+(\.\d+)?$/.test(value)) {
      errors.numericValue = text.numericValueInvalid;
    }
    const tolerance = draft.numericTolerance.trim();
    if (tolerance.length > 0) {
      if (!/^\d+(\.\d+)?$/.test(tolerance) || Number(tolerance) < 0) {
        errors.numericTolerance = text.numericToleranceInvalid;
      }
    }
  }

  if (draft.questionType === "fill_blank") {
    const accepted = parseAcceptedAnswers(draft.acceptedAnswers);
    if (accepted.length === 0) errors.acceptedAnswers = text.acceptedRequired;
    else if (accepted.length > MAX_ACCEPTED) {
      errors.acceptedAnswers = text.acceptedLimit;
    }
  }

  return { errors, valid: Object.keys(errors).length === 0 };
}

export type SnapshotOptionInput = {
  optionText: string;
  isCorrect: boolean;
  sortOrder: number;
};

export type SnapshotQuestionInput = {
  sourceQuestionId?: string;
  position: number;
  questionType: QuestionType;
  body: string;
  options?: SnapshotOptionInput[];
  correctAnswer?: unknown;
  explanation?: string;
  marks: string;
};

/**
 * Draft → wire. Callers validate first (the sheet marks fields before it
 * enables save); this function still normalises, because the server's zod
 * rejects whitespace and a trailing `.00`.
 */
export function toSnapshotQuestion(
  draft: QuestionDraft,
  position: number,
  sourceQuestionId?: string,
): SnapshotQuestionInput {
  const type = draft.questionType;
  const body = draft.body.trim();
  const explanation = draft.explanation.trim();
  const marks = trimDecimal(draft.marks) || "1";

  const base: SnapshotQuestionInput = {
    position,
    questionType: type,
    body,
    marks,
    ...(sourceQuestionId ? { sourceQuestionId } : {}),
    ...(explanation.length > 0 ? { explanation } : {}),
  };

  if (isOptionType(type)) {
    return {
      ...base,
      options: draft.options.map((option, index) => ({
        optionText: option.text.trim(),
        isCorrect: option.isCorrect,
        sortOrder: index,
      })),
    };
  }

  if (type === "true_false") {
    return {
      ...base,
      correctAnswer: { value: draft.trueFalse === "true" },
    };
  }

  if (type === "numeric") {
    return {
      ...base,
      correctAnswer: {
        value: Number(draft.numericValue.trim()),
        tolerance: Number(draft.numericTolerance.trim() || "0"),
      },
    };
  }

  if (type === "fill_blank") {
    return {
      ...base,
      correctAnswer: {
        accepted: parseAcceptedAnswers(draft.acceptedAnswers),
        case_sensitive: draft.caseSensitive,
      },
    };
  }

  return base;
}

/** The stored/served shape this module can rebuild a draft from. */
export type SnapshotSource = {
  questionType: string;
  body: string;
  marks: string;
  explanation: string | null;
  options:
    | { id: number; text: string; isCorrect: boolean }[]
    | null;
  correctAnswer: unknown;
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Snapshot → draft, for the edit sheet. Returns null for a type this build
 * cannot author (match / file upload): those rows stay visible, carry their
 * key from the bank, and can be removed or reordered, but not rewritten by a
 * form that has no fields for them.
 */
export function draftFromSnapshot(
  source: SnapshotSource,
): QuestionDraft | null {
  if (!isAuthorableQuestionType(source.questionType)) return null;
  const correct = recordOf(source.correctAnswer);
  const draft = emptyQuestionDraft(source.questionType);
  draft.body = source.body;
  draft.marks = trimDecimal(source.marks) || "1";
  draft.explanation = source.explanation ?? "";

  if (isOptionType(source.questionType)) {
    const options = (source.options ?? []).map((option) => ({
      key: newOptionKey(),
      text: option.text,
      isCorrect: option.isCorrect,
    }));
    draft.options = options.length >= MIN_OPTIONS ? options : draft.options;
  }

  if (source.questionType === "true_false") {
    const value = correct?.value;
    draft.trueFalse =
      value === true ? "true" : value === false ? "false" : "";
  }

  if (source.questionType === "numeric") {
    const value = correct?.value;
    const tolerance = correct?.tolerance;
    draft.numericValue =
      typeof value === "number" || typeof value === "string"
        ? String(value)
        : "";
    draft.numericTolerance =
      typeof tolerance === "number" && tolerance > 0 ? String(tolerance) : "";
  }

  if (source.questionType === "fill_blank") {
    const accepted = correct?.accepted;
    draft.acceptedAnswers = Array.isArray(accepted)
      ? accepted.map(String).join("\n")
      : "";
    draft.caseSensitive = correct?.case_sensitive === true;
  }

  return draft;
}

/** A bank row as the picker's output carries it. */
export type BankSnapshotSource = {
  id: string;
  questionType: string;
  body: string;
  correctAnswer: unknown;
  explanation: string | null;
  defaultMarks: string;
  options: {
    optionText: string;
    isCorrect: boolean;
    sortOrder: number;
  }[];
};

/**
 * Attach a bank question: copy it into the assignment's snapshot. The bank
 * row's own option order is kept; the source id records provenance only.
 */
export function snapshotFromBankItem(
  item: BankSnapshotSource,
  position: number,
): SnapshotQuestionInput {
  const type = isQuestionType(item.questionType)
    ? item.questionType
    : "short_answer";
  const explanation = item.explanation?.trim() ?? "";
  const options = [...item.options]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((option, index) => ({
      optionText: option.optionText,
      isCorrect: option.isCorrect,
      sortOrder: index,
    }));

  return {
    sourceQuestionId: item.id,
    position,
    questionType: type,
    body: item.body,
    marks: trimDecimal(item.defaultMarks) || "1",
    ...(explanation.length > 0 ? { explanation } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(item.correctAnswer !== null && item.correctAnswer !== undefined
      ? { correctAnswer: item.correctAnswer }
      : {}),
  };
}

/** Move one list row by `delta`, clamped — a disabled control never moves. */
export function moveItem<T>(
  items: readonly T[],
  index: number,
  delta: number,
): T[] {
  const next = [...items];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) {
    return next;
  }
  const moving = next[index] as T;
  next[index] = next[target] as T;
  next[target] = moving;
  return next;
}

/** Decimal sum of marks, in cents, so 0.1 + 0.2 is 0.3. */
export function totalQuestionMarks(values: readonly string[]): string {
  const cents = values.reduce((sum, value) => {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? sum + Math.round(parsed * 100) : sum;
  }, 0);
  return String(Math.round(cents) / 100);
}

export type AnswerOption = { id: number; text: string };

function emptyAnswer(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * One attempt answer in the teacher's language. The attempt read model does
 * not carry option text or marks, so the caller passes the snapshot's options;
 * an id with no option row still reads as "Option 3" rather than vanishing.
 */
export function answerSummary(
  questionType: string,
  answer: unknown,
  options: readonly AnswerOption[] | null,
): string | null {
  if (emptyAnswer(answer)) return null;
  const record = recordOf(answer);

  if (isOptionType(questionType)) {
    const rawIds = record?.option_ids;
    if (!Array.isArray(rawIds)) return typeof answer === "string" ? answer : null;
    const ids = rawIds
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    if (ids.length === 0) return null;
    return ids
      .map((id) => {
        const option = options?.find((row) => row.id === id);
        const label = option?.text?.trim();
        return label
          ? `${optionLetter(id - 1)}. ${label}`
          : copy.homework.questions.optionFallback(id);
      })
      .join(" · ");
  }

  if (questionType === "true_false") {
    const value = record?.value ?? answer;
    if (value === true || value === "true") return copy.homework.questions.true;
    if (value === false || value === "false") return copy.homework.questions.false;
    return null;
  }

  if (questionType === "match") {
    const pairs = record?.pairs;
    if (!Array.isArray(pairs)) return null;
    const rows = pairs
      .map((pair) =>
        Array.isArray(pair) && pair.length === 2
          ? `${String(pair[0])} → ${String(pair[1])}`
          : null,
      )
      .filter((row): row is string => row !== null);
    return rows.length > 0 ? rows.join(" · ") : null;
  }

  if (typeof answer === "string" || typeof answer === "number") {
    const raw = String(answer).trim();
    return raw.length > 0 ? raw : null;
  }

  const text = record?.text;
  if (typeof text === "string" || typeof text === "number") {
    const raw = String(text).trim();
    return raw.length > 0 ? raw : null;
  }

  const value = record?.value;
  if (typeof value === "string" || typeof value === "number") {
    const raw = String(value).trim();
    return raw.length > 0 ? raw : null;
  }

  return null;
}

/**
 * The snapshot's key, for the teacher-only list. `null` means the type is
 * manual — the screen says so instead of showing a blank line.
 */
export function answerKeySummary(source: {
  questionType: string;
  options?: readonly { id: number; text: string; isCorrect: boolean }[] | null;
  correctAnswer?: unknown;
}): string | null {
  if (isOptionType(source.questionType)) {
    const correct = (source.options ?? [])
      .filter((option) => option.isCorrect)
      .sort((a, b) => a.id - b.id);
    if (correct.length === 0) return null;
    return correct
      .map((option) => {
        const text = option.text.trim();
        return text
          ? `${optionLetter(option.id - 1)}. ${text}`
          : optionLetter(option.id - 1);
      })
      .join(" · ");
  }
  if (source.questionType === "fill_blank") {
    const accepted = recordOf(source.correctAnswer)?.accepted;
    if (!Array.isArray(accepted) || accepted.length === 0) return null;
    return accepted.map(String).join(", ");
  }
  return answerSummary(source.questionType, source.correctAnswer, null);
}
