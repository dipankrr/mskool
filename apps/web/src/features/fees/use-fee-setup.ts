"use client";

import { toast } from "sonner";

import type {
  CreateFeeHeadInput,
  CreateFeeStructureInput,
  CreateFeeStructureLineInput,
  CreateLateFeeRuleInput,
  UpdateFeeHeadInput,
  UpdateFeeStructureInput,
  UpdateFeeStructureLineInput,
} from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * FEE SETUP — the configuration tab's hooks (heads here; structures,
 * lines, late-fee rules and subscriptions extend this file in UI3/UI5).
 *
 * Split from the one-hook-file-per-feature pattern deliberately: the fees
 * router has eight namespaces and ~30 procedures; one file would be the
 * largest in the app on day one. Setup owns everything a school configures
 * BEFORE any student is billed.
 *
 * Every fees mutation requires `schoolId` (the router's `schoolParent`
 * envelope) — so creates go through `writeScopeArgs()` and honor its null
 * case ("choose a branch first"), while row-addressed calls pass
 * `{ ...scopeArgs(), schoolId: …, id }`. The schoolId for a row action is
 * the ROW's own (from the list), not the switcher's guess.
 */

const THIRTY_SECONDS = 30 * 1000;

/** Active heads at the caller's scope. The list is permissive (ADR-017). */
export function useFeeHeads() {
  const { scopeArgs } = useActiveContext();

  return trpc.fees.head.list.useQuery(scopeArgs(), {
    staleTime: THIRTY_SECONDS,
  });
}

export function useFeeHeadMutations() {
  const { scopeArgs, writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refreshHeads = async () => {
    await utils.fees.head.list.invalidate();
  };

  const create = trpc.fees.head.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.heads.created);
      await refreshHeads();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = trpc.fees.head.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.heads.updated);
      await refreshHeads();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deactivate = trpc.fees.head.deactivate.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.heads.retired);
      await refreshHeads();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    create: {
      ...create,
      /** mutateAsync, so the dialog closes on success only (the U-series lesson). */
      submit: (data: CreateFeeHeadInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error(copy.errors.needsBranch);
        return create.mutateAsync({ ...scope, data });
      },
      canSubmit: Boolean(writeScopeArgs()),
    },
    update: {
      ...update,
      submit: (schoolId: string, id: string, data: UpdateFeeHeadInput) =>
        update.mutateAsync({ ...scopeArgs(), schoolId, id, data }),
    },
    deactivate: {
      ...deactivate,
      submit: (schoolId: string, id: string) =>
        deactivate.mutateAsync({ ...scopeArgs(), schoolId, id }),
    },
  };
}

/**
 * A year's fee structures. `includeHistory` is REQUIRED by the contract
 * (ADR-024's year edge) — false pins to the session in the switcher; the
 * year select decides which year the caller is asking about, and history
 * holders reach closed years with true.
 */
export function useFeeStructures(academicYearId: string | undefined, includeHistory: boolean) {
  const { scopeArgs } = useActiveContext();

  return trpc.fees.structure.list.useQuery(
    { ...scopeArgs(), academicYearId: academicYearId ?? "", includeHistory },
    {
      enabled: Boolean(academicYearId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

/** One structure's lines (the per-head pricing). */
export function useFeeStructureLines(schoolId: string | undefined, structureId: string | undefined) {
  const { scopeArgs } = useActiveContext();

  return trpc.fees.structure.listLines.useQuery(
    { ...scopeArgs(), schoolId: schoolId ?? "", id: structureId ?? "" },
    {
      enabled: Boolean(schoolId && structureId),
      staleTime: THIRTY_SECONDS,
      retry: false,
    },
  );
}

/** The school's active late-fee rules (school-wide list, structure link shown per row). */
export function useLateFeeRules() {
  const { scopeArgs } = useActiveContext();

  return trpc.fees.structure.listLateFeeRules.useQuery(scopeArgs(), {
    staleTime: THIRTY_SECONDS,
  });
}

export function useFeeStructureMutations() {
  const { scopeArgs, writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refreshStructures = async () => {
    await Promise.all([
      utils.fees.structure.list.invalidate(),
      utils.fees.structure.listLines.invalidate(),
      utils.fees.structure.listLateFeeRules.invalidate(),
    ]);
  };

  const create = trpc.fees.structure.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.structures.created);
      await refreshStructures();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = trpc.fees.structure.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.structures.updated);
      await refreshStructures();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deactivate = trpc.fees.structure.deactivate.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.structures.closed);
      await refreshStructures();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const addLine = trpc.fees.structure.addLine.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.structures.lineCreated);
      await refreshStructures();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateLine = trpc.fees.structure.updateLine.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.structures.lineUpdated);
      await refreshStructures();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const addLateFeeRule = trpc.fees.structure.addLateFeeRule.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.structures.lateFeeCreated);
      await refreshStructures();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    create: {
      ...create,
      submit: (data: CreateFeeStructureInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error(copy.errors.needsBranch);
        return create.mutateAsync({ ...scope, data });
      },
      canSubmit: Boolean(writeScopeArgs()),
    },
    update: {
      ...update,
      submit: (schoolId: string, id: string, data: UpdateFeeStructureInput) =>
        update.mutateAsync({ ...scopeArgs(), schoolId, id, data }),
    },
    deactivate: {
      ...deactivate,
      submit: (schoolId: string, id: string) =>
        deactivate.mutateAsync({ ...scopeArgs(), schoolId, id }),
    },
    addLine: {
      ...addLine,
      submit: (schoolId: string, structureId: string, data: CreateFeeStructureLineInput) =>
        addLine.mutateAsync({ ...scopeArgs(), schoolId, id: structureId, data }),
    },
    updateLine: {
      ...updateLine,
      submit: (schoolId: string, lineId: string, data: UpdateFeeStructureLineInput) =>
        updateLine.mutateAsync({ ...scopeArgs(), schoolId, id: lineId, data }),
    },
    addLateFeeRule: {
      ...addLateFeeRule,
      submit: (data: CreateLateFeeRuleInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error(copy.errors.needsBranch);
        return addLateFeeRule.mutateAsync({ ...scope, data });
      },
      canSubmit: Boolean(writeScopeArgs()),
    },
  };
}
