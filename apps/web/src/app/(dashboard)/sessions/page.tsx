"use client";

import { CalendarDaysIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
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
import { SessionFormDialog } from "@/features/sessions/session-form-dialog";
import { useSessionMutations, useSessions } from "@/features/sessions/use-sessions";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDateRange } from "@/lib/format";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { AcademicYear } from "@/lib/trpc/types";

/**
 * The richest vertical, and the one that exercises the whole foundation: two
 * database constraints surface as readable conflicts, promotion sits behind a
 * consequence-bearing confirm, and what the list contains depends on a permission.
 *
 * Past sessions are filtered server-side by `academic_year:read_history` (ADR-024),
 * not here. A caller without it simply receives fewer rows; this screen only says so,
 * because an unexplained one-row list looks like a bug.
 */

const column = createAppColumnHelper<AcademicYear>();

function makeColumns({
  onEdit,
  onPromote,
  canUpdate,
}: {
  onEdit: (session: AcademicYear) => void;
  onPromote: (session: AcademicYear) => void;
  canUpdate: boolean;
}): DataTableColumns<AcademicYear> {
  return column.columns([
    column.accessor("name", { header: copy.sessions.fields.name }),
    column.accessor("startDate", {
      header: "Dates",
      cell: ({ row }) => formatIsoDateRange(row.original.startDate, row.original.endDate),
    }),
    column.accessor("isCurrent", {
      header: "Status",
      cell: ({ row }) =>
        row.original.isCurrent ? (
          <Badge variant="secondary">{copy.sessions.running}</Badge>
        ) : (
          <span className="text-muted-foreground">{copy.sessions.past}</span>
        ),
    }),
    column.display({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActions
            session={row.original}
            onEdit={onEdit}
            onPromote={onPromote}
            canUpdate={canUpdate}
          />
        </div>
      ),
    }),
  ]);
}

function RowActions({
  session,
  onEdit,
  onPromote,
  canUpdate,
}: {
  session: AcademicYear;
  onEdit: (session: AcademicYear) => void;
  onPromote: (session: AcademicYear) => void;
  canUpdate: boolean;
}) {
  if (!canUpdate) return null;

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
          <DropdownMenuItem onClick={() => onEdit(session)}>
            {copy.common.edit}
          </DropdownMenuItem>
          {/* Promoting the session that is already running is a no-op, so it is
              not offered. */}
          {session.isCurrent ? null : (
            <DropdownMenuItem onClick={() => onPromote(session)}>
              {copy.sessions.setCurrentAction}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function SessionsPage() {
  const { has, canSeeHistory, needsBranchChoice } = useActiveContext();
  const sessions = useSessions();
  const { create, update, setCurrent } = useSessionMutations();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicYear | undefined>(undefined);
  const [promoting, setPromoting] = useState<AcademicYear | undefined>(undefined);

  const canUpdate = has("academic_year:update");

  const onEdit = useCallback((session: AcademicYear) => {
    setEditing(session);
    setFormOpen(true);
  }, []);

  const onPromote = useCallback((session: AcademicYear) => setPromoting(session), []);

  const columns = useMemo(
    () => makeColumns({ onEdit, onPromote, canUpdate }),
    [onEdit, onPromote, canUpdate],
  );

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const rows = sessions.data ?? [];

  return (
    <>
      <PageHeader
        title={copy.terms.sessions}
        description={copy.sessions.subtitle}
        actions={
          <PermissionGate permission="academic_year:create">
            <Button onClick={openCreate}>
              <PlusIcon data-icon="inline-start" />
              {copy.sessions.add}
            </Button>
          </PermissionGate>
        }
      />

      {/*
        Sessions belong to one branch, and every write here needs one named. Saying so
        up front beats a request that cannot succeed.
      */}
      {needsBranchChoice ? (
        <EmptyState
          icon={CalendarDaysIcon}
          title={copy.access.chooseBranchTitle}
          description={copy.access.chooseBranchBody}
        />
      ) : (
        <>
          {!canSeeHistory ? (
            <p className="text-muted-foreground text-sm">
              {copy.sessions.historyHidden}
            </p>
          ) : null}

          <DataTable
            data={rows}
            columns={columns}
            getRowId={(row) => row.id}
            caption={copy.sessions.subtitle}
            isLoading={sessions.isLoading}
            error={sessions.error}
            onRetry={() => void sessions.refetch()}
            renderCard={(row) => (
              <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium">{row.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatIsoDateRange(row.startDate, row.endDate)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {row.isCurrent ? (
                    <Badge variant="secondary">{copy.common.current}</Badge>
                  ) : null}
                  <RowActions
                    session={row}
                    onEdit={onEdit}
                    onPromote={onPromote}
                    canUpdate={canUpdate}
                  />
                </div>
              </div>
            )}
            empty={
              <EmptyState
                icon={CalendarDaysIcon}
                title={copy.sessions.emptyTitle}
                description={copy.sessions.emptyBody}
                action={
                  <PermissionGate permission="academic_year:create">
                    <Button onClick={openCreate}>{copy.sessions.add}</Button>
                  </PermissionGate>
                }
              />
            }
          />
        </>
      )}

      <SessionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        session={editing}
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
        open={Boolean(promoting)}
        onOpenChange={(open) => {
          if (!open) setPromoting(undefined);
        }}
        title={copy.sessions.setCurrentTitle}
        consequence={copy.sessions.setCurrentBody}
        confirmLabel={copy.sessions.setCurrentConfirm}
        pending={setCurrent.isPending}
        onConfirm={() => {
          if (promoting) setCurrent.submit(promoting.id);
          setPromoting(undefined);
        }}
      />
    </>
  );
}
