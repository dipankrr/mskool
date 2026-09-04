"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  createFeeStructureSchema,
  type CreateFeeStructureInput,
} from "@repo/contracts";

import { FormDialog } from "@/components/form-dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClasses } from "@/features/classes/use-classes";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import type { FeeStructure } from "@/lib/trpc/types";
import type { FeeStructureInstallmentMode } from "./fee-enums";

/**
 * CREATE STRUCTURE — one structure per class per session (the unique index
 * the service enforces). The name is suggested from the class + session the
 * moment both are chosen, because nobody wants to type "Class 6 Fees
 * 2025-26" when the form already knows it — but the suggestion stays an
 * editable field, not a generated fact.
 *
 * Edit mode (structure prop) patches name/mode only; the class and session
 * selects are hidden rather than disabled — a thing that cannot move should
 * not appear to be a choice.
 */

const MODES: ReadonlyArray<FeeStructureInstallmentMode> = ["term_wise", "monthly", "upfront"];

export function StructureDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  structure,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateFeeStructureInput) => Promise<void> | void;
  pending: boolean;
  /** Present = edit mode (name + installment mode only). */
  structure?: FeeStructure;
}) {
  const isEdit = Boolean(structure);
  const { sessions, activeSession } = useActiveContext();
  const classes = useClasses();

  const form = useForm<CreateFeeStructureInput>({
    resolver: zodResolver(createFeeStructureSchema),
    defaultValues: { name: "", installmentMode: "term_wise" },
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      isEdit
        ? {
            academicYearId: structure?.academicYearId ?? "",
            classId: structure?.classId ?? "",
            name: structure?.name ?? "",
            installmentMode: structure?.installmentMode,
          }
        : { name: "", installmentMode: "term_wise" },
    );
  }, [open, isEdit, structure, form]);

  const errors = form.formState.errors;
  const classId = form.watch("classId");
  const yearId = form.watch("academicYearId");

  // Suggest the name once both anchors are chosen and the user has not
  // typed one — the suggestion is a starting point, never overwritten.
  useEffect(() => {
    if (isEdit || !classId || !yearId) return;
    if (form.getValues("name")) return;
    const cls = classes.data?.find((c) => c.id === classId);
    const year = sessions.find((s) => s.id === yearId);
    if (cls && year) {
      form.setValue("name", `${cls.name} — ${year.name}`);
    }
  }, [classId, yearId, classes.data, sessions, isEdit, form]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? copy.fees.structures.editTitle : copy.fees.structures.addTitle}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={isEdit ? copy.common.save : copy.common.create}
      pending={pending}
    >
      <FieldGroup>
        {!isEdit ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={errors.academicYearId ? true : undefined}>
              <FieldLabel htmlFor="structure-year">{copy.fees.structures.fields.academicYear}</FieldLabel>
              <Select
                value={yearId || undefined}
                onValueChange={(v) =>
                  form.setValue("academicYearId", v ?? "", { shouldValidate: true })
                }
              >
                <SelectTrigger id="structure-year" aria-invalid={errors.academicYearId ? true : undefined}>
                  <SelectValue>
                    {(value: string | null) =>
                      sessions.find((s) => s.id === value)?.name ??
                      activeSession?.name ??
                      copy.common.none}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{copy.fees.structures.fields.academicYearHelp}</FieldDescription>
              <FieldError>{errors.academicYearId?.message}</FieldError>
            </Field>

            <Field data-invalid={errors.classId ? true : undefined}>
              <FieldLabel htmlFor="structure-class">{copy.fees.structures.fields.class}</FieldLabel>
              <Select
                value={classId || undefined}
                onValueChange={(v) => form.setValue("classId", v ?? "", { shouldValidate: true })}
              >
                <SelectTrigger id="structure-class" aria-invalid={errors.classId ? true : undefined}>
                  <SelectValue>
                    {(value: string | null) =>
                      (classes.data ?? []).find((cls) => cls.id === value)?.name ??
                      copy.common.none}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(classes.data ?? []).map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{copy.fees.structures.fields.classHelp}</FieldDescription>
              <FieldError>{errors.classId?.message}</FieldError>
            </Field>
          </div>
        ) : null}

        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="structure-name">{copy.fees.structures.fields.name}</FieldLabel>
          <Input
            id="structure-name"
            placeholder="Class 6 — 2025-26"
            aria-invalid={errors.name ? true : undefined}
            {...form.register("name")}
          />
          <FieldDescription>{copy.fees.structures.fields.nameHelp}</FieldDescription>
          <FieldError>{errors.name?.message}</FieldError>
        </Field>

        <Field data-invalid={errors.installmentMode ? true : undefined}>
          <FieldLabel htmlFor="structure-mode">{copy.fees.structures.fields.installmentMode}</FieldLabel>
          <Select
            value={form.watch("installmentMode") ?? "term_wise"}
            onValueChange={(v) =>
              form.setValue("installmentMode", (v ?? "term_wise") as FeeStructureInstallmentMode)
            }
          >
              <SelectTrigger id="structure-mode" aria-invalid={errors.installmentMode ? true : undefined}>
                <SelectValue>
                  {(value: string | null) =>
                    (value
                      ? copy.fees.installmentModes[value as FeeStructureInstallmentMode]
                      : undefined) ?? copy.fees.installmentModes.term_wise}
                </SelectValue>
              </SelectTrigger>
            <SelectContent>
              {MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {copy.fees.installmentModes[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{copy.fees.structures.fields.installmentModeHelp}</FieldDescription>
          <FieldError>{errors.installmentMode?.message}</FieldError>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}
