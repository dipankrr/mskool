"use client";

import type {
  AddGuardianInput,
  CreateEnrollmentInput,
  CreateStudentInput,
} from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { trpc } from "@/lib/trpc/client";

import type { FamilySlot } from "./admit-logic";

/**
 * THE ADMISSION'S WRITES, one after another: the student, then the class, then
 * each parent. They stay separate calls because they answer to separate
 * permissions, and because a child on the register with a failed class is a real
 * state that the desk can finish, not an error to roll back.
 *
 * No toasts here, unlike the other student hooks. The dialog's last step reports
 * every result in place, with Retry beside anything that failed, so a stack of
 * toasts would only repeat it.
 */

/** One save that follows the student, with what the result needs to show and retry it. */
export type AdmitTask = { error: unknown } & (
  | { kind: "enrollment"; payload: CreateEnrollmentInput; label: string }
  | { kind: "guardian"; slot: FamilySlot; payload: AddGuardianInput; who: string }
);

export function useAdmission() {
  const { writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();
  const createStudent = trpc.student.create.useMutation();
  const createEnrollment = trpc.enrollment.create.useMutation();
  const addGuardian = trpc.guardian.add.useMutation();

  const scope = () => {
    const args = writeScopeArgs();
    if (!args) throw new Error("A branch must be chosen to admit a student.");
    return args;
  };

  return {
    /** Rejects on refusal: the dialog sends a used number back to its field. */
    admit: (data: CreateStudentInput) => createStudent.mutateAsync({ ...scope(), data }),

    /** Never rejects: the failure travels back on the task, for the result list. */
    run: async (studentId: string, task: AdmitTask): Promise<AdmitTask> => {
      try {
        if (task.kind === "enrollment") {
          await createEnrollment.mutateAsync({
            ...scope(),
            data: { ...task.payload, studentId },
          });
        } else {
          await addGuardian.mutateAsync({ ...scope(), id: studentId, ...task.payload });
        }
        return { ...task, error: null };
      } catch (error) {
        return { ...task, error };
      }
    },

    refresh: () =>
      Promise.all([
        utils.student.list.invalidate(),
        utils.student.byId.invalidate(),
        utils.enrollment.list.invalidate(),
        utils.guardian.list.invalidate(),
      ]),
  };
}
