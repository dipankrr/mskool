"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, ScrollTextIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import {
  createPassCriteriaSchema,
  type CreatePassCriteriaInput,
} from "@repo/contracts";
import type { PassCriteria } from "@/lib/trpc/types";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { copy } from "@/lib/copy";
import { useActiveContext } from "@/features/session/active-context";
import { usePassCriteria, usePassCriteriaMutations } from "./use-exam-config";

/**
 * PASS CRITERIA — what passing a year means (ADR-032): the school default
 * row per year, with optional per-class overrides. The attendance bar is
 * ADVISORY (it never blocks a student — it feeds the readiness list).
 */

const column = createAppColumnHelper<PassCriteria>();

type CriteriaFormValues = CreatePassCriteriaInput;

function CriteriaDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  criteria,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreatePassCriteriaInput) => Promise<void> | void;
  pending: boolean;
  criteria?: PassCriteria;
}) {
  const isEdit = Boolean(criteria);

  const form = useForm<CriteriaFormValues>({
    resolver: zodResolver(createPassCriteriaSchema) as never,
    defaultValues: {},
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      isEdit
        ? {
            minSubjectsToPass: criteria?.minSubjectsToPass ?? undefined,
            graceMarksAllowed: criteria?.graceMarksAllowed ?? false,
            maxGracePerSubject: criteria?.maxGracePerSubject ?? undefined,
            maxGraceTotal: criteria?.maxGraceTotal ?? undefined,
            compartmentAllowed: criteria?.compartmentAllowed ?? false,
            maxSubjectsForCompartment: criteria?.maxSubjectsForCompartment ?? undefined,
            minAttendancePct: criteria?.minAttendancePct ?? "75.00",
          }
        : {
            graceMarksAllowed: false,
            compartmentAllowed: false,
            minAttendancePct: "75.00",
          },
    );
  }, [open, isEdit, criteria, form]);

  const grace = form.watch("graceMarksAllowed");
  const compartment = form.watch("compartmentAllowed");

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? copy.exams.criteria.title : copy.exams.criteria.add}
      onSubmit={form.handleSubmit((data) => onSubmit(data))}
      submitLabel={copy.common.save}
      pending={pending}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="criteria-min-subjects">{copy.exams.criteria.fields.minSubjects}</FieldLabel>
          <Input
            id="criteria-min-subjects"
            inputMode="numeric"
            {...form.register("minSubjectsToPass", { setValueAs: (v) => (v === "" ? null : Number(v)) })}
          />
          <FieldError>{form.formState.errors.minSubjectsToPass?.message}</FieldError>
        </Field>

        <Field>
          <div className="flex items-center gap-2">
            <Switch
              id="criteria-grace"
              checked={Boolean(grace)}
              onCheckedChange={(checked) => form.setValue("graceMarksAllowed", checked)}
            />
            <FieldLabel htmlFor="criteria-grace" className="!gap-1">
              {copy.exams.criteria.fields.grace}
            </FieldLabel>
          </div>
        </Field>

        {grace ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="criteria-grace-subject">{copy.exams.criteria.fields.maxGracePerSubject}</FieldLabel>
              <Input
                id="criteria-grace-subject"
                inputMode="decimal"
                {...form.register("maxGracePerSubject", { setValueAs: (v) => (v === "" ? null : v) })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="criteria-grace-total">{copy.exams.criteria.fields.maxGraceTotal}</FieldLabel>
              <Input
                id="criteria-grace-total"
                inputMode="decimal"
                {...form.register("maxGraceTotal", { setValueAs: (v) => (v === "" ? null : v) })}
              />
            </Field>
          </div>
        ) : null}

        <Field>
          <div className="flex items-center gap-2">
            <Switch
              id="criteria-compartment"
              checked={Boolean(compartment)}
              onCheckedChange={(checked) => form.setValue("compartmentAllowed", checked)}
            />
            <FieldLabel htmlFor="criteria-compartment" className="!gap-1">
              {copy.exams.criteria.fields.compartment}
            </FieldLabel>
          </div>
        </Field>

        {compartment ? (
          <Field>
            <FieldLabel htmlFor="criteria-compartment-max">{copy.exams.criteria.fields.maxCompartmentSubjects}</FieldLabel>
            <Input
              id="criteria-compartment-max"
              inputMode="numeric"
              {...form.register("maxSubjectsForCompartment", {
                setValueAs: (v) => (v === "" ? null : Number(v)),
              })}
            />
          </Field>
        ) : null}

        <Field>
          <FieldLabel htmlFor="criteria-attendance">{copy.exams.criteria.fields.attendance}</FieldLabel>
          <Input
            id="criteria-attendance"
            inputMode="decimal"
            {...form.register("minAttendancePct")}
          />
          <FieldDescription>{copy.exams.criteria.fields.attendance}</FieldDescription>
          <FieldError>{form.formState.errors.minAttendancePct?.message}</FieldError>
        </Field>
      </FieldGroup>
    </FormDialog>
  );
}

export function PassCriteriaSection() {
  const { academicYearId, scopeArgs } = useActiveContext();
  const criteria = usePassCriteria(academicYearId);
  const { create, update } = usePassCriteriaMutations(academicYearId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PassCriteria | undefined>();

  const columns = useMemo<DataTableColumns<PassCriteria>>(
    () =>
      column.columns([
        column.display({
          id: "kind",
          header: "",
          cell: ({ row }) =>
            row.original.classId === null ? (
              <Badge variant="outline">{copy.exams.criteria.defaultBadge}</Badge>
            ) : (
              <Badge variant="outline">{copy.exams.criteria.classBadge}</Badge>
            ),
        }),
        column.display({
          id: "minSubjects",
          header: copy.exams.criteria.fields.minSubjects,
          cell: ({ row }) => row.original.minSubjectsToPass ?? copy.common.none,
        }),
        column.display({
          id: "grace",
          header: copy.exams.criteria.fields.grace,
          cell: ({ row }) =>
            row.original.graceMarksAllowed
              ? `${copy.common.yes} · ${row.original.maxGracePerSubject ?? "0"} / ${row.original.maxGraceTotal ?? "0"}`
              : copy.common.no,
        }),
        column.display({
          id: "compartment",
          header: copy.exams.criteria.fields.compartment,
          cell: ({ row }) =>
            row.original.compartmentAllowed
              ? `${copy.common.yes} · ${row.original.maxSubjectsForCompartment ?? 0}`
              : copy.common.no,
        }),
        column.accessor("minAttendancePct", {
          header: copy.exams.criteria.fields.attendance,
        }),
      ]),
    [],
  );

  const rows = criteria.data ?? [];
  const hasDefault = rows.some((r) => r.classId === null);

  return (
    <section aria-labelledby="pass-criteria-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pass-criteria-heading" className="font-heading text-base font-semibold">
          {copy.exams.criteria.title}
        </h2>
        <PermissionGate permission="exam:create">
          <Button
            onClick={() => setFormOpen(true)}
            disabled={!academicYearId || hasDefault}
          >
            <PlusIcon data-icon="inline-start" />
            {copy.exams.criteria.add}
          </Button>
        </PermissionGate>
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">{copy.exams.criteria.subtitle}</p>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.exams.criteria.title}
        isLoading={criteria.isLoading}
        error={criteria.error}
        onRetry={() => void criteria.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {row.classId === null ? copy.exams.criteria.defaultBadge : copy.exams.criteria.classBadge}
              </p>
              <p className="text-muted-foreground text-xs">
                {copy.exams.criteria.fields.attendance}: {row.minAttendancePct}%
              </p>
            </div>
          </div>
        )}
        empty={
          <EmptyState
            icon={ScrollTextIcon}
            title={copy.exams.criteria.emptyTitle}
            description={copy.exams.criteria.emptyBody}
            action={
              <PermissionGate permission="exam:create">
                <Button onClick={() => setFormOpen(true)} disabled={!academicYearId}>
                  {copy.exams.criteria.add}
                </Button>
              </PermissionGate>
            }
          />
        }
      />

      <CriteriaDialog
        open={formOpen || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditing(undefined);
          }
        }}
        criteria={editing}
        pending={create.isPending || update.isPending}
        onSubmit={async (data) => {
          try {
            if (editing) {
              await update.mutateAsync({ ...scopeArgs(), id: editing.id, data });
            } else if (academicYearId) {
              await create.mutateAsync({ ...scopeArgs(), academicYearId, data });
            }
            setFormOpen(false);
            setEditing(undefined);
          } catch {
            // The toast carries the server's wording; the form stays open.
          }
        }}
      />
    </section>
  );
}
