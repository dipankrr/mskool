"use client";

import type { GuardianRelation } from "@repo/contracts";
import { toast } from "sonner";

import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import { useActiveContext } from "@/features/session/active-context";
import type { GuardianView as GuardianViewRow } from "@/lib/trpc/types";

/**
 * GUARDIANS — the parents' contact truth on the student profile
 * (ADR-037's follow-up). The family login FOLLOWS this data: saving a
 * portal-enabled phone creates the pending link server-side, so no screen
 * here ever asks anyone to type a login credential.
 *
 * The read is per-student (the profile already knows the row), so this
 * hooks scope by `studentId` rather than the active context's branch —
 * the row's own node is resolved server-side.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useGuardians(studentId: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.guardian.list.useQuery(
    { ...scopeArgs(), id: studentId },
    {
      enabled: Boolean(studentId),
      staleTime: THIRTY_SECONDS,
      // A NOT_FOUND here is a student the caller cannot see, not a blip.
      retry: false,
    },
  );
}

export function useGuardianMutations(studentId: string) {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  const refresh = async () => {
    await Promise.all([
      utils.guardian.list.invalidate({ id: studentId }),
      utils.portalAccess.status.invalidate({ studentId }),
    ]);
  };

  const add = trpc.guardian.add.useMutation({
    onSuccess: async () => {
      toast.success(copy.guardians.added);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = trpc.guardian.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.guardians.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const detach = trpc.guardian.detach.useMutation({
    onSuccess: async () => {
      toast.success(copy.guardians.detached);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    add: {
      ...add,
      submit: (data: {
        firstName: string;
        lastName?: string;
        relation: GuardianRelation;
        phone: string;
        isPrimary?: boolean;
        isEmergencyContact?: boolean;
        canAccessPortal?: boolean;
      }) => add.mutateAsync({ ...scopeArgs(), id: studentId, ...data }),
    },
    update: {
      ...update,
      submit: (guardianId: string, data: GuardianUpdate) =>
        update.mutateAsync({ ...scopeArgs(), id: studentId, guardianId, ...data }),
    },
    detach: {
      ...detach,
      submit: (guardianId: string, reason?: string) =>
        detach.mutateAsync({ ...scopeArgs(), id: studentId, guardianId, reason }),
    },
  };
}

/** What an edit may change — identity is stable, contact is correctable. */
type GuardianUpdate = Partial<
  Pick<
    GuardianViewRow,
    | "firstName"
    | "lastName"
    | "relation"
    | "phone"
    | "isPrimary"
    | "isEmergencyContact"
    | "canAccessPortal"
  >
>;