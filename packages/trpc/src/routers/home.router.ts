import {
  homeAttendanceTodayInputSchema,
  homeAttendanceTodaySchema,
  homeMyPapersInputSchema,
  homeMyPapersSchema,
  homeOrgInputSchema,
  homeOrgSchema,
} from "@repo/contracts";
import { homeService } from "@repo/services";
import { orgListProcedure, protectedProcedure, router, staffListProcedure } from "../trpc";

/**
 * STAFF HOME (ADR-072). Home is assembled from the caller's assignments,
 * permissions and scope, and reuses every read another screen already has.
 * These are the three it was missing.
 */
export const homeRouter = router({
  /**
   * Every section the caller may see in the branch, with today's counts and
   * who marked it. Permissive list: a teacher sees her own sections, a
   * principal the whole branch (`wholeSchool` says which), with the same
   * no-widening scopes as `attendance.status`.
   */
  attendanceToday: staffListProcedure("attendance:read")
    .meta({ openapi: { method: "GET", path: "/home/attendance-today", tags: ["home"], summary: "Today's attendance for every section the caller may see", protect: true } })
    .input(homeAttendanceTodayInputSchema)
    .output(homeAttendanceTodaySchema)
    .query(({ ctx, input }) => homeService.attendanceToday(ctx.scopes, ctx.schoolId, input)),

  /**
   * The caller's own subject pairs against open exams: entered of students
   * per paper, and the papers still to be sat. No permission, like
   * `assignment.mine`: the caller's own work, found from the session's login.
   */
  myPapers: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/home/my-papers", tags: ["home"], summary: "The caller's own exam papers and how far marks have got", protect: true } })
    .input(homeMyPapersInputSchema)
    .output(homeMyPapersSchema)
    .query(({ ctx, input }) => homeService.myPapers(ctx.session.user.id, input)),

  /**
   * The All branches view: per branch, only what the caller may read there.
   * Org-wide on purpose (ADR-067 point 2), so it uses orgListProcedure.
   */
  org: orgListProcedure("school:read")
    .meta({ openapi: { method: "GET", path: "/home/org", tags: ["home"], summary: "Each branch's figures for the All branches view", protect: true } })
    .input(homeOrgInputSchema)
    .output(homeOrgSchema)
    .query(({ ctx, input }) => homeService.org(ctx.authCache, ctx.organizationId, ctx.scopes, input.date)),
});
