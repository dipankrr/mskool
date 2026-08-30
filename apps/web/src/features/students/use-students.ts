"use client";

import type { CreateStudentInput } from "@repo/contracts";
import { toast } from "sonner";

import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import { useActiveContext } from "@/features/session/active-context";

/**
 * STUDENTS — the admission register.
 *
 * The list is permissive (`student.list` takes `{ organizationId }` and the
 * builder clips to the caller's grants), so the front desk at any scope
 * searches the same registry and sees exactly who they may see. Create names
 * the branch explicitly (B5): admitting a child is a branch-attributed act,
 * and `writeScopeArgs()` returning null is the "choose a branch first" state
 * the page renders instead of guessing.
 *
 * The search box owns `q` — the front-desk search runs server-side across
 * name parts and the admission number, so there is nothing to filter here.
 * The enrollment join (`enrollment.list`, the year anchor's own read) is a
 * SEPARATE query on purpose: a librarian holds `student:read` but not
 * `enrollment:read`, and her register must render with the Class column
 * empty rather than fail. Each query answers its own permission question.
 */

const THIRTY_SECONDS = 30 * 1000;

export function useStudents(q?: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.student.list.useQuery(
    { ...scopeArgs(), q: q || undefined },
    { staleTime: THIRTY_SECONDS },
  );
}

/**
 * The active session's enrollments, joined client-side for the "Class"
 * column. Failing (a caller without `enrollment:read`) degrades to an empty
 * map, never an error state — the register is still usable.
 */
export function useStudentEnrollments() {
  const { scopeArgs, activeSession } = useActiveContext();

  return trpc.enrollment.list.useQuery(
    { ...scopeArgs(), academicYearId: activeSession?.id ?? "" },
    {
      enabled: Boolean(activeSession?.id),
      staleTime: THIRTY_SECONDS,
    },
  );
}

export function useStudentMutations() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refresh = async () => {
    await Promise.all([utils.student.list.invalidate()]);
  };

  const create = trpc.student.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.students.created);
      await refresh();
    },
    // A duplicate admission number arrives already worded (ADR-026 maps the
    // unique index); errorMessage only guards anything that is not.
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    create: {
      ...create,
      /** Null writeScopeArgs means no branch is chosen — the caller decides. */
      submit: (data: CreateStudentInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error("A branch must be chosen to admit a student.");
        return create.mutate({ ...scope, data });
      },
      canSubmit: Boolean(writeScopeArgs()),
    },
  };
}
