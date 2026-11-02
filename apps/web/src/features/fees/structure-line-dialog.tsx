"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  createFeeStructureLineSchema,
  updateFeeStructureLineSchema,
  type CreateFeeStructureLineInput,
  type UpdateFeeStructureLineInput,
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
import { copy } from "@/lib/copy";
import type { FeeHead, FeeStructureLine } from "@/lib/trpc/types";
import type { FeeInstallmentFrequency } from "./fee-enums";

/**
 * ADD / EDIT a structure LINE: the head, how often it charges, and how much per
 * period. New lines start from the months the school charges. Choosing months
 * and changing a single row are on the mobile app.
 */

const FREQUENCIES: ReadonlyArray<FeeInstallmentFrequency> = [
  "monthly",
  "quarterly",
  "half_yearly",
  "term_wise",
  "once",
];

export function StructureLineDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  line,
  heads,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateFeeStructureLineInput | UpdateFeeStructureLineInput) => Promise<void> | void;
  pending: boolean;
  /** Present = edit mode. */
  line?: FeeStructureLine;
  heads: FeeHead[];
}) {
  const isEdit = Boolean(line);

  const form = useForm<CreateFeeStructureLineInput>({
    resolver: zodResolver(isEdit ? updateFeeStructureLineSchema : createFeeStructureLineSchema) as never,
    defaultValues: {},
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      isEdit
        ? { amount: line?.amount ?? "", frequency: line?.frequency }
        : { feeHeadId: "", amount: "", frequency: "monthly" },
    );
  }, [open, isEdit, line, form]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? copy.common.edit : copy.fees.structures.addLine}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={isEdit ? copy.common.save : copy.common.add}
      pending={pending}
    >
      <FieldGroup>
        {!isEdit ? (
          <Field data-invalid={errors.feeHeadId ? true : undefined}>
            <FieldLabel htmlFor="line-head">{copy.fees.structures.lineFields.head}</FieldLabel>
            <Select
              value={form.watch("feeHeadId") || undefined}
              onValueChange={(v) => form.setValue("feeHeadId", v ?? "", { shouldValidate: true })}
            >
              <SelectTrigger id="line-head" aria-invalid={errors.feeHeadId ? true : undefined}>
                <SelectValue>
                  {(value: string | null) =>
                    heads.find((head) => head.id === value)?.name ?? copy.common.none}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {heads.map((head) => (
                  <SelectItem key={head.id} value={head.id}>
                    {head.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{copy.fees.structures.lineFields.headHelp}</FieldDescription>
            <FieldError>{errors.feeHeadId?.message}</FieldError>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.frequency ? true : undefined}>
            <FieldLabel htmlFor="line-frequency">
              {copy.fees.structures.lineFields.frequency}
            </FieldLabel>
            <Select
              value={form.watch("frequency")}
              onValueChange={(v) => form.setValue("frequency", v as FeeInstallmentFrequency)}
            >
              <SelectTrigger id="line-frequency" aria-invalid={errors.frequency ? true : undefined}>
                <SelectValue>
                  {(value: string | null) =>
                    (value ? copy.fees.frequencies[value as FeeInstallmentFrequency] : undefined) ??
                    copy.fees.frequencies.monthly}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((freq) => (
                  <SelectItem key={freq} value={freq}>
                    {copy.fees.frequencies[freq]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{errors.frequency?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.amount ? true : undefined}>
            <FieldLabel htmlFor="line-amount">{copy.fees.structures.lineFields.amount}</FieldLabel>
            <Input
              id="line-amount"
              inputMode="decimal"
              placeholder="1000.00"
              aria-invalid={errors.amount ? true : undefined}
              {...form.register("amount")}
            />
            <FieldDescription>{copy.fees.structures.lineFields.amountHelp}</FieldDescription>
            <FieldError>{errors.amount?.message}</FieldError>
          </Field>
        </div>
      </FieldGroup>
    </FormDialog>
  );
}
