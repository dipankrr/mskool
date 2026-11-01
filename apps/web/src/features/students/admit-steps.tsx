"use client";

import { PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/lib/copy";
import { formatIsoDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createStudentSchema, type GuardianRelation } from "@repo/contracts";

import {
  filledSlots,
  normaliseParentPhone,
  primarySlot,
  relationFor,
  studentFullName,
  type FamilyErrors,
  type FamilyField,
  type FamilyForm,
  type FamilySlot,
  type RegisterRow,
} from "./admit-logic";

const text = copy.students.admit;

/** Blank means "not provided", which is not the same as an empty string. */
const optional = { setValueAs: (value: unknown) => (value === "" ? undefined : value) };

const GENDERS = ["male", "female", "other"] as const;

const OTHER_RELATIONS: GuardianRelation[] = [
  "grandfather",
  "grandmother",
  "uncle",
  "aunt",
  "brother",
  "sister",
  "legal_guardian",
  "other",
];

/**
 * The contract's rules with words a front desk can read. The contract's own
 * messages are Zod defaults ("Too small: expected string..."), and the server
 * re-validates whatever this lets through.
 */
export const admitStudentForm = createStudentSchema.extend({
  admissionNumber: z
    .string({ error: text.student.errors.number })
    .trim()
    .min(1, text.student.errors.number)
    .max(50, text.student.errors.number),
  firstName: z
    .string({ error: text.student.errors.firstName })
    .trim()
    .min(1, text.student.errors.firstName)
    .max(100),
  lastName: z
    .string({ error: text.student.errors.lastName })
    .trim()
    .min(1, text.student.errors.lastName)
    .max(100),
  dateOfBirth: z
    .string({ error: text.student.errors.dateOfBirth })
    .regex(/^\d{4}-\d{2}-\d{2}$/, text.student.errors.dateOfBirth)
    .refine((value) => value <= todayIso(), text.student.errors.dateOfBirthFuture),
  gender: z.enum(GENDERS, { error: text.student.errors.gender }),
});
export type StudentValues = z.infer<typeof admitStudentForm>;

/**
 * One choice, every option visible. Real radios underneath, so the arrow keys
 * and a screen reader work without any help.
 */
export function ChoiceChips({
  label,
  name,
  value,
  options,
  onChange,
  onClear,
  error,
}: {
  label: string;
  name: string;
  value: string | null | undefined;
  options: { value: string; label: string; note?: string }[];
  onChange: (value: string) => void;
  /** Lets a second click on the chosen option clear it. */
  onClear?: () => void;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "border-input hover:bg-accent/50 flex min-h-9 cursor-pointer flex-col justify-center rounded-3xl border px-4 py-1.5 text-sm transition-colors",
              "has-checked:border-primary has-checked:bg-primary/10 has-checked:font-medium",
              "has-focus-visible:ring-ring/50 has-focus-visible:ring-[3px]",
              error ? "border-destructive" : null,
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              onClick={() => {
                if (onClear && value === option.value) onClear();
              }}
            />
            <span>{option.label}</span>
            {option.note ? (
              <span className="text-muted-foreground text-xs font-normal">{option.note}</span>
            ) : null}
          </label>
        ))}
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </fieldset>
  );
}

// ------------------------------------------------------------------- student

export function StudentStep({
  form,
  suggestion,
  duplicate,
}: {
  form: UseFormReturn<StudentValues>;
  /** The next number in sequence, if the register shows one. */
  suggestion: string | null;
  duplicate: RegisterRow | null;
}) {
  const errors = form.formState.errors;
  const [showMiddle, setShowMiddle] = useState(Boolean(form.getValues("middleName")));
  const number = form.watch("admissionNumber");

  return (
    <FieldGroup>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.firstName ? true : undefined}>
          <FieldLabel htmlFor="student-first-name">{copy.students.fields.firstName}</FieldLabel>
          <Input
            id="student-first-name"
            autoComplete="off"
            aria-invalid={errors.firstName ? true : undefined}
            {...form.register("firstName")}
          />
          {errors.firstName ? <FieldError>{errors.firstName.message}</FieldError> : null}
        </Field>
        <Field data-invalid={errors.lastName ? true : undefined}>
          <FieldLabel htmlFor="student-last-name">{copy.students.fields.lastName}</FieldLabel>
          <Input
            id="student-last-name"
            autoComplete="off"
            aria-invalid={errors.lastName ? true : undefined}
            {...form.register("lastName")}
          />
          {errors.lastName ? <FieldError>{errors.lastName.message}</FieldError> : null}
        </Field>
      </div>

      {showMiddle ? (
        <Field>
          <FieldLabel htmlFor="student-middle-name">{copy.students.fields.middleName}</FieldLabel>
          <Input
            id="student-middle-name"
            autoComplete="off"
            {...form.register("middleName", optional)}
          />
        </Field>
      ) : (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowMiddle(true)}>
            <PlusIcon data-icon="inline-start" />
            {text.student.addMiddleName}
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.dateOfBirth ? true : undefined}>
          <FieldLabel htmlFor="student-dob">{copy.students.fields.dateOfBirth}</FieldLabel>
          <Input
            id="student-dob"
            type="date"
            max={todayIso()}
            aria-invalid={errors.dateOfBirth ? true : undefined}
            {...form.register("dateOfBirth")}
          />
          {errors.dateOfBirth ? <FieldError>{errors.dateOfBirth.message}</FieldError> : null}
        </Field>
        <ChoiceChips
          label={copy.students.fields.gender}
          name="student-gender"
          value={form.watch("gender")}
          options={GENDERS.map((gender) => ({
            value: gender,
            label: copy.students.genders[gender],
          }))}
          onChange={(value) =>
            form.setValue("gender", value as StudentValues["gender"], {
              shouldValidate: true,
              shouldDirty: true,
            })
          }
          error={errors.gender?.message}
        />
      </div>

      {duplicate ? (
        <Alert data-testid="admit-duplicate">
          <AlertDescription>
            {text.student.possibleDuplicate(
              `${duplicate.firstName} ${duplicate.lastName}`,
              duplicate.admissionNumber,
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <Field data-invalid={errors.admissionNumber ? true : undefined}>
          <FieldLabel htmlFor="student-admission-number">
            {copy.students.fields.admissionNumber}
          </FieldLabel>
          <Input
            id="student-admission-number"
            autoComplete="off"
            aria-invalid={errors.admissionNumber ? true : undefined}
            {...form.register("admissionNumber")}
          />
          {errors.admissionNumber ? (
            <FieldError>{errors.admissionNumber.message}</FieldError>
          ) : (
            <FieldDescription>{text.student.numberHelp}</FieldDescription>
          )}
          {suggestion && number?.trim() !== suggestion ? (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  form.setValue("admissionNumber", suggestion, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
              >
                {text.student.suggest(suggestion)}
              </Button>
            </div>
          ) : null}
        </Field>
        <Field data-invalid={errors.admissionDate ? true : undefined}>
          <FieldLabel htmlFor="student-admission-date">
            {copy.students.fields.admissionDate}
          </FieldLabel>
          <Input
            id="student-admission-date"
            type="date"
            max={todayIso()}
            aria-invalid={errors.admissionDate ? true : undefined}
            {...form.register("admissionDate", optional)}
          />
          {errors.admissionDate ? (
            <FieldError>{errors.admissionDate.message}</FieldError>
          ) : null}
        </Field>
      </div>
    </FieldGroup>
  );
}

// --------------------------------------------------------------------- class

export type SectionChoice = { id: string; name: string; strength: number | null };

export function ClassStep({
  sessionName,
  classes,
  sections,
  classId,
  sectionId,
  loading,
  failed,
  onClass,
  onClearClass,
  onSection,
}: {
  sessionName: string | null;
  classes: { id: string; name: string }[];
  /** The chosen class's sections. */
  sections: SectionChoice[];
  classId: string | null;
  sectionId: string | null;
  loading: boolean;
  failed: boolean;
  onClass: (id: string) => void;
  onClearClass: () => void;
  onSection: (id: string | null) => void;
}) {
  if (!sessionName) {
    return (
      <Alert data-testid="admit-no-session">
        <AlertDescription>{text.class.noSessionBody}</AlertDescription>
      </Alert>
    );
  }
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (failed) {
    return (
      <Alert variant="destructive" data-testid="admit-class-error">
        <AlertDescription>{text.class.loadFailed}</AlertDescription>
      </Alert>
    );
  }
  if (classes.length === 0) {
    return (
      <Alert data-testid="admit-no-classes">
        <AlertDescription>{text.class.noClassesBody}</AlertDescription>
      </Alert>
    );
  }

  return (
    <FieldGroup>
      <ChoiceChips
        label={text.class.classLabel}
        name="admit-class"
        value={classId}
        options={classes.map((option) => ({ value: option.id, label: option.name }))}
        onChange={onClass}
        onClear={onClearClass}
      />
      {classId ? (
        sections.length > 0 ? (
          <ChoiceChips
            label={text.class.sectionLabel}
            name="admit-section"
            value={sectionId ?? "later"}
            options={[
              ...sections.map((option) => ({
                value: option.id,
                label: text.class.sectionName(option.name),
                note: option.strength === null ? undefined : text.class.strength(option.strength),
              })),
              { value: "later", label: text.class.sectionLater },
            ]}
            onChange={(value) => onSection(value === "later" ? null : value)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{text.class.noSections}</p>
        )
      ) : null}
    </FieldGroup>
  );
}

// -------------------------------------------------------------------- family

function PersonRow({
  slot,
  family,
  errorFor,
  touch,
  onChange,
}: {
  slot: FamilySlot;
  family: FamilyForm;
  errorFor: (field: FamilyField) => string | undefined;
  touch: (field: FamilyField) => void;
  onChange: (slot: FamilySlot, part: "name" | "phone", value: string) => void;
}) {
  const nameError = errorFor(`${slot}.name`);
  const phoneError = errorFor(`${slot}.phone`);
  const who = text.family.slots[slot];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field data-invalid={nameError ? true : undefined}>
        <FieldLabel htmlFor={`student-${slot}-name`}>{text.family.nameOf(who)}</FieldLabel>
        <Input
          id={`student-${slot}-name`}
          autoComplete="off"
          value={family[slot].name}
          aria-invalid={nameError ? true : undefined}
          onChange={(event) => onChange(slot, "name", event.target.value)}
          onBlur={() => touch(`${slot}.name`)}
        />
        {nameError ? <FieldError>{nameError}</FieldError> : null}
      </Field>
      <Field data-invalid={phoneError ? true : undefined}>
        <FieldLabel htmlFor={`student-${slot}-phone`}>{text.family.phoneOf(who)}</FieldLabel>
        <Input
          id={`student-${slot}-phone`}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          maxLength={16}
          placeholder="9876543210"
          value={family[slot].phone}
          aria-invalid={phoneError ? true : undefined}
          onChange={(event) => onChange(slot, "phone", normaliseParentPhone(event.target.value))}
          onBlur={() => touch(`${slot}.phone`)}
        />
        {phoneError ? <FieldError>{phoneError}</FieldError> : null}
      </Field>
    </div>
  );
}

export function FamilyStep({
  family,
  errors,
  showAll,
  onChange,
  onRelation,
  onPrimary,
}: {
  family: FamilyForm;
  errors: FamilyErrors;
  /** Show every error, not just the fields already left. */
  showAll: boolean;
  onChange: (slot: FamilySlot, part: "name" | "phone", value: string) => void;
  onRelation: (relation: GuardianRelation) => void;
  onPrimary: (slot: FamilySlot) => void;
}) {
  const [touched, setTouched] = useState<Set<FamilyField>>(new Set());
  const [showOther, setShowOther] = useState(filledSlots(family).includes("other"));
  const touch = (field: FamilyField) =>
    setTouched((current) => new Set(current).add(field));
  const errorFor = (field: FamilyField) =>
    showAll || touched.has(field) ? errors[field] : undefined;
  const filled = filledSlots(family);
  const relationError = errorFor("otherRelation");

  return (
    <FieldGroup>
      <p className="text-muted-foreground text-sm">{text.family.intro}</p>
      <PersonRow slot="father" family={family} errorFor={errorFor} touch={touch} onChange={onChange} />
      <PersonRow slot="mother" family={family} errorFor={errorFor} touch={touch} onChange={onChange} />

      {showOther ? (
        <>
          <Field data-invalid={relationError ? true : undefined}>
            <FieldLabel htmlFor="student-other-relation">{text.family.relation}</FieldLabel>
            <Select
              value={family.otherRelation ?? undefined}
              onValueChange={(value) => onRelation(value as GuardianRelation)}
            >
              <SelectTrigger
                id="student-other-relation"
                aria-invalid={relationError ? true : undefined}
              >
                <SelectValue>
                  {(value: string | null) =>
                    value ? copy.guardians.relations[value] : copy.common.required
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {OTHER_RELATIONS.map((relation) => (
                    <SelectItem key={relation} value={relation}>
                      {copy.guardians.relations[relation]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {relationError ? <FieldError>{relationError}</FieldError> : null}
          </Field>
          <PersonRow slot="other" family={family} errorFor={errorFor} touch={touch} onChange={onChange} />
        </>
      ) : (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowOther(true)}>
            <PlusIcon data-icon="inline-start" />
            {text.family.addOther}
          </Button>
        </div>
      )}

      {filled.length > 1 ? (
        <ChoiceChips
          label={text.family.primaryLabel}
          name="admit-primary"
          value={primarySlot(family)}
          options={filled.map((slot) => ({ value: slot, label: text.family.slots[slot] }))}
          onChange={(value) => onPrimary(value as FamilySlot)}
        />
      ) : null}
    </FieldGroup>
  );
}

// -------------------------------------------------------------------- review

function ReviewGroup({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${text.review.edit} ${title}`}
          onClick={onEdit}
        >
          {text.review.edit}
        </Button>
      </div>
      {children}
    </section>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ReviewStep({
  values,
  family,
  placement,
  showClass,
  showFamily,
  onEdit,
}: {
  values: StudentValues;
  family: FamilyForm;
  /** "Class 6 · Section A", or null when not placed. */
  placement: string | null;
  showClass: boolean;
  showFamily: boolean;
  onEdit: (step: "student" | "class" | "family") => void;
}) {
  const filled = filledSlots(family);
  const primary = primarySlot(family);

  return (
    <div className="flex flex-col gap-3">
      <ReviewGroup title={text.review.student} onEdit={() => onEdit("student")}>
        <dl className="flex flex-col gap-1.5">
          <ReviewLine label={text.review.name} value={studentFullName(values)} />
          <ReviewLine label={text.review.born} value={formatIsoDate(values.dateOfBirth)} />
          <ReviewLine
            label={text.review.gender}
            value={values.gender ? copy.students.genders[values.gender] : ""}
          />
          <ReviewLine label={text.review.number} value={values.admissionNumber?.trim()} />
          <ReviewLine
            label={text.review.admittedOn}
            value={formatIsoDate(values.admissionDate ?? todayIso())}
          />
        </dl>
      </ReviewGroup>

      {showClass ? (
        <ReviewGroup title={text.review.class} onEdit={() => onEdit("class")}>
          <p className={cn("text-sm", placement ? null : "text-muted-foreground")}>
            {placement ?? text.review.noClass}
          </p>
        </ReviewGroup>
      ) : null}

      {showFamily ? (
        <ReviewGroup title={text.review.family} onEdit={() => onEdit("family")}>
          {filled.length === 0 ? (
            <p className="text-muted-foreground text-sm">{text.review.noFamily}</p>
          ) : (
            <dl className="flex flex-col gap-1.5">
              {filled.map((slot) => (
                <ReviewLine
                  key={slot}
                  label={copy.guardians.relations[relationFor(slot, family)] ?? ""}
                  value={[
                    family[slot].name.trim(),
                    family[slot].phone.trim(),
                    filled.length > 1 && slot === primary ? text.review.primary : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </dl>
          )}
        </ReviewGroup>
      ) : null}
    </div>
  );
}
