"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  createLateFeeRuleSchema,
  type CreateLateFeeRuleInput,
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
import { todayIso } from "@/lib/format";
import type { LateFeeCalculationType } from "./fee-enums";

/**
 * ADD LATE-FEE RULE — create only, deliberately: the router exposes no
 * update or deactivate (a recorded deferral), so the honest UI says so in
 * the help text — a rule is sunset by its effective-until date, and a new
 * one takes over. Nothing here pretends editing exists.
 *
 * `value` and `maxLateFee` are money-string fields (the wire format);
 * grace days is a plain int. The calculation type decides what the value
 * MEANS, and the help text follows the selection.
 */

const TYPES: ReadonlyArray<LateFeeCalculationType> = ["flat", "percentage", "per_day"];

export function LateFeeRuleDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateLateFeeRuleInput) => Promise<void> | void;
  pending: boolean;
}) {
  const form = useForm<CreateLateFeeRuleInput>({
    resolver: zodResolver(createLateFeeRuleSchema),
    defaultValues: {
      gracePeriodDays: 0,
      calculationType: "flat",
      effectiveFrom: todayIso(),
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      gracePeriodDays: 0,
      calculationType: "flat",
      effectiveFrom: todayIso(),
    });
  }, [open, form]);

  const errors = form.formState.errors;
  const type = form.watch("calculationType");

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.fees.structures.addLateFeeRule}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={copy.common.add}
      pending={pending}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.calculationType ? true : undefined}>
            <FieldLabel htmlFor="rule-type">{copy.fees.structures.lateFeeFields.type}</FieldLabel>
            <Select
              value={type}
              onValueChange={(v) => form.setValue("calculationType", v as LateFeeCalculationType)}
            >
              <SelectTrigger id="rule-type" aria-invalid={errors.calculationType ? true : undefined}>
                <SelectValue>
                  {(value: string | null) =>
                    (value ? copy.fees.lateFeeTypes[value as LateFeeCalculationType] : undefined) ??
                    copy.common.none}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {copy.fees.lateFeeTypes[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field data-invalid={errors.gracePeriodDays ? true : undefined}>
            <FieldLabel htmlFor="rule-grace">{copy.fees.structures.lateFeeFields.graceDays}</FieldLabel>
            <Input
              id="rule-grace"
              type="number"
              min={0}
              max={365}
              placeholder="15"
              aria-invalid={errors.gracePeriodDays ? true : undefined}
              {...form.register("gracePeriodDays", { valueAsNumber: true })}
            />
            <FieldDescription>{copy.fees.structures.lateFeeFields.graceDaysHelp}</FieldDescription>
            <FieldError>{errors.gracePeriodDays?.message}</FieldError>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.value ? true : undefined}>
            <FieldLabel htmlFor="rule-value">{copy.fees.structures.lateFeeFields.value}</FieldLabel>
            <Input
              id="rule-value"
              inputMode="decimal"
              placeholder={type === "percentage" ? "5.00" : "50.00"}
              aria-invalid={errors.value ? true : undefined}
              {...form.register("value")}
            />
            <FieldDescription>{copy.fees.structures.lateFeeFields.valueHelp}</FieldDescription>
            <FieldError>{errors.value?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.maxLateFee ? true : undefined}>
            <FieldLabel htmlFor="rule-max">{copy.fees.structures.lateFeeFields.max}</FieldLabel>
            <Input
              id="rule-max"
              inputMode="decimal"
              placeholder="500.00"
              aria-invalid={errors.maxLateFee ? true : undefined}
              {...form.register("maxLateFee", { setValueAs: (v) => (v === "" ? undefined : v) })}
            />
            <FieldDescription>{copy.fees.structures.lateFeeFields.maxHelp}</FieldDescription>
            <FieldError>{errors.maxLateFee?.message}</FieldError>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.effectiveFrom ? true : undefined}>
            <FieldLabel htmlFor="rule-from">{copy.fees.structures.lateFeeFields.from}</FieldLabel>
            <Input
              id="rule-from"
              type="date"
              aria-invalid={errors.effectiveFrom ? true : undefined}
              {...form.register("effectiveFrom")}
            />
            <FieldError>{errors.effectiveFrom?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.effectiveTo ? true : undefined}>
            <FieldLabel htmlFor="rule-to">{copy.fees.structures.lateFeeFields.to}</FieldLabel>
            <Input
              id="rule-to"
              type="date"
              aria-invalid={errors.effectiveTo ? true : undefined}
              {...form.register("effectiveTo", { setValueAs: (v) => (v === "" ? undefined : v) })}
            />
            <FieldDescription>{copy.fees.structures.lateFeeFields.windowHelp}</FieldDescription>
            <FieldError>{errors.effectiveTo?.message}</FieldError>
          </Field>
        </div>
      </FieldGroup>
    </FormDialog>
  );
}
