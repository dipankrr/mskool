"use client";

import { CalendarIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useActiveContext } from "@/features/session/active-context";
import { branchWord, copy } from "@/lib/copy";
import { formatIsoDateRange } from "@/lib/format";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { AcademicYear } from "@/lib/trpc/types";

/**
 * TEMPORARY. A readout of the resolved active context plus a live exercise of the
 * shared building blocks, so Chunk 6 is verified in a browser rather than only by
 * `tsc`. Chunk 7 replaces this with the shell and Chunk 12 with the checklist.
 */

/**
 * Module scope, not inside the component. v9 memoises row and column work by
 * reference, so rebuilding this array every render invalidates all of it and can
 * drive the adapter into a render loop.
 */
const column = createAppColumnHelper<AcademicYear>();

const sessionColumns: DataTableColumns<AcademicYear> = column.columns([
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
        <span className="text-muted-foreground">{copy.common.closed}</span>
      ),
  }),
]);

export default function DashboardPage() {
  const {
    me,
    membership,
    organizationId,
    schoolId,
    schools,
    sessions,
    activeSession,
    currentSession,
    sessionsLoading,
    needsBranchChoice,
    canSeeHistory,
    has,
    selectSchool,
    selectSession,
    scopeArgs,
    writeScopeArgs,
  } = useActiveContext();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const writeArgs = writeScopeArgs();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={copy.terms.sessions}
        description={`${membership.organization.name} · ${me.user.name}`}
        actions={
          <PermissionGate permission="academic_year:create">
            <Button onClick={() => setFormOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              {copy.sessions.add}
            </Button>
          </PermissionGate>
        }
      />

      <DataTable
        data={sessions}
        columns={sessionColumns}
        getRowId={(row) => row.id}
        isLoading={sessionsLoading}
        caption={copy.sessions.subtitle}
        renderCard={(row) => (
          <button
            type="button"
            onClick={() => selectSession(row.id)}
            className="flex w-full flex-col items-start gap-1 rounded-lg border p-4 text-left hover:bg-muted/50"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-medium">{row.name}</span>
              {row.isCurrent ? (
                <Badge variant="secondary">{copy.sessions.running}</Badge>
              ) : null}
            </div>
            <span className="text-muted-foreground text-xs">
              {formatIsoDateRange(row.startDate, row.endDate)}
            </span>
          </button>
        )}
        empty={
          <EmptyState
            icon={CalendarIcon}
            title={copy.sessions.emptyTitle}
            description={copy.sessions.emptyBody}
            action={
              <PermissionGate permission="academic_year:create">
                <Button onClick={() => setFormOpen(true)}>{copy.sessions.add}</Button>
              </PermissionGate>
            }
          />
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Resolved context</CardTitle>
          <CardDescription>
            {membership.roleTypes.join(", ")} · {membership.permissions.length} permissions
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">organizationId</dt>
            <dd className="font-mono text-xs">{organizationId}</dd>

            <dt className="text-muted-foreground">schoolId</dt>
            <dd className="font-mono text-xs">{schoolId ?? "null"}</dd>

            <dt className="text-muted-foreground">academicYearId</dt>
            <dd className="font-mono text-xs">{activeSession?.id ?? "null"}</dd>

            <dt className="text-muted-foreground">scopeArgs()</dt>
            <dd className="font-mono text-xs">{JSON.stringify(scopeArgs())}</dd>

            <dt className="text-muted-foreground">writeScopeArgs()</dt>
            <dd className="font-mono text-xs">
              {writeArgs ? JSON.stringify(writeArgs) : "null — needs a branch"}
            </dd>

            <dt className="text-muted-foreground">running session</dt>
            <dd>{currentSession?.name ?? "none"}</dd>

            <dt className="text-muted-foreground">read_history</dt>
            <dd>{canSeeHistory ? copy.common.yes : copy.common.no}</dd>

            <dt className="text-muted-foreground">school:create</dt>
            <dd>{has("school:create") ? copy.common.yes : copy.common.no}</dd>

            <dt className="text-muted-foreground">needsBranchChoice</dt>
            <dd>{needsBranchChoice ? copy.common.yes : copy.common.no}</dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            {schools.map((school) => (
              <Button
                key={school.id}
                variant={school.id === schoolId ? "default" : "outline"}
                size="sm"
                onClick={() => selectSchool(school.id === schoolId ? null : school.id)}
              >
                {school.code}
              </Button>
            ))}
            {schools.length === 0 ? (
              <span className="text-muted-foreground text-xs">
                No {branchWord(0, true).toLowerCase()} visible — scoped below school level.
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
              Open ConfirmDialog
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
              Open FormDialog
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={copy.sessions.setCurrentTitle}
        consequence={copy.sessions.setCurrentBody}
        confirmLabel={copy.sessions.setCurrentConfirm}
        onConfirm={() => setConfirmOpen(false)}
      />

      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={copy.sessions.addTitle}
        description={copy.sessions.fields.startYearHelp}
        submitLabel={copy.common.save}
        onSubmit={(event) => {
          event.preventDefault();
          setFormOpen(false);
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="smoke-name">{copy.sessions.fields.name}</FieldLabel>
            <Input id="smoke-name" placeholder="2026-27" />
          </Field>
        </FieldGroup>
      </FormDialog>
    </div>
  );
}
