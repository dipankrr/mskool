"use client";

import { toast } from "sonner";

import type {
  ActivatePortalAccessInput,
  ChangePortalPhoneInput,
  ResetPortalPasswordInput,
} from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * PORTAL ACCESS hooks (ADR-007's completion): activate / reset / change-
 * phone over the staff-gated router. Every mutation states its
 * consequence in the copy, because each one is credential-shaped.
 */

export function usePortalAccessActions(studentId: string) {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  return {
    activate: trpc.portalAccess.activate.useMutation({
      onSuccess: async () => {
        toast.success(copy.portalAccess.activated);
        await utils.student.list.invalidate();
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
    resetPassword: trpc.portalAccess.resetPassword.useMutation({
      onSuccess: async () => {
        toast.success(copy.portalAccess.resetDone);
        await utils.student.list.invalidate();
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
    changePhone: trpc.portalAccess.changePhone.useMutation({
      onSuccess: async () => {
        toast.success(copy.portalAccess.phoneChanged);
        await utils.student.list.invalidate();
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
    scopeArgs,
  };
}

export type PortalActivateInput = ActivatePortalAccessInput;
export type PortalResetInput = ResetPortalPasswordInput;
export type PortalChangePhoneInput = ChangePortalPhoneInput;
