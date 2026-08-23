"use client";

import { LayersIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionBulkDialog } from "@/features/sections/section-bulk-dialog";
import { SectionFormDialog } from "@/features/sections/section-form-dialog";
import {
  useClass,
  useSectionMutations,
  useSections,
} from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { Section } from "@/lib/trpc/types";

/**
 * Sections live under a class rather than on a screen of their own.
 *
 * A section is meaningless without both a class and a session, so a top-level list
 * would force two selections before showing anything. Here the class comes from the
 * route and the session from the active context, so the common case needs no picker
 * at all — and the page states which session it is showing, because the same class has
 * different sections each year.
 */

const column = createAppColumnHelper<Section>();

function makeColumns({
  onEdit,
  onClose,
  canUpdate,
  canClose,
}: {
  onEdit: (section: Section) => void;
  onClose: (section: Section) => void;
  canUpdate: boolean;
  canClose: boolean;
}): DataTableColumns<Section> {
  return column.columns([
    column.accessor("name", { header: copy.sections.fields.name }),
    column.accessor("stream", {
      header: copy.sections.fields.stream,
      cell: ({ row }) => row.original.stream ?? copy.common.none,
    }),
    column.accessor("roomNumber", {
      header: copy.sections.fields.roomNumber,
      cell: ({ row }) => row.original.roomNumber ?? copy.common.none,
    }),
    column.accessor("maxStudents", {
      header: copy.sections.fields.maxStudents,
      cell: ({ row }) => row.original.maxStudents ?? copy.common.none,
    }),
    column.display({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActions
            section={row.original}
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
  section,
  onEdit,
  onClose,
  canUpdate,
  canClose,
}: {
  section: Section;
  onEdit: (section: Section) => void;
  onClose: (section: Section) => void;
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
            <DropdownMenuItem onClick={() => onEdit(section)}>
              {copy.common.edit}
            </DropdownMenuItem>
          ) : null}
          {canClose ? (
            <DropdownMenuItem variant="destructive" onClick={() => onClose(section)}>
              {copy.sections.closeAction}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function ClassDetailPage() {
  const params = useParams<{ classId: string }>();
  const classId = params.classId;

  const { has, activeSession, needsBranchChoice } = useActiveContext();
  const cls = useClass(classId);
  /*
    Not asked until the class is known to be one this caller may see. `classId` doubles
    as the addressed node on the server, so asking for a foreign class answers 403 —
    a request whose only outcome is a console error and a wasted round trip.
  */
  const sections = useSections(classId, { enabled: Boolean(cls.data) });
  const { update, close } = useSectionMutations(classId);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<Section | undefined>(undefined);
  const [closing, setClosing] = useState<Section | undefined>(undefined);

  const canUpdate = has("section:update");
  const canClose = has("section:delete");

  const onEdit = useCallback((section: Section) => setEditing(section), []);
  const onClose = useCallback((section: Section) => setClosing(section), []);

  const columns = useMemo(
    () => makeColumns({ onEdit, onClose, canUpdate, canClose }),
    [onEdit, onClose, canUpdate, canClose],
  );

  const rows = sections.data ?? [];

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/classes" />}>
              {copy.terms.classes}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {cls.data?.name ?? (cls.isLoading ? copy.common.loading : copy.terms.class)}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={cls.data ? copy.sections.inClass(cls.data.name) : copy.terms.sections}
        description={
          activeSession
            ? `${copy.sections.subtitle} — ${activeSession.name}`
            : copy.sections.subtitle
        }
        actions={
          /*
            Also requires the class itself to be resolved. Offering "Add sections" for a
            class the caller cannot see would send a create the cross-school guard in
            `createSection` must refuse.
          */
          cls.data && activeSession && !needsBranchChoice ? (
            <PermissionGate permission="section:create">
              <Button onClick={() => setBulkOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                {copy.sections.add}
              </Button>
            </PermissionGate>
          ) : undefined
        }
      />

      {/*
        Preconditions in the order the user can act on them. The class lookup comes
        first because a class that is not theirs makes everything below meaningless —
        but it resolves from the permissive list, so a legitimate caller of any scope
        depth passes it. Previously this branch fired for a class-scoped teacher and
        blanked a section list that had already loaded correctly.
      */}
      {cls.error ? (
        <EmptyState
          icon={LayersIcon}
          title={copy.errors.listFailedTitle}
          description={errorMessage(cls.error)}
          action={
            <Link href="/classes" className={buttonVariants({ variant: "outline" })}>
              {copy.terms.classes}
            </Link>
          }
        />
      ) : cls.notFound ? (
        <EmptyState
          icon={LayersIcon}
          title={copy.classes.notFoundTitle}
          description={copy.classes.notFoundBody}
          action={
            <Link href="/classes" className={buttonVariants({ variant: "outline" })}>
              {copy.terms.classes}
            </Link>
          }
        />
      ) : needsBranchChoice ? (
        <EmptyState
          icon={LayersIcon}
          title={copy.access.chooseBranchTitle}
          description={copy.access.chooseBranchBody}
        />
      ) : !activeSession ? (
        <EmptyState
          icon={LayersIcon}
          title={copy.sessions.emptyTitle}
          description={copy.sections.needsSession}
          action={
            /*
              A real <a>, styled as a button, rather than `Button render={<Link/>}`.
              Base UI's Button assumes a native <button> and warns that rendering an
              anchor through it strips button semantics — and it is right: this
              navigates, so a link is what it should be.
            */
            <Link href="/sessions" className={buttonVariants({ variant: "outline" })}>
              {copy.terms.sessions}
            </Link>
          }
        />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          caption={copy.sections.subtitle}
          /*
            `isLoading`, not `isPending`: a query disabled while no session exists sits
            at "pending" forever, which would show a skeleton that never resolves.
          */
          isLoading={sections.isLoading}
          error={sections.error}
          onRetry={() => void sections.refetch()}
          renderCard={(row) => (
            <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-medium">{row.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {[row.stream, row.roomNumber && `Room ${row.roomNumber}`]
                    .filter(Boolean)
                    .join(" · ") || copy.common.none}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {row.maxStudents ? (
                  <Badge variant="outline">{row.maxStudents}</Badge>
                ) : null}
                <RowActions
                  section={row}
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
              icon={LayersIcon}
              title={copy.sections.emptyTitle}
              description={copy.sections.emptyBody}
              action={
                <PermissionGate permission="section:create">
                  <Button onClick={() => setBulkOpen(true)}>{copy.sections.add}</Button>
                </PermissionGate>
              }
            />
          }
        />
      )}

      <SectionBulkDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        classId={classId}
        existing={rows}
      />

      <SectionFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        section={editing}
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
        title={copy.sections.closeTitle}
        consequence={copy.sections.closeBody}
        confirmLabel={copy.sections.closeConfirm}
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
