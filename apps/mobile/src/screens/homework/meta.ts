/**
 * The homework domain's presentation vocabulary: which word, which glyph,
 * which tone. Kept out of `lib/homework.ts` so the date/label helpers stay
 * free of theme and icon imports, and out of the screens so the agenda card,
 * detail hero and grading grid cannot disagree about what "closed" looks like.
 *
 * Colour is information here (the app's one rule): emerald only where work is
 * genuinely live or reviewed, amber where a deadline needs attention, red only
 * for a cancellation or a missed cutoff, slate for everything that is simply
 * done or not started.
 */

import type { AppIconName } from "../../components/app-icon";
import { copy } from "../../lib/copy";
import { isAssignmentKind, isAssignmentStatus } from "../../lib/homework";
import type {
  AssignmentKind,
  AssignmentStatus,
  GradingMode,
  SubmissionType,
} from "../../lib/homework";
import type { Tone } from "../../theme/brand-admin";

export const statusTone: Record<AssignmentStatus, Tone> = {
  draft: "neutral",
  scheduled: "caution",
  published: "positive",
  closed: "neutral",
  cancelled: "critical",
};

export function statusLabel(value: string): string {
  return isAssignmentStatus(value)
    ? copy.homework.statuses[value]
    : value.charAt(0).toUpperCase() + value.slice(1);
}

/** Only the exceptional states earn a capsule on a card; published is the norm. */
export function statusNeedsPill(value: string): boolean {
  return value === "draft" || value === "scheduled" || value === "closed" || value === "cancelled";
}

export const kindIcon: Record<AssignmentKind, AppIconName> = {
  homework: "homework",
  classwork: "classwork",
  project: "project",
  worksheet: "worksheet",
  reading: "reading",
  practice: "practice",
  quiz: "quiz",
};

export function kindLabel(value: string): string {
  return isAssignmentKind(value)
    ? copy.homework.kinds[value]
    : value.charAt(0).toUpperCase() + value.slice(1);
}

export function kindGlyph(value: string): AppIconName {
  return isAssignmentKind(value) ? kindIcon[value] : "homework";
}

export function gradingLabel(value: string): string {
  return value in copy.homework.grading
    ? copy.homework.grading[value as GradingMode]
    : value;
}

export function submissionLabel(value: string): string {
  return value in copy.homework.submissions
    ? copy.homework.submissions[value as SubmissionType]
    : value;
}

/** One line under the submission chips, in the teacher's language. */
export function submissionHelp(value: string): string | null {
  return value in copy.homework.submissionHelp
    ? copy.homework.submissionHelp[value as SubmissionType]
    : null;
}

export type StudentWorkStatus =
  | "assigned"
  | "in_progress"
  | "submitted"
  | "resubmit_requested"
  | "reviewed"
  | "excused"
  | "missing";

export const studentStatusTone: Record<StudentWorkStatus, Tone> = {
  assigned: "neutral",
  in_progress: "neutral",
  submitted: "caution",
  resubmit_requested: "caution",
  reviewed: "positive",
  excused: "neutral",
  missing: "critical",
};

export const studentStatusLabel: Record<StudentWorkStatus, string> = {
  assigned: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  resubmit_requested: "Resubmit asked",
  reviewed: "Reviewed",
  excused: "Excused",
  missing: "Missing",
};

export function isStudentWorkStatus(value: string): value is StudentWorkStatus {
  return value in studentStatusTone;
}

/** An evaluation's outcome, in the teacher's language. */
export function outcomeLabel(value: string): string {
  if (value === "resubmit_requested") {
    return copy.homework.grade.resubmitAsked;
  }
  if (value === "reviewed") return copy.homework.grade.reviewed;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
