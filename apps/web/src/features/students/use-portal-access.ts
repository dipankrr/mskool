"use client";

import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * PORTAL ACCESS hooks (ADR-037): the family login's links — list plus the
 * single staff act, revocation. Passwords are never issued here; the family
 * sets its own from home.
 */

export function usePortalAccessLinks(studentId: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.portalAccess.status.useQuery(
    { ...scopeArgs(), studentId },
    { enabled: Boolean(studentId), staleTime: 30 * 1000, retry: false },
  );
}

export function usePortalAccessActions(studentId: string) {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  const refreshLinks = async () => {
    await Promise.all([
      utils.portalAccess.status.invalidate(),
      utils.student.list.invalidate(),
    ]);
  };

  return {
    revokeLink: trpc.portalAccess.revokeLink.useMutation({
      onSuccess: async () => {
        toast.success(copy.portalAccess.linkRevoked);
        await refreshLinks();
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
    scopeArgs,
  };
}
