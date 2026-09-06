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

/*
 * Fees. The router is mounted as `fees` (plural) in router.ts — the router
 * file's own head comment says `fee.*`, which is stale. Money columns arrive
 * as decimal strings; `lib/money.ts` is the only thing allowed to parse them.
 */
export type FeeHead = RouterOutputs["fees"]["head"]["list"][number];
export type FeeStructure = RouterOutputs["fees"]["structure"]["list"][number];
export type FeeStructureLine = RouterOutputs["fees"]["structure"]["listLines"][number];
export type LateFeeRule = RouterOutputs["fees"]["structure"]["listLateFeeRules"][number];
export type FeeSubscription = RouterOutputs["fees"]["subscription"]["list"][number];
export type FeeAssignment = NonNullable<
  RouterOutputs["fees"]["assignment"]["byStudent"]
>;
export type FeeInstallment = RouterOutputs["fees"]["installment"]["dues"][number];
export type FeePayment = RouterOutputs["fees"]["payment"]["list"][number];
export type PaymentDetail = RouterOutputs["fees"]["payment"]["detail"];
export type LedgerTransaction = RouterOutputs["fees"]["ledger"]["list"][number];
export type OpeningBalance = RouterOutputs["fees"]["ledger"]["listOpeningBalances"][number];

// Exams — Phase 5 (ADR-032). Wire shapes the browser receives.
export type SubjectType = RouterOutputs["exam"]["subjectTypes"]["list"][number];
export type GradingScale = RouterOutputs["exam"]["gradingScales"]["list"][number];
export type PassCriteria = RouterOutputs["exam"]["passCriteria"]["list"][number];
export type Subject = RouterOutputs["subject"]["list"][number];
export type Exam = RouterOutputs["exam"]["exam"]["list"][number];
export type ExamDetail = RouterOutputs["exam"]["exam"]["byId"];
export type ExamSchedule = NonNullable<ExamDetail>["schedules"][number];
export type ExamComponent = ExamSchedule["components"][number];
export type ExamEligibility = RouterOutputs["exam"]["eligibility"]["list"][number];
export type ExamEntryGrid = NonNullable<RouterOutputs["exam"]["marks"]["entry"]>;
export type ExamEntryRosterRow = ExamEntryGrid["roster"][number];
export type ExamEntryComponent = ExamEntryGrid["components"][number];
export type ExamEntryCell = ExamEntryGrid["entries"][number];
export type ExamClassResults = NonNullable<RouterOutputs["exam"]["results"]["table"]>;
export type ExamPublicationRow = NonNullable<
  RouterOutputs["exam"]["publication"]["list"]
>[number];
export type ExamStudentEntry = NonNullable<
  RouterOutputs["exam"]["marks"]["studentEntries"]
>[number];
export type ReportCardVersion = RouterOutputs["exam"]["cards"]["versions"][number];
export type ExamClassCard = NonNullable<
  RouterOutputs["exam"]["cards"]["classSet"]
>["cards"][number];
export type PublishedReportCard = RouterOutputs["portalExam"]["results"]["list"][number];
