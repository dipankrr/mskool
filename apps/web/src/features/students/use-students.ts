"use client";

import type {
  CreateEnrollmentInput,
  CreateStudentInput,
  UpdateStudentInput,
} from "@repo/contracts";
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
 *
 * Row-addressed calls (byId, update, deactivate, assignSection) address the
 * ROW's node — `{ organizationId, id }` — never the active context's, per
 * the use-branches rule. `student:delete` is SENSITIVE server-side: its gate
 * re-reads assignments fresh, so the confirm dialog is a courtesy, not the
 * check.
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

/** One student, owner-resolved (B6 overlap read). */
export function useStudent(studentId: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.student.byId.useQuery(
    { ...scopeArgs(), id: studentId },
    {
      enabled: Boolean(studentId),
      staleTime: THIRTY_SECONDS,
      // A stale id after a deactivate is a NOT_FOUND, and re-asking cannot
      // change it.
      retry: false,
    },
  );
}

export function useStudentMutations() {
  const { scopeArgs, writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const refreshRegister = async () => {
    await Promise.all([
      utils.student.list.invalidate(),
      utils.student.byId.invalidate(),
      utils.enrollment.list.invalidate(),
      utils.enrollment.byId.invalidate(),
    ]);
  };

  const create = trpc.student.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.students.created);
      await refreshRegister();
    },
    // A duplicate admission number arrives already worded (ADR-026 maps the
    // unique index); errorMessage only guards anything that is not.
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = trpc.student.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.students.updated);
      await refreshRegister();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deactivate = trpc.student.deactivate.useMutation({
    onSuccess: async () => {
      toast.success(copy.students.deactivated);
      await refreshRegister();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const enroll = trpc.enrollment.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.students.enrollment.enrolled);
      await refreshRegister();
    },
    // The year-anchor refusals (duplicate student-year, foreign class) and
    // the status machine's wordings arrive ready to show.
    onError: (error) => toast.error(errorMessage(error)),
  });

  const assignSection = trpc.enrollment.assignSection.useMutation({
    onSuccess: async () => {
      toast.success(copy.students.enrollment.assigned);
      await refreshRegister();
    },
    // "This enrollment already has a section" — the transfer deferral —
    // arrives as BAD_REQUEST with its honest wording.
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    create: {
      ...create,
      /**
       * Returns the mutation promise so the dialog can close on SUCCESS only —
       * a fire-and-forget submit would close over a refused admission and the
       * user would wonder where the student went. Null writeScopeArgs means no
       * branch is chosen — the caller decides.
       */
      submit: (data: CreateStudentInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error("A branch must be chosen to admit a student.");
        return create.mutateAsync({ ...scope, data });
      },
      canSubmit: Boolean(writeScopeArgs()),
    },
    update: {
      ...update,
      submit: (id: string, data: UpdateStudentInput) =>
        update.mutateAsync({ ...scopeArgs(), id, data }),
    },
    deactivate: {
      ...deactivate,
      submit: (id: string) => deactivate.mutateAsync({ ...scopeArgs(), id }),
    },
    enroll: {
      ...enroll,
      submit: (data: CreateEnrollmentInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error("A branch must be chosen to enroll a student.");
        return enroll.mutateAsync({ ...scope, data });
      },
    },
    assignSection: {
      ...assignSection,
      submit: (id: string, sectionId: string, rollNumber?: string) =>
        assignSection.mutateAsync({
          ...scopeArgs(),
          id,
          sectionId,
          ...(rollNumber ? { rollNumber } : {}),
        }),
    },
  };
}
