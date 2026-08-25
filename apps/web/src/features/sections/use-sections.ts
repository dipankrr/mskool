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
 * The class this route is about, resolved from the **permissive** list rather than
 * `class.byId`.
 *
 * `byId` is a strict `staffProcedure`, so it authorizes against the node the request
 * addresses — and the client has no reliable way to name a node the caller covers.
 * Addressing the organization 403s a class-scoped teacher; addressing the class node
 * fixes that but still 403s a *section*-scoped one; and a caller scoped below school
 * level has no `schoolId` to send either, because `me` shows them no schools.
 *
 * The list endpoint asks the opposite question — "which of your grants fall inside
 * this subtree" — so it returns exactly the classes this caller may see, whatever
 * their scope depth. Finding one row in that answer is therefore both correct and
 * unfailable, and a class the caller cannot see is simply absent, which is the same
 * "not found" the strict endpoint would have produced for another branch's class.
 */
export function useClass(classId: string) {
  const { organizationId, schoolId } = useActiveContext();

  const query = trpc.academic.class.list.useQuery(
    { organizationId, ...(schoolId ? { schoolId } : {}) },
    // Retry policy comes from the QueryClient default (see provider.tsx).
    { staleTime: THIRTY_SECONDS },
  );

  return {
    ...query,
    data: query.data?.find((cls) => cls.id === classId),
    /** Loaded successfully, but this id is not among the classes they may see. */
    notFound: query.isSuccess && !query.data.some((cls) => cls.id === classId),
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
