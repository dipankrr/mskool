"use client";

import { Building2Icon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BranchFormDialog } from "@/features/branches/branch-form-dialog";
import { useBranches, useBranchMutations } from "@/features/branches/use-branches";
import { useActiveContext } from "@/features/session/active-context";
import { branchWord, copy } from "@/lib/copy";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { School } from "@/lib/trpc/types";

/**
 * The first domain vertical, and the template the other three follow: a list on
 * `DataTable`, one form for create and edit, and a close action behind a confirm
 * that states the consequence.
 *
 * Closing deactivates rather than deletes (hard rule 2) — students, payments and
 * results all reference a school and must stay reachable — so the UI never says
 * "delete" and always says records are kept.
 */

const column = createAppColumnHelper<School>();

/**
 * Built by a factory rather than at module scope because the row actions close over
 * this screen's handlers. Memoised on those handlers, since v9 memoises column work
 * by reference and a new array every render would invalidate all of it.
 */
function makeColumns({
  onEdit,
  onClose,
  canUpdate,
  canClose,
}: {
  onEdit: (branch: School) => void;
  onClose: (branch: School) => void;
  canUpdate: boolean;
  canClose: boolean;
}): DataTableColumns<School> {
  return column.columns([
    column.accessor("name", { header: copy.branches.fields.name }),
    column.accessor("code", {
      header: copy.branches.fields.code,
      cell: ({ row }) => <Badge variant="outline">{row.original.code}</Badge>,
    }),
    column.accessor("board", {
      header: copy.branches.boardLabel,
      cell: ({ row }) => copy.branches.boards[row.original.board],
    }),
    column.accessor("city", {
      header: copy.branches.fields.city,
      cell: ({ row }) => row.original.city ?? copy.common.none,
    }),
    column.display({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActions
            branch={row.original}
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

/**
 * Absent, not disabled, when the caller may do neither — a menu button that opens
 * an empty menu is worse than no button.
 */
function RowActions({
  branch,
  onEdit,
  onClose,
  canUpdate,
  canClose,
}: {
  branch: School;
  onEdit: (branch: School) => void;
  onClose: (branch: School) => void;
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
            <DropdownMenuItem onClick={() => onEdit(branch)}>
              {copy.common.edit}
            </DropdownMenuItem>
          ) : null}
          {canClose ? (
            <DropdownMenuItem variant="destructive" onClick={() => onClose(branch)}>
              {copy.branches.closeAction}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function BranchesPage() {
  const { has, schools } = useActiveContext();
  const branches = useBranches();
  const { create, update, close } = useBranchMutations();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<School | undefined>(undefined);
  const [closing, setClosing] = useState<School | undefined>(undefined);

  const canUpdate = has("school:update");
  const canClose = has("school:delete");

  const onEdit = useCallback((branch: School) => {
    setEditing(branch);
    setFormOpen(true);
  }, []);

  const onClose = useCallback((branch: School) => setClosing(branch), []);

  const columns = useMemo(
    () => makeColumns({ onEdit, onClose, canUpdate, canClose }),
    [onEdit, onClose, canUpdate, canClose],
  );

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const rows = branches.data ?? [];
  const word = branchWord(schools.length, true);

  return (
    <>
      <PageHeader
        title={word}
        description={copy.branches.subtitle}
        actions={
          <PermissionGate permission="school:create">
            <Button onClick={openCreate}>
              <PlusIcon data-icon="inline-start" />
              {copy.branches.add}
            </Button>
          </PermissionGate>
        }
      />

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.branches.subtitle}
        isLoading={branches.isLoading}
        error={branches.error}
        onRetry={() => void branches.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-medium">{row.name}</span>
              <span className="text-muted-foreground truncate text-xs">
                {copy.branches.boards[row.board]}
                {row.city ? ` · ${row.city}` : ""}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant="outline">{row.code}</Badge>
              <RowActions
                branch={row}
                onEdit={onEdit}
                onClose={onClose}
                canUpdate={canUpdate}
                canClose={canClose}
              />
            </div>
          </div>
        )}
        empty={
          <EmptyState
            icon={Building2Icon}
            title={copy.branches.emptyTitle}
            description={copy.branches.emptyBody}
            action={
              <PermissionGate permission="school:create">
                <Button onClick={openCreate}>{copy.branches.add}</Button>
              </PermissionGate>
            }
          />
        }
      />

      <BranchFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        branch={editing}
        pending={create.isPending || update.isPending}
        onSubmit={(data) => {
          if (editing) {
            update.submit(editing.id, data);
          } else {
            create.submit(data);
          }
          setFormOpen(false);
        }}
      />

      <ConfirmDialog
        open={Boolean(closing)}
        onOpenChange={(open) => {
          if (!open) setClosing(undefined);
        }}
        title={copy.branches.closeTitle}
        consequence={copy.branches.closeBody}
        confirmLabel={copy.branches.closeConfirm}
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
