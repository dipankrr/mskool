"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  createSubscriptionSchema,
  type CreateSubscriptionInput,
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
import type { FeeHead } from "@/lib/trpc/types";

/**
 * SUBSCRIBE — an optional-category head onto a student, priced monthly.
 * The head select offers ONLY optional heads (the service refuses the
 * rest with its own wording; filtering here is the field's affordance,
  not the gate). The student and year come from the card's context, so
 * this form is: service, detail, two amounts, window.
 */

export function SubscribeDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  optionalHeads,
  studentId,
  academicYearId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateSubscriptionInput) => Promise<void> | void;
  pending: boolean;
  /** Pre-filtered: category=optional, active. */
  optionalHeads: FeeHead[];
  /** The card's context — part of the form values, so the schema validates whole. */
  studentId: string;
  academicYearId: string;
}) {
  const form = useForm<CreateSubscriptionInput>({
    resolver: zodResolver(createSubscriptionSchema),
    defaultValues: { studentId, academicYearId, subscribedFrom: todayIso() },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      studentId,
      academicYearId,
      subscribedFrom: todayIso(),
      subscribedTo: undefined,
    });
  }, [open, studentId, academicYearId, form]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.fees.subscriptions.addTitle}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={copy.fees.subscriptions.add}
      pending={pending}
    >
      <FieldGroup>
        <Field data-invalid={errors.feeHeadId ? true : undefined}>
          <FieldLabel htmlFor="sub-head">{copy.fees.subscriptions.fields.head}</FieldLabel>
          <Select
            value={form.watch("feeHeadId") || undefined}
            onValueChange={(v) => form.setValue("feeHeadId", v ?? "", { shouldValidate: true })}
          >
            <SelectTrigger id="sub-head" aria-invalid={errors.feeHeadId ? true : undefined}>
              <SelectValue>
                {(value: string | null) =>
                  optionalHeads.find((head) => head.id === value)?.name ?? copy.common.none}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {optionalHeads.map((head) => (
                <SelectItem key={head.id} value={head.id}>
                  {head.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{copy.fees.subscriptions.fields.headHelp}</FieldDescription>
          <FieldError>{errors.feeHeadId?.message}</FieldError>
        </Field>

        <Field data-invalid={errors.serviceDetail ? true : undefined}>
          <FieldLabel htmlFor="sub-detail">{copy.fees.subscriptions.fields.detail}</FieldLabel>
          <Input
            id="sub-detail"
            placeholder="Route 3 — Dum Dum"
            maxLength={255}
            aria-invalid={errors.serviceDetail ? true : undefined}
            {...form.register("serviceDetail", { setValueAs: (v) => (v === "" ? undefined : v) })}
          />
          <FieldDescription>{copy.fees.subscriptions.fields.detailHelp}</FieldDescription>
          <FieldError>{errors.serviceDetail?.message}</FieldError>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.monthlyAmount ? true : undefined}>
            <FieldLabel htmlFor="sub-monthly">{copy.fees.subscriptions.fields.monthly}</FieldLabel>
            <Input
              id="sub-monthly"
              inputMode="decimal"
              placeholder="800.00"
              aria-invalid={errors.monthlyAmount ? true : undefined}
              {...form.register("monthlyAmount")}
            />
            <FieldError>{errors.monthlyAmount?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.annualAmount ? true : undefined}>
            <FieldLabel htmlFor="sub-annual">{copy.fees.subscriptions.fields.annual}</FieldLabel>
            <Input
              id="sub-annual"
              inputMode="decimal"
              placeholder="9600.00"
              aria-invalid={errors.annualAmount ? true : undefined}
              {...form.register("annualAmount")}
            />
            <FieldError>{errors.annualAmount?.message}</FieldError>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.subscribedFrom ? true : undefined}>
            <FieldLabel htmlFor="sub-from">{copy.fees.subscriptions.fields.from}</FieldLabel>
            <Input
              id="sub-from"
              type="date"
              aria-invalid={errors.subscribedFrom ? true : undefined}
              {...form.register("subscribedFrom")}
            />
            <FieldError>{errors.subscribedFrom?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.subscribedTo ? true : undefined}>
            <FieldLabel htmlFor="sub-to">{copy.fees.subscriptions.fields.to}</FieldLabel>
            <Input
              id="sub-to"
              type="date"
              aria-invalid={errors.subscribedTo ? true : undefined}
              {...form.register("subscribedTo", { setValueAs: (v) => (v === "" ? undefined : v) })}
            />
            <FieldDescription>{copy.fees.subscriptions.fields.windowHelp}</FieldDescription>
            <FieldError>{errors.subscribedTo?.message}</FieldError>
          </Field>
        </div>
      </FieldGroup>
    </FormDialog>
  );
}
