import { trpc } from "../../../lib/trpc";
import type { CriteriaPayload } from "../../../lib/pass-criteria";
import type { bandsPayload } from "../../../lib/grading-scale";
import { useExamScope } from "../use-exam-data";

/**
 * GRADING SETUP (chunk 7F) — reads and writes for the three policy lists.
 *
 * Everything here is a school-parent row: the scope carries both the
 * organization and the active branch, and the server re-checks `exam:read` /
 * `exam:create` / `exam:update` on every call. No optimistic writes — a
 * policy save is rare and the server's refusal must reach the form intact.
 *
 * Reads are enabled only when a branch is active: an org-wide list would mix
 * two campuses' scales into one policy screen. Pass criteria additionally
 * need the running session (the row is per year).
 */

const CONFIG_STALE = 60_000;

export function useGradingScope() {
  return useExamScope();
}

function useScopeArgs() {
  const scope = useExamScope();
  return {
    scope,
    scopeArgs: {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
    },
    /** A branch is the unit of grading policy. */
    ready: scope.ready && Boolean(scope.organizationId) && Boolean(scope.schoolId),
  };
}

export function useSubjectTypesAdmin() {
  const { scope, scopeArgs, ready } = useScopeArgs();
  return trpc.exam.subjectTypes.list.useQuery(scopeArgs, {
    enabled: ready && scope.canRead,
    staleTime: CONFIG_STALE,
  });
}

export function useGradingScalesAdmin() {
  const { scope, scopeArgs, ready } = useScopeArgs();
  return trpc.exam.gradingScales.list.useQuery(scopeArgs, {
    enabled: ready && scope.canRead,
    staleTime: CONFIG_STALE,
  });
}

export function usePassCriteriaAdmin() {
  const { scope, scopeArgs, ready } = useScopeArgs();
  return trpc.exam.passCriteria.list.useQuery(
    {
      ...scopeArgs,
      academicYearId: scope.academicYear?.id ?? "",
    },
    {
      enabled: ready && scope.canRead && Boolean(scope.academicYear?.id),
      staleTime: CONFIG_STALE,
    },
  );
}

/** Classes for the scope picker and for naming a class override in the list. */
export function useCriteriaClasses() {
  const { scope, scopeArgs, ready } = useScopeArgs();
  return trpc.academic.class.list.useQuery(scopeArgs, {
    enabled: ready && scope.canReadClasses,
    staleTime: 300_000,
  });
}

/** Subject names for the must-pass multi-select and the live summary. */
export function useCriteriaSubjects() {
  const { scope, scopeArgs, ready } = useScopeArgs();
  return trpc.subject.list.useQuery(scopeArgs, {
    enabled: ready && scope.canReadSubjects,
    staleTime: 300_000,
  });
}

export function useSubjectTypeActions() {
  const { scopeArgs } = useScopeArgs();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await Promise.all([
      utils.exam.subjectTypes.list.invalidate(),
      utils.assignment.subjectMapping.list.invalidate(),
      utils.exam.termGrades.list.invalidate(),
    ]);
  };

  const create = trpc.exam.subjectTypes.create.useMutation({
    onSuccess: () => void refresh(),
  });
  const update = trpc.exam.subjectTypes.update.useMutation({
    onSuccess: () => void refresh(),
  });
  const deactivate = trpc.exam.subjectTypes.deactivate.useMutation({
    onSuccess: () => void refresh(),
  });
  const applyPreset = trpc.exam.subjectTypes.applyPreset.useMutation({
    onSuccess: () => void refresh(),
  });
  const makeDefault = trpc.exam.subjectTypes.makeDefault.useMutation({
    onSuccess: () => void refresh(),
  });

  return {
    create: (data: Record<string, unknown>) =>
      create.mutateAsync({
        ...scopeArgs,
        data,
      } as Parameters<typeof create.mutateAsync>[0]),
    update: (id: string, data: Record<string, unknown>) =>
      update.mutateAsync({
        ...scopeArgs,
        id,
        data,
      } as Parameters<typeof update.mutateAsync>[0]),
    deactivate: (id: string) =>
      deactivate.mutateAsync({
        ...scopeArgs,
        id,
      }),
    applyPreset: () => applyPreset.mutateAsync(scopeArgs),
    makeDefault: (id: string) => makeDefault.mutateAsync({ ...scopeArgs, id }),
    pending:
      create.isPending ||
      update.isPending ||
      deactivate.isPending ||
      applyPreset.isPending ||
      makeDefault.isPending,
  };
}

type ScaleBands = ReturnType<typeof bandsPayload>;

export function useGradingScaleActions() {
  const { scopeArgs } = useScopeArgs();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await Promise.all([
      utils.exam.gradingScales.list.invalidate(),
      utils.exam.components.list.invalidate(),
    ]);
  };

  const create = trpc.exam.gradingScales.create.useMutation({
    onSuccess: () => void refresh(),
  });
  const update = trpc.exam.gradingScales.update.useMutation({
    onSuccess: () => void refresh(),
  });
  const replaceBands = trpc.exam.gradingScales.replaceBands.useMutation({
    onSuccess: () => void refresh(),
  });
  const makeDefault = trpc.exam.gradingScales.makeDefault.useMutation({
    onSuccess: () => void refresh(),
  });

  return {
    create: (input: {
      name: string;
      description?: string;
      isDefault: boolean;
      bands: ScaleBands;
    }) =>
      create.mutateAsync({
        ...scopeArgs,
        ...input,
      } as Parameters<typeof create.mutateAsync>[0]),
    update: (
      id: string,
      data: { name?: string; description?: string; isActive?: boolean },
    ) =>
      update.mutateAsync({
        ...scopeArgs,
        id,
        data,
      }),
    replaceBands: (id: string, bands: ScaleBands) =>
      replaceBands.mutateAsync({
        ...scopeArgs,
        id,
        bands,
      } as Parameters<typeof replaceBands.mutateAsync>[0]),
    makeDefault: (id: string) =>
      makeDefault.mutateAsync({
        ...scopeArgs,
        id,
      }),
    retire: (id: string) =>
      update.mutateAsync({
        ...scopeArgs,
        id,
        data: { isActive: false },
      }),
    pending:
      create.isPending ||
      update.isPending ||
      replaceBands.isPending ||
      makeDefault.isPending,
  };
}

export function usePassCriteriaActions() {
  const { scopeArgs } = useScopeArgs();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await Promise.all([
      utils.exam.passCriteria.list.invalidate(),
      utils.exam.eligibility.list.invalidate(),
    ]);
  };

  const create = trpc.exam.passCriteria.create.useMutation({
    onSuccess: () => void refresh(),
  });
  const update = trpc.exam.passCriteria.update.useMutation({
    onSuccess: () => void refresh(),
  });

  return {
    create: (academicYearId: string, data: CriteriaPayload) =>
      create.mutateAsync({
        ...scopeArgs,
        academicYearId,
        data,
      } as Parameters<typeof create.mutateAsync>[0]),
    update: (id: string, data: Record<string, unknown>) =>
      update.mutateAsync({
        ...scopeArgs,
        id,
        data,
      } as Parameters<typeof update.mutateAsync>[0]),
    pending: create.isPending || update.isPending,
  };
}
