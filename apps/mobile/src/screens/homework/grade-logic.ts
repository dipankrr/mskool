import { copy } from "../../lib/copy";
import {
  composeTimestamp,
  isValidMarks,
  preserveLateWindow,
} from "../../lib/homework";

/**
 * The grading screens' whole brain: what a save may contain, what the server
 * will refuse, and how a per-student deadline keeps the late window it
 * already had.
 *
 * Three server facts shape it, all read from `homework.service.ts` rather
 * than guessed:
 *
 * - `evaluate` only accepts `reviewed` / `resubmit_requested`. A `marks`
 *   assignment refuses `reviewed` without an online submission, and a
 *   `grade` assignment refuses it too; completion and none do not.
 * - `evaluate` nulls the marks on a resubmit, so that path sends feedback
 *   only — the note the student needs is the whole instruction.
 * - `extend` stores the pair it is given. The service does not re-derive the
 *   grace window, so the client moves the due moment and keeps the window
 *   that was already there (`preserveLateWindow`).
 *
 * Grades and rubric scores are deliberately absent: the contracts accept them
 * but the app has no read model for rubric criteria or valid grade letters.
 * The screens state that limitation instead of offering a field that would
 * fail on save.
 */

export const MAX_FEEDBACK = 5_000;
export const MIN_RESUBMIT_NOTE = 3;
export const MAX_RESUBMIT_NOTE = 5_000;
export const MIN_EXCUSE_REASON = 3;
export const MAX_EXCUSE_REASON = 500;
export const MAX_EXTENSION_REASON = 500;

export type GradeErrors = {
  marks?: string;
  feedback?: string;
};

export type GradeCheck = {
  errors: GradeErrors;
  /** The decimal string the wire takes, or null when the mode has no score. */
  marks: string | null;
  feedback: string | null;
  valid: boolean;
  /** `reviewed` is refused until an online submission exists. */
  reviewBlocked: boolean;
  /** The mode cannot be saved from the app at all (rubric). */
  readOnly: boolean;
};

/**
 * Validate one review. `mode` stays a string on purpose: a row authored by a
 * newer server build must not crash this screen, it just hides the form.
 */
export function checkGradeDraft({
  mode,
  marks,
  feedback,
  maxMarks,
  hasSubmission,
}: {
  mode: string;
  marks: string;
  feedback: string;
  /** The assignment's decimal-string ceiling, if it has one. */
  maxMarks: string | null | undefined;
  hasSubmission: boolean;
}): GradeCheck {
  const text = copy.homework.grade;
  const errors: GradeErrors = {};
  const ceiling =
    maxMarks === null || maxMarks === undefined || maxMarks.trim() === ""
      ? null
      : Number(maxMarks);

  let nextMarks: string | null = null;
  if (mode === "marks") {
    const raw = marks.trim();
    if (raw.length === 0) {
      errors.marks = text.marksRequired;
    } else if (!isValidMarks(raw, null)) {
      errors.marks = text.marksShape;
    } else if (ceiling !== null && Number(raw) > ceiling) {
      errors.marks = text.marksTooHigh(String(ceiling));
    } else {
      nextMarks = raw;
    }
  }

  const nextFeedback = feedback.trim();
  if (nextFeedback.length > MAX_FEEDBACK) {
    errors.feedback = text.feedbackTooLong;
  }

  const readOnly = mode === "rubric";
  const reviewBlocked =
    !hasSubmission && (mode === "marks" || mode === "grade");

  return {
    errors,
    marks: nextMarks,
    feedback: nextFeedback.length > 0 ? nextFeedback : null,
    valid:
      Object.keys(errors).length === 0 && !reviewBlocked && !readOnly,
    reviewBlocked,
    readOnly,
  };
}

export type TextCheck = {
  /** The trimmed value to send, or null when it is not acceptable. */
  value: string | null;
  error: string | null;
};

/** A resubmit note: short, specific, and shown to the family. */
export function checkResubmitNote(note: string): TextCheck {
  const text = copy.homework.grade;
  const value = note.trim();
  if (value.length < MIN_RESUBMIT_NOTE) {
    return { value: null, error: text.resubmitNote };
  }
  if (value.length > MAX_RESUBMIT_NOTE) {
    return { value: null, error: text.resubmitTooLong };
  }
  return { value, error: null };
}

/** An excuse reason: required, short, kept on the student's record. */
export function checkExcuseReason(reason: string): TextCheck {
  const text = copy.homework.grade;
  const value = reason.trim();
  if (value.length < MIN_EXCUSE_REASON) {
    return { value: null, error: text.excuseRequired };
  }
  if (value.length > MAX_EXCUSE_REASON) {
    return { value: null, error: text.excuseTooLong };
  }
  return { value, error: null };
}

export type ExtensionCheck = {
  error: string | null;
  /** The ISO instants the mutation sends, or null while the pair is invalid. */
  dueAt: string | null;
  closeAt: string | null;
  reason: string | null;
  valid: boolean;
};

/**
 * A per-student extension. The new due moment must be in the future AND after
 * the row's current deadline — an "extension" that shortens a deadline is a
 * different act and the app has no undo for it. The close moment preserves
 * the window this row already had, so editing a deadline never quietly
 * invents or removes late-acceptance time.
 */
export function checkExtension({
  day,
  time,
  reason,
  currentDueAt,
  currentCloseAt,
  now = new Date(),
}: {
  day: string | null;
  time: string | null;
  reason: string;
  currentDueAt: string | Date;
  currentCloseAt: string | Date;
  now?: Date;
}): ExtensionCheck {
  const text = copy.homework.grade;
  const dueAt = composeTimestamp(day, time);
  if (!dueAt) {
    return { error: text.extendRequired, dueAt: null, closeAt: null, reason: null, valid: false };
  }

  const nextDue = new Date(dueAt);
  const currentDue = new Date(currentDueAt);
  if (Number.isNaN(nextDue.getTime()) || Number.isNaN(currentDue.getTime())) {
    return { error: text.extendRequired, dueAt: null, closeAt: null, reason: null, valid: false };
  }
  if (nextDue.getTime() <= now.getTime() || nextDue.getTime() <= currentDue.getTime()) {
    return { error: text.extendFuture, dueAt: null, closeAt: null, reason: null, valid: false };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length > MAX_EXTENSION_REASON) {
    return { error: text.extendReasonTooLong, dueAt: null, closeAt: null, reason: null, valid: false };
  }

  return {
    error: null,
    dueAt,
    closeAt: preserveLateWindow(dueAt, currentDueAt, currentCloseAt),
    reason: trimmedReason.length > 0 ? trimmedReason : null,
    valid: true,
  };
}
