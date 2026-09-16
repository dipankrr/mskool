"use client";

import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * RESULTS + PUBLICATION (S4) — the league table read, the publication
 * records, and the compute/correction acts. Reads are photographs of the
 * last compute; the compute button and the stale badge (from readiness)
 * are how the user knows to re-take it.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useClassResults(examId: string | undefined, classId: string | undefined) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.results.table.useQuery(
    { ...scopeArgs(), id: examId ?? "", classId: classId ?? "" },
    { enabled: Boolean(examId && classId), staleTime: THIRTY_SECONDS },
  );
}

export function usePublications(examId: string | undefined) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.publication.list.useQuery(
    { ...scopeArgs(), id: examId ?? "" },
    { enabled: Boolean(examId), staleTime: THIRTY_SECONDS },
  );
}

export function useStudentEntries(examId: string, studentId: string | undefined) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.marks.studentEntries.useQuery(
    { ...scopeArgs(), id: examId, studentId: studentId ?? "" },
    { enabled: Boolean(studentId) },
  );
}

export function useCardVersions(studentId: string | undefined) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.cards.versions.useQuery(
    { ...scopeArgs(), id: studentId ?? "" },
    { enabled: Boolean(studentId) },
  );
}

export function useResultActions(examId: string, classId: string | null) {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  const refresh = async () => {
    await utils.exam.results.table.invalidate({ ...scopeArgs(), id: examId });
    await utils.exam.publication.list.invalidate({ ...scopeArgs(), id: examId });
    await utils.exam.eligibility.readiness.invalidate();
    await utils.exam.exam.byId.invalidate();
    if (classId) await utils.exam.exam.byId.invalidate();
  };

  const compute = trpc.exam.results.compute.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.results.computed);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const computeRanks = trpc.exam.results.computeTermRanks.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.results.ranksComputed);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const applyRevision = trpc.exam.publication.applyRevision.useMutation({
    onSuccess: async (data) => {
      toast.success(copy.exams.results.correctionApplied);
      await refresh();
      void data;
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return { compute, computeRanks, applyRevision };
}
