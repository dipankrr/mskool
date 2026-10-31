import { useMemo } from "react";

import { fullName, sortRosterByRoll } from "../../lib/exams";
import { trpc } from "../../lib/trpc";
import { toIsoVerbatim } from "../../lib/exam-draft";
import type { ServerTermGrade } from "../../lib/term-grade-draft";
import { useClassSubjectNames, useExamScope, useExamSections } from "./use-exam-data";
import { useExamTerms } from "./use-setup";

export type TermGradeSubject = {
  mappingId: string;
  subjectId: string;
};

/** The enrollment statuses `saveTermAssessment` accepts (mirrored, not invented). */
const SAVEABLE_ENROLLMENT_STATUS = new Set([
  "active",
  "admitted",
  "section_assigned",
]);

export type TermGradeStudent = {
  studentId: string;
  rollNumber: string | null;
  firstName: string;
  lastName: string;
  /** Pre-joined for the row and the save-lived sheet. */
  name: string;
};

/** The session's terms in report-card order (the anchor of the screen). */
export function useTermGradeTerms() {
  return useExamTerms();
}

/** The class's term-grade areas: mappings whose SUBJECT TYPE is "Term grade". */
export function useTermGradeSubjects(classId: string | null) {
  const scope = useExamScope();
  const names = useClassSubjectNames();
  const mappings = trpc.assignment.subjectMapping.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      academicYearId: scope.academicYear?.id ?? "",
      classId: classId ?? "",
    },
    {
      enabled: scope.addressable && Boolean(classId),
      staleTime: 60_000,
    },
  );
  const types = trpc.exam.subjectTypes.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
    },
    {
      enabled: scope.ready && scope.canRead && Boolean(scope.organizationId),
      staleTime: 300_000,
    },
  );

  const rows = useMemo<TermGradeSubject[]>(() => {
    const termGradeTypes = new Set(
      (types.data ?? [])
        .filter((type) => type.assessmentMode === "term_grade")
        .map((type) => type.id),
    );
    const seen = new Set<string>();
    const list: TermGradeSubject[] = [];
    for (const mapping of mappings.data ?? []) {
      if (!mapping.subjectTypeId || !termGradeTypes.has(mapping.subjectTypeId)) {
        continue;
      }
      if (seen.has(mapping.subjectId)) continue;
      seen.add(mapping.subjectId);
      list.push({ mappingId: mapping.id, subjectId: mapping.subjectId });
    }
    return list;
  }, [mappings.data, types.data]);

  return {
    rows,
    pending: mappings.isPending || types.isPending,
    isError: mappings.isError || types.isError,
    error: mappings.error ?? types.error ?? null,
    refetch: () => {
      void mappings.refetch();
      void types.refetch();
    },
    subjectName: names.subjectName,
  };
}

/** The class's sections (scope-clipped), in the session being viewed. */
export function useTermGradeSections(classId: string | null) {
  const sections = useExamSections();
  const rows = useMemo(
    () => (sections.data ?? []).filter((row) => row.classId === classId),
    [sections.data, classId],
  );
  return {
    rows,
    pending: sections.isPending,
    isError: sections.isError,
    error: sections.error ?? null,
    refetch: sections.refetch,
  };
}

/** The section's enrollments in register (roll) order. */
export function useTermGradeRoster(sectionId: string | null) {
  const scope = useExamScope();
  const query = trpc.enrollment.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      academicYearId: scope.academicYear?.id ?? "",
      ...(sectionId ? { sectionId } : {}),
    },
    {
      enabled: scope.addressable && Boolean(sectionId),
      staleTime: 60_000,
    },
  );

  const rows = useMemo<TermGradeStudent[]>(() => {
    const mapped = (query.data ?? [])
      // The save accepts a grade only for an enrollment the term still counts
      // (the same three statuses `saveTermAssessment` checks). A former
      // student left on the enrollment row must not appear as a row that can
      // never save.
      .filter((row) =>
        SAVEABLE_ENROLLMENT_STATUS.has(row.enrollment.enrollmentStatus),
      )
      .filter((row) => !sectionId || row.enrollment.sectionId === sectionId)
      .map((row) => ({
        studentId: row.student.id,
        rollNumber: row.enrollment.rollNumber,
        firstName: row.student.firstName,
        lastName: row.student.lastName,
        name: fullName(row.student),
      }));
    return sortRosterByRoll(mapped);
  }, [query.data, sectionId]);

  return {
    rows,
    pending: query.isPending,
    isSuccess: query.isSuccess,
    isRefetching: query.isRefetching,
    isError: query.isError,
    error: query.error ?? null,
    refetch: query.refetch,
  };
}

/**
 * One term's saved rows, filtered to the active mapping and shaped for the
 * draft store. The list endpoint returns the whole school's rows for the term
 * (gap 35); the screen pays that once per subject switch, not per row.
 */
export function useTermGradeEntries(termId: string | null, mappingId: string | null) {
  const scope = useExamScope();
  const query = trpc.exam.termGrades.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      termId: termId ?? "",
    },
    {
      enabled: Boolean(termId) && scope.ready && scope.canRead && Boolean(scope.organizationId),
      // A stale read is how a refetch hides a colleague's correction: always
      // re-read, and re-read again when the app returns to the foreground.
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: true,
      placeholderData: (previous) => previous,
    },
  );

  const rows = useMemo<ServerTermGrade[]>(
    () =>
      (query.data ?? [])
        .filter((row) => row.mappingId === mappingId)
        .map((row) => ({
          studentId: row.studentId,
          rowId: row.id,
          grade: row.grade,
          remarks: row.teacherRemarks,
          updatedAt: toIsoVerbatim(row.updatedAt),
        })),
    [query.data, mappingId],
  );

  return {
    rows,
    isSuccess: query.isSuccess,
    isError: query.isError,
    error: query.error ?? null,
    isFetching: query.isFetching,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}
