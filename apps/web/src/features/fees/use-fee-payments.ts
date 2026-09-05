"use client";

import { toast } from "sonner";

import type { RecordRefundInput } from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * PAYMENTS + THE STATE MACHINE — the lifecycle surface. The named
 * transitions (clear/bounce/reverse/cancel) all require a REASON and
 * the fee_payment:approve permission; refund requires fee_refund:create.
 * The UI renders ONLY the transitions legal in a payment's current
 * status (the plan's state table) — an illegal action cannot be proposed.
 *
 * After any transition: broad invalidation. A bounce re-opens balances
 * (dues change), writes a ledger row, and moves the payment — so dues,
 * payments, ledger, and the assignment all refetch.
 */

const THIRTY_SECONDS = 30 * 1000;

export function usePayments(academicYearId: string | undefined, studentId?: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.fees.payment.list.useQuery(
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

export function usePaymentDetail(schoolId: string | undefined, paymentId: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.fees.payment.detail.useQuery(
    { ...scopeArgs(), schoolId: schoolId ?? "", id: paymentId },
    {
      enabled: Boolean(schoolId && paymentId),
      staleTime: THIRTY_SECONDS,
      retry: false,
    },
  );
}

export function usePaymentMutations() {
  const { scopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refreshAfterTransition = async () => {
    await Promise.all([
      utils.fees.payment.list.invalidate(),
      utils.fees.payment.detail.invalidate(),
      utils.fees.installment.dues.invalidate(),
      utils.fees.ledger.list.invalidate(),
    ]);
  };

  const clear = trpc.fees.payment.clear.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.payments.transitioned("cleared"));
      await refreshAfterTransition();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const bounce = trpc.fees.payment.bounce.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.payments.transitioned("bounced"));
      await refreshAfterTransition();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const reverse = trpc.fees.payment.reverse.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.payments.transitioned("reversed"));
      await refreshAfterTransition();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const cancel = trpc.fees.payment.cancel.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.payments.transitioned("cancelled"));
      await refreshAfterTransition();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const refund = trpc.fees.payment.refund.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.payments.refunded);
      await refreshAfterTransition();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /** A transition on the payment's own node; the reason is required by the schema. */
  const submitTransition =
    (
      mutation:
        | typeof clear
        | typeof bounce
        | typeof reverse
        | typeof cancel,
      action: string,
    ) =>
    async (schoolId: string, paymentId: string, reason: string) => {
      void action;
      return mutation.mutateAsync({ ...scopeArgs(), schoolId, id: paymentId, reason });
    };

  return {
    clear: { ...clear, submit: submitTransition(clear, "clear") },
    bounce: { ...bounce, submit: submitTransition(bounce, "bounce") },
    reverse: { ...reverse, submit: submitTransition(reverse, "reverse") },
    cancel: { ...cancel, submit: submitTransition(cancel, "cancel") },
    refund: {
      ...refund,
      submit: (schoolId: string, data: RecordRefundInput) =>
        refund.mutateAsync({ ...scopeArgs(), schoolId, data }),
    },
  };
}
