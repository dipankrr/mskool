"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { saveExamComponentsInput, type SaveExamComponentsInput } from "@repo/contracts";

import type { ExamComponent } from "@/lib/trpc/types";

import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { trpc } from "@/lib/trpc/client";

/**
 * ONE SUBJECT'S PAPER — the batch editor behind the papers table's
 * "Components" button.
 *
 * A paper is "Theory (80, pass 27, must pass) + Internal (20)": rows of
 * parts whose weightages must sum to 100 (the contract's rule, surfaced
 * here as a live counter so the error arrives before the submit does).
 * Weightages stop being editable once marks exist — the server refuses
 * with that wording; this dialog simply stays closed behind the schedule's
 * locked state on the detail page.
 *
 * Two of the reference design's per-component options live here (both
 * schema-backed from day one):
 * - **Grading scale** — "this component gets its own independent grade"
 *   (the ICSE case): compute stamps the band's grade onto the component
 *   result, beside the marks. "School default" clears the override.
 * - **Negative marking** — visible only when the EXAM allows it (the
 *   master switch lives in the exam's create/edit dialog). The entered
 *   marks are NET — the deduction happens at the desk, the field records
 *   the rate the desk used.
 *
 * `sequenceNumber` is the row order at submit time; the form never asks.
 */
type FormValues = Omit<SaveExamComponentsInput, "components"> & {
  components: Array<Omit<SaveExamComponentsInput["components"][number], "sequenceNumber">>;
};

export function ComponentsDialog({
  open,
  onOpenChange,
  scheduleId,
  scheduleLabel,
  components,
  examAllowsNegativeMarking,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleId: string;
  scheduleLabel: string;
  components: ExamComponent[];
  /** The exam's master switch — the per-part options stay hidden without it. */
  examAllowsNegativeMarking: boolean;
  pending: boolean;
  onSubmit: (data: SaveExamComponentsInput) => Promise<void> | void;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(saveExamComponentsInput) as never,
    // `id` is the schedule's — the save route is schedule-addressed.
    defaultValues: { id: scheduleId, components: [] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "components" });
  const [weightSum, setWeightSum] = useState(0);

  useEffect(() => {
    if (!open) return;
    form.reset({
      id: scheduleId,
      components: components.map((c) => ({
        name: c.name,
        maxMarks: c.maxMarks,
        passMarks: c.passMarks,
        weightagePercentage: c.weightagePercentage,
        isMandatoryPass: c.isMandatoryPass,
        allowsNegativeMarking: c.allowsNegativeMarking,
        negativeMarksPerWrong: c.negativeMarksPerWrong ?? undefined,
        gradingScaleId: c.gradingScaleId ?? undefined,
      })),
    });
  }, [open, scheduleId, components, form]);

  // Live weightage sum — the submit-time invariant, shown as you type.
  useEffect(() => {
    const subscription = form.watch((values) => {
      const sum = (values.components ?? []).reduce<number>(
        (total, row) => total + (Number(row?.weightagePercentage) || 0),
        0,
      );
      setWeightSum(Math.round(sum * 100) / 100);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${copy.exams.workflow.editComponentsFor} — ${scheduleLabel}`}
      description={copy.exams.workflow.componentSubtitle}
      pending={pending}
      onSubmit={form.handleSubmit((data) =>
        onSubmit({
          id: scheduleId,
          components: data.components.map((row, index) => ({
            ...row,
            sequenceNumber: index + 1,
          })),
        }),
      )}
    >
      <div className="flex flex-col gap-4">
        {fields.map((field, index) => {
          const rowError = form.formState.errors.components?.[index];
          const partNegative = Boolean(form.watch(`components.${index}.allowsNegativeMarking`));
          return (
            <fieldset key={field.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
              <Field data-invalid={rowError?.name ? true : undefined} className="sm:col-span-2">
                <FieldLabel htmlFor={`component-name-${index}`}>
                  {copy.exams.workflow.fields.name}
                </FieldLabel>
                <Input
                  id={`component-name-${index}`}
                  maxLength={100}
                  placeholder="Theory"
                  aria-invalid={rowError?.name ? true : undefined}
                  {...form.register(`components.${index}.name`)}
                />
                <FieldError>{rowError?.name?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.maxMarks ? true : undefined}>
                <FieldLabel htmlFor={`component-max-${index}`}>
                  {copy.exams.workflow.fields.maxMarks}
                </FieldLabel>
                <Input
                  id={`component-max-${index}`}
                  inputMode="decimal"
                  placeholder="80"
                  aria-invalid={rowError?.maxMarks ? true : undefined}
                  {...form.register(`components.${index}.maxMarks`)}
                />
                <FieldError>{rowError?.maxMarks?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.passMarks ? true : undefined}>
                <FieldLabel htmlFor={`component-pass-${index}`}>
                  {copy.exams.workflow.fields.passMarks}
                </FieldLabel>
                <Input
                  id={`component-pass-${index}`}
                  inputMode="decimal"
                  placeholder="27"
                  aria-invalid={rowError?.passMarks ? true : undefined}
                  {...form.register(`components.${index}.passMarks`)}
                />
                <FieldError>{rowError?.passMarks?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.weightagePercentage ? true : undefined}>
                <FieldLabel htmlFor={`component-weight-${index}`}>
                  {copy.exams.workflow.fields.weightage}
                </FieldLabel>
                <Input
                  id={`component-weight-${index}`}
                  inputMode="decimal"
                  placeholder="80"
                  aria-invalid={rowError?.weightagePercentage ? true : undefined}
                  {...form.register(`components.${index}.weightagePercentage`)}
                />
                <FieldError>{rowError?.weightagePercentage?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.gradingScaleId ? true : undefined}>
                <FieldLabel htmlFor={`component-scale-${index}`}>
                  {copy.exams.workflow.fields.gradingScale}
                </FieldLabel>
                <GradingScaleField form={form} index={index} />
                <FieldDescription>{copy.exams.workflow.fields.gradingScaleHelp}</FieldDescription>
                <FieldError>{rowError?.gradingScaleId?.message}</FieldError>
              </Field>

              <Field>
                <div className="flex items-center gap-2 pt-2">
                  <Switch
                    id={`component-mandatory-${index}`}
                    checked={Boolean(form.watch(`components.${index}.isMandatoryPass`))}
                    onCheckedChange={(checked) =>
                      form.setValue(`components.${index}.isMandatoryPass`, checked)
                    }
                  />
                  <FieldLabel htmlFor={`component-mandatory-${index}`} className="!gap-1">
                    {copy.exams.workflow.fields.mandatory}
                  </FieldLabel>
                </div>
              </Field>

              {examAllowsNegativeMarking ? (
                <>
                  <Field>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`component-negative-${index}`}
                        checked={partNegative}
                        onCheckedChange={(checked) =>
                          form.setValue(`components.${index}.allowsNegativeMarking`, checked)
                        }
                      />
                      <FieldLabel htmlFor={`component-negative-${index}`} className="!gap-1">
                        {copy.exams.workflow.fields.negative}
                      </FieldLabel>
                    </div>
                  </Field>
                  {partNegative ? (
                    <Field data-invalid={rowError?.negativeMarksPerWrong ? true : undefined}>
                      <FieldLabel htmlFor={`component-negrate-${index}`}>
                        {copy.exams.workflow.fields.negativeRate}
                      </FieldLabel>
                      <Input
                        id={`component-negrate-${index}`}
                        inputMode="decimal"
                        placeholder="0.25"
                        aria-invalid={rowError?.negativeMarksPerWrong ? true : undefined}
                        {...form.register(`components.${index}.negativeMarksPerWrong`, {
                          setValueAs: (v) => (v === "" ? undefined : v),
                        })}
                      />
                      <FieldDescription>
                        {copy.exams.workflow.fields.negativeRateHelp}
                      </FieldDescription>
                      <FieldError>{rowError?.negativeMarksPerWrong?.message}</FieldError>
                    </Field>
                  ) : null}
                </>
              ) : null}

              <div className="sm:col-span-2 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(index)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  {copy.exams.workflow.removeRow}
                </Button>
              </div>
            </fieldset>
          );
        })}

        <div className="flex items-center justify-between gap-3">
          <p
            className={
              weightSum === 100
                ? "text-muted-foreground text-sm"
                : "text-destructive text-sm font-medium"
            }
          >
            {copy.exams.workflow.weightSum}: {weightSum}% / 100%
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              append({
                name: "",
                maxMarks: "",
                passMarks: "",
                weightagePercentage: "",
                isMandatoryPass: false,
                allowsNegativeMarking: false,
                negativeMarksPerWrong: undefined,
                gradingScaleId: undefined,
              })
            }
          >
            <PlusIcon data-icon="inline-start" />
            {copy.exams.workflow.addComponentRow}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}

/** The scale picker — "School default" (null) plus the school's active scales. */
function GradingScaleField({
  form,
  index,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  index: number;
}) {
  const { scopeArgs } = useActiveContext();
  const scales = trpc.exam.gradingScales.list.useQuery(scopeArgs(), {
    staleTime: 30_000,
  });
  return (
    <Select
      value={(form.watch(`components.${index}.gradingScaleId`) as string | undefined) ?? "default"}
      onValueChange={(v) =>
        form.setValue(
          `components.${index}.gradingScaleId`,
          v === "default" ? undefined : v,
        )
      }
    >
      <SelectTrigger id={`component-scale-${index}`}>
        <SelectValue>
          {(value: string | null) =>
            value
              ? (scales.data?.find((s) => s.id === value)?.name ??
                copy.exams.workflow.fields.gradingScaleDefault)
              : copy.exams.workflow.fields.gradingScaleDefault
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">
          {copy.exams.workflow.fields.gradingScaleDefault}
        </SelectItem>
        {(scales.data ?? []).map((scale) => (
          <SelectItem key={scale.id} value={scale.id}>
            {scale.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
