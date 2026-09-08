"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon, MoreHorizontalIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useFieldArray, useForm } from "react-hook-form";

import { createGradingScaleSchema, type CreateGradingScaleInput } from "@repo/contracts";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { Switch } from "@/components/ui/switch";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { GradingScale } from "@/lib/trpc/types";
import { copy } from "@/lib/copy";
import { useActiveContext } from "@/features/session/active-context";
import { useGradingScaleMutations, useGradingScales } from "./use-exam-config";

/**
 * GRADING SCALES — percentage bands that turn a score into a grade
 * (ADR-032 #5). A scale LOCKS on first use (the ADR-013 trigger + the
 * service guard): from then on only its name is editable — policy changes
 * mean a NEW scale, because results computed against the old one must grade
 * the same way forever.
 *
 * The dialog edits a scale WITH its bands (created atomically); the bands
 * field-array pins contiguity client-side while the service re-validates.
 */

const column = createAppColumnHelper<GradingScale>();

type BandsFormValues = {
  name: string;
  description?: string;
  isDefault?: boolean;
  bands: {
    minMarks: string;
    maxMarks: string;
    gradeLabel: string;
    gradePoint?: string | null;
    descriptor?: string;
    sequenceNumber?: number;
  }[];
};

function GradingScaleDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
  scale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateGradingScaleInput, id?: string) => Promise<void> | void;
  pending: boolean;
  scale?: GradingScale;
}) {
  const isEdit = Boolean(scale);
  const locked = Boolean(scale?.isLocked);

  const form = useForm<BandsFormValues>({
    resolver: zodResolver(createGradingScaleSchema) as never,
    defaultValues: { name: "", bands: [{ minMarks: "0", maxMarks: "100", gradeLabel: "A" }] },
  });
  const bands = useFieldArray({ control: form.control, name: "bands" });

  useEffect(() => {
    if (!open) return;
    form.reset(
      scale
        ? {
            name: scale.name,
            description: scale.description ?? undefined,
            isDefault: scale.isDefault,
            bands: (scale.bands ?? []).map((b) => ({
              minMarks: b.minMarks,
              maxMarks: b.maxMarks,
              gradeLabel: b.gradeLabel,
              gradePoint: b.gradePoint ?? undefined,
              descriptor: b.descriptor ?? undefined,
              sequenceNumber: b.sequenceNumber,
            })),
          }
        : { name: "", bands: [{ minMarks: "0", maxMarks: "100", gradeLabel: "A" }] },
    );
  }, [open, scale, form]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? scale!.name : copy.exams.scales.add}
      onSubmit={form.handleSubmit((data) =>
        onSubmit(data as CreateGradingScaleInput, isEdit ? scale!.id : undefined),
      )}
      submitLabel={copy.common.save}
      pending={pending}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="scale-name">{copy.exams.scales.fields.name}</FieldLabel>
          <Input id="scale-name" maxLength={100} {...form.register("name")} />
        </Field>

        <Field>
          <FieldLabel htmlFor="scale-description">{copy.exams.scales.fields.description}</FieldLabel>
          <Input
            id="scale-description"
            maxLength={255}
            {...form.register("description", {
              setValueAs: (v) => (v === "" ? undefined : v),
            })}
          />
        </Field>

        {!isEdit ? (
          <Field>
            <div className="flex items-center gap-2">
              <Switch
                id="scale-default"
                checked={form.watch("isDefault") ?? false}
                onCheckedChange={(checked) => form.setValue("isDefault", checked)}
              />
              <FieldLabel htmlFor="scale-default" className="!gap-1">
                {copy.exams.scales.fields.isDefault}
              </FieldLabel>
            </div>
          </Field>
        ) : null}

        {isEdit && locked ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <LockIcon className="size-4" />
            {copy.exams.scales.locked}
          </p>
        ) : null}

        {!(isEdit && locked) ? (
        <div className="flex flex-col gap-2">
          <FieldLabel>{copy.exams.scales.fields.bands}</FieldLabel>
          {bands.fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-[1fr_1fr_1fr_1fr] items-start gap-2">
              <Field>
                <Input
                  inputMode="decimal"
                  placeholder={copy.exams.scales.fields.minMarks}
                  aria-label={copy.exams.scales.fields.minMarks}
                  {...form.register(`bands.${index}.minMarks` as const)}
                />
                <FieldError>{form.formState.errors.bands?.[index]?.minMarks?.message}</FieldError>
              </Field>
              <Field>
                <Input
                  inputMode="decimal"
                  placeholder={copy.exams.scales.fields.maxMarks}
                  aria-label={copy.exams.scales.fields.maxMarks}
                  {...form.register(`bands.${index}.maxMarks` as const)}
                />
                <FieldError>{form.formState.errors.bands?.[index]?.maxMarks?.message}</FieldError>
              </Field>
              <Field>
                <Input
                  placeholder={copy.exams.scales.fields.gradeLabel}
                  aria-label={copy.exams.scales.fields.gradeLabel}
                  {...form.register(`bands.${index}.gradeLabel` as const)}
                />
                <FieldError>{form.formState.errors.bands?.[index]?.gradeLabel?.message}</FieldError>
              </Field>
              <Field>
                <Input
                  inputMode="decimal"
                  placeholder={copy.exams.scales.fields.gradePoint}
                  aria-label={copy.exams.scales.fields.gradePoint}
                  {...form.register(`bands.${index}.gradePoint` as const, {
                    setValueAs: (v) => (v === "" ? undefined : v),
                  })}
                />
              </Field>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => bands.append({ minMarks: "", maxMarks: "", gradeLabel: "" })}
          >
            <PlusIcon data-icon="inline-start" />
            {copy.exams.scales.addBand}
          </Button>
          <FieldError>{form.formState.errors.bands?.root?.message}</FieldError>
        </div>
        ) : null}
      </FieldGroup>
    </FormDialog>
  );
}

export function GradingScalesSection() {
  const { writeScopeArgs } = useActiveContext();
  const scales = useGradingScales();
  const { create, update, replaceBands, makeDefault } = useGradingScaleMutations();

  // School-parent writes (org-only scope fails server-side).
  const writeScope = useCallback(() => {
    const scope = writeScopeArgs();
    if (!scope) toast.error(copy.errors.needsBranch);
    return scope;
  }, [writeScopeArgs]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GradingScale | undefined>();
  const [deactivating, setDeactivating] = useState<GradingScale | undefined>();

  const runMakeDefault = useCallback(
    (id: string) => {
      const scope = writeScope();
      if (!scope) return;
      makeDefault.mutate({ ...scope, id });
    },
    [makeDefault, writeScope],
  );

  const columns = useMemo<DataTableColumns<GradingScale>>(
    () =>
      column.columns([
        column.accessor("name", {
          header: copy.exams.scales.fields.name,
          cell: ({ row }) => (
            <span className="flex items-center gap-2 font-medium">
              {row.original.name}
              {row.original.isDefault ? <Badge variant="outline">{copy.exams.scales.isDefault}</Badge> : null}
              {row.original.isLocked ? (
                <Badge variant="outline">
                  <LockIcon className="size-3" />
                  {copy.exams.scales.locked}
                </Badge>
              ) : null}
            </span>
          ),
        }),
        column.display({
          id: "bands",
          header: copy.exams.scales.fields.bands,
          cell: ({ row }) => (
            <span className="text-muted-foreground text-xs">
              {(row.original.bands ?? [])
                .map((b) => `${b.gradeLabel} ${Number(b.minMarks)}-${Number(b.maxMarks)}`)
                .join(" · ")}
            </span>
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
                <PermissionGate permission="exam:update">
                  <DropdownMenuItem
                    disabled={row.original.isLocked}
                    onClick={() => setEditing(row.original)}
                  >
                    <PencilIcon data-icon="inline-start" />
                    {copy.common.edit}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={row.original.isDefault}
                    onClick={() => runMakeDefault(row.original.id)}
                  >
                    {copy.exams.scales.makeDefault}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDeactivating(row.original)}>
                    {copy.exams.scales.deactivateScale}
                  </DropdownMenuItem>
                </PermissionGate>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        }),
      ]),
    [runMakeDefault],
  );

  const rows = scales.data ?? [];

  return (
    <section aria-labelledby="grading-scales-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="grading-scales-heading" className="font-heading text-base font-semibold">
          {copy.exams.scales.title}
        </h2>
        <PermissionGate permission="exam:create">
          <Button onClick={() => setFormOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            {copy.exams.scales.add}
          </Button>
        </PermissionGate>
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">{copy.exams.scales.subtitle}</p>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.exams.scales.title}
        isLoading={scales.isLoading}
        error={scales.error}
        onRetry={() => void scales.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate font-medium">
                {row.name}
                {row.isDefault ? <Badge variant="outline">{copy.exams.scales.isDefault}</Badge> : null}
                {row.isLocked ? <Badge variant="outline">{copy.exams.scales.locked}</Badge> : null}
              </p>
              <p className="text-muted-foreground text-xs">
                {(row.bands ?? []).map((b) => b.gradeLabel).join(" · ")}
              </p>
            </div>
          </div>
        )}
        empty={
          <EmptyState
            icon={LockIcon}
            title={copy.exams.scales.emptyTitle}
            description={copy.exams.scales.emptyBody}
            action={
              <PermissionGate permission="exam:create">
                <Button onClick={() => setFormOpen(true)}>{copy.exams.scales.add}</Button>
              </PermissionGate>
            }
          />
        }
      />

      <GradingScaleDialog
        open={formOpen || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditing(undefined);
          }
        }}
        scale={editing}
        pending={create.isPending || replaceBands.isPending || update.isPending}
        onSubmit={async (data, id) => {
          try {
            const scope = writeScope();
            if (!scope) return;
            if (id && editing) {
              // Name/description travel the update route; bands travel the
              // replace route (locked scales never reach here — the editor
              // hides their bands and the service refuses anyway).
              if (
                data.name !== editing.name ||
                (data.description ?? null) !== (editing.description ?? null)
              ) {
                await update.mutateAsync({
                  ...scope,
                  id,
                  data: { name: data.name, description: data.description },
                });
              }
              if (!editing.isLocked) {
                await replaceBands.mutateAsync({ ...scope, id, bands: data.bands });
              }
            } else {
              await create.mutateAsync({ ...scope, ...data });
            }
            setFormOpen(false);
            setEditing(undefined);
          } catch {
            // The toast carries the server's wording; the form stays open.
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(deactivating)}
        onOpenChange={(open) => {
          if (!open) setDeactivating(undefined);
        }}
        title={copy.exams.scales.deactivateScaleTitle}
        consequence={copy.exams.scales.deactivateScaleBody}
        confirmLabel={copy.exams.scales.deactivateScale}
        pending={update.isPending}
        onConfirm={() => {
          if (!deactivating) return;
          const scope = writeScope();
          if (!scope) return;
          update.mutate(
            { ...scope, id: deactivating.id, data: { isActive: false } },
            { onSuccess: () => setDeactivating(undefined) },
          );
        }}
      />
    </section>
  );
}
