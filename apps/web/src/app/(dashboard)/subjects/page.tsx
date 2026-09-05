"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MoreHorizontalIcon, PencilIcon, PlusIcon, ReceiptTextIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import {
  createSubjectSchema,
  updateSubjectSchema,
  type CreateSubjectInput,
  type UpdateSubjectInput,
} from "@repo/contracts";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";
import { useActiveContext } from "@/features/session/active-context";
import { toast } from "sonner";
import type { Subject } from "@/lib/trpc/types";

/**
 * SUBJECTS — the school's subject catalogue (S1). The vocabulary every other
 * exam screen picks from; the class wiring (which class takes what, with
 * which type and teacher) lives on the class page.
 *
 * Deactivate is the only removal (hard rule 2): results and assignments keep
 * pointing at a retired subject forever.
 */

const column = createAppColumnHelper<Subject>();

function SubjectDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  subject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateSubjectInput | UpdateSubjectInput) => Promise<void> | void;
  pending: boolean;
  subject?: Subject;
}) {
  const isEdit = Boolean(subject);

  const form = useForm<CreateSubjectInput>({
    resolver: zodResolver(isEdit ? (updateSubjectSchema as never) : (createSubjectSchema as never)) as never,
    defaultValues: {},
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      isEdit
        ? {
            name: subject?.name ?? "",
            shortName: subject?.shortName ?? undefined,
            code: subject?.code ?? undefined,
          }
        : { name: "" },
    );
  }, [open, isEdit, subject, form]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? copy.exams.subjects.edit : copy.exams.subjects.add}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={isEdit ? copy.common.save : copy.common.create}
      pending={pending}
    >
      <>
        <Field>
          <FieldLabel htmlFor="subject-name">{copy.exams.subjects.fields.name}</FieldLabel>
          <Input id="subject-name" maxLength={150} {...form.register("name")} />
          <FieldError>{form.formState.errors.name?.message}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="subject-short">{copy.exams.subjects.fields.shortName}</FieldLabel>
          <Input
            id="subject-short"
            maxLength={20}
            {...form.register("shortName", { setValueAs: (v) => (v === "" ? undefined : v) })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="subject-code">{copy.exams.subjects.fields.code}</FieldLabel>
          <Input
            id="subject-code"
            maxLength={20}
            {...form.register("code", { setValueAs: (v) => (v === "" ? undefined : v) })}
          />
          <FieldError>{form.formState.errors.code?.message}</FieldError>
        </Field>
      </>
    </FormDialog>
  );
}

export default function SubjectsPage() {
  const { scopeArgs, writeScopeArgs } = useActiveContext();

  const subjects = trpc.subject.list.useQuery(scopeArgs(), { staleTime: 30_000 });

  const utils = trpc.useUtils();
  const refresh = async () => {
    await utils.subject.list.invalidate();
  };

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | undefined>();
  const [retiring, setRetiring] = useState<Subject | undefined>();

  const create = trpc.subject.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.subjects.created);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const update = trpc.subject.update.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.subjects.updated);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const deactivate = trpc.subject.deactivate.useMutation({
    onSuccess: async () => {
      toast.success(copy.exams.subjects.retired);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const columns = useMemo<DataTableColumns<Subject>>(
    () =>
      column.columns([
        column.accessor("name", {
          header: copy.exams.subjects.fields.name,
          cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
        }),
        column.accessor("shortName", {
          header: copy.exams.subjects.fields.shortName,
          cell: ({ row }) =>
            row.original.shortName ? (
              <span className="text-muted-foreground">{row.original.shortName}</span>
            ) : (
              copy.common.none
            ),
        }),
        column.accessor("code", {
          header: copy.exams.subjects.fields.code,
          cell: ({ row }) =>
            row.original.code ? (
              <span className="text-muted-foreground">{row.original.code}</span>
            ) : (
              copy.common.none
            ),
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
                <PermissionGate permission="subject:update">
                  <DropdownMenuItem onClick={() => setEditing(row.original)}>
                    <PencilIcon data-icon="inline-start" />
                    {copy.exams.subjects.edit}
                  </DropdownMenuItem>
                </PermissionGate>
                <PermissionGate permission="subject:delete">
                  <DropdownMenuItem onClick={() => setRetiring(row.original)}>
                    {copy.exams.subjects.retireAction}
                  </DropdownMenuItem>
                </PermissionGate>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        }),
      ]),
    [],
  );

  const rows = subjects.data ?? [];

  return (
    <section aria-labelledby="subjects-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="subjects-heading" className="font-heading text-lg font-semibold">
          {copy.exams.subjects.title}
        </h1>
        <PermissionGate permission="subject:create">
          <Button onClick={() => setFormOpen(true)} disabled={!writeScopeArgs()}>
            <PlusIcon data-icon="inline-start" />
            {copy.exams.subjects.add}
          </Button>
        </PermissionGate>
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">{copy.exams.subjects.subtitle}</p>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.exams.subjects.title}
        isLoading={subjects.isLoading}
        error={subjects.error}
        onRetry={() => void subjects.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="truncate font-medium">{row.name}</p>
              <p className="text-muted-foreground text-xs">
                {[row.shortName, row.code].filter(Boolean).join(" · ") || copy.common.none}
              </p>
            </div>
            <PermissionGate permission="subject:update">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={copy.common.actions}>
                      <MoreHorizontalIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <PermissionGate permission="subject:update">
                    <DropdownMenuItem onClick={() => setEditing(row)}>
                      <PencilIcon data-icon="inline-start" />
                      {copy.exams.subjects.edit}
                    </DropdownMenuItem>
                  </PermissionGate>
                  <PermissionGate permission="subject:delete">
                    <DropdownMenuItem onClick={() => setRetiring(row)}>
                      {copy.exams.subjects.retireAction}
                    </DropdownMenuItem>
                  </PermissionGate>
                </DropdownMenuContent>
              </DropdownMenu>
            </PermissionGate>
          </div>
        )}
        empty={
          <EmptyState
            icon={ReceiptTextIcon}
            title={copy.exams.subjects.emptyTitle}
            description={copy.exams.subjects.emptyBody}
            action={
              <PermissionGate permission="subject:create">
                <Button onClick={() => setFormOpen(true)}>{copy.exams.subjects.add}</Button>
              </PermissionGate>
            }
          />
        }
      />

      <SubjectDialog
        open={formOpen || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditing(undefined);
          }
        }}
        subject={editing}
        pending={create.isPending || update.isPending}
        onSubmit={async (data) => {
          const schoolId = writeScopeArgs()?.schoolId;
          if (!schoolId) return;
          try {
            if (editing) {
              await update.mutateAsync({ ...scopeArgs(), schoolId, id: editing.id, data: data as UpdateSubjectInput });
            } else {
              await create.mutateAsync({ ...scopeArgs(), schoolId, data: data as CreateSubjectInput });
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
        title={copy.exams.subjects.retireTitle}
        consequence={copy.exams.subjects.retireBody}
        confirmLabel={copy.exams.subjects.retireConfirm}
        destructive
        pending={deactivate.isPending}
        onConfirm={async () => {
          if (!retiring) return;
          try {
            await deactivate.mutateAsync({
              ...scopeArgs(),
              schoolId: retiring.schoolId,
              id: retiring.id,
            });
          } finally {
            setRetiring(undefined);
          }
        }}
      />
    </section>
  );
}
