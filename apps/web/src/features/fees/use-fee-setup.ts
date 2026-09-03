"use client";

import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import type { CreateFeeHeadInput, UpdateFeeHeadInput } from "@repo/contracts";

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
