import type { inferRouterOutputs } from "@trpc/server";
// Type-only, and it must stay that way: this is the whole mechanism that keeps
// apps/web from bundling express, drizzle and postgres (AGENTS.md's type chain).
import type { AppRouter } from "@repo/trpc";

/**
 * THE SHAPES THE BROWSER ACTUALLY RECEIVES.
 *
 * Not the same as the `@repo/contracts` types, and the difference bites. A
 * `timestamp` column is a `Date` in the contract and in the service, but there is
 * no superjson transformer on this client, so JSON turns it into a string in
 * transit. `School` from `@repo/contracts` therefore does not describe what a
 * component holds — `createdAt` is a `string` here — and assigning one to the
 * other is a type error rather than a silent mismatch, which is how this was found.
 *
 * So: **row shapes come from here, validation schemas come from `@repo/contracts`.**
 * The two do not conflict. Create and update schemas omit every timestamp column,
 * so a form never validates a `Date`, and calendar dates are ISO strings on both
 * sides by design (see `academic.contract.ts`).
 *
 * Everything is still derived from `AppRouter`, so a column change remains a
 * compile error in this app rather than a runtime surprise.
 */
type RouterOutputs = inferRouterOutputs<AppRouter>;

export type Me = RouterOutputs["me"]["get"];
export type Membership = Me["memberships"][number];

export type School = Membership["schools"][number];
export type AcademicYear = RouterOutputs["academic"]["year"]["list"][number];
export type Class = RouterOutputs["academic"]["class"]["list"][number];
export type Section = RouterOutputs["academic"]["section"]["list"][number];

/** A registry row. Active students only — the service documents why. */
export type Student = RouterOutputs["student"]["list"][number];
/** The enrollment list's `{ enrollment, student }` pair — the year anchor's read shape. */
export type EnrollmentPair = RouterOutputs["enrollment"]["list"][number];

/** One calendar day — the marking gate's row. */
export type CalendarDay = RouterOutputs["attendance"]["calendar"]["list"][number];

/** The scope every staff call carries. Lists send the org; mutations add a branch. */
export type StaffScopeArgs = { organizationId: string };
export type WriteScopeArgs = StaffScopeArgs & { schoolId: string };
