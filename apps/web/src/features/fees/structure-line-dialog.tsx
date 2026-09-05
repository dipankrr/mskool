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
import { formatMoney, fromPaise, isMoneyString, toPaise } from "@/lib/money";
import type { FeeHead, FeeStructureLine } from "@/lib/trpc/types";
import type { FeeInstallmentFrequency } from "./fee-enums";

/**
 * ADD / EDIT a structure LINE — the head + annual amount + how it splits.
 * The money input is the wire format itself (the schema's regex): typing
 * "1200.505" is a FIELD error before any submit, which is the whole
 * "forms ARE the contracts" rule doing its job.
 *
 * The month window is two selects (1..12), not free typing — the from ≤ to
 * refinement then reads as a rule about choices, not a keyboard error.
 */

const FREQUENCIES: ReadonlyArray<FeeInstallmentFrequency> = [
  "inherit",
  "monthly",
  "quarterly",
  "half_yearly",
  "term_wise",
  "annual",
];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function monthLabel(month: number): string {
  return new Intl.DateTimeFormat("en-IN", { month: "short" }).format(new Date(2026, month - 1, 1));
}

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
        ? {
            annualAmount: line?.annualAmount ?? "",
            installmentFrequency: line?.installmentFrequency,
            applicableFromMonth: line?.applicableFromMonth,
            applicableToMonth: line?.applicableToMonth,
          }
        : {
            feeHeadId: "",
            annualAmount: "",
            installmentFrequency: "inherit",
            applicableFromMonth: 1,
            applicableToMonth: 12,
          },
    );
  }, [open, isEdit, line, form]);

  const errors = form.formState.errors;

  // Live preview (spec §27): fixed frequencies divide the annual amount
  // into equal instalments — paise arithmetic only, shown only when the
  // split is exact. inherit/term_wise depend on the structure, not the line.
  const previewAnnual = form.watch("annualAmount") ?? "";
  const previewFrequency = form.watch("installmentFrequency");
  const previewPeriods =
    previewFrequency === "monthly"
      ? 12
      : previewFrequency === "quarterly"
        ? 4
        : previewFrequency === "half_yearly"
          ? 2
          : previewFrequency === "annual"
            ? 1
            : 0;
  const previewPer =
    previewPeriods > 0 && isMoneyString(previewAnnual)
      ? (() => {
          const paise = toPaise(previewAnnual);
          const per = paise / BigInt(previewPeriods);
          return paise % BigInt(previewPeriods) === 0n ? fromPaise(per) : null;
        })()
      : null;

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
          <Field data-invalid={errors.annualAmount ? true : undefined}>
            <FieldLabel htmlFor="line-amount">{copy.fees.structures.lineFields.annualAmount}</FieldLabel>
            <Input
              id="line-amount"
              inputMode="decimal"
              placeholder="12000.00"
              aria-invalid={errors.annualAmount ? true : undefined}
              {...form.register("annualAmount")}
            />
            <FieldDescription>{copy.fees.structures.lineFields.annualAmountHelp}</FieldDescription>
            <FieldError>{errors.annualAmount?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.installmentFrequency ? true : undefined}>
            <FieldLabel htmlFor="line-frequency">
              {copy.fees.structures.lineFields.frequency}
            </FieldLabel>
            <Select
              value={form.watch("installmentFrequency")}
              onValueChange={(v) =>
                form.setValue("installmentFrequency", v as FeeInstallmentFrequency)
              }
            >
              <SelectTrigger id="line-frequency" aria-invalid={errors.installmentFrequency ? true : undefined}>
                <SelectValue>
                  {(value: string | null) =>
                    (value ? copy.fees.frequencies[value as FeeInstallmentFrequency] : undefined) ??
                    copy.fees.frequencies.inherit}
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
            <FieldDescription>{copy.fees.structures.lineFields.frequencyHelp}</FieldDescription>
            <FieldError>{errors.installmentFrequency?.message}</FieldError>
            {previewPer ? (
              <p className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
                {copy.fees.structures.lineFields.linePreview(
                  formatMoney(previewPer),
                  previewPeriods,
                )}
              </p>
            ) : null}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.applicableFromMonth ? true : undefined}>
            <FieldLabel htmlFor="line-from">{copy.fees.structures.lineFields.fromMonth}</FieldLabel>
            <Select
              value={String(form.watch("applicableFromMonth") ?? 1)}
              onValueChange={(v) => form.setValue("applicableFromMonth", Number(v), { shouldValidate: true })}
            >
              <SelectTrigger id="line-from" aria-invalid={errors.applicableFromMonth ? true : undefined}>
                <SelectValue>
                  {(value: string | null) => {
                    const m = Number(value);
                    return m >= 1 && m <= 12 ? monthLabel(m) : copy.common.none;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field data-invalid={errors.applicableToMonth ? true : undefined}>
            <FieldLabel htmlFor="line-to">{copy.fees.structures.lineFields.toMonth}</FieldLabel>
            <Select
              value={String(form.watch("applicableToMonth") ?? 12)}
              onValueChange={(v) => form.setValue("applicableToMonth", Number(v), { shouldValidate: true })}
            >
              <SelectTrigger id="line-to" aria-invalid={errors.applicableToMonth ? true : undefined}>
                <SelectValue>
                  {(value: string | null) => {
                    const m = Number(value);
                    return m >= 1 && m <= 12 ? monthLabel(m) : copy.common.none;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{copy.fees.structures.lineFields.monthsHelp}</FieldDescription>
            <FieldError>{errors.applicableToMonth?.message}</FieldError>
          </Field>
        </div>
      </FieldGroup>
    </FormDialog>
  );
}
