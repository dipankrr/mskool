import { copy } from "../../lib/copy";
import { isExamStatus } from "../../lib/exams";
import type { ExamStatus, TransitionKey } from "../../lib/exams";
import type { Tone } from "../../theme/brand-admin";

/** The stage word a person reads ("Marks entry"); unknown → the raw value. */
export function stageLabel(status: string): string {
  return isExamStatus(status) ? copy.exams.stage[status] : status;
}

const STAGE_TONE: Record<ExamStatus, Tone> = {
  draft: "neutral",
  scheduled: "neutral",
  ongoing: "neutral",
  // Entry is the stage that asks something of the reader: it wears the accent.
  marks_entry: "positive",
  under_verification: "caution",
  published: "positive",
  locked: "neutral",
};

export function stageTone(status: string): Tone {
  return isExamStatus(status) ? STAGE_TONE[status] : "neutral";
}

export function examTypeLabel(type: string): string {
  return (copy.exams.type as Record<string, string | undefined>)[type] ?? type;
}

export function transitionLabel(key: TransitionKey): string {
  return copy.exams.hub.transitions[key];
}

export function transitionConsequence(key: TransitionKey): string {
  return copy.exams.hub.consequences[key];
}

/** The confirm sheet's title: forward, back, or the lock. */
export function transitionTitle(key: TransitionKey): string {
  if (key === "locked") return copy.exams.hub.confirmLock;
  if (key === "back_to_entry" || key === "back_to_draft") {
    return copy.exams.hub.confirmBack;
  }
  return copy.exams.hub.confirmForward;
}
