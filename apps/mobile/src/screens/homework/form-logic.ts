import { todayIso } from "../../lib/format";
import {
  closeForEdit,
  composeTimestamp,
  defaultDueParts,
  isAssignmentKind,
  isPositiveMarks,
  splitTimestamp,
} from "../../lib/homework";
import type {
  AssignmentKind,
  GradingMode,
  SubmissionType,
} from "../../lib/homework";
import { copy } from "../../lib/copy";
import type { HomeworkDetail } from "./types";

/**
 * The create/edit form's whole brain: one state shape, one validator, two
 * payload builders. The screen owns controls and copy; every rule about what
 * the wire will accept lives here so the create and edit paths cannot drift.
 *
 * Three facts drive the shape:
 *
 * - **Kind and grading mode are create-only.** The update contract omits them
 *   (grading mode is immutable after create, a recorded backend gap), so the
 *   edit form renders them as facts rather than pretending they are editable.
 * - **The late window is server-owned.** On create we omit `closeAt` and let
 *   the service apply the effective school/class window; `latePolicy` is only
 *   sent when the teacher explicitly overrides the school default. On edit we
 *   freeze the existing window and, when the due moment moves, send the close
 *   moment ourselves — otherwise the update path resolves the SCHOOL default
 *   without the class override and silently changes the window.
 * - **Optional text can be absent, not empty.** The service stores `""` for a
 *   cleared description, which reads as "none" everywhere, but an absent
 *   `estimatedMinutes` means "unchanged" (the contract cannot null it).
 */

export const MAX_TITLE = 250;
export const MAX_TOPIC = 250;
export const MAX_DESCRIPTION = 20_000;
export const MAX_ESTIMATE_MINUTES = 600;
export const MAX_ATTEMPTS = 10;

/** What the school's late policy is, versus an explicit per-assignment choice. */
export type LateChoice = "default" | "allowed" | "not_allowed";

export type HomeworkFormState = {
  sectionId: string | null;
  subjectId: string | null;
  kind: AssignmentKind;
  title: string;
  description: string;
  topic: string;
  estimated: string;
  dueDay: string | null;
  dueTime: string | null;
  late: LateChoice;
  allowResubmission: boolean;
  maxSubmissions: string;
  submissions: SubmissionType[];
  gradingMode: GradingMode;
  maxMarks: string;
};

export type HomeworkFormField =
  | "sectionId"
  | "subjectId"
  | "title"
  | "topic"
  | "estimated"
  | "due"
  | "maxSubmissions"
  | "submissions"
  | "maxMarks";

export type HomeworkFormErrors = Partial<Record<HomeworkFormField, string>>;

export type HomeworkFormCheck = {
  errors: HomeworkFormErrors;
  /** The composed instant, or null when the date/time pair is not real. */
  dueAt: string | null;
  estimatedMinutes: number | null;
  maxSubmissions: number | null;
  maxMarks: string | null;
  /** The chosen due moment has already passed — a warning, not an error. */
  pastDue: boolean;
  valid: boolean;
};

export function blankHomeworkForm(today = todayIso()): HomeworkFormState {
  const due = defaultDueParts(today);
  return {
    sectionId: null,
    subjectId: null,
    kind: "homework",
    title: "",
    description: "",
    topic: "",
    estimated: "",
    dueDay: due.day,
    dueTime: due.time,
    late: "default",
    allowResubmission: true,
    maxSubmissions: "",
    // The everyday Indian classroom case: work done in the notebook and
    // checked in class. Still one tap away from "Nothing is handed in".
    submissions: ["offline"],
    // Checking the notebook is the common act; marks stay deliberate.
    gradingMode: "completion",
    maxMarks: "",
  };
}

export function formFromDetail(detail: HomeworkDetail): HomeworkFormState {
  const due = splitTimestamp(detail.dueAt);
  return {
    sectionId:
      detail.targets.find((target) => target.targetType === "section")
        ?.sectionId ?? null,
    subjectId: detail.subjectId,
    kind: isAssignmentKind(detail.kind) ? detail.kind : "homework",
    title: detail.title,
    description: detail.description ?? "",
    topic: detail.topic ?? "",
    estimated:
      detail.estimatedMinutes === null ? "" : String(detail.estimatedMinutes),
    dueDay: due.day,
    dueTime: due.time,
    // An existing row always has a concrete policy; there is no "default" to
    // return to once the server has resolved it.
    late: detail.latePolicy === "not_allowed" ? "not_allowed" : "allowed",
    allowResubmission: detail.allowResubmission,
    maxSubmissions:
      detail.maxSubmissions === null ? "" : String(detail.maxSubmissions),
    submissions: detail.submissionTypes,
    gradingMode: detail.gradingMode,
    maxMarks: detail.maxMarks ?? "",
  };
}

function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * Validate one form and derive the wire values once.
 *
 * `mode` matters in only one place: an estimate cannot be cleared after
 * create, so on edit a blank field means "keep what is stored". Create treats
 * blank as absent. Everything else is shared.
 */
export function checkHomeworkForm(
  state: HomeworkFormState,
  mode: "create" | "edit",
  now = new Date(),
): HomeworkFormCheck {
  const errors: HomeworkFormErrors = {};
  const text = copy.homework.form;

  if (!state.sectionId) errors.sectionId = text.requiredSection;
  if (!state.subjectId) errors.subjectId = text.requiredSubject;

  const title = state.title.trim();
  if (title.length === 0) errors.title = text.requiredTitle;
  else if (title.length > MAX_TITLE) errors.title = text.titleTooLong;
  if (state.topic.trim().length > MAX_TOPIC) errors.topic = text.topicTooLong;

  const dueAt = composeTimestamp(state.dueDay, state.dueTime);
  if (!dueAt) errors.due = text.invalidDue;

  const estimatedRaw = state.estimated.trim();
  let estimatedMinutes: number | null = null;
  if (estimatedRaw.length > 0) {
    const value = wholeNumber(estimatedRaw);
    if (value === null || value < 1 || value > MAX_ESTIMATE_MINUTES) {
      errors.estimated = text.invalidEstimate;
    } else {
      estimatedMinutes = value;
    }
  } else if (mode === "create") {
    estimatedMinutes = null;
  }

  const attemptsRaw = state.maxSubmissions.trim();
  let maxSubmissions: number | null = null;
  if (attemptsRaw.length > 0) {
    const value = wholeNumber(attemptsRaw);
    if (value === null || value < 1 || value > MAX_ATTEMPTS) {
      errors.maxSubmissions = text.invalidAttempts;
    } else {
      maxSubmissions = value;
    }
  }

  if (state.submissions.length === 0) {
    errors.submissions = text.requiredSubmission;
  }

  let maxMarks: string | null = null;
  if (state.gradingMode === "marks") {
    const marks = state.maxMarks.trim();
    if (!isPositiveMarks(marks)) errors.maxMarks = text.invalidMarks;
    else maxMarks = marks;
  }

  const pastDue =
    dueAt !== null && new Date(dueAt).getTime() < now.getTime();

  return {
    errors,
    dueAt,
    estimatedMinutes,
    maxSubmissions,
    maxMarks,
    pastDue,
    valid: Object.keys(errors).length === 0,
  };
}

export function homeworkFormHasErrors(errors: HomeworkFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The domain half of `homework.create`; the screen adds the org ids. */
export type HomeworkCreatePayload = {
  academicYearId: string;
  sectionId: string;
  subjectId: string;
  kind: AssignmentKind;
  title: string;
  description?: string;
  topic?: string;
  estimatedMinutes?: number;
  submissionTypes: SubmissionType[];
  gradingMode: GradingMode;
  maxMarks?: string;
  dueAt: string;
  latePolicy?: "allowed" | "not_allowed";
  allowResubmission: boolean;
  maxSubmissions?: number;
};

export function createPayload(
  state: HomeworkFormState,
  check: HomeworkFormCheck,
  academicYearId: string,
): HomeworkCreatePayload | null {
  if (!check.valid || !check.dueAt || !state.sectionId || !state.subjectId) {
    return null;
  }
  const description = state.description.trim();
  const topic = state.topic.trim();
  return {
    academicYearId,
    sectionId: state.sectionId,
    subjectId: state.subjectId,
    kind: state.kind,
    title: state.title.trim(),
    ...(description.length > 0 ? { description } : {}),
    ...(topic.length > 0 ? { topic } : {}),
    ...(check.estimatedMinutes !== null
      ? { estimatedMinutes: check.estimatedMinutes }
      : {}),
    submissionTypes: state.submissions,
    gradingMode: state.gradingMode,
    ...(check.maxMarks !== null ? { maxMarks: check.maxMarks } : {}),
    dueAt: check.dueAt,
    // "default" sends nothing: the service resolves the school/class setting,
    // including the late window that belongs with it.
    ...(state.late !== "default" ? { latePolicy: state.late } : {}),
    allowResubmission: state.allowResubmission,
    ...(state.allowResubmission && check.maxSubmissions !== null
      ? { maxSubmissions: check.maxSubmissions }
      : {}),
  };
}

/** The domain half of `homework.update`; unchanged fields are omitted. */
export type HomeworkUpdatePayload = {
  id: string;
  sectionId: string;
  subjectId: string;
  title?: string;
  description?: string;
  topic?: string;
  estimatedMinutes?: number;
  dueAt?: string;
  closeAt?: string;
  allowResubmission?: boolean;
  maxSubmissions?: number | null;
  submissionTypes?: SubmissionType[];
};

export function updatePayload(
  state: HomeworkFormState,
  check: HomeworkFormCheck,
  detail: HomeworkDetail,
): HomeworkUpdatePayload | null {
  if (
    !check.valid ||
    !check.dueAt ||
    !state.sectionId ||
    !state.subjectId
  ) {
    return null;
  }
  const payload: HomeworkUpdatePayload = {
    id: detail.id,
    sectionId: state.sectionId,
    subjectId: state.subjectId,
  };

  const title = state.title.trim();
  if (title !== detail.title) payload.title = title;

  const description = state.description.trim();
  if (description !== (detail.description ?? "")) payload.description = description;

  const topic = state.topic.trim();
  if (topic !== (detail.topic ?? "")) payload.topic = topic;

  if (
    check.estimatedMinutes !== null &&
    check.estimatedMinutes !== detail.estimatedMinutes
  ) {
    payload.estimatedMinutes = check.estimatedMinutes;
  }

  if (state.allowResubmission !== detail.allowResubmission) {
    payload.allowResubmission = state.allowResubmission;
  }

  if (check.maxSubmissions !== detail.maxSubmissions) {
    payload.maxSubmissions = check.maxSubmissions;
  }

  if (!sameSubmissions(state.submissions, detail.submissionTypes)) {
    payload.submissionTypes = state.submissions;
  }

  const existingDue = instantOf(detail.dueAt);
  const nextDue = instantOf(check.dueAt);
  if (existingDue === null || nextDue === null || existingDue !== nextDue) {
    payload.dueAt = check.dueAt;
    // Preserve the window the row already has. For `not_allowed` the window
    // is zero, so this still lands exactly on the new due moment.
    payload.closeAt = closeForEdit(check.dueAt, detail.dueAt, detail.closeAt);
  }

  return payload;
}

/** Only the id pair and gate pair left — nothing the user changed. */
export function updatePayloadIsEmpty(payload: HomeworkUpdatePayload): boolean {
  return Object.keys(payload).every((key) =>
    key === "id" || key === "sectionId" || key === "subjectId",
  );
}

function instantOf(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function sameSubmissions(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

/** Does this form differ from the state it opened with? */
export function isHomeworkFormDirty(
  state: HomeworkFormState,
  initial: HomeworkFormState,
): boolean {
  return (
    state.sectionId !== initial.sectionId ||
    state.subjectId !== initial.subjectId ||
    state.kind !== initial.kind ||
    state.title !== initial.title ||
    state.description !== initial.description ||
    state.topic !== initial.topic ||
    state.estimated !== initial.estimated ||
    state.dueDay !== initial.dueDay ||
    state.dueTime !== initial.dueTime ||
    state.late !== initial.late ||
    state.allowResubmission !== initial.allowResubmission ||
    state.maxSubmissions !== initial.maxSubmissions ||
    !sameSubmissions(state.submissions, initial.submissions) ||
    state.gradingMode !== initial.gradingMode ||
    state.maxMarks !== initial.maxMarks
  );
}
