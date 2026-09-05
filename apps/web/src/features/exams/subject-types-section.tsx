"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MoreHorizontalIcon, PencilIcon, PlusIcon, SparklesIcon, SquarePenIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import {
  createSubjectTypeSchema,
  updateSubjectTypeSchema,
  type CreateSubjectTypeInput,
  type UpdateSubjectTypeInput,
} from "@repo/contracts";
import type { SubjectType } from "@/lib/trpc/types";
import { useActiveContext } from "@/features/session/active-context";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { copy } from "@/lib/copy";
import {
  useSubjectTypeMutations,
  useSubjectTypes,
} from "./use-exam-config";

/**
 * SUBJECT TYPES — the report-card widgets and the grading behaviour behind
 * them (ADR-032 #1). School-defined; the CBSE preset seeds the standard set.
 *
 * The flag/mode fields LOCK once the type has assessment data (the service
 * refuses with the worded reason; S4's assessment counts wire the row's
 * locked state) — until then the dialog keeps them editable and the server
 * stays the authority.
 */

const column = createAppColumnHelper<SubjectType>();

type TypeFormValues = CreateSubjectTypeInput;

function SubjectTypeDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  type,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateSubjectTypeInput | UpdateSubjectTypeInput) => Promise<void> | void;
  pending: boolean;
  type?: SubjectType;
}) {
  const isEdit = Boolean(type);

  const form = useForm<TypeFormValues>({
    resolver: zodResolver(isEdit ? (updateSubjectTypeSchema as never) : (createSubjectTypeSchema as never)) as never,
    defaultValues: {},
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      isEdit
        ? {
            name: type?.name ?? "",
            countsTowardResult: type?.countsTowardResult ?? true,
            isGradedOnly: type?.isGradedOnly ?? false,
            assessmentMode: type?.assessmentMode ?? "exam",
            sequence: type?.sequence ?? 0,
          }
        : { name: "", countsTowardResult: true, isGradedOnly: false, assessmentMode: "exam", sequence: 0 },
    );
  }, [open, isEdit, type, form]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? copy.exams.types.title : copy.exams.types.add}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={isEdit ? copy.common.save : copy.common.create}
      pending={pending}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="subject-type-name">{copy.exams.types.fields.name}</FieldLabel>
          <Input id="subject-type-name" maxLength={100} {...form.register("name")} />
        </Field>

        <Field>
          <FieldLabel htmlFor="subject-type-mode">{copy.exams.types.fields.mode}</FieldLabel>
          <Select
            value={form.watch("assessmentMode")}
            onValueChange={(v) => form.setValue("assessmentMode", v as "exam" | "term_grade")}
          >
            <SelectTrigger id="subject-type-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exam">{copy.exams.types.badges.exam}</SelectItem>
              <SelectItem value="term_grade">{copy.exams.types.badges.term_grade}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <div className="flex items-center gap-2">
            <Switch
              id="subject-type-counts"
              checked={Boolean(form.watch("countsTowardResult"))}
              onCheckedChange={(checked) => form.setValue("countsTowardResult", checked)}
            />
            <FieldLabel htmlFor="subject-type-counts" className="!gap-1">
              {copy.exams.types.fields.counts}
            </FieldLabel>
          </div>
          <FieldDescription>{copy.exams.types.fields.countsHelp}</FieldDescription>
        </Field>

        <Field>
          <div className="flex items-center gap-2">
            <Switch
              id="subject-type-graded"
              checked={Boolean(form.watch("isGradedOnly"))}
              onCheckedChange={(checked) => form.setValue("isGradedOnly", checked)}
            />
            <FieldLabel htmlFor="subject-type-graded" className="!gap-1">
              {copy.exams.types.fields.graded}
            </FieldLabel>
          </div>
          <FieldDescription>{copy.exams.types.fields.gradedHelp}</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="subject-type-sequence">{copy.exams.types.fields.sequence}</FieldLabel>
          <Input
            id="subject-type-sequence"
            inputMode="numeric"
            {...form.register("sequence", { setValueAs: (v) => Number(v) })}
          />
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}

export function SubjectTypesSection() {
  const { scopeArgs } = useActiveContext();
  const types = useSubjectTypes();
  const { create, update, deactivate, applyPreset } = useSubjectTypeMutations();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SubjectType | undefined>();
  const [retiring, setRetiring] = useState<SubjectType | undefined>();

  const columns = useMemo<DataTableColumns<SubjectType>>(
    () =>
      column.columns([
        column.accessor("name", {
          header: copy.exams.types.fields.name,
          cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
        }),
        column.accessor("countsTowardResult", {
          header: copy.exams.types.fields.counts,
          cell: ({ row }) => (row.original.countsTowardResult ? copy.common.yes : copy.common.no),
        }),
        column.accessor("isGradedOnly", {
          header: copy.exams.types.fields.graded,
          cell: ({ row }) => (row.original.isGradedOnly ? copy.common.yes : copy.common.no),
        }),
        column.accessor("assessmentMode", {
          header: copy.exams.types.fields.mode,
          cell: ({ row }) => <Badge variant="outline">{row.original.assessmentMode === "exam" ? copy.exams.types.badges.exam : copy.exams.types.badges.term_grade}</Badge>,
        }),
        column.display({
          id: "actions",
          header: copy.common.actions,
          cell: ({ row }) => (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={copy.common.actions}>
                    <MoreHorizontalIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <PermissionGate permission="exam:update">
                  <DropdownMenuItem onClick={() => setEditing(row.original)}>
                    <PencilIcon data-icon="inline-start" />
                    {copy.common.edit}
                  </DropdownMenuItem>
                </PermissionGate>
                <PermissionGate permission="exam:update">
                  <DropdownMenuItem onClick={() => setRetiring(row.original)}>
                    <SquarePenIcon data-icon="inline-start" />
                    {copy.exams.types.retireAction}
                  </DropdownMenuItem>
                </PermissionGate>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        }),
      ]),
    [],
  );

  const rows = types.data ?? [];

  return (
    <section aria-labelledby="subject-types-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="subject-types-heading" className="font-heading text-base font-semibold">
          {copy.exams.types.title}
        </h2>
        <div className="flex gap-2">
          <PermissionGate permission="exam:create">
            <Button
              variant="outline"
              onClick={() => {
                void applyPreset.mutateAsync({ organizationId: scopeArgs().organizationId }).catch(() => {});
              }}
              disabled={applyPreset.isPending}
            >
              <SparklesIcon data-icon="inline-start" />
              {copy.exams.types.applyPreset}
            </Button>
          </PermissionGate>
          <PermissionGate permission="exam:create">
            <Button onClick={() => setFormOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              {copy.exams.types.add}
            </Button>
          </PermissionGate>
        </div>
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">{copy.exams.types.subtitle}</p>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.exams.types.title}
        isLoading={types.isLoading}
        error={types.error}
        onRetry={() => void types.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="truncate font-medium">{row.name}</p>
              <p className="text-muted-foreground text-xs">
                {row.assessmentMode === "exam" ? copy.exams.types.badges.exam : copy.exams.types.badges.term_grade}
                {row.countsTowardResult ? ` · ${copy.exams.types.fields.counts}` : ""}
              </p>
            </div>
            <PermissionGate permission="exam:update">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={copy.common.actions}>
                      <MoreHorizontalIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <PermissionGate permission="exam:update">
                    <DropdownMenuItem onClick={() => setEditing(row)}>
                      <PencilIcon data-icon="inline-start" />
                      {copy.common.edit}
                    </DropdownMenuItem>
                  </PermissionGate>
                  <PermissionGate permission="exam:update">
                    <DropdownMenuItem onClick={() => setRetiring(row)}>
                      {copy.exams.types.retireAction}
                    </DropdownMenuItem>
                  </PermissionGate>
                </DropdownMenuContent>
              </DropdownMenu>
            </PermissionGate>
          </div>
        )}
        empty={
          <EmptyState
            icon={SparklesIcon}
            title={copy.exams.types.emptyTitle}
            description={copy.exams.types.emptyBody}
            action={
              <div className="flex gap-2">
                <PermissionGate permission="exam:create">
                  <Button
                    variant="outline"
                    onClick={() => {
                      void applyPreset.mutateAsync({ organizationId: scopeArgs().organizationId }).catch(() => {});
                    }}
                  >
                    {copy.exams.types.applyPreset}
                  </Button>
                </PermissionGate>
                <PermissionGate permission="exam:create">
                  <Button onClick={() => setFormOpen(true)}>{copy.exams.types.add}</Button>
                </PermissionGate>
              </div>
            }
          />
        }
      />

      <SubjectTypeDialog
        open={formOpen || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditing(undefined);
          }
        }}
        type={editing}
        pending={create.isPending || update.isPending}
        onSubmit={async (data) => {
          try {
            if (editing) {
              await update.mutateAsync({ ...scopeArgs(), id: editing.id, data: data as UpdateSubjectTypeInput });
            } else {
              await create.mutateAsync({ ...scopeArgs(), data: data as CreateSubjectTypeInput });
            }
            setFormOpen(false);
            setEditing(undefined);
          } catch {
            // The toast carries the server's wording; the form stays open.
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(retiring)}
        onOpenChange={(open) => !open && setRetiring(undefined)}
        title={copy.exams.types.retireTitle}
        consequence={copy.exams.types.retireBody}
        confirmLabel={copy.exams.types.retireConfirm}
        destructive
        pending={deactivate.isPending}
        onConfirm={async () => {
          if (!retiring) return;
          try {
            await deactivate.mutateAsync({ ...scopeArgs(), id: retiring.id });
          } finally {
            setRetiring(undefined);
          }
        }}
      />
    </section>
  );
}
