"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  createFeeHeadSchema,
  updateFeeHeadSchema,
  type CreateFeeHeadInput,
  type UpdateFeeHeadInput,
} from "@repo/contracts";

import type { FeeHead } from "@/lib/trpc/types";

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
import type { FeeHeadCategory } from "./fee-enums";

/**
 * CREATE + EDIT fee head — one component, the schema does the work:
 * create validates the full shape; edit validates the partial one, and
 * the form's `defaultValues` decide which resolver is in play (the
 * presence of a `head` prop). The tax refinement (`isTaxable` →
 * `taxPercentage` required) is the CONTRACT's, so the field error the
 * user sees is the same rule the server enforces — no client-side
 * re-statement to drift.
 *
 * `taxPercentage` is a wire money-ish string ("18", "18.00") but the
 * input is decimal-typed, `inputMode="decimal"` for the phone keypad.
 */
type HeadFormValues = CreateFeeHeadInput;

const CATEGORY_VALUES = ["regular", "one_time", "optional", "fine", "refundable"] as const;

export function FeeHeadDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  head,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateFeeHeadInput | UpdateFeeHeadInput) => Promise<void> | void;
  pending: boolean;
  /** Present = edit mode. Wire shape (string timestamps) — see lib/trpc/types. */
  head?: FeeHead;
}) {
  const isEdit = Boolean(head);

  const form = useForm<HeadFormValues>({
    /*
     * Both schemas validate the same field names (create requires, update
     * partials); one form type serves both because update's output is a
     * subset shape of create's. The cast is only for the resolver's
     * generic variance — the runtime validation is the contract's own.
     */
    resolver: zodResolver(isEdit ? updateFeeHeadSchema : createFeeHeadSchema) as never,
    defaultValues: {},
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      isEdit
        ? {
            name: head?.name ?? "",
            shortCode: head?.shortCode ?? undefined,
            description: head?.description ?? undefined,
            category: head?.category as FeeHeadCategory,
            isTaxable: head?.isTaxable,
            taxPercentage: head?.taxPercentage ?? undefined,
          }
        : { name: "", category: "regular", isTaxable: false },
    );
  }, [open, isEdit, head, form]);

  const errors = form.formState.errors;
  const isTaxable = form.watch("isTaxable");

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? copy.fees.heads.editTitle : copy.fees.heads.addTitle}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={isEdit ? copy.common.save : copy.common.create}
      pending={pending}
    >
      <FieldGroup>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="fee-head-name">{copy.fees.heads.fields.name}</FieldLabel>
            <Input
              id="fee-head-name"
              placeholder="Tuition Fee"
              aria-invalid={errors.name ? true : undefined}
              {...form.register("name")}
            />
            <FieldDescription>{copy.fees.heads.fields.nameHelp}</FieldDescription>
            <FieldError>{errors.name?.message}</FieldError>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={errors.shortCode ? true : undefined}>
              <FieldLabel htmlFor="fee-head-code">{copy.fees.heads.fields.shortCode}</FieldLabel>
              <Input
                id="fee-head-code"
                placeholder="TUIF"
                maxLength={20}
                aria-invalid={errors.shortCode ? true : undefined}
                {...form.register("shortCode", { setValueAs: (v) => (v === "" ? undefined : v) })}
              />
              <FieldDescription>{copy.fees.heads.fields.shortCodeHelp}</FieldDescription>
              <FieldError>{errors.shortCode?.message}</FieldError>
            </Field>

            <Field data-invalid={errors.category ? true : undefined}>
              <FieldLabel htmlFor="fee-head-category">{copy.fees.heads.fields.category}</FieldLabel>
              <Select
                value={form.watch("category")}
                onValueChange={(v) => form.setValue("category", v as FeeHeadCategory)}
              >
                <SelectTrigger id="fee-head-category" aria-invalid={errors.category ? true : undefined}>
                  <SelectValue>
                    {(value: string | null) =>
                      (value ? copy.fees.headCategories[value as FeeHeadCategory] : undefined) ??
                      copy.common.none}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {copy.fees.headCategories[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{copy.fees.heads.fields.categoryHelp}</FieldDescription>
              <FieldError>{errors.category?.message}</FieldError>
            </Field>
          </div>

          <Field data-invalid={errors.description ? true : undefined}>
            <FieldLabel htmlFor="fee-head-description">{copy.fees.heads.fields.description}</FieldLabel>
            <Input
              id="fee-head-description"
              maxLength={255}
              aria-invalid={errors.description ? true : undefined}
              {...form.register("description", { setValueAs: (v) => (v === "" ? undefined : v) })}
            />
            <FieldError>{errors.description?.message}</FieldError>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <div className="flex items-center gap-2">
                <Switch
                  id="fee-head-taxable"
                  checked={Boolean(isTaxable)}
                  onCheckedChange={(checked) => form.setValue("isTaxable", checked)}
                />
                <FieldLabel htmlFor="fee-head-taxable" className="!gap-1">
                  {copy.fees.heads.fields.isTaxable}
                </FieldLabel>
              </div>
              <FieldDescription>{copy.fees.heads.fields.isTaxableHelp}</FieldDescription>
            </Field>

            {isTaxable ? (
              <Field data-invalid={errors.taxPercentage ? true : undefined}>
                <FieldLabel htmlFor="fee-head-tax">{copy.fees.heads.fields.taxPercentage}</FieldLabel>
                <Input
                  id="fee-head-tax"
                  inputMode="decimal"
                  placeholder="18"
                  aria-invalid={errors.taxPercentage ? true : undefined}
                  {...form.register("taxPercentage", {
                    setValueAs: (v) => (v === "" ? undefined : v),
                  })}
                />
                <FieldDescription>{copy.fees.heads.fields.taxPercentageHelp}</FieldDescription>
                <FieldError>{errors.taxPercentage?.message}</FieldError>
              </Field>
            ) : null}
          </div>
        </FieldGroup>
    </FormDialog>
  );
}
