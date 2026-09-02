"use client";

import { useEffect, useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { copy } from "@/lib/copy";

/**
 * The bulk generator's input: the weekly template, one weekday at a time.
 * Each weekday is a THREE-state cycle — Working → Half day → Off — because
 * that is the real shape of an Indian school week: many run Saturday as a
 * half day every week, which the old working/off binary could not say and
 * cost ~40 manual edits after generation. Mon–Fri start as Working, the
 * overwhelmingly common shape; the point of a generator is that "the
 * obvious thing" is one click.
 *
 * An all-Off selection is refused (the contract's min(1) on working
 * weekdays; a school with no teaching days is not a school).
 *
 * Idempotency is the service's (onConflictDoNothing fills MISSING dates
 * only), so this dialog is safe to re-run after adding a holiday — the
 * wording says so.
 */

/** GRID_WEEKDAYS order (Mon..Sun) with its copy key — one aligned table. */
const GRID_DAYS = [
  { value: 1, key: "monday" },
  { value: 2, key: "tuesday" },
  { value: 3, key: "wednesday" },
  { value: 4, key: "thursday" },
  { value: 5, key: "friday" },
  { value: 6, key: "saturday" },
  { value: 0, key: "sunday" },
] as const;

type WeekdayState = "working" | "half_day" | "off";

const STATE_ORDER: WeekdayState[] = ["working", "half_day", "off"];

const NEXT_STATE: Record<WeekdayState, WeekdayState> = {
  working: "half_day",
  half_day: "off",
  off: "working",
};

/** Monday–Friday as working days: the overwhelmingly common shape. */
const INITIAL: Record<number, WeekdayState> = {
  1: "working",
  2: "working",
  3: "working",
  4: "working",
  5: "working",
  6: "off",
  0: "off",
};

const STATE_COPY: Record<WeekdayState, string> = {
  working: copy.attendance.generateStates.working,
  half_day: copy.attendance.generateStates.half_day,
  off: copy.attendance.generateStates.off,
};

const STATE_STYLES: Record<WeekdayState, string> = {
  working: "border-primary/40 bg-primary/10 text-foreground",
  half_day:
    "border-amber-500/40 bg-amber-500/10 text-foreground",
  off: "text-muted-foreground",
};

export function GenerateCalendarDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (workingWeekdays: number[], halfDayWeekdays: number[]) => void;
  pending: boolean;
}) {
  const [states, setStates] = useState<Record<number, WeekdayState>>(INITIAL);

  useEffect(() => {
    if (!open) return;
    setStates(INITIAL);
  }, [open]);

  const cycle = (weekday: number) =>
    setStates((current) => ({
      ...current,
      [weekday]: NEXT_STATE[current[weekday] ?? "off"],
    }));

  const workingWeekdays = GRID_DAYS.filter(
    (d) => states[d.value] !== "off",
  ).map((d) => d.value);
  const halfDayWeekdays = GRID_DAYS.filter(
    (d) => states[d.value] === "half_day",
  ).map((d) => d.value);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.attendance.generateTitle}
      description={copy.attendance.generateHelp}
      submitLabel={copy.attendance.generate}
      pending={pending}
      disabled={workingWeekdays.length === 0}
      onSubmit={() => onSubmit(workingWeekdays, halfDayWeekdays)}
    >
      <FieldGroup>
        <Field>
          <FieldLabel>{copy.attendance.workingWeekdays}</FieldLabel>
          <div className="grid grid-cols-7 gap-2">
            {GRID_DAYS.map(({ value: weekday, key }) => {
              const state = states[weekday] ?? "off";
              return (
                <button
                  key={weekday}
                  type="button"
                  onClick={() => cycle(weekday)}
                  aria-label={`${copy.attendance.weekdays[key]}: ${STATE_COPY[state]}`}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-2 text-sm transition-colors hover:bg-accent ${STATE_STYLES[state]}`}
                >
                  <span className="font-medium">{copy.attendance.weekdays[key]}</span>
                  <span className="text-[10px] leading-none">{STATE_COPY[state]}</span>
                </button>
              );
            })}
          </div>
          <FieldDescription>
            {workingWeekdays.length === 0
              ? "At least one teaching day is required."
              : copy.attendance.generateStates.help}
          </FieldDescription>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}
