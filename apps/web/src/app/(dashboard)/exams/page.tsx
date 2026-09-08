"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { toast } from "sonner";

import { createExamSchema, type CreateExamInput } from "@repo/contracts";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
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

const EXAM_TYPE_LABELS: Record<string, string> = {
  regular: copy.exams.workflow.typeRegular,
  supplementary: copy.exams.workflow.typeSupplementary,
  improvement: copy.exams.workflow.typeImprovement,
  mock: copy.exams.workflow.typeMock,
  test: copy.exams.workflow.typeTest,
};

function ExamDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  terms,
  exams,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateExamInput) => Promise<void> | void;
  pending: boolean;
  terms: { id: string; name: string }[];
  exams: { id: string; name: string }[];
}) {
  const form = useForm<CreateExamInput>({
    resolver: zodResolver(createExamSchema) as never,
    defaultValues: {},
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: "",
      termId: terms[0]?.id ?? "",
      examType: "regular",
      weightageInTerm: "100.00",
      countsTowardTermResult: true,
    });
  }, [open, terms, form]);

  const examType = form.watch("examType");
  // Practice papers run the full pipeline but never count — the server
  // forces the flag, so the counting options stay hidden for them.
  const nonCounting = examType === "mock" || examType === "test";
  const needsLink = examType === "supplementary" || examType === "improvement";

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
          {terms.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {copy.exams.workflow.noTermsTitle} — {copy.exams.workflow.noTermsBody}
            </p>
          ) : (
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
          )}
          <FieldError>{form.formState.errors.termId?.message}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="exam-type">{copy.exams.workflow.type}</FieldLabel>
          <Select
            value={examType}
            onValueChange={(v) => {
              const next = v as CreateExamInput["examType"];
              form.setValue("examType", next);
              // Keep the hidden counting fields consistent with the type
              // so a stale weightage can never ride along on a mock/test.
              form.setValue("countsTowardTermResult", next !== "mock" && next !== "test");
              if (next !== "supplementary" && next !== "improvement") {
                form.setValue("linkedExamId", null);
              }
            }}
          >
            <SelectTrigger id="exam-type">
              <SelectValue>
                {(value: string | null) => (value ? (EXAM_TYPE_LABELS[value] ?? value) : copy.common.none)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="regular">{copy.exams.workflow.typeRegular}</SelectItem>
              <SelectItem value="supplementary">{copy.exams.workflow.typeSupplementary}</SelectItem>
              <SelectItem value="improvement">{copy.exams.workflow.typeImprovement}</SelectItem>
              <SelectItem value="mock">{copy.exams.workflow.typeMock}</SelectItem>
              <SelectItem value="test">{copy.exams.workflow.typeTest}</SelectItem>
            </SelectContent>
          </Select>
          <FieldError>{form.formState.errors.examType?.message}</FieldError>
        </Field>
        {needsLink ? (
          <Field>
            <FieldLabel htmlFor="exam-linked">{copy.exams.workflow.linkedExam}</FieldLabel>
            <Select
              value={form.watch("linkedExamId") ?? ""}
              onValueChange={(v) => {
                form.setValue("linkedExamId", v || null);
              }}
            >
              <SelectTrigger id="exam-linked">
                <SelectValue>
                  {(value: string | null) =>
                    value ? (exams.find((e) => e.id === value)?.name ?? copy.common.none) : copy.common.none
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {exams.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{copy.exams.workflow.linkedExamHelp}</FieldDescription>
            <FieldError>{form.formState.errors.linkedExamId?.message}</FieldError>
          </Field>
        ) : null}
        {nonCounting ? (
          <p className="text-sm text-muted-foreground">{copy.exams.workflow.nonCountingNote}</p>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="exam-weightage">{copy.exams.workflow.weightage}</FieldLabel>
              <Input
                id="exam-weightage"
                inputMode="decimal"
                placeholder="100.00"
                {...form.register("weightageInTerm")}
              />
              <FieldDescription>{copy.exams.workflow.weightageHelp}</FieldDescription>
              <FieldError>{form.formState.errors.weightageInTerm?.message}</FieldError>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="exam-counts"
                checked={form.watch("countsTowardTermResult") ?? true}
                onCheckedChange={(v) => form.setValue("countsTowardTermResult", v === true)}
              />
              <FieldLabel htmlFor="exam-counts">{copy.exams.workflow.countsToward}</FieldLabel>
            </Field>
            <FieldDescription>{copy.exams.workflow.countsTowardHelp}</FieldDescription>
            <FieldError>{form.formState.errors.countsTowardTermResult?.message}</FieldError>
          </>
        )}
      </>
    </FormDialog>
  );
}

export default function ExamsPage() {
  const { academicYearId, has, writeScopeArgs } = useActiveContext();
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
          cell: ({ row }) => (
            <Badge variant="outline">
              {EXAM_TYPE_LABELS[row.original.examType] ?? row.original.examType}
            </Badge>
          ),
        }),
        column.accessor("status", {
          header: copy.exams.workflow.status,
          cell: ({ row }) => <Badge variant="outline">{statusLabel(row.original.status)}</Badge>,
        }),
        column.accessor("termName", {
          header: copy.exams.workflow.term,
        }),
        column.accessor("scheduledClasses", {
          header: copy.exams.workflow.progress,
          cell: ({ row }) =>
            row.original.scheduledClasses === 0
              ? copy.common.none
              : `${row.original.publishedClasses}/${row.original.scheduledClasses} ${copy.exams.workflow.publishedSuffix}`,
        }),
      ]),
    [],
  );

  const rows = exams.data ?? [];

  return (
    <>
      <PageHeader title={copy.exams.workflow.title} description={copy.exams.setup.subtitle} />
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
              <p className="text-muted-foreground mt-1 text-xs">
                {EXAM_TYPE_LABELS[row.examType] ?? row.examType} · {row.termName || copy.common.none}
                {row.scheduledClasses > 0
                  ? ` · ${row.publishedClasses}/${row.scheduledClasses} ${copy.exams.workflow.publishedSuffix}`
                  : null}
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
        exams={rows.map((r) => ({ id: r.id, name: r.name }))}
        pending={create.isPending}
        onSubmit={async (data) => {
          // School-parent write: the branch rides along, or the user is
          // asked to pick one — org-only scope always fails server-side.
          const scope = writeScopeArgs();
          if (!scope) {
            toast.error(copy.errors.needsBranch);
            return;
          }
          // Practice papers never count: send no weightage so no stale
          // value rides along (the server forces the flag anyway).
          const payload: CreateExamInput =
            data.examType === "mock" || data.examType === "test"
              ? {
                  name: data.name,
                  termId: data.termId,
                  examType: data.examType,
                  countsTowardTermResult: false,
                }
              : data;
          await create.mutateAsync({ ...scope, data: payload });
          setFormOpen(false);
        }}
      />
    </>
  );
}
