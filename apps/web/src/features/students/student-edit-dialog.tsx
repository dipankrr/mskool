"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { updateStudentSchema, type UpdateStudentInput } from "@repo/contracts";
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
import { copy } from "@/lib/copy";
import type { Student } from "@/lib/trpc/types";

/**
 * Edit a student's demographics and contact details. Identity (admission
 * number) and life cycle (status) are deliberately absent — the contract
 * omits them, so the form cannot offer them.
 *
 * Prefilled from the row; empty optional fields become `undefined`, not ""
 * (the branch-dialog rule). The schema is PARTIAL server-side, but the form
 * submits the whole shape — every field arrives prefilled, so a superset of
 * the update schema is still valid input.
 */

/** Blank means "not provided", which is not the same as an empty string. */
const optional = { setValueAs: (value: unknown) => (value === "" ? undefined : value) };

export function StudentEditDialog({
  open,
  onOpenChange,
  student,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student;
  onSubmit: (data: UpdateStudentInput) => void;
  pending: boolean;
}) {
  const form = useForm<UpdateStudentInput>({
    resolver: zodResolver(updateStudentSchema),
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      firstName: student.firstName,
      middleName: student.middleName ?? undefined,
      lastName: student.lastName,
      dateOfBirth: student.dateOfBirth,
      admissionDate: student.admissionDate ?? undefined,
      phone: student.phone ?? undefined,
      email: student.email ?? undefined,
    });
  }, [open, student, form]);

  const errors = form.formState.errors;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.students.editTitle}
      submitLabel={copy.common.save}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={errors.firstName ? true : undefined}>
            <FieldLabel htmlFor="student-edit-first-name">
              {copy.students.fields.firstName}
            </FieldLabel>
            <Input
              id="student-edit-first-name"
              aria-invalid={errors.firstName ? true : undefined}
              {...form.register("firstName")}
            />
            {errors.firstName ? <FieldError>{errors.firstName.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.middleName ? true : undefined}>
            <FieldLabel htmlFor="student-edit-middle-name">
              {copy.students.fields.middleName}
            </FieldLabel>
            <Input
              id="student-edit-middle-name"
              {...form.register("middleName", optional)}
            />
            {errors.middleName ? <FieldError>{errors.middleName.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.lastName ? true : undefined}>
            <FieldLabel htmlFor="student-edit-last-name">
              {copy.students.fields.lastName}
            </FieldLabel>
            <Input
              id="student-edit-last-name"
              aria-invalid={errors.lastName ? true : undefined}
              {...form.register("lastName")}
            />
            {errors.lastName ? <FieldError>{errors.lastName.message}</FieldError> : null}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.dateOfBirth ? true : undefined}>
            <FieldLabel htmlFor="student-edit-dob">
              {copy.students.fields.dateOfBirth}
            </FieldLabel>
            <Input
              id="student-edit-dob"
              type="date"
              aria-invalid={errors.dateOfBirth ? true : undefined}
              {...form.register("dateOfBirth")}
            />
            {errors.dateOfBirth ? <FieldError>{errors.dateOfBirth.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.admissionDate ? true : undefined}>
            <FieldLabel htmlFor="student-edit-admission-date">
              {copy.students.fields.admissionDate}
            </FieldLabel>
            <Input
              id="student-edit-admission-date"
              type="date"
              aria-invalid={errors.admissionDate ? true : undefined}
              {...form.register("admissionDate", optional)}
            />
            {errors.admissionDate ? (
              <FieldError>{errors.admissionDate.message}</FieldError>
            ) : null}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.phone ? true : undefined}>
            <FieldLabel htmlFor="student-edit-phone">{copy.students.fields.phone}</FieldLabel>
            <Input
              id="student-edit-phone"
              inputMode="tel"
              aria-invalid={errors.phone ? true : undefined}
              {...form.register("phone", optional)}
            />
            {errors.phone ? <FieldError>{errors.phone.message}</FieldError> : null}
          </Field>

          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="student-edit-email">{copy.students.fields.email}</FieldLabel>
            <Input
              id="student-edit-email"
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
