import {
  academicCalendar,
  attendancePolicies,
  attendanceSummary,
  dailyAttendanceStatus,
  periods,
} from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * ATTENDANCE — Phase 3. This file grows with the phase: C2 owns the calendar,
 * policy, and period schemas; C5 adds the marking/status/summary shapes.
 *
 * The calendar is attendance-namespaced even though the reference files it
 * under academic structure — its only v1 consumer is marking, and the routers
 * serve it under `attendance.calendar.*`.
 *
 * Same derivation as every contract here: schemas come from the Drizzle table
 * via drizzle-zod, so a column change surfaces as a validation-type error
 * rather than drifting silently (the type chain in AGENTS.md).
 */

/**
 * Drizzle's `date()` yields a `string`, not a `Date` — a calendar date has no
 * time or zone to preserve. Validated as ISO `YYYY-MM-DD`, which is what
 * Postgres accepts and what the client sends. (Shared with term.contract.ts,
 * which owns the rationale.)
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.");

/**
 * Drizzle's `time()` also yields a string. Accepted as `HH:MM` or `HH:MM:SS`
 * — Postgres stores both the same way, and a school typing "08:30" should not
 * be forced to pad it. Range-checked here so "25:99" fails with a field-level
 * message rather than a Postgres internal one.
 */
const timeOfDay = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
    "Use a 24-hour time: HH:MM or HH:MM:SS.",
  );

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export const calendarDaySelectSchema = createSelectSchema(academicCalendar);
export type CalendarDay = z.infer<typeof calendarDaySelectSchema>;

/**
 * One calendar date, created or overridden. `dayType` and `date` are the
 * identity; `reason` is optional and nullable — omitting it on an override
 * PRESERVES the existing reason (the don't-wipe rule the service implements),
 * sending `null` clears it.
 */
export const upsertCalendarDaySchema = z.object({
  academicYearId: z.uuid(),
  date: isoDate,
  dayType: calendarDaySelectSchema.shape.dayType,
  reason: z.string().min(1).max(255).nullish(),
});
export type UpsertCalendarDayInput = z.infer<typeof upsertCalendarDaySchema>;

/**
 * Weekday convention: 0 = Sunday … 6 = Saturday — JS `Date.getUTCDay()`, so
 * the service's date walk and this input speak the same numbers.
 */
export const weekdaySchema = z.number().int().min(0).max(6);

/**
 * The bulk generator's input: one year plus the days a week is actually in
 * session. `workingWeekdays` is the full set of in-session days; the optional
 * `halfDayWeekdays` SUBSET marks which of those are half days — many Indian
 * schools run Saturday as a half day every week, and generating those as
 * working days would leave ~40 manual edits. Everything NOT in
 * `workingWeekdays` is generated as `weekend`; holidays are then set
 * per-date with `upsertCalendarDay`. At least one working weekday — a
 * school with none is not a school.
 */
export const generateCalendarSchema = z
  .object({
    academicYearId: z.uuid(),
    workingWeekdays: z.array(weekdaySchema).min(1).max(7),
    halfDayWeekdays: z.array(weekdaySchema).max(7).optional(),
  })
  .refine(
    (v) =>
      !v.halfDayWeekdays ||
      v.halfDayWeekdays.every((day) => v.workingWeekdays.includes(day)),
    {
      message: "Half-day weekdays must be among the working weekdays.",
      path: ["halfDayWeekdays"],
    },
  );
export type GenerateCalendarInput = z.infer<typeof generateCalendarSchema>;

export const listCalendarSchema = z.object({
  academicYearId: z.uuid(),
  month: z.number().int().min(1).max(12).optional(),
});
export type ListCalendarInput = z.infer<typeof listCalendarSchema>;

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const attendancePolicySelectSchema = createSelectSchema(attendancePolicies);
export type AttendancePolicy = z.infer<typeof attendancePolicySelectSchema>;

/**
 * The school's marking configuration, created on first upsert. `updatedBy`
 * comes from the caller's identity, never the payload.
 *
 * The refine keeps a period-wise school from saving an unusable rule: a
 * `threshold_percentage` policy with no threshold cannot derive a daily
 * status in C5's marking flow. A `daily`-mode school may carry any rule —
 * it is never consulted while mode is daily.
 */
export const upsertPolicySchema = createInsertSchema(attendancePolicies)
  .omit({
    id: true,
    // Both come from the authenticated scope, never from the client.
    organizationId: true,
    schoolId: true,
    updatedBy: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    (v) =>
      v.dailyStatusRule !== "threshold_percentage" ||
      v.thresholdPercentage != null,
    {
      message:
        "A threshold_percentage rule needs a threshold percentage (1-100).",
      path: ["thresholdPercentage"],
    },
  );
export type UpsertPolicyInput = z.infer<typeof upsertPolicySchema>;

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const periodSelectSchema = createSelectSchema(periods);
export type Period = z.infer<typeof periodSelectSchema>;

/**
 * A period of ONE section in ONE year. `academicYearId` is in the create
 * input for the same reason it is on the assignment layer: the service
 * verifies it equals the section's own year (the STA year-consistency
 * pattern), so a period can never be filed under a year its section does not
 * belong to.
 */
export const createPeriodSchema = createInsertSchema(periods, {
  name: z.string().min(1).max(50),
  // Every section restarts at Period 1; uniqueness with (section, year) is
  // the database's (`periods_section_year_sequence_uq`), not pre-checked
  // here — a check between our SELECT and our INSERT would still race.
  sequenceNumber: z.number().int().min(1).max(30),
  startTime: timeOfDay.nullish(),
  endTime: timeOfDay.nullish(),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    // The section is addressed by the router as the explicit parent (B5),
    // not carried in the body.
    sectionId: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    (v) => !v.startTime || !v.endTime || v.endTime > v.startTime,
    {
      message: "A period cannot end before it starts.",
      path: ["endTime"],
    },
  );
export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;

/**
 * Rename, re-sequence, re-time, re-point the subject or teacher. The section
 * and year are NOT patchable: moving a period between sections or years would
 * orphan the attendance rows already marked against it. A period in the wrong
 * section is deleted-and-recreated while it is childless.
 */
export const updatePeriodSchema = createInsertSchema(periods, {
  name: z.string().min(1).max(50),
  sequenceNumber: z.number().int().min(1).max(30),
  startTime: timeOfDay.nullish(),
  endTime: timeOfDay.nullish(),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    sectionId: true,
    academicYearId: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial()
  .refine(
    (v) => !v.startTime || !v.endTime || v.endTime > v.startTime,
    {
      message: "A period cannot end before it starts.",
      path: ["endTime"],
    },
  );
export type UpdatePeriodInput = z.infer<typeof updatePeriodSchema>;

// ---------------------------------------------------------------------------
// Marking (C5) — the flow the calendar gates
// ---------------------------------------------------------------------------

export const dailyAttendanceStatusSelectSchema = createSelectSchema(
  dailyAttendanceStatus,
);
export type DailyAttendanceStatus = z.infer<
  typeof dailyAttendanceStatusSelectSchema
>;

/** The five markable statuses — shared by records and the daily layer. */
export const attendanceStatusSchema =
  dailyAttendanceStatusSelectSchema.shape.status;

/**
 * One student's mark. `correctionReason` is the owner's design (ADR-030): the
 * FRONTEND asks for a reason when editing a PAST date and does not ask on
 * same-day marking — the backend stores what it receives and never requires
 * it. An update sent WITHOUT a reason preserves the stored one.
 */
export const attendanceEntrySchema = z.object({
  studentId: z.uuid(),
  status: attendanceStatusSchema,
  correctionReason: z.string().min(1).max(500).optional(),
});
export type AttendanceEntry = z.infer<typeof attendanceEntrySchema>;

/**
 * One marking submission for a section on a date. `periodId` is present only
 * for period-wise schools — a daily-mode school marking with a period named
 * is a service refusal, not a silent reinterpretation. The date must be
 * calendar-valid (working, half day, or exam day): that is the marking
 * gate's job in the service, not a schema rule, because the answer lives in
 * another table.
 */
export const markAttendanceSchema = z.object({
  sectionId: z.uuid(),
  date: isoDate,
  periodId: z.uuid().optional(),
  entries: z.array(attendanceEntrySchema).min(1),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

/** Which section's day to read, and which day. */
export const getDailyStatusSchema = z.object({
  sectionId: z.uuid(),
  date: isoDate,
});
export type GetDailyStatusInput = z.infer<typeof getDailyStatusSchema>;

/**
 * Which summaries to read. `sectionId` and `studentId` narrow an otherwise
 * school-wide read; the caller's scope narrows it further regardless — the
 * service scopes through the enrollment JOIN, so a section teacher gets her
 * section's students' rows even without naming the section.
 */
export const listSummariesSchema = z.object({
  academicYearId: z.uuid(),
  sectionId: z.uuid().optional(),
  studentId: z.uuid().optional(),
});
export type ListSummariesInput = z.infer<typeof listSummariesSchema>;

export const attendanceSummarySelectSchema = createSelectSchema(attendanceSummary);
export type AttendanceSummary = z.infer<typeof attendanceSummarySelectSchema>;
