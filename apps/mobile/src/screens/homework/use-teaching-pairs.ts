import { useMemo } from "react";

import { useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { usePermissions } from "../../hooks/use-permissions";
import { trpc } from "../../lib/trpc";

export type PairSection = {
  id: string;
  /** "Class 5 · A" — what a teacher calls the pair, not the raw section row. */
  label: string;
  sectionName: string;
  classId: string;
  className: string;
};

export type PairSubject = {
  id: string;
  name: string;
  shortName: string | null;
};

/**
 * The create form's "where it goes" data: the sections this caller may target
 * and, for the chosen one, the subjects they may give homework in.
 *
 * Three reads, each on the permission the server itself requires:
 *
 * - `academic.section.list` + `academic.class.list` → the picker's section
 *   directory, scope-clipped to the caller's teaching grants.
 * - `assignment.subjectMapping.list` → the class's mapped subjects. The
 *   mapping is per class, not per section, which is why the section row
 *   carries its `classId`.
 * - `assignment.teacherAssignment.list` → the caller's own subject rows for
 *   the chosen section, used only when the caller's role hints are a
 *   subject-teacher one. A class teacher (or an admin) passes the server's
 *   subject gate on scope, so filtering their subjects by their own staffing
 *   rows would hide subjects they can in fact assign. Rows are matched on
 *   `userId`, because the list itself returns the section's whole staffing.
 *
 * Filtering is a UI hint, not authorization: the server re-checks the
 * (section, subject) pair on every create, exactly as ADR-029 requires.
 */
export function useTeachingPairs({
  enabled,
  sectionId,
}: {
  enabled: boolean;
  sectionId: string | null;
}) {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();
  const { me } = useMe();

  const canReadSections = has("section:read");
  const canReadClasses = has("class:read");
  const canReadMappings = has("subject_mapping:read");
  const canReadStaffing = has("teacher_assignment:read");

  const orgReady = ready && Boolean(organizationId) && Boolean(academicYear?.id);

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: enabled && orgReady && canReadClasses },
  );

  const sections = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
    },
    { enabled: enabled && orgReady && canReadSections },
  );

  const sectionOptions = useMemo<PairSection[]>(() => {
    const classNames = new Map(
      (classes.data ?? []).map((row) => [row.id, row.name]),
    );
    const order = new Map(
      (classes.data ?? []).map((row) => [row.id, row.numericOrder]),
    );
    return (sections.data ?? [])
      .map((row) => {
        const className = classNames.get(row.classId) ?? "";
        return {
          id: row.id,
          sectionName: row.name,
          classId: row.classId,
          className,
          label: className ? `${className} · ${row.name}` : row.name,
        };
      })
      .sort(
        (a, b) =>
          (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0) ||
          a.sectionName.localeCompare(b.sectionName),
      );
  }, [sections.data, classes.data]);

  const section = sectionOptions.find((row) => row.id === sectionId) ?? null;
  const classId = section?.classId ?? null;

  const mappings = trpc.assignment.subjectMapping.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      classId: classId ?? "",
    },
    { enabled: enabled && orgReady && canReadMappings && Boolean(classId) },
  );

  const membership = me?.memberships.find(
    (row) => row.organization.id === organizationId,
  );
  const roles = membership?.roleTypes ?? [];
  // Only a pure subject-teacher caller is gated by the (section, subject)
  // pair; a class teacher or admin passes on scope.
  const needsOwnStaffing =
    enabled &&
    Boolean(sectionId) &&
    roles.includes("subject_teacher") &&
    !roles.some((role) =>
      ["principal", "vice_principal", "class_teacher", "staff_coordinator"].includes(
        role,
      ),
    );

  const staffing = trpc.assignment.teacherAssignment.list.useQuery(
    { organizationId: organizationId ?? "", sectionId: sectionId ?? "" },
    {
      enabled:
        needsOwnStaffing && orgReady && canReadStaffing && Boolean(sectionId),
    },
  );

  const meId = me?.user.id;

  const ownSubjectIds = useMemo(() => {
    if (!needsOwnStaffing) return null;
    // Do not filter while the staffing read is in flight: an empty set would
    // flash "no subjects" before the rows arrive.
    if (staffing.isPending) return null;
    const ids = new Set<string>();
    for (const row of staffing.data ?? []) {
      if (
        row.userId === meId &&
        row.role === "subject_teacher" &&
        row.subjectId
      ) {
        ids.add(row.subjectId);
      }
    }
    // Empty (not null) is a real answer for a pure subject teacher with no
    // staffing row in this section: show the honest "no subjects" state and
    // let the server refuse anything else.
    return ids;
  }, [needsOwnStaffing, staffing.isPending, staffing.data, meId]);

  const subjectsRead = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: enabled && orgReady && has("subject:read") },
  );

  const subjects = useMemo<PairSubject[]>(() => {
    const byId = new Map(
      (subjectsRead.data ?? []).map((row) => [row.id, row]),
    );
    const rows: PairSubject[] = [];
    for (const mapping of mappings.data ?? []) {
      const subject = byId.get(mapping.subjectId);
      if (!subject) continue;
      if (ownSubjectIds && !ownSubjectIds.has(subject.id)) continue;
      rows.push({
        id: subject.id,
        name: subject.name,
        shortName: subject.shortName,
      });
    }
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }, [mappings.data, subjectsRead.data, ownSubjectIds]);

  const subjectNames = useMemo(
    () => new Map((subjectsRead.data ?? []).map((row) => [row.id, row.name])),
    [subjectsRead.data],
  );

  return {
    orgReady,
    sectionOptions,
    sectionsQuery: sections,
    classesQuery: classes,
    subjects,
    subjectsQuery: mappings,
    /** A label for a fixed pair even when the picker list filters it out. */
    subjectNameOf: (id: string | null) =>
      id ? (subjectNames.get(id) ?? null) : null,
    subjectsPending:
      Boolean(classId) &&
      (mappings.isPending || subjectsRead.isPending || staffing.isPending),
    subjectsError: mappings.error ?? subjectsRead.error ?? staffing.error ?? null,
    refetchSections: () => {
      void sections.refetch();
      void classes.refetch();
    },
    refetchSubjects: () => {
      void mappings.refetch();
      void subjectsRead.refetch();
    },
  };
}
