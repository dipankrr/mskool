"use client";

import { toast } from "sonner";

import type {
  AssignFeeStructureInput,
  CreateConcessionInput,
} from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { trpc } from "@/lib/trpc/client";

/**
 * THE STUDENT FEE PROFILE — the per-student hooks behind the "Fees" card
 * on the student detail page (UI4; UI5's subscriptions and UI9's opening
 * balances extend this file). `assignment.byStudent` returns NULL for a
 * not-yet-assigned student — null is the "Assign structure" CTA, never an
 * error state.
 *
 * The money paths here follow the slice's standing rules: the concession
 * amount is COMPUTED by the server and toasted back (never typed),
 * `inserted: 0` from the generator is success wording (idempotent fill),
 * and every mutation invalidates the assignment + dues reads so the card
 * always shows what the DB says, not a local prediction.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useStudentFeeAssignment(studentId: string | undefined) {
  const { scopeArgs, schoolId, activeSession } = useActiveContext();

  return trpc.fees.assignment.byStudent.useQuery(
    {
      ...scopeArgs(),
      schoolId: schoolId ?? "",
      studentId: studentId ?? "",
      academicYearId: activeSession?.id ?? "",
    },
    {
      enabled: Boolean(studentId && schoolId && activeSession?.id),
      staleTime: THIRTY_SECONDS,
      retry: false,
    },
  );
}

export function useFeeProfileMutations() {
  const { scopeArgs, writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refreshProfile = async () => {
    await Promise.all([
      utils.fees.assignment.byStudent.invalidate(),
      utils.fees.installment.dues.invalidate(),
    ]);
  };

  const assign = trpc.fees.assignment.assign.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.profile.assigned);
      await refreshProfile();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const generate = trpc.fees.assignment.generateInstallments.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.inserted === 0
          ? copy.fees.profile.nothingToGenerate
          : copy.fees.profile.generated(result.inserted),
      );
      await refreshProfile();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const recompute = trpc.fees.assignment.recomputeConcessions.useMutation({
    onSuccess: async () => {
      toast.success(copy.fees.profile.recomputed);
      await refreshProfile();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const addConcession = trpc.fees.assignment.addConcession.useMutation({
    onSuccess: async (result) => {
      toast.success(copy.fees.profile.concessionCreated(formatMoney(result.concessionAmount)));
      await refreshProfile();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    assign: {
      ...assign,
      submit: (data: AssignFeeStructureInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error(copy.errors.needsBranch);
        return assign.mutateAsync({ ...scope, data });
      },
      canSubmit: Boolean(writeScopeArgs()),
    },
    generate: {
      ...generate,
      submit: (schoolId: string, assignmentId: string) =>
        generate.mutateAsync({ ...scopeArgs(), schoolId, id: assignmentId }),
    },
    recompute: {
      ...recompute,
      submit: (schoolId: string, assignmentId: string) =>
        recompute.mutateAsync({ ...scopeArgs(), schoolId, id: assignmentId }),
    },
    addConcession: {
      ...addConcession,
      submit: (schoolId: string, assignmentId: string, data: CreateConcessionInput) =>
        addConcession.mutateAsync({ ...scopeArgs(), schoolId, id: assignmentId, data }),
    },
  };
}
