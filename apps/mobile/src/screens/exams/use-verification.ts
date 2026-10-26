import { useMemo } from "react";

import { trpc } from "../../lib/trpc";
import { useExamScope } from "./use-exam-data";

/**
 * The two review writes and the base they share. `marks.verify` and
 * `marks.unverify` take the same input: the rows, plus the (section, subject)
 * pair the server binds every row to. They are not subject-gated; the caller's
 * scope must cover the stated section, which is why `sectionId` rides along.
 */
export function useVerifyMutations() {
  const scope = useExamScope();
  const verify = trpc.exam.marks.verify.useMutation();
  const unverify = trpc.exam.marks.unverify.useMutation();

  const input = (args: {
    rowIds: string[];
    sectionId: string;
    subjectId: string;
  }) => ({
    organizationId: scope.organizationId ?? "",
    ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
    componentResultIds: args.rowIds,
    sectionId: args.sectionId,
    subjectId: args.subjectId,
  });

  return {
    verify: (args: Parameters<typeof input>[0]) => verify.mutateAsync(input(args)),
    unverify: (args: Parameters<typeof input>[0]) =>
      unverify.mutateAsync(input(args)),
  };
}

/**
 * Which section each student of a class sits in, from ONE read of the class's
 * enrollments. A class-wide paper's roster does not say (the entry grid has no
 * section per student), and the verify batch rule is per section, so a reviewer
 * of a multi-section paper needs this to know whom a batch may contain.
 *
 * Disabled (and `null`) unless asked for: only a class-wide paper being
 * reviewed needs it.
 */
export function useSectionByStudent(
  classId: string | null,
  enabled: boolean,
): {
  sectionByStudent: ReadonlyMap<string, string | null> | null;
  pending: boolean;
  error: unknown;
  refetch: () => void;
} {
  const scope = useExamScope();
  const willRun = enabled && scope.addressable && Boolean(classId);
  const query = trpc.enrollment.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      academicYearId: scope.academicYear?.id ?? "",
      classId: classId ?? undefined,
    },
    {
      enabled: willRun,
      staleTime: 60_000,
    },
  );

  const sectionByStudent = useMemo(() => {
    if (!query.data) return null;
    return new Map<string, string | null>(
      query.data.map((row) => [row.student.id, row.enrollment.sectionId]),
    );
  }, [query.data]);

  return {
    sectionByStudent,
    pending: willRun && query.isPending,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
