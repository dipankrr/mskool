import { trpc } from "../../lib/trpc";
import { useExamScope } from "./use-exam-data";

const THIRTY_SECONDS = 30_000;

/**
 * EXAM BLUEPRINT reads and writes (chunk 7D). The form's reads (terms,
 * subject types, one class's mappings) and the six acts — create, update,
 * the papers batch, the parts replace, the eligibility recompute and the
 * per-student override. Nothing optimistic: a blueprint save changes what
 * every future result is measured against, so the sheet holds until the
 * server answers and prints its refusals inline.
 */

export function useExamTerms() {
  const scope = useExamScope();
  return trpc.academic.term.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      academicYearId: scope.academicYear?.id ?? "",
    },
    {
      enabled: scope.addressable,
      staleTime: 300_000,
    },
  );
}

export function useSubjectTypes() {
  const scope = useExamScope();
  return trpc.exam.subjectTypes.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
    },
    {
      enabled: scope.ready && scope.canRead && Boolean(scope.organizationId),
      staleTime: 300_000,
    },
  );
}

/** One class's subject mappings — the "Add class" paper generator's input. */
export function useClassMappings(classId: string | null, enabled: boolean) {
  const scope = useExamScope();
  return trpc.assignment.subjectMapping.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      academicYearId: scope.academicYear?.id ?? "",
      classId: classId ?? "",
    },
    {
      enabled: enabled && scope.addressable && Boolean(classId),
      staleTime: 60_000,
    },
  );
}

/** The exams a supplementary/improvement paper can redeem. */
export function useLinkedExamOptions(excludeExamId: string | null) {
  const scope = useExamScope();
  const list = trpc.exam.exam.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      academicYearId: scope.academicYear?.id,
    },
    { enabled: scope.addressable, staleTime: THIRTY_SECONDS },
  );
  const rows = (list.data ?? []).filter((row) => row.id !== excludeExamId);
  return { rows, pending: list.isPending };
}

export function useExamFormActions(examId: string | null) {
  const scope = useExamScope();
  const utils = trpc.useUtils();
  const scopeArgs = {
    organizationId: scope.organizationId ?? "",
    ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
  };
  const refresh = async () => {
    await Promise.all([
      utils.exam.exam.list.invalidate(),
      utils.exam.exam.byId.invalidate({ ...scopeArgs, id: examId ?? "" }),
    ]);
  };
  const create = trpc.exam.exam.create.useMutation({
    onSuccess: () => void refresh(),
  });
  const update = trpc.exam.exam.update.useMutation({
    onSuccess: () => void refresh(),
  });
  return {
    create: (data: Record<string, unknown>) =>
      create.mutateAsync({
        ...scopeArgs,
        data,
      } as Parameters<typeof create.mutateAsync>[0]),
    update: (data: Record<string, unknown>) =>
      update.mutateAsync({
        ...scopeArgs,
        ...(examId ? { id: examId } : {}),
        data,
      } as Parameters<typeof update.mutateAsync>[0]),
    pending: create.isPending || update.isPending,
  };
}

export function useSetupActions(examId: string) {
  const scope = useExamScope();
  const utils = trpc.useUtils();
  const scopeArgs = {
    organizationId: scope.organizationId ?? "",
    ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
  };
  const refresh = async () => {
    await Promise.all([
      utils.exam.schedules.list.invalidate(),
      utils.exam.exam.byId.invalidate({ ...scopeArgs, id: examId }),
      utils.exam.components.list.invalidate(),
    ]);
  };
  const saveSchedules = trpc.exam.schedules.save.useMutation({
    onSuccess: () => void refresh(),
  });
  const saveComponents = trpc.exam.components.save.useMutation({
    onSuccess: () => void refresh(),
  });
  return {
    saveSchedules: (args: {
      schedules: readonly Record<string, unknown>[];
      removeClassIds?: string[];
    }) =>
      saveSchedules.mutateAsync({
        ...scopeArgs,
        id: examId,
        schedules: args.schedules as never,
        ...(args.removeClassIds?.length ? { removeClassIds: args.removeClassIds } : {}),
      }),
    saveComponents: (args: {
      scheduleId: string;
      components: readonly Record<string, unknown>[];
    }) =>
      saveComponents.mutateAsync({
        ...scopeArgs,
        id: args.scheduleId,
        components: args.components as never,
      }),
    schedulesPending: saveSchedules.isPending,
    componentsPending: saveComponents.isPending,
  };
}

export function useEligibilityActions(examId: string) {
  const scope = useExamScope();
  const utils = trpc.useUtils();
  const scopeArgs = {
    organizationId: scope.organizationId ?? "",
    ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
  };
  const refresh = () =>
    utils.exam.eligibility.list.invalidate({ ...scopeArgs, examId });
  const recompute = trpc.exam.eligibility.recompute.useMutation({
    onSuccess: () => void refresh(),
  });
  const override = trpc.exam.eligibility.override.useMutation({
    onSuccess: () => void refresh(),
  });
  return {
    recompute: () => recompute.mutateAsync({ ...scopeArgs, id: examId }),
    override: (args: {
      studentId: string;
      overrideEligible: boolean;
      reason: string;
    }) =>
      override.mutateAsync({
        ...scopeArgs,
        examId,
        studentId: args.studentId,
        overrideEligible: args.overrideEligible,
        reason: args.reason,
      }),
    pending: recompute.isPending || override.isPending,
  };
}
