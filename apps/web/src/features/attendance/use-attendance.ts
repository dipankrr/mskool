"use client";

import type {
  MarkAttendanceInput,
  UpsertCalendarDayInput,
  UpsertPolicyInput,
} from "@repo/contracts";
import { toast } from "sonner";

import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import { useActiveContext } from "@/features/session/active-context";

/**
 * ATTENDANCE — the calendar is the marking gate, and this hook is its client.
 *
 * The list is permissive and takes `{ organizationId, academicYearId, month? }`:
 * the month filter runs in SQL, so a month view costs one month of rows, not a
 * year. Omitting `month` lists the WHOLE year — the full-year view's query.
 * Generate and upsert name the branch explicitly (B5). The generate
 * response carries the row COUNT (`{ generated }`) — the toast reports the
 * effect, and "0" is a real answer (every day already had a row), not a
 * failure.
 *
 * The upsert implements the don't-wipe rule client-side the same way the
 * service does: a reason that is not SENT preserves the stored one, so the
 * dialog omits it rather than sending "".
 */

const THIRTY_SECONDS = 30 * 1000;

export function useCalendar(yearId: string, month: number | undefined) {
  const { scopeArgs } = useActiveContext();

  return trpc.attendance.calendar.list.useQuery(
    {
      ...scopeArgs(),
      academicYearId: yearId,
      // Omitted, not null: the contract's optional month means "whole year".
      ...(month === undefined ? {} : { month }),
    },
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
      submit: (
        academicYearId: string,
        workingWeekdays: number[],
        halfDayWeekdays?: number[],
      ) => {
        const scope = writeScopeArgs();
        if (!scope) throw new Error("A branch must be chosen to generate the calendar.");
        return generate.mutateAsync({
          ...scope,
          data: {
            academicYearId,
            workingWeekdays,
            ...(halfDayWeekdays && halfDayWeekdays.length > 0
              ? { halfDayWeekdays }
              : {}),
          },
        });
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

/**
 * The school's ONE marking policy — null before the first upsert, which the
 * screen renders as "the defaults are already in effect" rather than an
 * error (the marking flow treats a missing row the same way).
 */
export function usePolicy(schoolId: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.attendance.policy.get.useQuery(
    { ...scopeArgs(), schoolId },
    { enabled: Boolean(schoolId), staleTime: THIRTY_SECONDS },
  );
}

export function usePolicyMutations() {
  const { writeScopeArgs, schoolId } = useActiveContext();
  const utils = trpc.useUtils();

  const upsert = trpc.attendance.policy.upsert.useMutation({
    onSuccess: async () => {
      toast.success(copy.attendance.policy.saved);
      await utils.attendance.policy.get.invalidate();
    },
    // The threshold refine (rule needs a threshold) is caught client-side;
    // anything else arrives worded.
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    upsert: {
      ...upsert,
      submit: (data: UpsertPolicyInput) => {
        const scope = writeScopeArgs();
        if (!scope || !schoolId) {
          throw new Error("A branch must be chosen to set the policy.");
        }
        return upsert.mutateAsync({ ...scope, schoolId, data });
      },
    },
  };
}

/**
 * The authoritative layer's view of one section's day — the marking screen's
 * prefill and its read-only mode. Empty = the day has not been marked.
 */
export function useDayStatuses(sectionId: string, date: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.attendance.status.useQuery(
    { ...scopeArgs(), sectionId, date },
    {
      enabled: Boolean(sectionId) && Boolean(date),
      staleTime: THIRTY_SECONDS,
      retry: false,
    },
  );
}

/** A section's periods — the period-wise marking screen's picker. */
export function usePeriods(sectionId: string) {
  const { scopeArgs } = useActiveContext();

  return trpc.attendance.period.list.useQuery(
    { ...scopeArgs(), sectionId },
    {
      enabled: Boolean(sectionId),
      staleTime: THIRTY_SECONDS,
    },
  );
}

export function useMarkAttendance() {
  const { scopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const mark = trpc.attendance.mark.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.marked === 1
          ? copy.attendance.marking.markedOne
          : copy.attendance.marking.marked(result.marked),
      );
      await Promise.all([
        utils.attendance.status.invalidate(),
        utils.attendance.summary.invalidate(),
      ]);
    },
    // The gate refusals (holiday, no calendar, roster stranger, mode
    // mismatch) all arrive worded from translateErrors.
    onError: (error) => toast.error(errorMessage(error)),
  });

  return {
    mark: {
      ...mark,
      submit: (input: Omit<MarkAttendanceInput, "organizationId">) =>
        mark.mutateAsync({ ...scopeArgs(), ...input }),
    },
  };
}
