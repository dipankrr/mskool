"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  createAcademicYearSchema,
  type CreateAcademicYearInput,
} from "@repo/contracts";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { FormDialog } from "@/components/form-dialog";
import {
  Field,
  FieldDescription,
  FieldError,
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
import { Switch } from "@/components/ui/switch";
import { copy } from "@/lib/copy";
import {
  formatIsoDateRange,
  sessionFromStartYear,
  sessionStartYearOptions,
} from "@/lib/format";
import type { AcademicYear } from "@/lib/trpc/types";

/**
 * Creating a session is one choice — which year — not three fields.
 *
 * Typing two dates by hand is where the overlapping-session mistake comes from, and
 * an overlap is refused by an exclusion constraint the user has no way to anticipate.
 * So the default is a preset: pick a start year, get 1 April to 31 March and the
 * `2025-26` name derived from it. Manual entry stays available behind a switch for
 * the schools whose year genuinely differs.
 *
 * Editing is always manual — the dates already exist, and re-deriving them from a
 * preset would silently discard an amendment someone made deliberately.
 *
 * `isCurrent` and `originalEndDate` are not fields here, and the contract omits them
 * for good reasons: promoting a session is a transition between two rows
 * (`academic.year.setCurrent`), and the original end date is frozen at creation so
 * "was this year extended?" stays answerable.
 */
export function SessionFormDialog({
  open,
  onOpenChange,
  session,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session?: AcademicYear;
  onSubmit: (data: CreateAcademicYearInput) => void;
  pending: boolean;
}) {
  const editing = Boolean(session);
  const [manual, setManual] = useState(false);

  const form = useForm<CreateAcademicYearInput>({
    resolver: zodResolver(createAcademicYearSchema),
  });

  const startYears = sessionStartYearOptions();
  const [startYear, setStartYear] = useState<number>(startYears[1] ?? 2025);

  /** Reset on open: the dialog stays mounted, so stale values would persist. */
  useEffect(() => {
    if (!open) return;

    if (session) {
      setManual(true);
      form.reset({
        name: session.name,
        startDate: session.startDate,
        endDate: session.endDate,
      });
      return;
    }

    const preset = sessionFromStartYear(startYears[1] ?? 2025);
    setManual(false);
    setStartYear(startYears[1] ?? 2025);
    form.reset(preset);
    // `startYears` is derived from today and stable within a render pass; including
    // it would reset the form on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session, form]);

  /** Choosing a year rewrites all three fields, because they are one decision. */
  const applyPreset = (year: number) => {
    setStartYear(year);
    const preset = sessionFromStartYear(year);
    form.setValue("name", preset.name);
    form.setValue("startDate", preset.startDate);
    form.setValue("endDate", preset.endDate);
  };

  const errors = form.formState.errors;
  const values = form.watch();

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? copy.sessions.editTitle : copy.sessions.addTitle}
      submitLabel={editing ? copy.common.save : copy.sessions.add}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
    >
      <FieldGroup>
        {!editing ? (
          <Field orientation="horizontal">
            <FieldLabel htmlFor="session-manual">
              {copy.sessions.fields.customDates}
            </FieldLabel>
            <Switch
              id="session-manual"
              checked={manual}
              onCheckedChange={(checked) => setManual(Boolean(checked))}
            />
          </Field>
        ) : null}

        {!editing && !manual ? (
          <Field>
            <FieldLabel htmlFor="session-year">
              {copy.sessions.fields.startYear}
            </FieldLabel>
            <Select
              value={String(startYear)}
              onValueChange={(value) => applyPreset(Number(value))}
            >
              <SelectTrigger id="session-year">
                <SelectValue>
                  {(value: string | null) =>
                    value ? sessionFromStartYear(Number(value)).name : ""
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {startYears.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {sessionFromStartYear(year).name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              {copy.sessions.fields.startYearHelp} —{" "}
              {formatIsoDateRange(values.startDate, values.endDate)}
            </FieldDescription>
          </Field>
        ) : null}

        {/*
          The name and dates are always registered, even when the preset is driving
          them: hiding an input does not unregister it, and the values it holds are
          exactly what gets submitted.
        */}
        <div className={!editing && !manual ? "hidden" : "flex flex-col gap-4"}>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="session-name">{copy.sessions.fields.name}</FieldLabel>
            <Input
              id="session-name"
              aria-invalid={errors.name ? true : undefined}
              {...form.register("name")}
            />
            <FieldDescription>{copy.sessions.fields.nameHelp}</FieldDescription>
            {errors.name ? <FieldError>{errors.name.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.startDate ? true : undefined}>
            <FieldLabel htmlFor="session-start">
              {copy.sessions.fields.startDate}
            </FieldLabel>
            {/*
              A native date input, so the phone's own picker opens and the value is
              already the ISO string the wire expects — no parsing, and it displays
              in the reader's locale, which here is DD/MM/YYYY.
            */}
            <Input
              id="session-start"
              type="date"
              aria-invalid={errors.startDate ? true : undefined}
              {...form.register("startDate")}
            />
            {errors.startDate ? (
              <FieldError>{errors.startDate.message}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={errors.endDate ? true : undefined}>
            <FieldLabel htmlFor="session-end">{copy.sessions.fields.endDate}</FieldLabel>
            <Input
              id="session-end"
              type="date"
              aria-invalid={errors.endDate ? true : undefined}
              {...form.register("endDate")}
            />
            {errors.endDate ? <FieldError>{errors.endDate.message}</FieldError> : null}
          </Field>
        </div>
      </FieldGroup>
    </FormDialog>
  );
}
