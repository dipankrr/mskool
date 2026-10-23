import { useMemo } from "react";

import { useActiveContext } from "../../hooks/use-active-context";
import { trpc } from "../../lib/trpc";
import { shiftIsoDays } from "./calendar-month";
import type { Status } from "./draft";
import { collectRecentDays } from "./recent-history";

/**
 * The last few marked days before the selected one — the paper register's
 * left-hand page, reduced to a glance. One bounded range query backs the
 * whole section; the client folds it by date and keeps five, so no per-student
 * request exists (the N+1 this was designed to avoid).
 */

/** The API caps a history request at 45 days; stay inside it. */
const HISTORY_WINDOW_DAYS = 45;

export function useRecentAttendance({
  sectionId,
  date,
  enabled = true,
}: {
  sectionId: string;
  /** The selected register day; history ends the day before it. */
  date: string;
  enabled?: boolean;
}) {
  const { organizationId, schoolId } = useActiveContext();
  const ready = Boolean(organizationId && sectionId && enabled);
  const fromDate = shiftIsoDays(date, -HISTORY_WINDOW_DAYS);
  const toDate = shiftIsoDays(date, -1);

  const query = trpc.attendance.statusHistory.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      sectionId,
      fromDate,
      toDate,
    },
    {
      enabled: ready && fromDate <= toDate,
      staleTime: 60_000,
    },
  );

  const days = useMemo(
    () =>
      collectRecentDays(
        (query.data ?? []) as { date: string; studentId: string; status: Status }[],
      ),
    [query.data],
  );

  return { days, query };
}
