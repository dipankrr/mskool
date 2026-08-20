"use client";

import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage, toFriendlyError } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import type { CreateSchoolInput, UpdateSchoolInput } from "@repo/contracts";

/**
 * BRANCHES — the schools under this trust.
 *
 * **Which node each call addresses is the whole subtlety here**, and it is not the
 * blanket "mutations send the active branch" rule the rest of the app follows:
 *
 *   list       → `{ organizationId }`. The permissive builder clips the caller's
 *                grants to the addressed subtree, so a branch principal gets their
 *                own branch back without the client filtering anything.
 *   create     → `{ organizationId }`, and *not* the selected branch. The school
 *                being created has no `scope_nodes` row yet, so there is nothing to
 *                address; the service reads `ctx.organizationId` directly. Sending
 *                the currently-selected branch would address an unrelated node.
 *   update /   → `{ organizationId, schoolId: <the row being changed> }`. This is the
 *   deactivate   row's own node, not the active context's. A principal does not cover
 *                the org node, so addressing the org would 403 them out of editing
 *                their own branch — and an org admin covers both, so it works for
 *                everyone.
 *
 * Every mutation invalidates `me.get` as well as the list, because
 * `me.memberships[].schools` is what feeds the branch switcher and the "Branch" vs
 * "School" wording. Skip it and a newly created branch is missing from the switcher
 * until the next full page load.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useBranches() {
  const { scopeArgs } = useActiveContext();

  return trpc.school.list.useQuery(scopeArgs(), {
    staleTime: THIRTY_SECONDS,
    /**
     * One retry, not TanStack's default three.
     *
     * Measured: with the default policy and exponential backoff, a failing list
     * showed a loading skeleton for about seventeen seconds before admitting
     * anything was wrong. A user reads that as a hang and reloads the page — which
     * restarts the same seventeen seconds. One retry covers the genuinely transient
     * case (a dropped connection, a cold database) and then says so.
     *
     * A permission or not-found answer is not retried at all, because asking the
     * same question again cannot change it.
     */
    retry: (failureCount, error) => {
      const friendly = toFriendlyError(error);
      return friendly.retryable && !friendly.requiresSignIn && failureCount < 1;
    },
  });
}

export function useBranchMutations() {
  const { organizationId } = useActiveContext();
  const utils = trpc.useUtils();

  /** The list and the identity payload both describe the set of branches. */
  const refresh = async () => {
    await Promise.all([utils.school.list.invalidate(), utils.me.get.invalidate()]);
  };

  const create = trpc.school.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.branches.created);
      await refresh();
    },
    // The message is already human: ADR-026 maps schools_org_code_uq to "Code X is
    // already used by another branch." errorMessage only guards against anything
    // that is not.
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = trpc.school.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.branches.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const close = trpc.school.deactivate.useMutation({
    onSuccess: async () => {
      toast.success(copy.branches.closed);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    create: {
      ...create,
      submit: (data: CreateSchoolInput) => create.mutate({ organizationId, data }),
    },
    update: {
      ...update,
      submit: (id: string, data: UpdateSchoolInput) =>
        update.mutate({ organizationId, schoolId: id, id, data }),
    },
    close: {
      ...close,
      submit: (id: string) => close.mutate({ organizationId, schoolId: id, id }),
    },
  };
}
