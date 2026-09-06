"use client";

import { toast } from "sonner";

import type { CreateTermInput, UpdateTermInput } from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * TERMS — the subdivisions of a session (ADR-022). The exam chain, the
 * attendance summaries, and fee installments all hang off them, so the
 * sessions screen shows each year's terms beside the year — the exam
 * dialog's term picker and the report card's grouping both read this data.
 *
 * The create endpoint names the parent in its OWN input (`schoolId` + data
 * — B5's shape: omitting it is a compile error, not a runtime 500), so the
 * branch must be chosen; the update is id-addressed with the scope
 * envelope spread.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useTerms(academicYearId: string | null) {
  const { scopeArgs } = useActiveContext();
  return trpc.academic.term.list.useQuery(
    { ...scopeArgs(), academicYearId: academicYearId ?? "" },
    { enabled: Boolean(academicYearId), staleTime: THIRTY_SECONDS },
  );
}

export function useTermMutations() {
  const utils = trpc.useUtils();
  const { scopeArgs, writeScopeArgs } = useActiveContext();

  const refresh = async () => {
    await utils.academic.term.list.invalidate();
  };

  const create = trpc.academic.term.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.sessions.termCreated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = trpc.academic.term.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.sessions.termUpdated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    create: {
      ...create,
      /** Needs a branch named (the endpoint's schoolId envelope). */
      submit: (data: CreateTermInput) => {
        const scope = writeScopeArgs();
        if (!scope) return Promise.reject(new Error(copy.errors.needsBranch));
        return create.mutateAsync({ ...scope, data });
      },
    },
    update: {
      ...update,
      submit: (id: string, data: UpdateTermInput) =>
        update.mutateAsync({ ...scopeArgs(), id, data }),
    },
  };
}
