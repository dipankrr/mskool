import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { useActiveContext } from "../../../hooks/use-active-context";
import { usePermissions } from "../../../hooks/use-permissions";
import { toFriendlyError } from "../../../lib/errors";
import { todayIso } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { shiftIsoDays } from "../../staff-attendance/calendar-month";
import { summaryByStudent, type SummaryRow } from "../../staff-attendance/summary";
import type { HistoryRow } from "./profile-logic";

type Outputs = inferRouterOutputs<AppRouter>;
export type FeeSummary = Outputs["fees"]["dashboard"]["student"];
export type LatestResult = NonNullable<Outputs["exam"]["results"]["studentLatest"]>;
export type RecentHomework = Outputs["homework"]["studentRecent"];
export type { SummaryRow };
export type PortalLink = Outputs["portalAccess"]["status"][number];

/**
 * One block of the page: not drawn, still loading, failed (with its own retry), or
 * ready. "Not allowed" and "not yours" (FORBIDDEN / NOT_FOUND) are `hidden`, the same
 * as holding no permission, so nobody sees a lock; anything else keeps the block and
 * offers Retry inside it.
 */
export type Block<T> =
  | { state: "hidden" }
  | { state: "loading" }
  | { state: "error"; retry: () => void }
  | { state: "ready"; data: T };

function blockOf<T>(
  allowed: boolean,
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: T | undefined;
    refetch: () => unknown;
  },
): Block<T> {
  if (!allowed) return { state: "hidden" };
  if (query.isError) {
    const kind = toFriendlyError(query.error).kind;
    if (kind === "forbidden" || kind === "notFound") return { state: "hidden" };
    return { state: "error", retry: () => void query.refetch() };
  }
  if (query.isPending || query.data === undefined) return { state: "loading" };
  return { state: "ready", data: query.data };
}

/**
 * Everything the profile reads beyond the student row itself, each gated by the
 * permission that read needs. Scope narrows further on the server: a section teacher's
 * reads for another section come back empty or null, and the page hides them too.
 */
export function useProfileData(input: {
  studentId: string | undefined;
  sectionId: string | null;
  enabled: boolean;
}) {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has, hasAny } = usePermissions();
  const base = ready && input.enabled && Boolean(organizationId) && Boolean(input.studentId);
  const yearId = academicYear?.id ?? "";
  const studentId = input.studentId ?? "";
  const org = organizationId ?? "";

  const can = {
    attendance: has("attendance:read"),
    fees: hasAny("fee_report:read", "student_fee_assignment:read"),
    results: has("exam:read"),
    homework: has("homework:read"),
    portal: has("portal_access:activate"),
  };

  const today = todayIso();
  // 30 days covers ten school days and today; the server caps a range at 45.
  const history = trpc.attendance.statusHistory.useQuery(
    {
      organizationId: org,
      ...(schoolId ? { schoolId } : {}),
      sectionId: input.sectionId ?? "",
      fromDate: shiftIsoDays(today, -30),
      toDate: today,
    },
    { enabled: base && can.attendance && Boolean(input.sectionId), staleTime: 60_000 },
  );
  const summary = trpc.attendance.summary.useQuery(
    { organizationId: org, academicYearId: yearId, studentId },
    { enabled: base && can.attendance && Boolean(yearId), staleTime: 60_000 },
  );
  const fees = trpc.fees.dashboard.student.useQuery(
    { organizationId: org, academicYearId: yearId, studentId },
    { enabled: base && can.fees && Boolean(yearId) },
  );
  const results = trpc.exam.results.studentLatest.useQuery(
    { organizationId: org, academicYearId: yearId, studentId },
    { enabled: base && can.results && Boolean(yearId), staleTime: 5 * 60_000 },
  );
  const homework = trpc.homework.studentRecent.useQuery(
    { organizationId: org, academicYearId: yearId, studentId },
    { enabled: base && can.homework && Boolean(yearId), staleTime: 60_000 },
  );
  const portal = trpc.portalAccess.status.useQuery(
    { organizationId: org, schoolId: schoolId ?? undefined, studentId },
    { enabled: base && can.portal },
  );

  // Attendance needs a section (the history is section-scoped). With no row for
  // this child in either read, the viewer's scope doesn't reach them, or nothing
  // was ever marked: either way there's nothing to show.
  const historyRows = (history.data ?? []) as unknown as HistoryRow[];
  const summaryRow =
    summaryByStudent((summary.data ?? []) as unknown as SummaryRow[]).get(studentId) ?? null;
  const attendanceAllowed = can.attendance && Boolean(input.sectionId) && Boolean(yearId);
  const attendanceQuery = {
    isPending: history.isPending || summary.isPending,
    isError: history.isError || summary.isError,
    error: history.error ?? summary.error,
    data:
      history.data && summary.data ? { rows: historyRows, summary: summaryRow } : undefined,
    refetch: () => {
      void history.refetch();
      void summary.refetch();
    },
  };
  const attendanceBlock = blockOf(attendanceAllowed, attendanceQuery);
  const attendance: Block<{ rows: HistoryRow[]; summary: SummaryRow | null }> =
    attendanceBlock.state === "ready" &&
    !attendanceBlock.data.summary &&
    !attendanceBlock.data.rows.some((row) => row.studentId === studentId)
      ? { state: "hidden" }
      : attendanceBlock;

  const resultsBlock = blockOf(can.results && Boolean(yearId), results);

  return {
    attendance,
    fees: blockOf(can.fees && Boolean(yearId), fees),
    // Null means nothing published, or a child outside the viewer's scope.
    results: (resultsBlock.state === "ready" && resultsBlock.data === null
      ? { state: "hidden" }
      : resultsBlock) as Block<LatestResult>,
    homework: blockOf(can.homework && Boolean(yearId), homework),
    portal: blockOf(can.portal, portal),
    refetch: () => {
      if (can.attendance && input.sectionId) void history.refetch();
      if (can.attendance) void summary.refetch();
      if (can.fees) void fees.refetch();
      if (can.results) void results.refetch();
      if (can.homework) void homework.refetch();
      if (can.portal) void portal.refetch();
    },
  };
}
