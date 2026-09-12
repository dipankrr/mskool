"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { saveExamSchedulesInput, type SaveExamSchedulesInput } from "@repo/contracts";

import type { ExamSchedule, Section, Subject } from "@/lib/trpc/types";

import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
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
 * ONE CLASS'S PAPER GRID — the batch editor behind "Edit papers".
 *
 * A date sheet, not a stack of fieldsets: one row per subject with inline
 * inputs, because the principal reads this the way the printed date sheet
 * reads — subject down the page, day/time across. `overflow-x-auto` keeps
 * the table honest on a phone rather than crushing seven columns.
 *
 * The save is a batch, not row-at-a-time (the service replaces the class's
 * schedules — and the parts of the rows it replaces — in one transaction),
 * so the whole grid is the form: `useFieldArray` holds one row per paper.
 * Deleting every row is legal — an empty grid is a state a draft can be
 * in, and "Remove class" in the papers section uses exactly that — but the
 * `scheduled` transition refuses until coverage is complete; that refusal
 * is the guard, not this dialog.
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

  const header = copy.exams.workflow.fields;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${copy.exams.workflow.editScheduleFor} — ${className}`}
      description={copy.exams.workflow.papersSubtitle}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit({ ...data, id: examId }))}
    >
      <div className="flex flex-col gap-3">
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="pb-1 pe-2 font-medium">{header.subject}</th>
                <th className="pb-1 pe-2 font-medium">{header.section}</th>
                <th className="pb-1 pe-2 font-medium">{header.date}</th>
                <th className="pb-1 pe-2 font-medium">{header.startTime}</th>
                <th className="pb-1 pe-2 font-medium">{header.duration}</th>
                <th className="pb-1 pe-2 font-medium">{header.venue}</th>
                <th className="pb-1 pe-2 font-medium">{header.passMarksOverrideShort}</th>
                <th className="pb-1" aria-label={copy.common.actions} />
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => {
                const rowError = errors?.[index];
                const invalid = (key: string) => rowError?.[key as keyof typeof rowError];
                return (
                  <tr key={field.id}>
                    <td className="pb-2 pe-2 align-top">
                      <Select
                        value={form.watch(`schedules.${index}.subjectId`)}
                        onValueChange={(v) => {
                          if (v) form.setValue(`schedules.${index}.subjectId`, v);
                        }}
                      >
                        <SelectTrigger
                          aria-label={`${header.subject} ${index + 1}`}
                          aria-invalid={invalid("subjectId") ? true : undefined}
                          className="w-36"
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
                    </td>
                    <td className="pb-2 pe-2 align-top">
                      <Select
                        value={form.watch(`schedules.${index}.sectionId`) ?? "all"}
                        onValueChange={(v) => {
                          form.setValue(`schedules.${index}.sectionId`, v === "all" ? null : v);
                        }}
                      >
                        <SelectTrigger
                          aria-label={`${header.section} ${index + 1}`}
                          aria-invalid={invalid("sectionId") ? true : undefined}
                          className="w-28"
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
                    </td>
                    <td className="pb-2 pe-2 align-top">
                      <Input
                        type="date"
                        aria-label={`${header.date} ${index + 1}`}
                        aria-invalid={invalid("examDate") ? true : undefined}
                        className="w-36"
                        {...form.register(`schedules.${index}.examDate`)}
                      />
                    </td>
                    <td className="pb-2 pe-2 align-top">
                      <Input
                        type="time"
                        aria-label={`${header.startTime} ${index + 1}`}
                        aria-invalid={invalid("startTime") ? true : undefined}
                        className="w-24"
                        {...form.register(`schedules.${index}.startTime`)}
                      />
                    </td>
                    <td className="pb-2 pe-2 align-top">
                      <Input
                        type="number"
                        min={5}
                        max={600}
                        inputMode="numeric"
                        aria-label={`${header.duration} ${index + 1}`}
                        aria-invalid={invalid("durationMinutes") ? true : undefined}
                        className="w-20"
                        {...form.register(`schedules.${index}.durationMinutes`, {
                          setValueAs: (v) => (v === "" ? undefined : Number(v)),
                        })}
                      />
                    </td>
                    <td className="pb-2 pe-2 align-top">
                      <Input
                        maxLength={150}
                        aria-label={`${header.venue} ${index + 1}`}
                        aria-invalid={invalid("venue") ? true : undefined}
                        className="w-32"
                        {...form.register(`schedules.${index}.venue`, {
                          setValueAs: (v) => (v === "" ? undefined : v),
                        })}
                      />
                    </td>
                    <td className="pb-2 pe-2 align-top">
                      <Input
                        inputMode="decimal"
                        aria-label={`${header.passMarksOverride} ${index + 1}`}
                        aria-invalid={invalid("passMarks") ? true : undefined}
                        className="w-20"
                        placeholder={copy.common.none}
                        {...form.register(`schedules.${index}.passMarks`, {
                          setValueAs: (v) => (v === "" ? undefined : v),
                        })}
                      />
                    </td>
                    <td className="pb-2 align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${copy.exams.workflow.removeRow} ${index + 1}`}
                        onClick={() => remove(index)}
                      >
                        <Trash2Icon />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              append({
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
      </div>
    </FormDialog>
  );
}
