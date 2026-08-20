"use client";

import { useEffect } from "react";
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
import { copy } from "@/lib/copy";
import type { Class } from "@/lib/trpc/types";

/**
 * Editing a class touches its label and its note — never its position.
 *
 * `numericOrder` is deliberately absent. It is unique per branch, so an edit field
 * for it is a collision waiting to happen on a number the user cannot reason about;
 * and reordering the ladder is not a thing a school does. Classes are added from the
 * ladder, which assigns the order, and a class in the wrong place is closed rather
 * than renumbered.
 *
 * No zod resolver here: the two editable fields are a bounded string and an optional
 * note, and `updateClassSchema` is a partial of the create schema, so validating
 * against it would accept `numericOrder` — a field this form has no business
 * carrying. Length limits are enforced by `maxLength` and by the server.
 */
export function ClassFormDialog({
  open,
  onOpenChange,
  cls,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cls?: Class;
  onSubmit: (data: { name: string; description?: string }) => void;
  pending: boolean;
}) {
  const form = useForm<{ name: string; description?: string }>();

  useEffect(() => {
    if (!open) return;

    form.reset({
      name: cls?.name ?? "",
      description: cls?.description ?? undefined,
    });
  }, [open, cls, form]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.classes.editTitle}
      pending={pending}
      onSubmit={form.handleSubmit((data) =>
        onSubmit({
          name: data.name.trim(),
          description: data.description?.trim() || undefined,
        }),
      )}
    >
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="class-name">{copy.classes.fields.name}</FieldLabel>
          <Input
            id="class-name"
            maxLength={100}
            aria-invalid={errors.name ? true : undefined}
            {...form.register("name", { required: copy.common.required })}
          />
          <FieldDescription>{copy.classes.fields.nameHelp}</FieldDescription>
          {errors.name ? <FieldError>{errors.name.message}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="class-note">{copy.classes.fields.description}</FieldLabel>
          <Input id="class-note" maxLength={255} {...form.register("description")} />
          <FieldDescription>{copy.classes.fields.descriptionHelp}</FieldDescription>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}
