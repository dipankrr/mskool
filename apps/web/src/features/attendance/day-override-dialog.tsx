"use client";

import { useEffect, useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import type { CalendarDay } from "@/lib/trpc/types";

const DAY_TYPES = ["working", "holiday", "half_day", "weekend", "exam_day"] as const;

/**
 * The single-date override — how a holiday, exam day, or half day enters the
 * calendar. **The reason follows the don't-wipe rule** (the service's, and
 * the plan's): leaving the field blank OMITS it from the payload, which the
 * backend reads as "keep what is stored". Clearing a reason is not offered —
 * it would need an explicit null, and a blank field asking "are you sure?"
 * is the wrong place for that decision.
 */
export function DayOverrideDialog({
  open,
  onOpenChange,
  day,
  date,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The day's current row, if it has one — undefined for a bare date. */
  day?: CalendarDay;
  date: string;
  onSubmit: (input: { date: string; dayType: (typeof DAY_TYPES)[number]; reason?: string }) => void;
  pending: boolean;
}) {
  const [dayType, setDayType] = useState<(typeof DAY_TYPES)[number]>("working");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setDayType(day?.dayType ?? "working");
    // Display-only: the STORED reason shows as a starting point, but an
    // unedited field is omitted from the payload (don't-wipe), and an edit
    // replaces it. No blank field can wipe anything.
    setReason(day?.reason ?? "");
  }, [open, day]);

  const canSubmit = Boolean(dayType);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.attendance.overrideTitle}
      description={formatIsoDate(date)}
      submitLabel={copy.attendance.override}
      pending={pending}
      disabled={!canSubmit}
      onSubmit={() => {
        if (!dayType) return;
        // Blank = not sent = the stored reason survives.
        onSubmit({ date, dayType, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="day-type">Day type</FieldLabel>
          <Select
            value={dayType}
            onValueChange={(value) => setDayType((value ?? "working") as (typeof DAY_TYPES)[number])}
          >
            <SelectTrigger id="day-type">
              <SelectValue>
                {(value: string | null) =>
                  value
                    ? copy.attendance.dayTypes[value as (typeof DAY_TYPES)[number]]
                    : copy.common.none
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {DAY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {copy.attendance.dayTypes[type]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="day-reason">{copy.attendance.reason}</FieldLabel>
          <Input
            id="day-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={255}
            placeholder={copy.attendance.reasonPlaceholder}
          />
          <FieldDescription>{copy.attendance.reasonPlaceholder}</FieldDescription>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}
