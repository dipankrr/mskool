"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createSchoolSchema, type CreateSchoolInput } from "@repo/contracts";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copy } from "@/lib/copy";
import type { School } from "@/lib/trpc/types";

/**
 * Create and edit share one form, because they take the same fields and a split
 * would let them drift.
 *
 * Validated with `createSchoolSchema` in both modes — the stricter of the two — even
 * though `update` accepts a partial. An edit form is prefilled, so every required
 * field already has a value, and a superset of `UpdateSchoolInput` is still valid
 * input for it. Using the loose schema for editing would let someone clear a
 * required field and only discover it from the server.
 *
 * **Empty optional fields become `undefined`, not `""`.** An untouched text input
 * yields an empty string, and `z.email().optional()` rejects that — so the form
 * would refuse to submit over a field the user deliberately left blank.
 * `setValueAs` on each optional field is what prevents it.
 */

const BOARDS = ["cbse", "icse", "state", "ib", "unaffiliated"] as const;

/** Blank means "not provided", which is not the same as an empty string. */
const optional = { setValueAs: (value: unknown) => (value === "" ? undefined : value) };

export function BranchFormDialog({
  open,
  onOpenChange,
  branch,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for an edit, absent for a create. */
  branch?: School;
  onSubmit: (data: CreateSchoolInput) => void;
  pending: boolean;
}) {
  const editing = Boolean(branch);

  const form = useForm<CreateSchoolInput>({
    resolver: zodResolver(createSchoolSchema),
    defaultValues: { board: "cbse" },
  });

  /**
   * Reset on open rather than on mount: the dialog stays mounted between openings,
   * so without this a second "Add branch" would show the previous branch's values.
   */
  useEffect(() => {
    if (!open) return;

    form.reset(
      branch
        ? {
            name: branch.name,
            legalName: branch.legalName,
            code: branch.code,
            board: branch.board,
            email: branch.email ?? undefined,
            phone: branch.phone ?? undefined,
            city: branch.city ?? undefined,
            state: branch.state ?? undefined,
            pincode: branch.pincode ?? undefined,
            udiseCode: branch.udiseCode ?? undefined,
          }
        : { board: "cbse" },
    );
  }, [open, branch, form]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? copy.branches.editTitle : copy.branches.addTitle}
      submitLabel={editing ? copy.common.save : copy.branches.add}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
    >
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="branch-name">{copy.branches.fields.name}</FieldLabel>
          <Input
            id="branch-name"
            aria-invalid={errors.name ? true : undefined}
            {...form.register("name")}
          />
          <FieldDescription>{copy.branches.fields.nameHelp}</FieldDescription>
          {errors.name ? <FieldError>{errors.name.message}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.legalName ? true : undefined}>
          <FieldLabel htmlFor="branch-legal">
            {copy.branches.fields.legalName}
          </FieldLabel>
          <Input
            id="branch-legal"
            aria-invalid={errors.legalName ? true : undefined}
            {...form.register("legalName")}
          />
          <FieldDescription>{copy.branches.fields.legalNameHelp}</FieldDescription>
          {errors.legalName ? <FieldError>{errors.legalName.message}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.code ? true : undefined}>
          <FieldLabel htmlFor="branch-code">{copy.branches.fields.code}</FieldLabel>
          <Input
            id="branch-code"
            /* The contract requires A-Z, 0-9 and hyphens, so uppercase as they type
               rather than rejecting what they typed. */
            className="uppercase"
            aria-invalid={errors.code ? true : undefined}
            {...form.register("code", {
              setValueAs: (value: unknown) =>
                typeof value === "string" ? value.toUpperCase().trim() : value,
            })}
          />
          <FieldDescription>{copy.branches.fields.codeHelp}</FieldDescription>
          {errors.code ? <FieldError>{errors.code.message}</FieldError> : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="branch-board">{copy.branches.boardLabel}</FieldLabel>
          <Select
            value={form.watch("board")}
            onValueChange={(value) =>
              form.setValue("board", value as CreateSchoolInput["board"])
            }
          >
            <SelectTrigger id="branch-board">
              <SelectValue>
                {(value: string | null) =>
                  value ? copy.branches.boards[value as (typeof BOARDS)[number]] : ""
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {BOARDS.map((board) => (
                  <SelectItem key={board} value={board}>
                    {copy.branches.boards[board]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>{copy.branches.boardHelp}</FieldDescription>
        </Field>

        <Field data-invalid={errors.phone ? true : undefined}>
          <FieldLabel htmlFor="branch-phone">{copy.branches.fields.phone}</FieldLabel>
          <Input
            id="branch-phone"
            inputMode="tel"
            aria-invalid={errors.phone ? true : undefined}
            {...form.register("phone", optional)}
          />
          {errors.phone ? <FieldError>{errors.phone.message}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="branch-email">{copy.branches.fields.email}</FieldLabel>
          <Input
            id="branch-email"
            type="email"
            aria-invalid={errors.email ? true : undefined}
            {...form.register("email", optional)}
          />
          {errors.email ? <FieldError>{errors.email.message}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.city ? true : undefined}>
          <FieldLabel htmlFor="branch-city">{copy.branches.fields.city}</FieldLabel>
          <Input id="branch-city" {...form.register("city", optional)} />
        </Field>

        <Field data-invalid={errors.state ? true : undefined}>
          <FieldLabel htmlFor="branch-state">{copy.branches.fields.state}</FieldLabel>
          <Input id="branch-state" {...form.register("state", optional)} />
        </Field>

        <Field data-invalid={errors.pincode ? true : undefined}>
          <FieldLabel htmlFor="branch-pincode">
            {copy.branches.fields.pincode}
          </FieldLabel>
          <Input
            id="branch-pincode"
            inputMode="numeric"
            aria-invalid={errors.pincode ? true : undefined}
            {...form.register("pincode", optional)}
          />
          {errors.pincode ? <FieldError>{errors.pincode.message}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.udiseCode ? true : undefined}>
          <FieldLabel htmlFor="branch-udise">
            {copy.branches.fields.udiseCode}
          </FieldLabel>
          <Input
            id="branch-udise"
            inputMode="numeric"
            aria-invalid={errors.udiseCode ? true : undefined}
            {...form.register("udiseCode", optional)}
          />
          <FieldDescription>{copy.branches.fields.udiseHelp}</FieldDescription>
          {errors.udiseCode ? <FieldError>{errors.udiseCode.message}</FieldError> : null}
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}
