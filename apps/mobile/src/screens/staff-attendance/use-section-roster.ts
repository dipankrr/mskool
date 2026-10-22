import { useMemo } from "react";

import { useActiveContext } from "../../hooks/use-active-context";
import { trpc } from "../../lib/trpc";
import { buildRoster } from "./roster";

/**
 * The one enrollments read behind both attendance panels: the section's
 * enrollment pairs, the roster in roll order, and the roster ids the marking
 * draft is keyed by. The query options are chunk 1's verbatim (60 s stale) so
 * the two panels share one cache entry when both are mounted.
 */
export function useSectionRoster(sectionId: string) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const ready = Boolean(organizationId && academicYear);

  const query = trpc.enrollment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
      sectionId,
    },
    { enabled: ready, staleTime: 60_000 },
  );

  const roster = useMemo(
    () => buildRoster(query.data ?? [], sectionId),
    [query.data, sectionId],
  );
  const rosterIds = useMemo(
    () => roster.map((entry) => entry.studentId),
    [roster],
  );

  return { roster, rosterIds, query, ready };
}
