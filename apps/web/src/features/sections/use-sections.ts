"use client";

import { toast } from "sonner";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
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
 *
 * **`classId` is not only a filter.** It is part of `staffScopeInput`, so it also becomes
 * the addressed node: passing a class the caller has no grant inside makes even this
 * permissive endpoint answer 403. That is correct defence in depth, but it means the
 * caller should not ask until the class is known to be theirs — hence `enabled`.
 */
export function useSections(classId?: string, options?: { enabled?: boolean }) {
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
      enabled: Boolean(academicYearId) && (options?.enabled ?? true),
      staleTime: THIRTY_SECONDS,
    },
  );
}

/**
 * The class this route is about, by id.
 *
 * This used to read the permissive `class.list` and pick one row, because
 * `class.byId` was a strict read that a section-scoped teacher could not pass:
 * her grant does not cover the class node above her section. B7 (ADR-028)
 * made single-row reads ask "is this row inside one of my grants?" instead,
 * so the direct read now answers for every role that owns a piece of it — and
 * a class the caller cannot see is a NOT_FOUND, the same answer the list
 * trick produced by absence.
 */
export function useClass(classId: string) {
  const { organizationId } = useActiveContext();

  const query = trpc.academic.class.byId.useQuery(
    { organizationId, id: classId },
    // Retry policy comes from the QueryClient default (see provider.tsx).
    { staleTime: THIRTY_SECONDS },
  );

  return {
    ...query,
    data: query.data ?? undefined,
    /** The row exists but is not inside any grant this caller holds — or it
     * genuinely does not exist. Same wording either way, by design. */
    notFound:
      !query.isLoading && !query.isSuccess && query.error?.data?.code === "NOT_FOUND",
  };
}

export function useSectionMutations(classId: string) {
  const { organizationId, writeScopeArgs, academicYearId } = useActiveContext();
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
      // ADR-027: id-addressed — no branch naming, no "choose a branch" gate.
      submit: (id: string, data: UpdateSectionInput) => {
        update.mutate({ organizationId, id, data });
      },
    },
    close: {
      ...close,
      submit: (id: string) => {
        close.mutate({ organizationId, id });
      },
    },
  };
}
