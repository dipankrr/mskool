import { useMemo } from "react";

import { useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { usePermissions } from "../../hooks/use-permissions";
import { isAssignmentConstrained } from "../../lib/exams";
import type { TeachingPair } from "../../lib/exams";
import { trpc } from "../../lib/trpc";

/**
 * Who is asking, in which branch and session, and what the grants hint at.
 * Hints decide what to render; every read and write is re-checked server-side.
 *
 * Every class, section, subject and enrollment read in the exams surfaces
 * carries `schoolId` (the Step 2 retest rule: an org-addressed read shows both
 * campuses' rows).
 */
export function useExamScope() {
  const { organizationId, schoolId, academicYear, yearPending, ready } =
    useActiveContext();
  const { has } = usePermissions();
  return {
    organizationId,
    schoolId,
    academicYear,
    yearPending,
    ready,
    /** The caller can address an org + a running session. */
    addressable: ready && Boolean(organizationId) && Boolean(academicYear?.id),
    canRead: has("exam:read"),
    canUpdate: has("exam:update"),
    canEnter: has("marks:create"),
    canReadMarks: has("marks:read"),
    canVerify: has("marks:verify"),
    canReadClasses: has("class:read"),
    canReadSubjects: has("subject:read"),
    canReadSections: has("section:read"),
    canReadStaffing: has("teacher_assignment:read"),
  };
}

const THIRTY_SECONDS = 30_000;

export function useExamList() {
  const scope = useExamScope();
  return trpc.exam.exam.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      academicYearId: scope.academicYear?.id,
    },
    {
      enabled: scope.addressable && scope.canRead,
      staleTime: THIRTY_SECONDS,
    },
  );
}

export function useExamDetail(examId: string) {
  const scope = useExamScope();
  return trpc.exam.exam.byId.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      id: examId,
    },
    {
      enabled: scope.ready && scope.canRead && Boolean(scope.organizationId) && Boolean(examId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

/** Class and subject names for the papers (the schedule rows carry ids only). */
export function useClassSubjectNames() {
  const scope = useExamScope();
  const classes = trpc.academic.class.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
    },
    {
      enabled: scope.ready && Boolean(scope.organizationId) && scope.canReadClasses,
      staleTime: 300_000,
    },
  );
  const subjects = trpc.subject.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
    },
    {
      enabled: scope.ready && Boolean(scope.organizationId) && scope.canReadSubjects,
      staleTime: 300_000,
    },
  );

  const classById = useMemo(
    () => new Map((classes.data ?? []).map((row) => [row.id, row])),
    [classes.data],
  );
  const subjectById = useMemo(
    () => new Map((subjects.data ?? []).map((row) => [row.id, row])),
    [subjects.data],
  );

  return {
    classes,
    subjects,
    className: (id: string) => classById.get(id)?.name ?? null,
    classOrder: (id: string) => classById.get(id)?.numericOrder ?? 0,
    subjectName: (id: string) => subjectById.get(id)?.name ?? null,
  };
}

/** The running session's sections the caller can see (scope-clipped). */
export function useExamSections(enabled = true) {
  const scope = useExamScope();
  return trpc.academic.section.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      academicYearId: scope.academicYear?.id ?? "",
    },
    {
      enabled: enabled && scope.addressable && scope.canReadSections,
      staleTime: 60_000,
    },
  );
}

/**
 * The caller's own (section, subject) teaching pairs, for papers of the given
 * classes — or `null` when the caller is not constrained by assignments (a
 * class teacher, principal or admin passes the subject gate on scope, so every
 * paper in their scope is theirs to enter).
 *
 * For a pure subject teacher the pairs are read from the visible sections'
 * staffing rows, matched on the signed-in user (the list returns the whole
 * section's staffing). `pending` stays true until every read settles, so the
 * hub never flashes "not your paper" before the answer arrives. This is a UI
 * hint: the paper screen re-asks the server (`canEnter`).
 */
export function useMyPairs(classIds: readonly string[]): {
  pairs: readonly TeachingPair[] | null;
  pending: boolean;
} {
  const scope = useExamScope();
  const { me } = useMe();
  const membership = me?.memberships.find(
    (row) => row.organization.id === scope.organizationId,
  );
  const constrained = isAssignmentConstrained(membership?.roleTypes ?? []);
  const sections = useExamSections(constrained);

  const classSet = new Set(classIds);
  const relevant = (sections.data ?? []).filter((row) =>
    classSet.has(row.classId),
  );

  const staffing = trpc.useQueries((t) =>
    relevant.map((section) =>
      t.assignment.teacherAssignment.list(
        { organizationId: scope.organizationId ?? "", sectionId: section.id },
        {
          enabled: constrained && scope.canReadStaffing && scope.ready,
          staleTime: 60_000,
        },
      ),
    ),
  );

  // Not constrained, or not allowed to read the staffing that would prove it:
  // say nothing ("unknown") rather than label every paper "not yours".
  if (!constrained || !scope.canReadSections || !scope.canReadStaffing) {
    return { pairs: null, pending: false };
  }

  const userId = me?.user.id;
  const pairs: TeachingPair[] = [];
  relevant.forEach((section, index) => {
    for (const row of staffing[index]?.data ?? []) {
      if (
        row.userId === userId &&
        row.role === "subject_teacher" &&
        row.subjectId
      ) {
        pairs.push({
          sectionId: section.id,
          classId: section.classId,
          subjectId: row.subjectId,
        });
      }
    }
  });

  const pending =
    sections.isPending || staffing.some((query) => query.isPending);
  return { pairs, pending };
}
