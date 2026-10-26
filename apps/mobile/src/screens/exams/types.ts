import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

/**
 * The exam wire shapes, inferred once so no screen re-derives them. The mobile
 * app imports `@repo/trpc` type-only; these aliases disappear at build time.
 * Timestamps arrive as ISO strings at runtime although the contracts type them
 * `Date` — helpers that touch them accept `string | Date`.
 */
type Out = inferRouterOutputs<AppRouter>["exam"];

export type ExamListRow = Out["exam"]["list"][number];

export type ExamDetail = NonNullable<Out["exam"]["byId"]>;

export type ExamPaper = ExamDetail["schedules"][number];

export type PaperComponent = ExamPaper["components"][number];

export type EntryGrid = NonNullable<Out["marks"]["entry"]>;

export type RosterStudent = EntryGrid["roster"][number];

export type EligibilityRow = Out["eligibility"]["list"][number];
