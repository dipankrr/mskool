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
    onSuccess: async (_data, variables) => {
      toast.success(copy.exams.workflow.transitioned);
      await refreshExam(variables.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveSchedules = trpc.exam.schedules.save.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success(copy.exams.workflow.schedulesSaved);
      await refreshExam(variables.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveComponents = trpc.exam.components.save.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success(copy.exams.workflow.componentsSaved);
      // The detail page reads components nested under byId — both keys.
      await utils.exam.exam.byId.invalidate();
      await utils.exam.components.list.invalidate({ id: variables.id });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const readiness = trpc.exam.eligibility.recompute.useMutation({
    onError: (error) => toast.error(errorMessage(error)),
  });

  return { create, update, transition, saveSchedules, saveComponents, readiness, refreshExam };
}

export function useSchedules(examId: string | undefined) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.schedules.list.useQuery(
    { ...scopeArgs(), examId: examId ?? "" },
    { enabled: Boolean(examId) },
  );
}

export function useComponents(scheduleId: string | undefined) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.components.list.useQuery(
    { ...scopeArgs(), id: scheduleId ?? "" },
    { enabled: Boolean(scheduleId) },
  );
}

export function useReadiness(examId: string | undefined, classId: string | undefined) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.eligibility.readiness.useQuery(
    { ...scopeArgs(), id: examId ?? "", classId: classId ?? "" },
    { enabled: Boolean(examId) && Boolean(classId) },
  );
}

export function useEligibility(examId: string | undefined) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.eligibility.list.useQuery(
    { ...scopeArgs(), examId: examId ?? "" },
    { enabled: Boolean(examId) },
  );
}

export function useEligibilityActions(examId: string) {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  const refresh = async () => {
    await utils.exam.eligibility.list.invalidate({ ...scopeArgs(), examId });
    await utils.exam.exam.byId.invalidate();
  };

  const recompute = trpc.exam.eligibility.recompute.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.workflow.eligibilityRecomputed);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const override = trpc.exam.eligibility.override.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.workflow.studentAllowed);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return { recompute, override };
}

export function usePublicationActions(examId: string) {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  const refreshAll = async () => {
    await utils.exam.exam.byId.invalidate({ ...scopeArgs(), id: examId });
    await utils.exam.exam.list.invalidate();
    await utils.exam.eligibility.readiness.invalidate({ ...scopeArgs(), id: examId, classId: "" });
  };

  const publishClass = trpc.exam.publication.publishClass.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.workflow.classPublished);
      await refreshAll();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const publishExam = trpc.exam.publication.publishExam.useMutation({
    onSuccess: async (data) => {
      if (data.failedClassIds.length > 0) {
        toast.error(
          copy.exams.workflow.examPublishedPartial(
            data.publishedClasses,
            data.failedClassIds.length,
          ),
        );
      } else {
        toast.success(copy.exams.workflow.examPublished(data.publishedClasses));
      }
      await refreshAll();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const openWindow = trpc.exam.publication.openRevisionWindow.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.workflow.windowOpened);
      await refreshAll();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const closeWindow = trpc.exam.publication.closeRevisionWindow.useMutation({
    onSuccess: async (data) => {
      toast.success(copy.exams.workflow.windowClosed(data?.reIssued ?? 0));
      await refreshAll();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return { publishClass, publishExam, openWindow, closeWindow };
}

export type { SaveExamComponentsInput, SaveExamSchedulesInput };
