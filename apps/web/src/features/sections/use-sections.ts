"use client";

import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage, toFriendlyError } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import type { UpdateSectionInput } from "@repo/contracts";

/**
 * SECTIONS — the divisions of one class within one session.
 *
 * A section needs three things to be meaningful: a branch, a session and a class.
 * That is why this lives under a class detail route and reads the session from the
 * active context, so the common case asks the user for nothing.
 *
 * `list` is the only query in the app that *requires* an id beyond scope —
 * `academicYearId` — because sections are re-created every year and an unfiltered
 * list would silently mix sessions. The query is therefore disabled until a session
 * resolves rather than being called with a placeholder.
 *
 * Closed sessions are filtered server-side by `academic_year:read_history` through a
 * join on `academic_years` (ADR-024), so a caller without it gets an empty list for a
 * past session rather than an error.
 */

const THIRTY_SECONDS = 30 * 1000;

/**
 * Sections for the active session.
 *
 * `classId` narrows to one class, which is what the class detail route wants. Omitted,
 * it returns every section in the session — how Home decides whether setup is finished
 * without asking for a class first.
 */
export function useSections(classId?: string) {
  const { organizationId, schoolId, academicYearId } = useActiveContext();

  return trpc.academic.section.list.useQuery(
    {
      organizationId,
      ...(schoolId ? { schoolId } : {}),
      // Never sent as a placeholder: the query below is disabled until it is real.
      academicYearId: academicYearId ?? "",
      ...(classId ? { classId } : {}),
    },
    {
      enabled: Boolean(academicYearId),
      staleTime: THIRTY_SECONDS,
      retry: (failureCount, error) => {
        const friendly = toFriendlyError(error);
        return friendly.retryable && !friendly.requiresSignIn && failureCount < 1;
      },
    },
  );
}

/** The class itself, so the page can name it — and 404 a class from another branch. */
export function useClass(classId: string) {
  const { organizationId, schoolId } = useActiveContext();

  return trpc.academic.class.byId.useQuery(
    { organizationId, ...(schoolId ? { schoolId } : {}), id: classId },
    { staleTime: THIRTY_SECONDS, retry: false },
  );
}

export function useSectionMutations(classId: string) {
  const { writeScopeArgs, academicYearId } = useActiveContext();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await utils.academic.section.list.invalidate();
  };

  const create = trpc.academic.section.create.useMutation();

  const update = trpc.academic.section.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.sections.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const close = trpc.academic.section.deactivate.useMutation({
    onSuccess: async () => {
      toast.success(copy.sections.closed);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    /**
     * One section, awaited, no toast — the bulk dialog reports the batch. Same shape
     * as the class ladder, and for the same reason: there is no transactional bulk
     * endpoint, so the caller has to know which names landed.
     */
    createOne: async (name: string) => {
      const scope = writeScopeArgs();

      if (!scope) throw new Error(copy.errors.needsBranch);
      if (!academicYearId) throw new Error(copy.sections.needsSession);

      return create.mutateAsync({
        ...scope,
        data: { name, classId, academicYearId },
      });
    },
    refresh,
    update: {
      ...update,
      submit: (id: string, data: UpdateSectionInput) => {
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
