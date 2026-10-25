import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

/**
 * The homework wire shapes, inferred once so no screen re-derives them. The
 * mobile app imports `@repo/trpc` type-only (the same boundary as web); these
 * aliases disappear at build time.
 */
export type HomeworkRow = inferRouterOutputs<AppRouter>["homework"]["list"][number];

export type HomeworkDetail = NonNullable<
  inferRouterOutputs<AppRouter>["homework"]["byId"]
>;

export type StudentAssignmentRow =
  inferRouterOutputs<AppRouter>["homework"]["students"]["list"][number];

export type StudentAssignmentDetail = NonNullable<
  inferRouterOutputs<AppRouter>["homework"]["students"]["get"]
>;

export type SubmissionRow = StudentAssignmentDetail["submissions"][number];

export type EvaluationRow = StudentAssignmentDetail["evaluations"][number];

export type HomeworkTarget = HomeworkDetail["targets"][number];

/** The teacher-facing set: options carry keys and the question carries marks. */
export type AssignmentQuestionRow = NonNullable<
  inferRouterOutputs<AppRouter>["homework"]["questions"]["get"]
>[number];

export type BankItemRow =
  inferRouterOutputs<AppRouter>["homework"]["bank"]["list"][number];

export type BankItemDetail = NonNullable<
  inferRouterOutputs<AppRouter>["homework"]["bank"]["byId"]
>;

export type AttemptRow = NonNullable<
  inferRouterOutputs<AppRouter>["homework"]["students"]["attempts"]["list"]
>[number];

export type AttemptAnswerRow = AttemptRow["answers"][number];

export type CommentRow =
  inferRouterOutputs<AppRouter>["homework"]["comments"]["list"][number];

/** The effective settings read model: no identity columns, just the rules. */
export type EffectiveSettings =
  inferRouterOutputs<AppRouter>["homework"]["settings"]["get"];

/** The upsert response: the stored row, identity columns included. */
export type SettingsRow =
  inferRouterOutputs<AppRouter>["homework"]["settings"]["upsert"];

export type RubricRow =
  inferRouterOutputs<AppRouter>["homework"]["rubrics"]["list"][number];

export type RubricDetailRow = NonNullable<
  inferRouterOutputs<AppRouter>["homework"]["rubrics"]["byId"]
>;

export type RubricCriterionRow = RubricDetailRow["criteria"][number];

export type RubricLevelRow = RubricCriterionRow["levels"][number];

/**
 * The section a v1 assignment targets. The publish/close gate pair needs it
 * because the service verifies the pair describes the row; an assignment with
 * no section target cannot be transitioned from this app.
 */
export function sectionTargetOf(
  detail: HomeworkDetail | null | undefined,
): HomeworkTarget | undefined {
  return detail?.targets.find((target) => target.targetType === "section");
}

/** Rows whose due time has already passed, most recent first. */
export function pastDueRows(
  rows: readonly HomeworkRow[],
  now = new Date(),
): HomeworkRow[] {
  return rows
    .filter((row) => {
      if (row.status !== "published") return false;
      const due = new Date(row.dueAt);
      return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
    })
    .sort((a, b) => new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime());
}
