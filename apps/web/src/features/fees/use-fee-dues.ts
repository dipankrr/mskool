"use client";

import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * DUES — the open-installment read, shared by the Dues tab (UI6) and the
 * student fee profile card's mini-table. Rows are installment-level with
 * NO student names joined (the service returns fee rows only); the Dues
 * tab cross-references names, the card already knows its student.
 *
 * `dueOnOrBefore` is the date ceiling the contract offers; `studentId`
 * narrows to one payer. The service returns only unpaid/partial rows —
 * the "open dues" definition is the server's, not a client filter.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useFeeDues(options: {
  academicYearId: string | undefined;
  studentId?: string;
  dueOnOrBefore?: string;
  /** Extra gate (e.g. counter: don't fetch the whole session before a student is picked). */
  enabled?: boolean;
}) {
  const { scopeArgs } = useActiveContext();

  return trpc.fees.installment.dues.useQuery(
    {
      ...scopeArgs(),
      academicYearId: options.academicYearId ?? "",
      ...(options.studentId ? { studentId: options.studentId } : {}),
      ...(options.dueOnOrBefore ? { dueOnOrBefore: options.dueOnOrBefore } : {}),
    },
    {
      enabled: Boolean(options.academicYearId) && (options.enabled ?? true),
      staleTime: THIRTY_SECONDS,
    },
  );
}

export function useWaiveMutation() {
  const { scopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const waive = trpc.fees.installment.waive.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.dues.waived);
      await Promise.all([
        utils.fees.installment.dues.invalidate(),
        utils.fees.assignment.byStudent.invalidate(),
      ]);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    ...waive,
    /** The approve-tier act (fee_waiver:approve) — hidden from callers without it. */
    submit: (schoolId: string, installmentId: string) =>
      waive.mutateAsync({ ...scopeArgs(), schoolId, id: installmentId }),
  };
}
