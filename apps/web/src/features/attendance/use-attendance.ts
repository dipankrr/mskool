"use client";

import type { UpsertCalendarDayInput } from "@repo/contracts";
import { toast } from "sonner";

import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import { useActiveContext } from "@/features/session/active-context";

/**
 * ATTENDANCE — the calendar is the marking gate, and this hook is its client.
 *
 * The list is permissive and takes `{ organizationId, academicYearId, month }`:
 * the month filter runs in SQL, so a month view costs one month of rows, not a
 * year. Generate and upsert name the branch explicitly (B5). The generate
 * response carries the row COUNT (`{ generated }`) — the toast reports the
 * effect, and "0" is a real answer (every day already had a row), not a
 * failure.
 *
 * The upsert implements the don't-wipe rule client-side the same way the
 * service does: a reason that is not SENT preserves the stored one, so the
 * dialog omits it rather than sending "".
 */

const THIRTY_SECONDS = 30 * 1000;

export function useCalendar(yearId: string, month: number) {
  const { scopeArgs } = useActiveContext();

  return trpc.attendance.calendar.list.useQuery(
    { ...scopeArgs(), academicYearId: yearId, month },
    {
      enabled: Boolean(yearId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

export function useCalendarMutations() {
  const { scopeArgs, writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  /** The grid reads by month, but a generate fills every month at once. */
  const refresh = async () => {
    await utils.attendance.calendar.list.invalidate();
  };

  const generate = trpc.attendance.calendar.generate.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.generated > 0
          ? copy.attendance.generated(result.generated)
          : copy.attendance.nothingToGenerate,
      );
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const upsertDay = trpc.attendance.calendar.upsert.useMutation({
    onSuccess: async () => {
      toast.success(copy.attendance.saved);
      await refresh();
    },
    // The date-outside-year refusal arrives already worded (ADR-026).
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    generate: {
      ...generate,
      submit: (academicYearId: string, workingWeekdays: number[]) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error("A branch must be chosen to generate the calendar.");
        return generate.mutateAsync({ ...scope, data: { academicYearId, workingWeekdays } });
      },
    },
    upsertDay: {
      ...upsertDay,
      submit: (input: UpsertCalendarDayInput) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error("A branch must be chosen to edit the calendar.");
        return upsertDay.mutateAsync({ ...scope, data: input });
      },
    },
  };
}
