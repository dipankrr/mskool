"use client";

import { GraduationCapIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClassFormDialog } from "@/features/classes/class-form-dialog";
import { ClassLadderDialog } from "@/features/classes/class-ladder-dialog";
import { useClasses, useClassMutations } from "@/features/classes/use-classes";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { Class } from "@/lib/trpc/types";

/**
 * Classes are not year-scoped — Class 6 is the same rung every session — so this
 * screen needs a branch but no session. That is also why it is reachable before a
 * session exists, which Chunk 12's checklist depends on.
 *
 * Adding is always the ladder, never a single free-text create: the ladder is what
 * assigns `numericOrder`, and a one-off create would have to ask for it.
 */

const column = createAppColumnHelper<Class>();

function makeColumns({
  onEdit,
  onClose,
  canUpdate,
  canClose,
}: {
  onEdit: (cls: Class) => void;
  onClose: (cls: Class) => void;
  canUpdate: boolean;
  canClose: boolean;
}): DataTableColumns<Class> {
  return column.columns([
    column.accessor("name", { header: copy.classes.fields.name }),
    column.accessor("description", {
      header: copy.classes.fields.description,
      cell: ({ row }) => row.original.description ?? copy.common.none,
    }),
    column.display({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActions
            cls={row.original}
            onEdit={onEdit}
            onClose={onClose}
            canUpdate={canUpdate}
            canClose={canClose}
          />
        </div>
      ),
    }),
  ]);
}

function RowActions({
  cls,
  onEdit,
  onClose,
  canUpdate,
  canClose,
}: {
  cls: Class;
  onEdit: (cls: Class) => void;
  onClose: (cls: Class) => void;
  canUpdate: boolean;
  canClose: boolean;
}) {
  if (!canUpdate && !canClose) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={copy.common.actions}>
            <MoreHorizontalIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {canUpdate ? (
            <DropdownMenuItem onClick={() => onEdit(cls)}>
              {copy.common.edit}
            </DropdownMenuItem>
          ) : null}
          {canClose ? (
            <DropdownMenuItem variant="destructive" onClick={() => onClose(cls)}>
              {copy.classes.closeAction}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function ClassesPage() {
  const { has, needsBranchChoice } = useActiveContext();
  const classes = useClasses();
  const { update, close } = useClassMutations();

  const [ladderOpen, setLadderOpen] = useState(false);
  const [editing, setEditing] = useState<Class | undefined>(undefined);
  const [closing, setClosing] = useState<Class | undefined>(undefined);

  const canUpdate = has("class:update");
  const canClose = has("class:delete");

  const onEdit = useCallback((cls: Class) => setEditing(cls), []);
  const onClose = useCallback((cls: Class) => setClosing(cls), []);

  const columns = useMemo(
    () => makeColumns({ onEdit, onClose, canUpdate, canClose }),
    [onEdit, onClose, canUpdate, canClose],
  );

  const rows = classes.data ?? [];

  return (
    <>
      <PageHeader
        title={copy.terms.classes}
        description={copy.classes.subtitle}
        actions={
          <PermissionGate permission="class:create">
            <Button onClick={() => setLadderOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              {copy.classes.add}
            </Button>
          </PermissionGate>
        }
      />

      {needsBranchChoice ? (
        <EmptyState
          icon={GraduationCapIcon}
          title={copy.access.chooseBranchTitle}
          description={copy.access.chooseBranchBody}
        />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          caption={copy.classes.subtitle}
          isLoading={classes.isPending}
          error={classes.error}
          onRetry={() => void classes.refetch()}
          renderCard={(row) => (
            <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-medium">{row.name}</span>
                {row.description ? (
                  <span className="text-muted-foreground truncate text-xs">
                    {row.description}
                  </span>
                ) : null}
              </div>
              <RowActions
                cls={row}
                onEdit={onEdit}
                onClose={onClose}
                canUpdate={canUpdate}
                canClose={canClose}
              />
            </div>
          )}
          empty={
            <EmptyState
              icon={GraduationCapIcon}
              title={copy.classes.emptyTitle}
              description={copy.classes.emptyBody}
              action={
                <PermissionGate permission="class:create">
                  <Button onClick={() => setLadderOpen(true)}>{copy.classes.add}</Button>
                </PermissionGate>
              }
            />
          }
        />
      )}

      <ClassLadderDialog
        open={ladderOpen}
        onOpenChange={setLadderOpen}
        existing={rows}
      />

      <ClassFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        cls={editing}
        pending={update.isPending}
        onSubmit={(data) => {
          if (editing) update.submit(editing.id, data);
          setEditing(undefined);
        }}
      />

      <ConfirmDialog
        open={Boolean(closing)}
        onOpenChange={(open) => {
          if (!open) setClosing(undefined);
        }}
        title={copy.classes.closeTitle}
        consequence={copy.classes.closeBody}
        confirmLabel={copy.classes.closeConfirm}
        destructive
        pending={close.isPending}
        onConfirm={() => {
          if (closing) close.submit(closing.id);
          setClosing(undefined);
        }}
      />
    </>
  );
}
