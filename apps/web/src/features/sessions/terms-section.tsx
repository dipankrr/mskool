"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import {
  createTermSchema,
  updateTermSchema,
  type CreateTermInput,
} from "@repo/contracts";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { useTermMutations, useTerms } from "./use-terms";
import type { AcademicYear, Term } from "@/lib/trpc/types";
import { DataTable } from "@/components/data-table";

/**
 * THE TERM PLAN (S2's recorded straggler, now landed) — one year's terms,
 * editable while childless. The exam dialog's term picker, the attendance
 * summaries, and fee installments all hang off these rows, so the sessions
 * screen shows them right under the year they belong to.
 *
 * Edits are partial (updateTermSchema): the year is never patchable
 * (see the contract's comment — a moved term orphans its children), so
 * the form resets per row and the dialog is the only writer.
 */

const column = createAppColumnHelper<Term>();

type TermFormValues = CreateTermInput;

export function TermsSection({ session }: { session: AcademicYear }) {
  const terms = useTerms(session.id);
  const { create, update } = useTermMutations();
  const { writeScopeArgs } = useActiveContext();
  const [editing, setEditing] = useState<Term | undefined>(undefined);
  const [open, setOpen] = useState(false);

  const form = useForm<TermFormValues>({
    // Same idiom as the fee-head dialog: one form type, the presence of
    // an editing row picks the resolver.
    resolver: zodResolver(editing ? updateTermSchema : createTermSchema) as never,
    defaultValues: {},
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      editing
        ? {
            name: editing.name,
            sequenceNumber: editing.sequenceNumber,
            startDate: editing.startDate,
            endDate: editing.endDate,
          }
        : {
            name: "",
            sequenceNumber: (terms.data?.length ?? 0) + 1,
            startDate: session.startDate,
            endDate: session.endDate,
          },
    );
  }, [open, editing, terms.data, session, form]);

  const canUpdate = useHasUpdate();
  const columns = useMemo<DataTableColumns<Term>>(
    () =>
      column.columns([
        column.accessor("sequenceNumber", { header: copy.sessions.termFields.sequence }),
        column.accessor("name", {
          header: copy.sessions.termFields.name,
          cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
        }),
        column.display({
          id: "window",
          header: copy.sessions.termFields.startDate,
          cell: ({ row }) =>
            `${formatIsoDate(row.original.startDate)} – ${formatIsoDate(row.original.endDate)}`,
        }),
        column.display({
          id: "actions",
          header: copy.common.actions,
          cell: ({ row }) =>
            canUpdate ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)}>
                <PencilIcon data-icon="inline-start" />
                {copy.sessions.termEdit}
              </Button>
            ) : null,
        }),
      ]),
    [canUpdate],
  );

  const submit = async (data: TermFormValues) => {
    if (!writeScopeArgs()) {
      // The create path needs a branch; the section sits under a year the
      // caller can already see, so this is the org-admin-no-branch case.
      return;
    }
    try {
      if (editing) {
        await update.submit(editing.id, data);
      } else {
        await create.submit({ ...data, academicYearId: session.id });
      }
      setOpen(false);
      setEditing(undefined);
    } catch {
      // The toast carries the wording; the form stays.
    }
  };

  return (
    <section aria-label={copy.sessions.termsSection} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-base font-semibold">
          {copy.sessions.termsSection}
        </h3>
        {canUpdate ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(undefined);
              setOpen(true);
            }}
          >
            <PlusIcon data-icon="inline-start" />
            {copy.sessions.termAdd}
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">{copy.sessions.termsSubtitle}</p>

      <DataTable
        data={terms.data ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.sessions.termsSection}
        isLoading={terms.isLoading}
        error={terms.error}
        onRetry={() => void terms.refetch()}
        renderCard={(row) => (
          <div className="rounded-lg border p-4">
            <p className="font-medium">
              {row.sequenceNumber}. {row.name}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatIsoDate(row.startDate)} – {formatIsoDate(row.endDate)}
            </p>
          </div>
        )}
        empty={
          <EmptyState
            title={copy.sessions.termsEmptyTitle}
            description={copy.sessions.termsEmptyBody}
            action={
              <PermissionGate permission="academic_year:create">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(undefined);
                    setOpen(true);
                  }}
                >
                  {copy.sessions.termAdd}
                </Button>
              </PermissionGate>
            }
          />
        }
      />

      <FormDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setEditing(undefined);
        }}
        title={editing ? copy.sessions.termEdit : copy.sessions.termAdd}
        description={`${copy.sessions.termsSection} — ${session.name}`}
        pending={create.isPending || update.isPending}
        onSubmit={form.handleSubmit((data) => submit(data as CreateTermInput))}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={form.formState.errors.name ? true : undefined}>
            <FieldLabel htmlFor="term-name">{copy.sessions.termFields.name}</FieldLabel>
            <Input id="term-name" maxLength={100} placeholder="Term 1" {...form.register("name")} />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </Field>
          <Field data-invalid={form.formState.errors.sequenceNumber ? true : undefined}>
            <FieldLabel htmlFor="term-sequence">{copy.sessions.termFields.sequence}</FieldLabel>
            <Input
              id="term-sequence"
              type="number"
              min={1}
              max={50}
              {...form.register("sequenceNumber", { setValueAs: (v) => Number(v) })}
            />
            <FieldError>{form.formState.errors.sequenceNumber?.message}</FieldError>
          </Field>
          <Field data-invalid={form.formState.errors.startDate ? true : undefined}>
            <FieldLabel htmlFor="term-start">{copy.sessions.termFields.startDate}</FieldLabel>
            <Input id="term-start" type="date" {...form.register("startDate")} />
            <FieldError>{form.formState.errors.startDate?.message}</FieldError>
          </Field>
          <Field data-invalid={form.formState.errors.endDate ? true : undefined}>
            <FieldLabel htmlFor="term-end">{copy.sessions.termFields.endDate}</FieldLabel>
            <Input id="term-end" type="date" {...form.register("endDate")} />
            <FieldError>{form.formState.errors.endDate?.message}</FieldError>
          </Field>
        </div>
      </FormDialog>
    </section>
  );
}

function useHasUpdate(): boolean {
  const { has } = useActiveContext();
  return has("academic_year:update");
}
