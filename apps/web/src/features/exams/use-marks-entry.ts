"use client";

import { toast } from "sonner";

import type { SaveComponentResultInput } from "@repo/contracts";

import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * MARKS ENTRY (S3) — the grid's data door. The read is one call
 * (`exam.marks.entry`: components + roster + entries); the write is the
 * existing subject-gated autosave cell. The page owns the cell state map;
 * these hooks own transport and toasts.
 */

export function useEntryGrid(
  examId: string | undefined,
  scheduleId: string | undefined,
  /** ADVISORY: feeds the caller's canEnter verdict, never the roster (BUG-9). */
  sectionId?: string,
) {
  const { scopeArgs } = useActiveContext();
  // `id` is the schedule's — the procedure is schedule-addressed (the
  // builder's owner resolver needs the id field, the byId pattern). The
  // roster follows the PAPER's scope server-side; the teacher's section
  // pick is only the save gate's fact (BUG-9) and the canEnter hint.
  return trpc.exam.marks.entry.useQuery(
    { ...scopeArgs(), examId: examId ?? "", id: scheduleId ?? "", ...(sectionId ? { sectionId } : {}) },
    { enabled: Boolean(examId && scheduleId) },
  );
}

export function useSaveCell(examId: string, scheduleId: string) {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  return trpc.exam.marks.save.useMutation({
    onSuccess: async () => {
      await utils.exam.eligibility.readiness.invalidate({ ...scopeArgs(), id: examId });
    },
    onError: (error) => {
      // The cell's worded refusals (conflict, > max, verified lock,
      // subject gate) are the UI's error state — spoken, not silent.
      toast.error(errorMessage(error));
    },
  });
}

export type SaveCellInput = Omit<SaveComponentResultInput, "examId" | "scheduleId">;

export function useVerifyEntries(examId: string, scheduleId: string) {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  return trpc.exam.marks.verify.useMutation({
    onSuccess: async (rows) => {
      toast.success(copy.exams.entry.verifiedToast(rows.length));
      await utils.exam.marks.entry.invalidate({ ...scopeArgs(), examId, id: scheduleId });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
