import {
  portalAttendanceMonthInputSchema,
  portalAttendanceMonthSchema,
  portalAttendanceOverviewSchema,
  portalAttendanceRankingInputSchema,
  portalAttendanceRankingSchema,
  portalChildInputSchema,
} from "@repo/contracts";
import { portalAttendanceService } from "@repo/services";

import { router, studentProcedure } from "../trpc";

/**
 * FAMILY ATTENDANCE (ADR-062) — `portalAttendance.*`. Ownership only, never
 * can(): the service refuses a child outside `ctx.studentIds` with NOT_FOUND
 * and reads the school and year from the child, never the session. Every
 * figure is the "so far" count from daily status (ADR-061, hard rule 5).
 */
export const portalAttendanceRouter = router({
  month: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/attendance/month", tags: ["portal"], summary: "One month of a child's attendance, day by day", protect: true } })
    .input(portalAttendanceMonthInputSchema)
    .output(portalAttendanceMonthSchema)
    .query(({ ctx, input }) => portalAttendanceService.month(ctx.studentIds, input)),

  overview: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/attendance/overview", tags: ["portal"], summary: "A child's attendance so far: this month, each term, the year", protect: true } })
    .input(portalChildInputSchema)
    .output(portalAttendanceOverviewSchema)
    .query(({ ctx, input }) => portalAttendanceService.overview(ctx.studentIds, input)),

  ranking: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/attendance/ranking", tags: ["portal"], summary: "The child's section ranking for a month, term or the year", protect: true } })
    .input(portalAttendanceRankingInputSchema)
    .output(portalAttendanceRankingSchema)
    .query(({ ctx, input }) =>
      portalAttendanceService.ranking(ctx.studentIds, {
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        period:
          input.period === "month"
            ? { kind: "month", month: input.month! }
            : input.period === "term"
              ? { kind: "term", termId: input.termId! }
              : { kind: "year" },
      }),
    ),
});
