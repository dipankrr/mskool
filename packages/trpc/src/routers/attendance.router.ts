import {
  attendancePolicySelectSchema,
  calendarDaySelectSchema,
  generateCalendarSchema,
  listCalendarSchema,
  periodSelectSchema,
  createPeriodSchema,
  updatePeriodSchema,
  upsertCalendarDaySchema,
  upsertPolicySchema,
} from "@repo/contracts";
import { attendanceService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  router,
  staffListProcedure,
  staffProcedure,
  type OwnerResolver,
} from "../trpc";

/**
 * ATTENDANCE — Phase 3, configuration surface (C3). The marking, status, and
 * summary procedures join this router in C6.
 *
 * **Gate choices, recorded here as the plan requires: `attendance:update`
 * gates every CONFIGURATION surface on this router — calendar generate and
 * day upsert, policy upsert, and period create/update. `attendance:create` is
 * RESERVED for the marking flow (C6's `mark`)**, whose authorization question
 * ("may you record attendance?") is a different one from "may you configure
 * it?" — and the default matrix pins them differently: subject_teacher holds
 * `create` but not `update`, so she can mark yet not rewrite the calendar or
 * the periods. Reads everywhere are `attendance:read`.
 *
 * NOT subject-gated (the plan's hard context): attendance is SECTION-scoped,
 * not subject-scoped — there is no subjectGate on any procedure here, and
 * `SUBJECT_GATED_WRITES` does not name these permissions.
 *
 * Scope levels, per entity (the reasoning lives on the service):
 *   - Calendar and policy are SCHOOL-level facts — a section-scoped teacher
 *     reads them through the permissive track's `atSchoolLevel` widening,
 *     which is legitimate here because neither table has a class dimension.
 *   - Periods are section-attached configuration on the assignment layer's
 *     pattern: the parent is named in the input (B5), reads are permissive
 *     lists and B7 overlap byId, mutations cover (ADR-017 strict).
 *
 * No `scope_nodes` writes — none of these tables is in the authorization
 * tree (hard rule 12 names school/class/section only).
 */

const READ_HISTORY = "academic_year:read_history" as const;

const resolvePeriodOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await attendanceService.getPeriodOwnerId(organizationId, id);
  if (!schoolId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Period not found." });
  }
  return { type: "school", id: schoolId };
};

// ---------------------------------------------------------------------------
// Calendar — the marking gate
// ---------------------------------------------------------------------------

const calendarRouter = router({
  // Permissive list (ADR-017): a section-scoped teacher must read the
  // calendar to know which days are markable, and a day is a day for the
  // whole branch. `includeHistory` composes as the terms list's does (ADR-024).
  list: staffListProcedure("attendance:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/attendance/calendar",
        tags: ["attendance"],
        summary: "List one academic year's calendar, optionally one month",
        protect: true,
      },
    })
    .input(listCalendarSchema)
    .output(z.array(calendarDaySelectSchema))
    .query(async ({ ctx, input }) =>
      attendanceService.listCalendar(
        ctx.scopes,
        input,
        ctx.canWithin(READ_HISTORY),
      ),
    ),

  // B5: the school is named in the endpoint's own input, so the scope
  // resolves to the school node and requireSchoolId never guesses. Strict
  // cover — configuring a calendar is a school-management act.
  generate: staffProcedure("attendance:update")
    .meta({
      openapi: {
        method: "POST",
        path: "/attendance/calendar/generate",
        tags: ["attendance"],
        summary:
          "Generate a year's calendar from working weekdays (idempotent, fills missing dates)",
        protect: true,
      },
    })
    .input(z.object({ schoolId: z.uuid(), data: generateCalendarSchema }))
    .output(z.object({ generated: z.number().int() }))
    .mutation(async ({ ctx, input }) =>
      attendanceService.generateYearCalendar(ctx.scope, input.data, ctx.userId),
    ),

  // The single-date override — how a holiday, exam day, or half day enters
  // the calendar. Same B5 shape as generate.
  upsert: staffProcedure("attendance:update")
    .meta({
      openapi: {
        method: "POST",
        path: "/attendance/calendar/days",
        tags: ["attendance"],
        summary: "Set or override one calendar date's day type",
        protect: true,
      },
    })
    .input(z.object({ schoolId: z.uuid(), data: upsertCalendarDaySchema }))
    .output(calendarDaySelectSchema)
    .mutation(async ({ ctx, input }) =>
      attendanceService.upsertCalendarDay(ctx.scope, input.data, ctx.userId),
    ),
});

// ---------------------------------------------------------------------------
// Policy — one per school
// ---------------------------------------------------------------------------

const policyRouter = router({
  // Permissive read, singleton result: the marking screen needs the policy's
  // late-arrival and threshold hints as much as the principal's config
  // screen does, and a section-scoped teacher does not COVER the school she
  // marks in. Null before the first upsert — the caller sees "no policy yet",
  // not an error.
  get: staffListProcedure("attendance:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/attendance/policy",
        tags: ["attendance"],
        summary: "Get a school's attendance marking policy (null before first upsert)",
        protect: true,
      },
    })
    .input(z.object({ schoolId: z.uuid() }))
    .output(attendancePolicySelectSchema.nullable())
    .query(async ({ ctx, input }) =>
      attendanceService.getPolicyForSchool(ctx.scopes, input.schoolId),
    ),

  // First upsert creates the school's one row, the rest update — keyed on
  // `attendance_policies_school_uq`. Strict cover, like every mutation.
  upsert: staffProcedure("attendance:update")
    .meta({
      openapi: {
        method: "POST",
        path: "/attendance/policy",
        tags: ["attendance"],
        summary: "Create or update the school's attendance marking policy",
        protect: true,
      },
    })
    .input(z.object({ schoolId: z.uuid(), data: upsertPolicySchema }))
    .output(attendancePolicySelectSchema)
    .mutation(async ({ ctx, input }) =>
      attendanceService.upsertPolicy(ctx.scope, input.data, ctx.userId),
    ),
});

// ---------------------------------------------------------------------------
// Periods — section-attached configuration (period-wise schools)
// ---------------------------------------------------------------------------

const periodRouter = router({
  // Permissive list: a section teacher reads her own section's periods the
  // same way she reads her assignments. ctx.scopes is clipped to the
  // addressed subtree.
  list: staffListProcedure("attendance:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/attendance/periods",
        tags: ["attendance"],
        summary: "List a section's periods in timetable order",
        protect: true,
      },
    })
    .input(z.object({ sectionId: z.uuid() }))
    .output(z.array(periodSelectSchema))
    .query(async ({ ctx, input }) =>
      attendanceService.listPeriods(ctx.scopes, input.sectionId),
    ),

  // B7 (ADR-028): overlap read — the period belongs to a school the caller
  // may reach into without covering.
  byId: staffProcedure("attendance:read", {
    resolveOwner: resolvePeriodOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/attendance/periods/{id}",
        tags: ["attendance"],
        summary: "Get one period",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(periodSelectSchema)
    .query(async ({ ctx, input }) => {
      const period = await attendanceService.getPeriodById(ctx.scope, input.id);
      if (!period) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Period not found." });
      }
      return period;
    }),

  // B5: the section is named in the input; the service verifies it belongs
  // to the caller's school and that the input's year equals the section's.
  create: staffProcedure("attendance:update")
    .meta({
      openapi: {
        method: "POST",
        path: "/attendance/periods",
        tags: ["attendance"],
        summary: "Create a period for a section",
        protect: true,
      },
    })
    .input(z.object({ sectionId: z.uuid(), data: createPeriodSchema }))
    .output(periodSelectSchema)
    .mutation(async ({ ctx, input }) =>
      attendanceService.createPeriod(
        ctx.scope,
        input.sectionId,
        input.data,
        ctx.userId,
      ),
    ),

  // B6 owner-resolved, cover gate (ADR-017 strict — mutations always cover).
  // Section and year are not patchable; a colliding sequence is the
  // database's `periods_section_year_sequence_uq`, worded by translateErrors.
  update: staffProcedure("attendance:update", {
    resolveOwner: resolvePeriodOwner,
  })
    .meta({
      openapi: {
        method: "PATCH",
        path: "/attendance/periods/{id}",
        tags: ["attendance"],
        summary: "Update a period (name, sequence, times, subject, teacher)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updatePeriodSchema }))
    .output(periodSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const period = await attendanceService.updatePeriod(
        ctx.scope,
        input.id,
        input.data,
      );
      if (!period) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Period not found." });
      }
      return period;
    }),
});

/**
 * Namespaced `attendance.*` (AGENTS.md: staff routers are `<domain>.*`);
 * sub-routers are flat so the tRPC namespace reads attendance.calendar.*,
 * attendance.policy.*, attendance.period.*. Wired under `attendance`;
 * REST paths are `/attendance/*`.
 */
export const attendanceRouter = router({
  calendar: calendarRouter,
  policy: policyRouter,
  period: periodRouter,
});
