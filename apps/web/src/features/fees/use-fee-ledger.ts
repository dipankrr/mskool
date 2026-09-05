"use client";

import { toast } from "sonner";

import type { CreateOpeningBalanceInput } from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * LEDGER + OPENING BALANCES — the append-only money history (read) and
 * the carry-forward (write). The ledger has NO mutation anywhere: the
 * append-only trigger is the backend's spine, and the UI reflects that
 * by offering nothing but filters — corrections are new rows made
 * through the transitions, not edits here.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useLedger(academicYearId: string | undefined, studentId?: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.fees.ledger.list.useQuery(
    {
      ...scopeArgs(),
      academicYearId: academicYearId ?? "",
      ...(studentId ? { studentId } : {}),
    },
    {
      enabled: Boolean(academicYearId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

export function useOpeningBalances(academicYearId: string | undefined, studentId?: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.fees.ledger.listOpeningBalances.useQuery(
    {
      ...scopeArgs(),
      academicYearId: academicYearId ?? "",
      ...(studentId ? { studentId } : {}),
    },
    {
      enabled: Boolean(academicYearId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

export function useOpeningBalanceMutations() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const record = trpc.fees.ledger.recordOpeningBalance.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.openingBalances.created);
      await Promise.all([
        utils.fees.ledger.listOpeningBalances.invalidate(),
        utils.fees.ledger.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    record: {
      ...record,
      submit: (data: CreateOpeningBalanceInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error(copy.errors.needsBranch);
        return record.mutateAsync({ ...scope, data });
      },
      canSubmit: Boolean(writeScopeArgs()),
    },
  };
}
