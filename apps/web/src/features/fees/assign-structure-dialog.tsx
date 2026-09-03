"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import type { AssignFeeStructureInput } from "@repo/contracts";
import { assignFeeStructureSchema } from "@repo/contracts";

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
import { Switch } from "@/components/ui/switch";
import { copy } from "@/lib/copy";

/**
 * ASSIGN STRUCTURE — the caller does NOT pick a structure: the service
 * resolves the class's active one onto the enrollment (the plan's S1
 * decision, stated in the help text so the absence of a structure select
 * reads as design, not omission). What the caller DOES choose: which
 * enrollment (a student can have several years), the effective-from
 * date, and whether the joining month charges in full.
 */

export function AssignStructureDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  enrollments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: AssignFeeStructureInput) => Promise<void> | void;
  pending: boolean;
  /** enrollmentId → label, from the student detail page's enrollment list. */
  enrollments: ReadonlyArray<{ id: string; label: string }>;
}) {
  const form = useForm<AssignFeeStructureInput>({
    resolver: zodResolver(assignFeeStructureSchema),
    defaultValues: { joiningMonthFullCharge: true },
  });

  useEffect(() => {
    if (!open) return;
    const first = enrollments[0];
    form.reset({
      enrollmentId: first?.id ?? "",
      feeEffectiveFrom: undefined,
      joiningMonthFullCharge: true,
    });
  }, [open, enrollments, form]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.fees.profile.assignTitle}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={copy.fees.profile.assignAction}
      pending={pending}
    >
      <FieldGroup>
        <p className="text-muted-foreground text-sm">{copy.fees.profile.assignHelp}</p>

        <Field data-invalid={errors.enrollmentId ? true : undefined}>
          <FieldLabel htmlFor="assign-enrollment">{copy.fees.profile.fields.enrollment}</FieldLabel>
          <Select
            value={form.watch("enrollmentId") || undefined}
            onValueChange={(v) => form.setValue("enrollmentId", v ?? "", { shouldValidate: true })}
          >
            <SelectTrigger id="assign-enrollment" aria-invalid={errors.enrollmentId ? true : undefined}>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {enrollments.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{copy.fees.profile.fields.enrollmentHelp}</FieldDescription>
          <FieldError>{errors.enrollmentId?.message}</FieldError>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.feeEffectiveFrom ? true : undefined}>
            <FieldLabel htmlFor="assign-from">{copy.fees.profile.fields.effectiveFrom}</FieldLabel>
            <Input
              id="assign-from"
              type="date"
              aria-invalid={errors.feeEffectiveFrom ? true : undefined}
              {...form.register("feeEffectiveFrom", {
                setValueAs: (v) => (v === "" ? undefined : v),
              })}
            />
            <FieldDescription>{copy.fees.profile.fields.effectiveFromHelp}</FieldDescription>
            <FieldError>{errors.feeEffectiveFrom?.message}</FieldError>
          </Field>

          <Field>
            <div className="flex items-center gap-2">
              <Switch
                id="assign-full-month"
                checked={form.watch("joiningMonthFullCharge") ?? true}
                onCheckedChange={(checked) => form.setValue("joiningMonthFullCharge", checked)}
              />
              <FieldLabel htmlFor="assign-full-month" className="!gap-1">
                {copy.fees.profile.fields.fullJoiningMonth}
              </FieldLabel>
            </div>
            <FieldDescription>{copy.fees.profile.fields.fullJoiningMonthHelp}</FieldDescription>
          </Field>
        </div>
      </FieldGroup>
    </FormDialog>
  );
}
