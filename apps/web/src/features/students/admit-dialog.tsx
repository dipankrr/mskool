"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createStudentSchema, type CreateStudentInput } from "@repo/contracts";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
import { Separator } from "@/components/ui/separator";
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

/** The phone rule, shared with the parents' card so both say the same. */
const tenDigits = z
  .string()
  .regex(/^\d{10}$/, "A phone number is 10 digits.");

/**
 * ADMISSION + PARENTS, ONE FORM. Identity is required by the contract;
 * contact details are optional because a school admits first and fills the
 * rest when the family comes in.
 *
 * **The parent phones are the point.** A family signs in with the number
 * the school verified here, so capturing it AT ADMISSION is what makes
 * every later screen credential-free: the login links itself, the family
 * sets its own password from home, and no one ever issues or hands over a
 * secret (ADR-037). Leave both blank and the family is added on the
 * student's record later — same flow, one step behind.
 *
 * **Empty optional fields become `undefined`, not `""`** (the
 * branch-form-dialog rule): an untouched input yields an empty string, and
 * an empty string is not a phone number. The date inputs are native
 * `type="date"` — their value is already ISO `YYYY-MM-DD`, exactly what the
 * contract wants, and never a localized display string.
 */

const admitForm = createStudentSchema.extend({
  fatherName: z.string().trim().max(100).optional(),
  fatherPhone: tenDigits.optional().or(z.literal("")),
  motherName: z.string().trim().max(100).optional(),
  motherPhone: tenDigits.optional().or(z.literal("")),
});
type AdmitForm = z.infer<typeof admitForm>;

/** One parent to add once the student exists. */
export type AdmittedGuardian = {
  firstName: string;
  phone: string;
  relation: "father" | "mother";
  isPrimary?: boolean;
};

export function AdmitStudentDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateStudentInput & { guardians: AdmittedGuardian[] }) => void;
  pending: boolean;
}) {
  const form = useForm<AdmitForm>({
    resolver: zodResolver(admitForm),
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
      onSubmit={form.handleSubmit((data) => {
        // The four parent fields are NOT part of the student contract —
        // split them off here so `student.create` receives exactly its own
        // shape, and the guardians go through the guardian endpoint.
        const { fatherName, fatherPhone, motherName, motherPhone, ...student } = data;
        const guardians: AdmittedGuardian[] = [];
        if (fatherPhone) {
          guardians.push({
            firstName: (fatherName || copy.guardians.relations.father) as string,
            phone: fatherPhone,
            relation: "father",
            isPrimary: true,
          });
        }
        if (motherPhone) {
          guardians.push({
            firstName: (motherName || copy.guardians.relations.mother) as string,
            phone: motherPhone,
            relation: "mother",
          });
        }
        onSubmit({ ...student, guardians });
      })}
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

        <Separator />

        {/*
          The parents. The number captured here is the family's sign-in, so
          this is the one place it is verified: the office checks it against
          what the family says, and the login follows automatically. Both
          optional — a family that arrives later is added on the student's
          record instead.
        */}
        <div>
          <p className="text-sm font-medium">{copy.guardians.title}</p>
          <p className="text-muted-foreground text-sm">{copy.guardians.subtitle}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={errors.fatherPhone ? true : undefined}>
            <FieldLabel htmlFor="student-father-phone">
              {copy.guardians.fields.phone} — {copy.guardians.relations.father}
            </FieldLabel>
            <Input
              id="student-father-phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="9876543210"
              aria-invalid={errors.fatherPhone ? true : undefined}
              {...form.register("fatherPhone", optional)}
            />
            {errors.fatherPhone ? (
              <FieldError>{errors.fatherPhone.message}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={errors.fatherName ? true : undefined}>
            <FieldLabel htmlFor="student-father-name">
              {copy.guardians.fields.firstName}
            </FieldLabel>
            <Input
              id="student-father-name"
              aria-invalid={errors.fatherName ? true : undefined}
              {...form.register("fatherName", optional)}
            />
          </Field>

          <Field data-invalid={errors.motherPhone ? true : undefined}>
            <FieldLabel htmlFor="student-mother-phone">
              {copy.guardians.fields.phone} — {copy.guardians.relations.mother}
            </FieldLabel>
            <Input
              id="student-mother-phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="9876543210"
              aria-invalid={errors.motherPhone ? true : undefined}
              {...form.register("motherPhone", optional)}
            />
            {errors.motherPhone ? (
              <FieldError>{errors.motherPhone.message}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={errors.motherName ? true : undefined}>
            <FieldLabel htmlFor="student-mother-name">
              {copy.guardians.fields.firstName}
            </FieldLabel>
            <Input
              id="student-mother-name"
              aria-invalid={errors.motherName ? true : undefined}
              {...form.register("motherName", optional)}
            />
          </Field>
        </div>
      </FieldGroup>
    </FormDialog>
  );
}
