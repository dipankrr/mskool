"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  createConcessionSchema,
  type CreateConcessionInput,
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
import type { ConcessionCalculation, ConcessionType } from "./fee-enums";

/**
 * ADD CONCESSION — the cashier records a TYPE and a VALUE; the rupee
 * amount is computed by the server (percentage floors in the school's
 * favour) and toasted back. The help text says exactly that, because a
 * form that silently computed money client-side would be the one place
 * this slice breaks its own rule.
 *
 * The optional head select offers the structure's heads via a "All
 * heads" sentinel — null on the wire (the contract's nullish), not a
 * magic UUID. Validity window defaults to today → open-ended.
 */

const TYPES: ReadonlyArray<ConcessionType> = [
  "sibling_discount",
  "staff_ward",
  "merit_scholarship",
  "need_based",
  "rte_waiver",
  "management_discount",
  "other",
];

const CALCULATIONS: ReadonlyArray<ConcessionCalculation> = ["flat", "percentage"];

/** The wire's null-feeHeadId rendered as a choice, not a blank. */
const ALL_HEADS = "__all__";

export function ConcessionDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  headNames,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateConcessionInput) => Promise<void> | void;
  pending: boolean;
  /** feeHeadId → name, for the applies-to select. */
  headNames: Map<string, string>;
}) {
  const form = useForm<CreateConcessionInput>({
    resolver: zodResolver(createConcessionSchema),
    defaultValues: {
      concessionType: "merit_scholarship",
      calculationType: "percentage",
      validFrom: todayIso(),
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      concessionType: "merit_scholarship",
      calculationType: "percentage",
      validFrom: todayIso(),
      validTo: undefined,
      feeHeadId: null,
    });
  }, [open, form]);

  const errors = form.formState.errors;
  const calculation = form.watch("calculationType");
  const selectedHead = form.watch("feeHeadId") ?? ALL_HEADS;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.fees.profile.concessionTitle}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={copy.fees.profile.concession}
      pending={pending}
    >
      <FieldGroup>
        <p className="text-muted-foreground text-sm">{copy.fees.profile.concessionHelp}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.concessionType ? true : undefined}>
            <FieldLabel htmlFor="concession-type">{copy.fees.profile.concessionFields.type}</FieldLabel>
            <Select
              value={form.watch("concessionType")}
              onValueChange={(v) => form.setValue("concessionType", v as ConcessionType)}
            >
              <SelectTrigger id="concession-type" aria-invalid={errors.concessionType ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {copy.fees.concessionTypes[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field data-invalid={errors.calculationType ? true : undefined}>
            <FieldLabel htmlFor="concession-calc">
              {copy.fees.profile.concessionFields.calculation}
            </FieldLabel>
            <Select
              value={calculation}
              onValueChange={(v) => form.setValue("calculationType", v as ConcessionCalculation)}
            >
              <SelectTrigger id="concession-calc" aria-invalid={errors.calculationType ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALCULATIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {copy.fees.concessionCalculations[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.value ? true : undefined}>
            <FieldLabel htmlFor="concession-value">{copy.fees.profile.concessionFields.value}</FieldLabel>
            <Input
              id="concession-value"
              inputMode="decimal"
              placeholder={calculation === "percentage" ? "10.00" : "2000.00"}
              aria-invalid={errors.value ? true : undefined}
              {...form.register("value")}
            />
            <FieldDescription>{copy.fees.profile.concessionFields.valueHelp}</FieldDescription>
            <FieldError>{errors.value?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.feeHeadId ? true : undefined}>
            <FieldLabel htmlFor="concession-head">
              {copy.fees.profile.concessionFields.head}
            </FieldLabel>
            <Select
              value={selectedHead}
              onValueChange={(v) =>
                form.setValue("feeHeadId", v === ALL_HEADS ? null : v, { shouldValidate: true })
              }
            >
              <SelectTrigger id="concession-head" aria-invalid={errors.feeHeadId ? true : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_HEADS}>{copy.fees.profile.concessionFields.allHeads}</SelectItem>
                {[...headNames.entries()].map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{copy.fees.profile.concessionFields.headHelp}</FieldDescription>
            <FieldError>{errors.feeHeadId?.message}</FieldError>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.validFrom ? true : undefined}>
            <FieldLabel htmlFor="concession-from">{copy.fees.profile.concessionFields.from}</FieldLabel>
            <Input
              id="concession-from"
              type="date"
              aria-invalid={errors.validFrom ? true : undefined}
              {...form.register("validFrom")}
            />
            <FieldError>{errors.validFrom?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.validTo ? true : undefined}>
            <FieldLabel htmlFor="concession-to">{copy.fees.profile.concessionFields.to}</FieldLabel>
            <Input
              id="concession-to"
              type="date"
              aria-invalid={errors.validTo ? true : undefined}
              {...form.register("validTo", { setValueAs: (v) => (v === "" ? undefined : v) })}
            />
            <FieldDescription>{copy.fees.profile.concessionFields.windowHelp}</FieldDescription>
            <FieldError>{errors.validTo?.message}</FieldError>
          </Field>
        </div>

        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor="concession-reason">{copy.fees.profile.concessionFields.reason}</FieldLabel>
          <Input
            id="concession-reason"
            maxLength={500}
            aria-invalid={errors.reason ? true : undefined}
            {...form.register("reason", { setValueAs: (v) => (v === "" ? undefined : v) })}
          />
          <FieldDescription>{copy.fees.profile.concessionFields.reasonHelp}</FieldDescription>
          <FieldError>{errors.reason?.message}</FieldError>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}
