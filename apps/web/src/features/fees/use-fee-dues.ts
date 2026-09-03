"use client";

import { useActiveContext } from "@/features/session/active-context";
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
      enabled: Boolean(options.academicYearId),
      staleTime: THIRTY_SECONDS,
    },
  );
}
