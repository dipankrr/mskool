import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

/**
 * Reading and writing a quiz answer on the family side. Answers travel as the
 * server stores them: `{ option_ids }` for choices, `{ value }` for true/false
 * and numbers, `{ text }` for typed answers.
 */

export type QuizQuestion = NonNullable<
  inferRouterOutputs<AppRouter>["portalHomework"]["attempts"]["get"]
>["questions"][number];

type Option = { id: number; text: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function isAnswered(type: string, value: unknown): boolean {
  const r = record(value);
  if (!r) return false;
  if (type === "mcq_single" || type === "mcq_multi") return Array.isArray(r.option_ids) && r.option_ids.length > 0;
  if (type === "true_false") return typeof r.value === "boolean";
  if (type === "numeric") return typeof r.value === "number" && Number.isFinite(r.value);
  return typeof r.text === "string" && r.text.trim().length > 0;
}

/** An answer as words: "B. Blocked by an object", "True", "42", the typed text. */
export function answerText(
  type: string,
  value: unknown,
  options?: readonly Option[] | null,
  labels: { yes: string; no: string } = { yes: "True", no: "False" },
): string {
  const r = record(value);
  if (!r) return "";
  if (type === "mcq_single" || type === "mcq_multi") {
    const ids = Array.isArray(r.option_ids) ? (r.option_ids as unknown[]).map(Number) : [];
    return ids
      .map((id) => {
        const index = options?.findIndex((o) => o.id === id) ?? -1;
        const option = index >= 0 ? options?.[index] : undefined;
        return option ? `${String.fromCharCode(65 + index)}. ${option.text}` : String(id);
      })
      .join(", ");
  }
  if (type === "true_false") return typeof r.value === "boolean" ? (r.value ? labels.yes : labels.no) : "";
  if (type === "numeric") return typeof r.value === "number" && Number.isFinite(r.value) ? String(r.value) : "";
  return typeof r.text === "string" ? r.text : "";
}

/** How many came back right, and how many still wait for the teacher's marking. */
export function quizScore(result: { answers: { isCorrect: boolean | null }[] }): { right: number; pending: number } {
  let right = 0;
  let pending = 0;
  for (const a of result.answers) {
    if (a.isCorrect === true) right += 1;
    else if (a.isCorrect === null) pending += 1;
  }
  return { right, pending };
}
