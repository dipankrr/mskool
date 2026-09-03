"use client";

import { CircleOffIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoreHorizontalIcon, PencilIcon } from "lucide-react";
import { useClasses } from "@/features/classes/use-classes";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import type { FeeStructure } from "@/lib/trpc/types";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import {
  useFeeStructureMutations,
  useFeeStructures,
} from "./use-fee-setup";
import { StructureDialog } from "./structure-dialog";

/**
 * FEE STRUCTURES — the Setup tab's second section: the per-class-per-
 * session bill. Row → the detail page (lines + late-fee rules live there,
 * one navigation deep, because a structure IS its lines).
 *
 * The year select is scoped by permission: history holders
 * (`academic_year:read_history`) see closed sessions too, everyone else
 * sees the running one — same select, honest contents, no dead options.
 */

const column = createAppColumnHelper<FeeStructure>();

export function FeeStructuresSection() {
  const { sessions, activeSession, canSeeHistory } = useActiveContext();
  const classes = useClasses();

  const [structuresYear, setStructuresYear] = useState<string | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FeeStructure | undefined>();
  const [closing, setClosing] = useState<FeeStructure | undefined>();

  // Default to the switcher's session; the select can move it (history
  // holders) — the years offered are only ones the caller may name.
  const selectedYear = structuresYear ?? activeSession?.id;
  const structures = useFeeStructures(selectedYear, false);
  const { create, update, deactivate } = useFeeStructureMutations();

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const cls of classes.data ?? []) map.set(cls.id, cls.name);
    return map;
  }, [classes.data]);

  const columns = useMemo<DataTableColumns<FeeStructure>>(
    () =>
      column.columns([
        column.display({
          id: "class",
          header: copy.fees.structures.fields.class,
          cell: ({ row }) =>
            classNameById.get(row.original.classId) ?? copy.common.none,
        }),
        column.accessor("name", {
          header: copy.fees.structures.fields.name,
          cell: ({ row }) => (
            <Link
              href={`/fees/setup/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {row.original.name}
            </Link>
          ),
        }),
        column.accessor("installmentMode", {
          header: copy.fees.structures.fields.installmentMode,
          cell: ({ row }) => copy.fees.installmentModes[row.original.installmentMode],
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
                <PermissionGate permission="fee_structure:update">
                  <DropdownMenuItem onClick={() => setEditing(row.original)}>
                    <PencilIcon data-icon="inline-start" />
                    {copy.common.edit}
                  </DropdownMenuItem>
                </PermissionGate>
                <PermissionGate permission="fee_structure:update">
                  <DropdownMenuItem onClick={() => setClosing(row.original)}>
                    <CircleOffIcon data-icon="inline-start" />
                    {copy.fees.structures.closeAction}
                  </DropdownMenuItem>
                </PermissionGate>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        }),
      ]),
    [classNameById],
  );

  const rows = structures.data ?? [];
  const yearOptions = canSeeHistory ? sessions : sessions.filter((s) => s.isCurrent);

  return (
    <section aria-labelledby="fee-structures-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="fee-structures-heading" className="font-heading text-base font-semibold">
          {copy.fees.structures.title}
        </h2>
        <div className="flex items-center gap-2">
          <Select
            value={selectedYear ?? undefined}
            onValueChange={(v) => setStructuresYear(v ?? undefined)}
          >
            <SelectTrigger
              className="w-40"
              aria-label={copy.fees.structures.fields.academicYear}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PermissionGate permission="fee_structure:create">
            <Button onClick={() => setFormOpen(true)} disabled={!create.canSubmit}>
              <PlusIcon data-icon="inline-start" />
              {copy.fees.structures.add}
            </Button>
          </PermissionGate>
        </div>
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">{copy.fees.structures.subtitle}</p>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.fees.structures.title}
        isLoading={structures.isLoading}
        error={structures.error}
        onRetry={() => void structures.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <Link
                href={`/fees/setup/${row.id}`}
                className="truncate font-medium hover:underline"
              >
                {row.name}
              </Link>
              <p className="text-muted-foreground text-xs">
                {classNameById.get(row.classId) ?? copy.common.none} ·{" "}
                {copy.fees.installmentModes[row.installmentMode]}
              </p>
            </div>
          </div>
        )}
        empty={
          <EmptyState
            title={copy.fees.structures.emptyTitle}
            description={copy.fees.structures.emptyBody}
            action={
              <PermissionGate permission="fee_structure:create">
                <Button onClick={() => setFormOpen(true)}>{copy.fees.structures.add}</Button>
              </PermissionGate>
            }
          />
        }
      />

      <StructureDialog
        open={formOpen || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditing(undefined);
          }
        }}
        structure={editing}
        pending={create.isPending}
        onSubmit={async (data) => {
          try {
            if (editing) {
              // Name/mode only — class and year are not movable (the contract omits them).
              await update.submit(editing.schoolId, editing.id, data);
            } else {
              await create.submit(data);
            }
            setFormOpen(false);
            setEditing(undefined);
          } catch {
            // Refused: toast carries the wording; the form stays.
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(closing)}
        onOpenChange={(open) => !open && setClosing(undefined)}
        title={copy.fees.structures.closeTitle}
        consequence={copy.fees.structures.closeBody}
        confirmLabel={copy.fees.structures.closeConfirm}
        destructive
        pending={deactivate.isPending}
        onConfirm={async () => {
          if (!closing) return;
          try {
            await deactivate.submit(closing.schoolId, closing.id);
          } finally {
            setClosing(undefined);
          }
        }}
      />
    </section>
  );
}
