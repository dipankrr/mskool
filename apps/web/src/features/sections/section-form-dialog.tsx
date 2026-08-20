"use client";

import { InfoIcon } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { FormDialog } from "@/components/form-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { copy } from "@/lib/copy";
import type { Section } from "@/lib/trpc/types";

type SectionEdit = {
  name: string;
  stream?: string;
  house?: string;
  roomNumber?: string;
  maxStudents?: number;
};

/**
 * Editing a section, minus the two fields that would move it.
 *
 * `classId` and `academicYearId` are absent from `updateSectionSchema` on purpose, and
 * the UI explains why rather than leaving a puzzling gap: changing either would
 * relocate every student, attendance record and result attached to the section, and
 * leave its scope node's denormalised ancestry pointing at the old class (ADR-015).
 * A section in the wrong place is closed and re-created.
 *
 * `stream` is where Class 11's Science and Commerce live — the reason the class ladder
 * refuses to create two "Class 11" rows.
 */
export function SectionFormDialog({
  open,
  onOpenChange,
  section,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section?: Section;
  onSubmit: (data: SectionEdit) => void;
  pending: boolean;
}) {
  const form = useForm<SectionEdit>();

  useEffect(() => {
    if (!open) return;

    form.reset({
      name: section?.name ?? "",
      stream: section?.stream ?? undefined,
      house: section?.house ?? undefined,
      roomNumber: section?.roomNumber ?? undefined,
      maxStudents: section?.maxStudents ?? undefined,
    });
  }, [open, section, form]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.sections.editTitle}
      pending={pending}
      onSubmit={form.handleSubmit((data) =>
        onSubmit({
          name: data.name.trim(),
          stream: data.stream?.trim() || undefined,
          house: data.house?.trim() || undefined,
          roomNumber: data.roomNumber?.trim() || undefined,
          maxStudents: data.maxStudents ? Number(data.maxStudents) : undefined,
        }),
      )}
    >
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="section-name">{copy.sections.fields.name}</FieldLabel>
          <Input
            id="section-name"
            maxLength={50}
            aria-invalid={errors.name ? true : undefined}
            {...form.register("name", { required: copy.common.required })}
          />
          <FieldDescription>{copy.sections.fields.nameHelp}</FieldDescription>
          {errors.name ? <FieldError>{errors.name.message}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="section-stream">{copy.sections.fields.stream}</FieldLabel>
          <Input id="section-stream" maxLength={50} {...form.register("stream")} />
          <FieldDescription>{copy.sections.fields.streamHelp}</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="section-house">{copy.sections.fields.house}</FieldLabel>
          <Input id="section-house" maxLength={50} {...form.register("house")} />
        </Field>

        <Field>
          <FieldLabel htmlFor="section-room">
            {copy.sections.fields.roomNumber}
          </FieldLabel>
          <Input id="section-room" maxLength={20} {...form.register("roomNumber")} />
        </Field>

        <Field data-invalid={errors.maxStudents ? true : undefined}>
          <FieldLabel htmlFor="section-seats">
            {copy.sections.fields.maxStudents}
          </FieldLabel>
          <Input
            id="section-seats"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            aria-invalid={errors.maxStudents ? true : undefined}
            {...form.register("maxStudents", {
              // An empty number input reads as "", which is not a number and not a
              // deliberate zero.
              setValueAs: (value: unknown) =>
                value === "" || value === null ? undefined : Number(value),
              min: { value: 1, message: "At least 1." },
              max: { value: 200, message: "At most 200." },
            })}
          />
          <FieldDescription>{copy.sections.fields.maxStudentsHelp}</FieldDescription>
          {errors.maxStudents ? (
            <FieldError>{errors.maxStudents.message}</FieldError>
          ) : null}
        </Field>

        <Alert>
          <InfoIcon />
          <AlertDescription>{copy.sections.cannotMove}</AlertDescription>
        </Alert>
      </FieldGroup>
    </FormDialog>
  );
}
