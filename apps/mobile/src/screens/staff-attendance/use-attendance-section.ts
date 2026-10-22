import { useMemo } from "react";

import { useActiveContext } from "../../hooks/use-active-context";
import { trpc } from "../../lib/trpc";

/**
 * The attendance tab's "which section" resolution (chunk 3 extraction): a
 * `sectionId` route param wins when it names a section the caller can see
 * (a home card, the switcher's `setParams`, or the manage hub passing the
 * current one along); else the caller's first active section.
 *
 * The shell, the manage hub, and the manage screens all call this, so the
 * queries carry the shell's exact keys and options — one cache entry per
 * list, whichever screen opened first.
 */
export function useAttendanceSection(preferredId: string | null | undefined) {
  const { organizationId, schoolId, academicYear } = useActiveContext();

  const sectionsQuery = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
    },
    { enabled: Boolean(organizationId && academicYear), staleTime: 60_000 },
  );
  const classesQuery = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", ...(schoolId ? { schoolId } : {}) },
    { enabled: Boolean(organizationId), staleTime: 300_000 },
  );

  const sections = useMemo(
    () =>
      (sectionsQuery.data ?? []).filter(
        (section) => section.status === "active",
      ),
    [sectionsQuery.data],
  );
  const classNameById = useMemo(
    () => new Map((classesQuery.data ?? []).map((cls) => [cls.id, cls.name])),
    [classesQuery.data],
  );

  const section = useMemo(() => {
    if (preferredId) {
      const wanted = sections.find((row) => row.id === preferredId);
      if (wanted) return wanted;
    }
    return sections[0];
  }, [sections, preferredId]);

  const labelOf = (row: { classId: string; name: string }) => {
    const className = classNameById.get(row.classId) ?? null;
    return className ? `${className} · ${row.name}` : row.name;
  };
  const sectionLabel = section ? labelOf(section) : null;
  const sectionOptions = sections.map((row) => ({
    id: row.id,
    label: labelOf(row),
  }));

  return { sectionsQuery, section, sectionLabel, sectionOptions };
}
