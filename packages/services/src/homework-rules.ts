import {
  KIND_COMES_BACK,
  KIND_GRADING,
  comesBackAllowsGrading,
  type ComesBack,
  type GradingMode,
  type HomeworkKind,
  type StudentWord,
} from "@repo/contracts";

import { refuse } from "./service-error";

/**
 * HOMEWORK RULES (ADR-064) — the pure decisions the homework service makes,
 * kept free of the database so they are unit-tested directly.
 */

type StudentRowStatus = "assigned" | "in_progress" | "submitted" | "redo" | "checked" | "missing";

/** Roll numbers sort as numbers first ("2" before "12", "12" before "12A"). */
export function compareRoll(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  const aNum = !Number.isNaN(na);
  const bNum = !Number.isNaN(nb);
  if (aNum && bNum && na !== nb) return na - nb;
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a.localeCompare(b, "en", { numeric: true });
}

/** Checks the kind's allowed ways back and grading, and the marks they need. */
export function validateChoices(input: {
  kind: HomeworkKind;
  comesBack: ComesBack;
  gradingMode: GradingMode;
  maxMarks: string | null;
}): void {
  if (!KIND_COMES_BACK[input.kind].includes(input.comesBack)) {
    throw refuse("BAD_REQUEST", "This type of homework can't come back that way.");
  }
  if (input.gradingMode !== "none" && !comesBackAllowsGrading(input.comesBack)) {
    throw refuse("BAD_REQUEST", "Only work that comes back to you can be graded.");
  }
  if (input.kind !== "quiz" && !KIND_GRADING[input.kind].includes(input.gradingMode)) {
    throw refuse("BAD_REQUEST", "This type of homework can't be graded that way.");
  }
  if (input.kind !== "quiz" && input.gradingMode === "marks") {
    const max = Number(input.maxMarks ?? "0");
    if (!(max > 0)) throw refuse("BAD_REQUEST", "Say what the marks are out of.");
  }
}

/**
 * The student's word for one homework (ADR-064): To do, Sent, Late, Checked,
 * Redo, Missed, plus two endings so nothing sits in "to do" for ever: work
 * brought to class is "with teacher" once due, and work with nothing coming
 * back is "over" once due. An unticked tick is missed once it closes.
 */
export function studentWord(
  sa: {
    status: StudentRowStatus;
    checkStatus: "done" | "incomplete" | "not_done" | "absent" | null;
    isLate: boolean;
    effectiveDueAt: Date;
    effectiveCloseAt: Date;
  },
  comesBack: ComesBack,
  now: Date,
): StudentWord {
  switch (sa.status) {
    case "checked":
      return sa.checkStatus === "not_done" ? "missed" : "checked";
    case "redo":
      return "redo";
    case "missing":
      return "missed";
    case "submitted":
      return sa.isLate ? "late" : "sent";
    default:
      if ((comesBack === "sent" || comesBack === "questions" || comesBack === "tick") && now > sa.effectiveCloseAt) {
        return "missed";
      }
      if (comesBack === "brought" && now > sa.effectiveDueAt) return "with_teacher";
      if (comesBack === "none" && now > sa.effectiveDueAt) return "over";
      return "to_do";
  }
}
