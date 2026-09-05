"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";

import { createExamSchema, type CreateExamInput } from "@repo/contracts";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
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
import { useActiveContext } from "@/features/session/active-context";
import {
  useExamWorkflowMutations,
  useExams,
  useTerms,
} from "@/features/exams/use-exam-workflow";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { copy } from "@/lib/copy";

/**
 * THE EXAMS HUB (S2): every exam for the active session with its lifecycle
 * badge; creation opens the term-picked dialog — the exam's year derives
 * from its term, never from the client (ADR-032).
 */

type ExamRow = NonNullable<ReturnType<typeof useExams>["data"]>[number];
const column = createAppColumnHelper<ExamRow>();

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    scheduled: "Scheduled",
    ongoing: "Ongoing",
    marks_entry: "Marks entry",
    under_verification: "Under verification",
    published: "Published",
    locked: "Locked",
  };
  return labels[status] ?? status;
}

function ExamDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  terms,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateExamInput) => Promise<void> | void;
  pending: boolean;
  terms: { id: string; name: string }[];
}) {
  const form = useForm<CreateExamInput>({
    resolver: zodResolver(createExamSchema) as never,
    defaultValues: {},
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ name: "", termId: terms[0]?.id ?? "", examType: "regular" });
  }, [open, terms, form]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.exams.workflow.add}
      submitLabel={copy.common.create}
      pending={pending}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
    >
      <>
        <Field>
          <FieldLabel htmlFor="exam-name">{copy.exams.subjects.fields.name}</FieldLabel>
          <Input id="exam-name" maxLength={150} {...form.register("name")} />
          <FieldError>{form.formState.errors.name?.message}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="exam-term">{copy.exams.workflow.term}</FieldLabel>
          <Select
            value={form.watch("termId")}
            onValueChange={(v) => {
              if (v) form.setValue("termId", v);
            }}
          >
            <SelectTrigger id="exam-term">
              <SelectValue>
                {(value: string | null) =>
                  value ? (terms.find((t) => t.id === value)?.name ?? copy.common.none) : copy.common.none
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {terms.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{form.formState.errors.termId?.message}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="exam-type">{copy.exams.workflow.type}</FieldLabel>
          <Select
            value={form.watch("examType")}
            onValueChange={(v) => form.setValue("examType", v as CreateExamInput["examType"])}
          >
            <SelectTrigger id="exam-type">
              <SelectValue>
                {(value: string | null) => (value ? value.replace("_", " ") : copy.common.none)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="regular">Regular</SelectItem>
              <SelectItem value="mock">Mock</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </>
    </FormDialog>
  );
}

export default function ExamsPage() {
  const { academicYearId, has, scopeArgs } = useActiveContext();
  const exams = useExams(academicYearId);
  const terms = useTerms(academicYearId);
  const { create } = useExamWorkflowMutations();

  const [formOpen, setFormOpen] = useState(false);

  const columns = useMemo<DataTableColumns<ExamRow>>(
    () =>
      column.columns([
        column.accessor("name", {
          header: copy.exams.subjects.fields.name,
          cell: ({ row }) => (
            <Link href={`/exams/${row.original.id}`} className="font-medium hover:underline">
              {row.original.name}
            </Link>
          ),
        }),
        column.accessor("examType", {
          header: copy.exams.workflow.type,
          cell: ({ row }) => <Badge variant="outline">{row.original.examType}</Badge>,
        }),
        column.accessor("status", {
          header: copy.exams.workflow.status,
          cell: ({ row }) => <Badge variant="outline">{statusLabel(row.original.status)}</Badge>,
        }),
      ]),
    [],
  );

  const rows = exams.data ?? [];

  return (
    <>
      <PageHeader title={copy.exams.setup.title} description={copy.exams.setup.subtitle} />
      <section aria-labelledby="exams-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="exams-heading" className="font-heading text-base font-semibold">
            {copy.exams.workflow.title}
          </h2>
          {has("exam:create") && academicYearId ? (
            <Button onClick={() => setFormOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              {copy.exams.workflow.add}
            </Button>
          ) : null}
        </div>

        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          caption={copy.exams.workflow.title}
          isLoading={exams.isLoading}
          error={exams.error}
          onRetry={() => void exams.refetch()}
          renderCard={(row) => (
            <Link href={`/exams/${row.id}`} className="block rounded-lg border p-4">
              <p className="flex items-center justify-between font-medium">
                {row.name}
                <Badge variant="outline">{statusLabel(row.status)}</Badge>
              </p>
            </Link>
          )}
          empty={
            <EmptyState
              icon={PlusIcon}
              title={copy.exams.workflow.emptyTitle}
              description={copy.exams.workflow.emptyBody}
              action={
                has("exam:create") && academicYearId ? (
                  <Button onClick={() => setFormOpen(true)}>{copy.exams.workflow.add}</Button>
                ) : undefined
              }
            />
          }
        />
      </section>

      <ExamDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        terms={terms.data ?? []}
        pending={create.isPending}
        onSubmit={async (data) => {
          await create.mutateAsync({ ...scopeArgs(), data });
          setFormOpen(false);
        }}
      />
    </>
  );
}
