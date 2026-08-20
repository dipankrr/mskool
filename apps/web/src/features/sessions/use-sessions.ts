"use client";

import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage, toFriendlyError } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import type {
  CreateAcademicYearInput,
  UpdateAcademicYearInput,
} from "@repo/contracts";

/**
 * SESSIONS — academic years, per branch.
 *
 * **Every write here needs a branch named.** `createAcademicYear` and
 * `setCurrentAcademicYear` both call `requireSchoolId`, because an org-scoped admin
 * legitimately has `schoolId: null` and there is no way to guess which branch a
 * session belongs to. So the screen asks for a branch before offering the actions,
 * rather than letting the server refuse — which after ADR-026 is a readable 400,
 * but still a round trip to learn something the client already knew.
 *
 * The list query deliberately uses the same input shape as the one in
 * `ActiveContextProvider`, so TanStack serves both from one cache entry instead of
 * fetching the same rows twice on every navigation.
 *
 * **Year visibility is not enforced here.** Whether closed sessions come back is
 * decided server-side from `academic_year:read_history` (ADR-024); the client only
 * explains the consequence to a caller who lacks it.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useSessions() {
  const { organizationId, schoolId } = useActiveContext();

  return trpc.academic.year.list.useQuery(
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

export function useSessionMutations() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await utils.academic.year.list.invalidate();
  };

  const create = trpc.academic.year.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.sessions.created);
      await refresh();
    },
    // Already human after ADR-026: overlapping dates name the session they clash
    // with, a duplicate name names the branch.
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = trpc.academic.year.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.sessions.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const setCurrent = trpc.academic.year.setCurrent.useMutation({
    onSuccess: async () => {
      toast.success(copy.sessions.setCurrent);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /**
   * Guards the one precondition the client can check itself. Returning early with a
   * toast is friendlier than sending a request that cannot succeed, and it keeps the
   * "which branch?" question in front of the user rather than in a server message.
   */
  const withBranch = <TArgs extends unknown[]>(
    run: (scope: { organizationId: string; schoolId: string }, ...args: TArgs) => void,
  ) => {
    return (...args: TArgs) => {
      const scope = writeScopeArgs();

      if (!scope) {
        toast.error(copy.errors.needsBranch);
        return;
      }

      run(scope, ...args);
    };
  };

  return {
    create: {
      ...create,
      submit: withBranch((scope, data: CreateAcademicYearInput) =>
        create.mutate({ ...scope, data }),
      ),
    },
    update: {
      ...update,
      submit: withBranch((scope, id: string, data: UpdateAcademicYearInput) =>
        update.mutate({ ...scope, id, data }),
      ),
    },
    setCurrent: {
      ...setCurrent,
      submit: withBranch((scope, id: string) => setCurrent.mutate({ ...scope, id })),
    },
  };
}
