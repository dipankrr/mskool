import { copy } from "../../lib/copy";

/** A question type in the teacher's words ("Multiple choice"), or a readable fallback. */
export function questionTypeLabel(value: string): string {
  return value in copy.homework.questions.types
    ? copy.homework.questions.types[value as keyof typeof copy.homework.questions.types]
    : value.replace(/_/g, " ");
}
