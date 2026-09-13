"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  createStaffSchema,
  deactivateStaffSchema,
  updateStaffSchema,
  type CreateStaffInput,
  type DeactivateStaffInput,
  type UpdateStaffInput,
} from "@repo/contracts";
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
import type { Staff } from "@/lib/trpc/types";

/**
 * The staff register's three forms: add, edit, and the leaving dialog.
 *
 * **Empty optional fields become `undefined`, not `""`** (the
 * branch-form-dialog rule). Native `type="date"` inputs already yield ISO
 * `YYYY-MM-DD`, exactly what the contract wants.
 *
 * The create form is deliberately short — identity and posting. A login is
 * NOT offered here: ADR-035 keeps the credential a separate, audited act on
 * the detail page.
 */

const LEAVING_STATUSES = ["suspended", "resigned", "retired", "terminated"] as const;

/** Blank means "not provided", which is not the same as an empty string. */
const optional = { setValueAs: (value: unknown) => (value === "" ? undefined : value) };

export function CreateStaffDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateStaffInput) => void;
  pending: boolean;
}) {
  const form = useForm<CreateStaffInput>({
    resolver: zodResolver(createStaffSchema),
  });

  useEffect(() => {
    if (!open) return;
    form.reset({});
  }, [open, form]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.staff.addTitle}
      description={copy.staff.addHelp}
      submitLabel={copy.staff.add}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
    >
      <StaffFields register={form.register as unknown as RegisterFn} errors={errors} withCode />
    </FormDialog>
  );
}

export function EditStaffDialog({
  open,
  onOpenChange,
  staff,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: Staff;
  onSubmit: (data: UpdateStaffInput) => void;
  pending: boolean;
}) {
  const form = useForm<UpdateStaffInput>({
    resolver: zodResolver(updateStaffSchema),
  });

  useEffect(() => {
    if (!open) return;
    // The employee code is identity, not a field — it never edits.
    form.reset({
      firstName: staff.firstName,
      middleName: staff.middleName ?? undefined,
      lastName: staff.lastName,
      gender: staff.gender ?? undefined,
      dateOfBirth: staff.dateOfBirth ?? undefined,
      phone: staff.phone ?? undefined,
      email: staff.email ?? undefined,
      designation: staff.designation ?? undefined,
      department: staff.department ?? undefined,
      qualification: staff.qualification ?? undefined,
      dateOfJoining: staff.dateOfJoining ?? undefined,
    });
  }, [open, form, staff]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${staff.firstName} ${staff.lastName}`}
      description={copy.staff.fields.employeeCodeHelp}
      submitLabel={copy.common.save}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
    >
      <StaffFields register={form.register as unknown as RegisterFn} errors={errors} withCode={false} />
    </FormDialog>
  );
}

/**
 * The register's soft delete (hard rule 2) with the WHY made explicit: the
 * status is the record, and the consequence text says what survives.
 */
export function DeactivateStaffDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (data: DeactivateStaffInput) => void;
  pending: boolean;
}) {
  const form = useForm<DeactivateStaffInput>({
    resolver: zodResolver(deactivateStaffSchema),
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ status: "resigned" });
  }, [open, form]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.staff.deactivateTitle}
      description={copy.staff.deactivateBody}
      submitLabel={copy.staff.deactivateLabel}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onConfirm(data))}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="staff-leaving-status">
            {copy.staff.leavingStatus}
          </FieldLabel>
          <Select
            value={form.watch("status")}
            onValueChange={(value) =>
              form.setValue("status", value as DeactivateStaffInput["status"])
            }
          >
            <SelectTrigger id="staff-leaving-status">
              <SelectValue>
                {(value: string | null) =>
                  value
                    ? copy.staff.statuses[value as (typeof LEAVING_STATUSES)[number]]
                    : copy.common.none
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {LEAVING_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {copy.staff.statuses[status]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>{copy.staff.leavingStatusHelp}</FieldDescription>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}

/**
 * Shared fields for add and edit, bound through a minimal register shim so
 * one component serves both forms. withCode gates the employee code — it
 * is required and permanent, so the edit form never shows it.
 */
type RegisterFn = (
  name: string,
  options?: { setValueAs?: (value: unknown) => unknown },
) => Record<string, unknown>;

function StaffFields({
  register,
  errors,
  withCode,
}: {
  register: RegisterFn;
  errors: Record<string, { message?: string } | undefined>;
  withCode: boolean;
}) {
  return (
    <FieldGroup>
      {withCode ? (
        <Field data-invalid={errors.employeeCode ? true : undefined}>
          <FieldLabel htmlFor="staff-employee-code">
            {copy.staff.fields.employeeCode}
          </FieldLabel>
          <Input
            id="staff-employee-code"
            aria-invalid={errors.employeeCode ? true : undefined}
            {...register("employeeCode")}
          />
          <FieldDescription>{copy.staff.fields.employeeCodeHelp}</FieldDescription>
          {errors.employeeCode ? (
            <FieldError>{errors.employeeCode.message}</FieldError>
          ) : null}
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field data-invalid={errors.firstName ? true : undefined}>
          <FieldLabel htmlFor="staff-first-name">{copy.staff.fields.firstName}</FieldLabel>
          <Input
            id="staff-first-name"
            aria-invalid={errors.firstName ? true : undefined}
            {...register("firstName")}
          />
          {errors.firstName ? <FieldError>{errors.firstName.message}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.middleName ? true : undefined}>
          <FieldLabel htmlFor="staff-middle-name">{copy.staff.fields.middleName}</FieldLabel>
          <Input
            id="staff-middle-name"
            {...register("middleName", optional)}
          />
          {errors.middleName ? <FieldError>{errors.middleName.message}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.lastName ? true : undefined}>
          <FieldLabel htmlFor="staff-last-name">{copy.staff.fields.lastName}</FieldLabel>
          <Input
            id="staff-last-name"
            aria-invalid={errors.lastName ? true : undefined}
            {...register("lastName")}
          />
          {errors.lastName ? <FieldError>{errors.lastName.message}</FieldError> : null}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.designation ? true : undefined}>
          <FieldLabel htmlFor="staff-designation">{copy.staff.fields.designation}</FieldLabel>
          <Input
            id="staff-designation"
            {...register("designation", optional)}
          />
          {errors.designation ? <FieldError>{errors.designation.message}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.department ? true : undefined}>
          <FieldLabel htmlFor="staff-department">{copy.staff.fields.department}</FieldLabel>
          <Input
            id="staff-department"
            {...register("department", optional)}
          />
          {errors.department ? <FieldError>{errors.department.message}</FieldError> : null}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.dateOfJoining ? true : undefined}>
          <FieldLabel htmlFor="staff-joining">{copy.staff.fields.dateOfJoining}</FieldLabel>
          <Input
            id="staff-joining"
            type="date"
            {...register("dateOfJoining", optional)}
          />
          {errors.dateOfJoining ? (
            <FieldError>{errors.dateOfJoining.message}</FieldError>
          ) : null}
        </Field>

        <Field data-invalid={errors.dateOfBirth ? true : undefined}>
          <FieldLabel htmlFor="staff-dob">{copy.staff.fields.dateOfBirth}</FieldLabel>
          <Input
            id="staff-dob"
            type="date"
            {...register("dateOfBirth", optional)}
          />
          {errors.dateOfBirth ? <FieldError>{errors.dateOfBirth.message}</FieldError> : null}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.phone ? true : undefined}>
          <FieldLabel htmlFor="staff-phone">{copy.staff.fields.phone}</FieldLabel>
          <Input
            id="staff-phone"
            inputMode="tel"
            {...register("phone", optional)}
          />
          {errors.phone ? <FieldError>{errors.phone.message}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="staff-email">{copy.staff.fields.email}</FieldLabel>
          <Input
            id="staff-email"
            type="email"
            {...register("email", optional)}
          />
          {errors.email ? <FieldError>{errors.email.message}</FieldError> : null}
        </Field>
      </div>
    </FieldGroup>
  );
}
