"use client";

import { useEffect, useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { copy } from "@/lib/copy";
import { GRID_WEEKDAYS } from "@/lib/calendar-grid";

/**
 * The bulk generator's input: the weekdays a week is actually in session.
 * Monday–Friday pre-ticked — the overwhelmingly common shape, and the point
 * of a generator is that "the obvious thing" is one click. An empty
 * selection is refused (the contract's min(1); a school with no teaching
 * days is not a school).
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

/** Monday–Friday pre-ticked: the overwhelmingly common shape. */
const DEFAULT_WORKING: number[] = [1, 2, 3, 4, 5];

export function GenerateCalendarDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (workingWeekdays: number[]) => void;
  pending: boolean;
}) {
  const [selected, setSelected] = useState<number[]>(DEFAULT_WORKING);

  useEffect(() => {
    if (!open) return;
    setSelected(DEFAULT_WORKING);
  }, [open]);

  const toggle = (weekday: number) =>
    setSelected((current) =>
      current.includes(weekday)
        ? current.filter((w) => w !== weekday)
        : [...current, weekday].sort((a, b) => a - b),
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.attendance.generateTitle}
      description={copy.attendance.generateHelp}
      submitLabel={copy.attendance.generate}
      pending={pending}
      disabled={selected.length === 0}
      onSubmit={() => onSubmit(selected)}
    >
      <FieldGroup>
        <Field>
          <FieldLabel>{copy.attendance.workingWeekdays}</FieldLabel>
          <div className="grid grid-cols-7 gap-2">
            {GRID_DAYS.map(({ value: weekday, key }) => (
              <label
                key={weekday}
                className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-2 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={selected.includes(weekday)}
                  onCheckedChange={() => toggle(weekday)}
                />
                <span>{copy.attendance.weekdays[key]}</span>
              </label>
            ))}
          </div>
          <FieldDescription>
            {selected.length === 0
              ? "At least one teaching day is required."
              : undefined}
          </FieldDescription>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}
