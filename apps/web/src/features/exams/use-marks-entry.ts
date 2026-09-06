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
  sectionId?: string,
) {
  const { scopeArgs } = useActiveContext();
  return trpc.exam.marks.entry.useQuery(
    { ...scopeArgs(), examId: examId ?? "", scheduleId: scheduleId ?? "", sectionId },
    { enabled: Boolean(examId && scheduleId) },
  );
}

export function useSaveCell(examId: string, scheduleId: string) {
  const utils = trpc.useUtils();
  const { scopeArgs } = useActiveContext();

  return trpc.exam.marks.save.useMutation({
    onSuccess: async () => {
      await utils.exam.eligibility.readiness.invalidate({ ...scopeArgs(), examId });
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
      await utils.exam.marks.entry.invalidate({ ...scopeArgs(), examId, scheduleId });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
