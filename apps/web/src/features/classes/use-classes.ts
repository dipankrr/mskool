"use client";

import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage, toFriendlyError } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import type { UpdateClassInput } from "@repo/contracts";

/**
 * CLASSES — the rungs a school teaches, per branch.
 *
 * Ordered by `numericOrder` on the server, so this never sorts: `listClasses` ends
 * with `orderBy(asc(numericOrder))` and only returns active rows.
 *
 * `createClass` calls `requireSchoolId` (it also writes a `scope_nodes` row in the
 * same transaction — hard rule 12), so creates need a branch named. Update and
 * close do not, but they still address the active branch: a principal does not cover
 * the org node, so addressing the org would 403 them out of their own classes.
 *
 * **`createOne` is exposed as an awaitable.** Bulk creation is N sequential calls
 * because no transactional bulk endpoint exists, so the caller needs to know which
 * rows landed — `mutate` cannot tell it that, and firing them in parallel would make
 * a partial failure impossible to report coherently.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useClasses() {
  const { organizationId, schoolId } = useActiveContext();

  return trpc.academic.class.list.useQuery(
    { organizationId, ...(schoolId ? { schoolId } : {}) },
    {
      staleTime: THIRTY_SECONDS,
      retry: (failureCount, error) => {
        const friendly = toFriendlyError(error);
        return friendly.retryable && !friendly.requiresSignIn && failureCount < 1;
      },
    },
  );
}

export function useClassMutations() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await utils.academic.class.list.invalidate();
  };

  const create = trpc.academic.class.create.useMutation();

  const update = trpc.academic.class.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.classes.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const close = trpc.academic.class.deactivate.useMutation({
    onSuccess: async () => {
      toast.success(copy.classes.closed);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    /**
     * One class, awaited, with no toast of its own — the bulk runner reports the
     * whole batch instead of firing a dozen toasts. Throws on failure so the caller
     * can record which rung it was.
     */
    createOne: async (data: { name: string; numericOrder: number }) => {
      const scope = writeScopeArgs();

      if (!scope) throw new Error(copy.errors.needsBranch);

      return create.mutateAsync({ ...scope, data });
    },
    refresh,
    update: {
      ...update,
      submit: (id: string, data: UpdateClassInput) => {
        const scope = writeScopeArgs();

        if (!scope) {
          toast.error(copy.errors.needsBranch);
          return;
        }

        update.mutate({ ...scope, id, data });
      },
    },
    close: {
      ...close,
      submit: (id: string) => {
        const scope = writeScopeArgs();

        if (!scope) {
          toast.error(copy.errors.needsBranch);
          return;
        }

        close.mutate({ ...scope, id });
      },
    },
  };
}
