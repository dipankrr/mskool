"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { updateExamSchema, type UpdateExamInput } from "@repo/contracts";
import type { z } from "zod";

import { FormDialog } from "@/components/form-dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { copy } from "@/lib/copy";

/**
 * EDIT EXAM — the exam's own details: name, weight, counting switch, and
 * the negative-marking master switch. The lifecycle fields (term, type,
 * links) are deliberately absent — the contract omits them, because a
 * mid-flight retarget is history rewriting, not editing.
 *
 * Weight/count changes move every future result's denominator: the server
 * freezes them once marks exist and words the refusal — this dialog simply
 * stays open behind it, the edits intact.
 */
type FormValues = z.infer<typeof updateExamSchema>;

export function ExamEditDialog({
  open,
  onOpenChange,
  exam,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: {
    id: string;
    name: string;
    examType: string;
    weightageInTerm: string;
    countsTowardTermResult: boolean;
    allowsNegativeMarking: boolean;
  } | null;
  pending: boolean;
  onSubmit: (data: { id: string; data: UpdateExamInput }) => Promise<void> | void;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(updateExamSchema) as never,
    defaultValues: {},
  });

  const counting = form.watch("countsTowardTermResult") ?? true;
  const negative = form.watch("allowsNegativeMarking") ?? false;

  useEffect(() => {
    if (!open || !exam) return;
    form.reset({
      name: exam.name,
      // Mocks and tests never count — the weight is hidden, not zero
      // (the create dialog's honest-state lesson).
      ...(exam.examType === "mock" || exam.examType === "test"
        ? {}
        : {
            weightageInTerm: exam.weightageInTerm,
            countsTowardTermResult: exam.countsTowardTermResult,
          }),
      allowsNegativeMarking: exam.allowsNegativeMarking,
    });
  }, [open, exam, form]);

  return (
    <FormDialog
      open={open && exam != null}
      onOpenChange={onOpenChange}
      title={copy.exams.workflow.editExam}
      description={copy.exams.workflow.editExamHelp}
      pending={pending}
      onSubmit={form.handleSubmit(async (data) => {
        if (!exam) return;
        await onSubmit({ id: exam.id, data });
      })}
    >
      <Field>
        <FieldLabel htmlFor="exam-edit-name">{copy.exams.workflow.nameLabel}</FieldLabel>
        <Input id="exam-edit-name" maxLength={150} {...form.register("name")} />
        <FieldError>{form.formState.errors.name?.message}</FieldError>
      </Field>

      {exam && exam.examType !== "mock" && exam.examType !== "test" ? (
        <>
          <Field>
            <FieldLabel htmlFor="exam-edit-weightage">
              {copy.exams.workflow.weightage}
            </FieldLabel>
            <Input
              id="exam-edit-weightage"
              inputMode="decimal"
              {...form.register("weightageInTerm")}
            />
            <FieldDescription>{copy.exams.workflow.weightageHelp}</FieldDescription>
            <FieldError>{form.formState.errors.weightageInTerm?.message}</FieldError>
          </Field>
          <Field>
            <div className="flex items-center gap-3">
              <Switch
                id="exam-edit-counts"
                checked={counting}
                onCheckedChange={(checked) => form.setValue("countsTowardTermResult", checked)}
              />
              <FieldLabel htmlFor="exam-edit-counts" className="!gap-0">
                {copy.exams.workflow.countsToward}
              </FieldLabel>
            </div>
            <FieldDescription>{copy.exams.workflow.countsTowardHelp}</FieldDescription>
          </Field>
        </>
      ) : null}

      <Field>
        <div className="flex items-center gap-3">
          <Switch
            id="exam-edit-negative"
            checked={negative}
            onCheckedChange={(checked) => form.setValue("allowsNegativeMarking", checked)}
          />
          <FieldLabel htmlFor="exam-edit-negative" className="!gap-0">
            {copy.exams.workflow.negativeMarking}
          </FieldLabel>
        </div>
        <FieldDescription>{copy.exams.workflow.negativeMarkingHelp}</FieldDescription>
      </Field>
    </FormDialog>
  );
}
