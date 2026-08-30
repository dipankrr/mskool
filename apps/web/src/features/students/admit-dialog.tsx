"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createStudentSchema, type CreateStudentInput } from "@repo/contracts";
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

/**
 * The admission form. Identity (admission number, name, DOB, gender) is
 * required by the contract; contact details are optional because a school
 * admits first and fills the rest when the family comes in — the detail
 * page (U2) owns the wider edit.
 *
 * **Empty optional fields become `undefined`, not `""`** (the
 * branch-form-dialog rule): an untouched input yields an empty string, and
 * an empty string is not a phone number. The date inputs are native
 * `type="date"` — their value is already ISO `YYYY-MM-DD`, exactly what the
 * contract wants, and never a localized display string.
 */

const GENDERS = ["male", "female", "other"] as const;

/** Blank means "not provided", which is not the same as an empty string. */
const optional = { setValueAs: (value: unknown) => (value === "" ? undefined : value) };

export function AdmitStudentDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateStudentInput) => void;
  pending: boolean;
}) {
  const form = useForm<CreateStudentInput>({
    resolver: zodResolver(createStudentSchema),
  });

  /** Reset on open: the dialog stays mounted between openings. */
  useEffect(() => {
    if (!open) return;
    form.reset({});
  }, [open, form]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.students.addTitle}
      description={copy.students.addHelp}
      submitLabel={copy.students.add}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
    >
      <FieldGroup>
        <Field data-invalid={errors.admissionNumber ? true : undefined}>
          <FieldLabel htmlFor="student-admission-number">
            {copy.students.fields.admissionNumber}
          </FieldLabel>
          <Input
            id="student-admission-number"
            aria-invalid={errors.admissionNumber ? true : undefined}
            {...form.register("admissionNumber")}
          />
          <FieldDescription>{copy.students.fields.admissionNumberHelp}</FieldDescription>
          {errors.admissionNumber ? (
            <FieldError>{errors.admissionNumber.message}</FieldError>
          ) : null}
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={errors.firstName ? true : undefined}>
            <FieldLabel htmlFor="student-first-name">
              {copy.students.fields.firstName}
            </FieldLabel>
            <Input
              id="student-first-name"
              aria-invalid={errors.firstName ? true : undefined}
              {...form.register("firstName")}
            />
            {errors.firstName ? <FieldError>{errors.firstName.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.middleName ? true : undefined}>
            <FieldLabel htmlFor="student-middle-name">
              {copy.students.fields.middleName}
            </FieldLabel>
            <Input
              id="student-middle-name"
              {...form.register("middleName", optional)}
            />
            {errors.middleName ? <FieldError>{errors.middleName.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.lastName ? true : undefined}>
            <FieldLabel htmlFor="student-last-name">
              {copy.students.fields.lastName}
            </FieldLabel>
            <Input
              id="student-last-name"
              aria-invalid={errors.lastName ? true : undefined}
              {...form.register("lastName")}
            />
            {errors.lastName ? <FieldError>{errors.lastName.message}</FieldError> : null}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.dateOfBirth ? true : undefined}>
            <FieldLabel htmlFor="student-dob">{copy.students.fields.dateOfBirth}</FieldLabel>
            <Input
              id="student-dob"
              type="date"
              aria-invalid={errors.dateOfBirth ? true : undefined}
              {...form.register("dateOfBirth")}
            />
            {errors.dateOfBirth ? <FieldError>{errors.dateOfBirth.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.gender ? true : undefined}>
            <FieldLabel htmlFor="student-gender">{copy.students.fields.gender}</FieldLabel>
            <Select
              value={form.watch("gender")}
              onValueChange={(value) =>
                form.setValue("gender", value as CreateStudentInput["gender"])
              }
            >
              <SelectTrigger id="student-gender" aria-invalid={errors.gender ? true : undefined}>
                <SelectValue>
                  {(value: string | null) =>
                    value ? copy.students.genders[value as (typeof GENDERS)[number]] : copy.common.none
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {GENDERS.map((gender) => (
                    <SelectItem key={gender} value={gender}>
                      {copy.students.genders[gender]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {errors.gender ? <FieldError>{errors.gender.message}</FieldError> : null}
          </Field>
        </div>

        <Field data-invalid={errors.admissionDate ? true : undefined}>
          <FieldLabel htmlFor="student-admission-date">
            {copy.students.fields.admissionDate}
          </FieldLabel>
          <Input
            id="student-admission-date"
            type="date"
            aria-invalid={errors.admissionDate ? true : undefined}
            {...form.register("admissionDate", optional)}
          />
          <FieldDescription>{copy.students.fields.admissionDateHelp}</FieldDescription>
          {errors.admissionDate ? (
            <FieldError>{errors.admissionDate.message}</FieldError>
          ) : null}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.phone ? true : undefined}>
            <FieldLabel htmlFor="student-phone">{copy.students.fields.phone}</FieldLabel>
            <Input
              id="student-phone"
              inputMode="tel"
              aria-invalid={errors.phone ? true : undefined}
              {...form.register("phone", optional)}
            />
            {errors.phone ? <FieldError>{errors.phone.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="student-email">{copy.students.fields.email}</FieldLabel>
            <Input
              id="student-email"
              type="email"
              aria-invalid={errors.email ? true : undefined}
              {...form.register("email", optional)}
            />
            {errors.email ? <FieldError>{errors.email.message}</FieldError> : null}
          </Field>
        </div>
      </FieldGroup>
    </FormDialog>
  );
}
