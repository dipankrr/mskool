"use client";

import { toast } from "sonner";

import type {
  CreateExamInput,
  SaveExamComponentsInput,
  SaveExamSchedulesInput,
} from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * EXAM WORKFLOW — the S2 hooks: the hub list, the blueprint editors, the
 * lifecycle transitions, and per-class publication. Every mutation toasts
 * the server's wording; the lifecycle's precondition errors are the UI's
 * inline guidance.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useExams(academicYearId: string | null) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.exam.list.useQuery(
    { ...scopeArgs(), academicYearId: academicYearId ?? undefined },
    { enabled: Boolean(academicYearId), staleTime: THIRTY_SECONDS },
  );
}

/** The active year's terms — the exam dialog's term picker. */
export function useTerms(academicYearId: string | null) {
  const { scopeArgs } = useActiveContext();
  return trpc.academic.term.list.useQuery(
    { ...scopeArgs(), academicYearId: academicYearId ?? "" },
    { enabled: Boolean(academicYearId), staleTime: THIRTY_SECONDS },
  );
}

export function useExamDetail(examId: string | undefined) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.exam.byId.useQuery(
    { ...scopeArgs(), id: examId ?? "" },
    { enabled: Boolean(examId) },
  );
}

export function useExamWorkflowMutations() {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  const refreshExam = async (examId: string) => {
    await utils.exam.exam.byId.invalidate({ ...scopeArgs(), id: examId });
    await utils.exam.exam.list.invalidate();
  };

  const create = trpc.exam.exam.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.workflow.created);
      await utils.exam.exam.list.invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const update = trpc.exam.exam.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.workflow.updated);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const transition = trpc.exam.exam.transition.useMutation({
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveSchedules = trpc.exam.schedules.save.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success(copy.exams.workflow.schedulesSaved);
      await refreshExam(variables.examId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveComponents = trpc.exam.components.save.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success(copy.exams.workflow.componentsSaved);
      await utils.exam.components.list.invalidate({ scheduleId: variables.scheduleId });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const readiness = trpc.exam.eligibility.recompute.useMutation({
    onError: (error) => toast.error(errorMessage(error)),
  });

  return { create, update, transition, saveSchedules, saveComponents, readiness, refreshExam };
}

export type { SaveExamComponentsInput, SaveExamSchedulesInput };
