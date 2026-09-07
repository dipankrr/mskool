"use client";

import { toast } from "sonner";

import type { CreateGradingScaleInput } from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * EXAM CONFIG — the setup screen's hooks (S1). Subject types, grading
 * scales, and pass criteria — everything the exam blueprint and the compute
 * engine read BEFORE any exam exists (ADR-032).
 *
 * Same shape as the fees setup hooks: permissive lists at the caller's
 * scope, school-parent mutations through `writeScopeArgs()`, toasts carrying
 * the server's wording.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useSubjectTypes() {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.subjectTypes.list.useQuery({ ...scopeArgs() }, {
    staleTime: THIRTY_SECONDS,
  });
}

export function useSubjectTypeMutations() {
  const utils = trpc.useUtils();
  const refresh = async () => {
    await utils.exam.subjectTypes.list.invalidate();
  };

  const create = trpc.exam.subjectTypes.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.types.created);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const update = trpc.exam.subjectTypes.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.types.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const deactivate = trpc.exam.subjectTypes.deactivate.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.types.retired);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const applyPreset = trpc.exam.subjectTypes.applyPreset.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.types.presetApplied);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return { create, update, deactivate, applyPreset };
}

export function useGradingScales() {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.gradingScales.list.useQuery({ ...scopeArgs() }, {
    staleTime: THIRTY_SECONDS,
  });
}

export function useGradingScaleMutations() {
  const utils = trpc.useUtils();
  const refresh = async () => {
    await utils.exam.gradingScales.list.invalidate();
  };

  const create = trpc.exam.gradingScales.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.scales.created);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const update = trpc.exam.gradingScales.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.scales.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const replaceBands = trpc.exam.gradingScales.replaceBands.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.scales.bandsReplaced);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const makeDefault = trpc.exam.gradingScales.makeDefault.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.scales.madeDefault);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return { create, update, replaceBands, makeDefault };
}

export function usePassCriteria(academicYearId: string | null) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.passCriteria.list.useQuery(
    { ...scopeArgs(), academicYearId: academicYearId ?? "" },
    { enabled: Boolean(academicYearId), staleTime: THIRTY_SECONDS },
  );
}

export function usePassCriteriaMutations(academicYearId: string | null) {
  const utils = trpc.useUtils();
  const refresh = async () => {
    await utils.exam.passCriteria.list.invalidate();
  };

  const create = trpc.exam.passCriteria.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.criteria.created);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const update = trpc.exam.passCriteria.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.criteria.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  void academicYearId;
  return { create, update };
}
