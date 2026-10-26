import { trpc } from "../../lib/trpc";
import type { RevisionType } from "../../lib/exam-results";
import { useExamScope } from "./use-exam-data";

const THIRTY_SECONDS = 30_000;

/**
 * RESULTS + PUBLICATION (chunk 7C). The reads are photographs of the last
 * compute; the compute button and the stale banner (from the readiness read
 * the hub already pays for) are how the caller knows to re-take one. Nothing
 * here is optimistic: publication and corrections change what families see,
 * so every act shows its server answer or its server refusal.
 */

export function useClassResults(examId: string, classId: string | null, enabled = true) {
  const scope = useExamScope();
  return trpc.exam.results.table.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      id: examId,
      classId: classId ?? "",
    },
    {
      enabled: enabled && scope.ready && Boolean(scope.organizationId) && Boolean(classId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

export function usePublications(examId: string, enabled = true) {
  const scope = useExamScope();
  return trpc.exam.publication.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      id: examId,
    },
    {
      enabled: enabled && scope.ready && Boolean(scope.organizationId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

/** One student's component entries across the exam — the correction sheet's data. */
export function useStudentEntries(examId: string, studentId: string | null, enabled = true) {
  const scope = useExamScope();
  return trpc.exam.marks.studentEntries.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      id: examId,
      studentId: studentId ?? "",
    },
    {
      enabled: enabled && scope.ready && Boolean(scope.organizationId) && Boolean(studentId),
      staleTime: 10_000,
    },
  );
}

export function useCardVersions(studentId: string | null, enabled = true) {
  const scope = useExamScope();
  return trpc.exam.cards.versions.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      id: studentId ?? "",
    },
    {
      enabled: enabled && scope.ready && Boolean(scope.organizationId) && Boolean(studentId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

export function useClassCards(examId: string, classId: string | null, enabled = true) {
  const scope = useExamScope();
  return trpc.exam.cards.classSet.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      id: examId,
      classId: classId ?? "",
    },
    {
      enabled: enabled && scope.ready && Boolean(scope.organizationId) && Boolean(classId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

/**
 * The six acts. Each invalidates the photographs the acts change (results,
 * publications, readiness, the exam itself — its status flips when the last
 * class publishes — and the cards the re-issue re-photographed). Errors are
 * thrown to the caller, which owns the sheet and its inline wording.
 */
export function useResultActions(examId: string) {
  const scope = useExamScope();
  const utils = trpc.useUtils();

  const scopeArgs = {
    organizationId: scope.organizationId ?? "",
    ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
  };
  const refresh = async () => {
    await Promise.all([
      utils.exam.results.table.invalidate({ ...scopeArgs, id: examId }),
      utils.exam.publication.list.invalidate({ ...scopeArgs, id: examId }),
      utils.exam.eligibility.readiness.invalidate(),
      utils.exam.exam.byId.invalidate({ ...scopeArgs, id: examId }),
      utils.exam.cards.classSet.invalidate({ ...scopeArgs, id: examId }),
      utils.exam.marks.studentEntries.invalidate({ ...scopeArgs, id: examId }),
    ]);
  };

  const compute = trpc.exam.results.compute.useMutation({
    onSuccess: () => void refresh(),
  });
  const computeRanks = trpc.exam.results.computeTermRanks.useMutation({
    onSuccess: () => void refresh(),
  });
  const publishClass = trpc.exam.publication.publishClass.useMutation({
    onSuccess: () => void refresh(),
  });
  const publishExam = trpc.exam.publication.publishExam.useMutation({
    onSuccess: () => void refresh(),
  });
  const openWindow = trpc.exam.publication.openRevisionWindow.useMutation({
    onSuccess: () => void refresh(),
  });
  const closeWindow = trpc.exam.publication.closeRevisionWindow.useMutation({
    onSuccess: () => void refresh(),
  });

  const withScope = (id: string) => ({ ...scopeArgs, id });

  return {
    compute: (classId: string) => compute.mutateAsync({ ...scopeArgs, id: examId, classId }),
    computeRanks: (termId: string) =>
      computeRanks.mutateAsync({ ...scopeArgs, termId }),
    publishClass: (classId: string) =>
      publishClass.mutateAsync({ ...scopeArgs, id: examId, classId }),
    publishExam: () => publishExam.mutateAsync(withScope(examId)),
    openWindow: (classId: string) =>
      openWindow.mutateAsync({ ...scopeArgs, id: examId, classId }),
    closeWindow: (classId: string) =>
      closeWindow.mutateAsync({ ...scopeArgs, id: examId, classId }),
    pending:
      compute.isPending ||
      computeRanks.isPending ||
      publishClass.isPending ||
      publishExam.isPending ||
      openWindow.isPending ||
      closeWindow.isPending,
    /** The raw mutations, for the sheets that own their error wording. */
    mutations: { compute, computeRanks, publishClass, publishExam, openWindow, closeWindow },
  };
}

/** The ledger-first correction apply (hard rule 7). */
export function useCorrection(examId: string) {
  const scope = useExamScope();
  const utils = trpc.useUtils();
  const apply = trpc.exam.publication.applyRevision.useMutation({
    onSuccess: () =>
      void Promise.all([
        utils.exam.results.table.invalidate({
          organizationId: scope.organizationId ?? "",
          ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
          id: examId,
        }),
        utils.exam.cards.classSet.invalidate({
          organizationId: scope.organizationId ?? "",
          ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
          id: examId,
        }),
        utils.exam.cards.versions.invalidate(),
        utils.exam.publication.list.invalidate(),
        utils.exam.eligibility.readiness.invalidate(),
      ]),
  });
  return {
    apply: (args: {
      componentResultId: string;
      revisedMarks: string | null;
      revisedGrade: string | null;
      revisionType: RevisionType;
      reason: string;
    }) =>
      apply.mutateAsync({
        organizationId: scope.organizationId ?? "",
        ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
        id: args.componentResultId,
        revisedMarks: args.revisedMarks,
        revisedGrade: args.revisedGrade,
        revisionType: args.revisionType,
        reason: args.reason,
      }),
    pending: apply.isPending,
    error: apply.error,
    reset: () => apply.reset(),
  };
}
