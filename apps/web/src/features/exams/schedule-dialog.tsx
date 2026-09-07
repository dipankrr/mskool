"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { saveExamSchedulesInput, type SaveExamSchedulesInput } from "@repo/contracts";

import type { ExamSchedule, Section, Subject } from "@/lib/trpc/types";

import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copy } from "@/lib/copy";

/**
 * ONE CLASS'S EXAM GRID — the batch editor behind "Edit schedules".
 *
 * The save is a batch, not a row-at-a-time (the service replaces the
 * class's schedules in one transaction), so the whole grid is the form:
 * `useFieldArray` holds one row per subject paper, and submit sends the
 * class's rows as `saveExamSchedulesInput`. Deleting every row is legal —
 * an empty grid is a state a drafting exam can be in — but the
 * `scheduled` transition refuses to fire until coverage is complete, and
 * that refusal is the guard, not this dialog.
 *
 * The pass-mark override starts empty: the server derives the weighted
 * default from the components, and a school only types here for the
 * "≥50/100 in total" rule (ADR-032).
 */
type FormValues = SaveExamSchedulesInput;

export function ScheduleDialog({
  open,
  onOpenChange,
  examId,
  classId,
  className,
  schedules,
  subjects,
  sections,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string;
  classId: string;
  className: string;
  /** The class's current rows (wire shape) — become the form's defaults. */
  schedules: ExamSchedule[];
  subjects: Subject[];
  /** The class's sections — a paper is class-wide or one section's. */
  sections: Section[];
  pending: boolean;
  onSubmit: (data: SaveExamSchedulesInput) => Promise<void> | void;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(saveExamSchedulesInput) as never,
    // `id` is the exam's — the save route is exam-addressed (owner gate).
    defaultValues: { id: examId, schedules: [] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "schedules" });

  useEffect(() => {
    if (!open) return;
    form.reset({
      id: examId,
      schedules: schedules.map((s) => ({
        examId,
        classId: s.classId,
        // Round-tripped, never dropped: omitting it would silently widen a
        // section paper to the whole class on save.
        sectionId: s.sectionId,
        subjectId: s.subjectId,
        examDate: s.examDate,
        // `type="time"` speaks HH:MM; the wire carries HH:MM:SS.
        startTime: s.startTime.slice(0, 5),
        durationMinutes: s.durationMinutes,
        venue: s.venue ?? undefined,
        // "0.00" is the not-yet-snapshotted default, not an override.
        passMarks: s.passMarks !== "0.00" ? s.passMarks : undefined,
      })),
    });
  }, [open, examId, schedules, form]);

  const errors = form.formState.errors.schedules;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${copy.exams.workflow.editScheduleFor} — ${className}`}
      description={copy.exams.workflow.scheduleSubtitle}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit({ ...data, id: examId }))}
    >
      <div className="flex flex-col gap-4">
        {fields.map((field, index) => {
          const rowError = errors?.[index];
          return (
            <fieldset
              key={field.id}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
            >
              <Field data-invalid={rowError?.subjectId ? true : undefined} className="sm:col-span-2">
                <FieldLabel htmlFor={`schedule-subject-${index}`}>
                  {copy.exams.workflow.fields.subject}
                </FieldLabel>                <Select
                  value={form.watch(`schedules.${index}.subjectId`)}
                  onValueChange={(v) => {
                    if (v) form.setValue(`schedules.${index}.subjectId`, v);
                  }}
                >
                  <SelectTrigger
                    id={`schedule-subject-${index}`}
                    aria-invalid={rowError?.subjectId ? true : undefined}
                  >
                    <SelectValue>
                      {(value: string | null) =>
                        value
                          ? (subjects.find((s) => s.id === value)?.name ?? copy.common.none)
                          : copy.common.required
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject) => (
                      <SelectItem key={subject.id} value={subject.id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{rowError?.subjectId?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.sectionId ? true : undefined} className="sm:col-span-2">
                <FieldLabel htmlFor={`schedule-section-${index}`}>
                  {copy.exams.workflow.fields.section}
                </FieldLabel>
                <Select
                  value={form.watch(`schedules.${index}.sectionId`) ?? "all"}
                  onValueChange={(v) => {
                    form.setValue(`schedules.${index}.sectionId`, v === "all" ? null : v);
                  }}
                >
                  <SelectTrigger
                    id={`schedule-section-${index}`}
                    aria-invalid={rowError?.sectionId ? true : undefined}
                  >
                    <SelectValue>
                      {(value: string | null) =>
                        value && value !== "all"
                          ? (sections.find((s) => s.id === value)?.name ?? copy.common.none)
                          : copy.exams.workflow.allSections
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{copy.exams.workflow.allSections}</SelectItem>
                    {sections.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{rowError?.sectionId?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.examDate ? true : undefined}>
                <FieldLabel htmlFor={`schedule-date-${index}`}>
                  {copy.exams.workflow.fields.date}
                </FieldLabel>
                <Input
                  id={`schedule-date-${index}`}
                  type="date"
                  aria-invalid={rowError?.examDate ? true : undefined}
                  {...form.register(`schedules.${index}.examDate`)}
                />
                <FieldError>{rowError?.examDate?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.startTime ? true : undefined}>
                <FieldLabel htmlFor={`schedule-start-${index}`}>
                  {copy.exams.workflow.fields.startTime}
                </FieldLabel>
                <Input
                  id={`schedule-start-${index}`}
                  type="time"
                  aria-invalid={rowError?.startTime ? true : undefined}
                  {...form.register(`schedules.${index}.startTime`)}
                />
                <FieldError>{rowError?.startTime?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.durationMinutes ? true : undefined}>
                <FieldLabel htmlFor={`schedule-duration-${index}`}>
                  {copy.exams.workflow.fields.duration}
                </FieldLabel>
                <Input
                  id={`schedule-duration-${index}`}
                  type="number"
                  min={5}
                  max={600}
                  inputMode="numeric"
                  aria-invalid={rowError?.durationMinutes ? true : undefined}
                  {...form.register(`schedules.${index}.durationMinutes`, {
                    setValueAs: (v) => (v === "" ? undefined : Number(v)),
                  })}
                />
                <FieldError>{rowError?.durationMinutes?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.venue ? true : undefined}>
                <FieldLabel htmlFor={`schedule-venue-${index}`}>
                  {copy.exams.workflow.fields.venue}
                </FieldLabel>
                <Input
                  id={`schedule-venue-${index}`}
                  maxLength={150}
                  aria-invalid={rowError?.venue ? true : undefined}
                  {...form.register(`schedules.${index}.venue`, {
                    setValueAs: (v) => (v === "" ? undefined : v),
                  })}
                />
                <FieldError>{rowError?.venue?.message}</FieldError>
              </Field>

              <Field data-invalid={rowError?.passMarks ? true : undefined} className="sm:col-span-2">
                <FieldLabel htmlFor={`schedule-pass-${index}`}>
                  {copy.exams.workflow.fields.passMarksOverride}
                </FieldLabel>
                <Input
                  id={`schedule-pass-${index}`}
                  inputMode="decimal"
                  aria-invalid={rowError?.passMarks ? true : undefined}
                  {...form.register(`schedules.${index}.passMarks`, {
                    setValueAs: (v) => (v === "" ? undefined : v),
                  })}
                />
                <FieldError>{rowError?.passMarks?.message}</FieldError>
              </Field>

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

        <Button
          type="button"
          variant="outline"
            onClick={() =>
              append({
                examId,
                classId,
                sectionId: null,
                subjectId: "",
                examDate: "",
                startTime: "",
                durationMinutes: 60,
              })
            }
        >
          <PlusIcon data-icon="inline-start" />
          {copy.exams.workflow.addScheduleRow}
        </Button>
      </div>
    </FormDialog>
  );
}
