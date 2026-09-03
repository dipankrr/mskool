"use client";

import { toast } from "sonner";

import type { RecordPaymentInput } from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * THE COUNTER — the collection desk. The record hook's shape is the
 * whole money-safety story of this slice:
 *
 * - `clientReference` is generated per ATTEMPT (UUID), so a retry after
 *   a network failure reuses the same key and the server returns the
 *   ORIGINAL receipt instead of double-collecting; the caller
 *   regenerates only after a SUCCESS, when the previous attempt's
 *   business outcome is settled.
 * - The toast carries the RECEIPT NUMBER the server returned — the
 *   success story is the receipt, not a generic "saved".
 * - Invalidation is broad on purpose: dues, payments, and the ledger
 *   all change shape with a collection.
 */

export function useCounterMutations() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refreshAfterMoney = async () => {
    await Promise.all([
      utils.fees.installment.dues.invalidate(),
      utils.fees.payment.list.invalidate(),
      utils.fees.payment.detail.invalidate(),
      utils.fees.ledger.list.invalidate(),
      utils.fees.assignment.byStudent.invalidate(),
    ]);
  };

  const record = trpc.fees.payment.record.useMutation({
    onSuccess: async (payment) => {
      toast.success(copy.fees.counter.recorded(payment.receiptNumber));
      if (payment.paymentStatus === "pending") {
        toast.info(copy.fees.counter.pendingNote);
      }
      await refreshAfterMoney();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    record: {
      ...record,
      /**
       * The idempotency key rides with the caller's attempt: generate
       * one UUID per submit attempt and REUSE it if the caller retries
       * the same submission; regenerate after success. The server
       * answers a repeated key with the original receipt (payload-
       * matched) or a refusal (payload mismatch) — never a second row.
       */
      submit: (data: RecordPaymentInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error(copy.errors.needsBranch);
        // The idempotency key rides INSIDE the contract's data (its own
        // nullable field) — one UUID per attempt, caller-generated.
        return record.mutateAsync({ ...scope, data });
      },
      canSubmit: Boolean(writeScopeArgs()),
    },
  };
}
