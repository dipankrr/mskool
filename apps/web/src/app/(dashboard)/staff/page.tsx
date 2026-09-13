"use client";

import { PlusIcon, SearchIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveContext } from "@/features/session/active-context";
import { CreateStaffDialog } from "@/features/staff/staff-form-dialogs";
import { useStaffList, useStaffMutations } from "@/features/staff/use-staff";
import { copy } from "@/lib/copy";
import { createAppColumnHelper } from "@/lib/table";
import type { Staff } from "@/lib/trpc/types";

/**
 * THE STAFF REGISTER — the HR-facing counterpart of the admission register.
 *
 * Several queries, deliberately decoupled by permission, on the students
 * model: the register itself (`staff:read`) is the only one this page cannot
 * lose — everything else degrades. `staff:create` gates the add action; the
 * roles and logins live on the detail page, where their own permissions
 * decide what renders.
 *
 * The search is server-side (`q` crosses name parts and the employee code)
 * and debounced, exactly like the register it mirrors.
 */

const column = createAppColumnHelper<Staff>();

const SEARCH_DEBOUNCE_MS = 300;

function fullName(row: Staff): string {
  return [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ");
}

export default function StaffPage() {
  const { has, writeScopeArgs } = useActiveContext();

  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const staff = useStaffList(debouncedSearch, showInactive);
  const { create } = useStaffMutations();

  const canAdd = has("staff:create") && Boolean(writeScopeArgs());

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("employeeCode", {
          header: copy.staff.fields.employeeCode,
          cell: ({ row }) => (
            <Badge variant="outline">{row.original.employeeCode}</Badge>
          ),
        }),
        column.display({
          id: "name",
          header: copy.staff.fields.firstName,
          cell: ({ row }) => (
            <Link
              href={`/staff/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {fullName(row.original)}
            </Link>
          ),
        }),
        column.accessor("designation", {
          header: copy.staff.fields.designation,
          cell: ({ row }) => row.original.designation ?? copy.common.none,
        }),
        column.accessor("status", {
          header: copy.common.status,
          cell: ({ row }) => copy.staff.statuses[row.original.status],
        }),
        column.accessor("phone", {
          header: copy.staff.fields.phone,
          cell: ({ row }) => row.original.phone ?? copy.common.none,
        }),
      ]),
    [],
  );

  const rows = staff.data ?? [];
  const searching = debouncedSearch.length > 0;

  return (
    <>
      <PageHeader
        title={copy.nav.staff}
        description={copy.staff.subtitle}
        actions={
          <PermissionGate permission="staff:create">
            <Button onClick={() => setFormOpen(true)} disabled={!canAdd}>
              <PlusIcon data-icon="inline-start" />
              {copy.staff.add}
            </Button>
          </PermissionGate>
        }
      />

      <div className="mb-4 flex max-w-sm flex-col gap-2">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.staff.searchPlaceholder}
            aria-label={copy.staff.searchLabel}
            className="pl-9"
          />
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          {copy.staff.showInactive}
        </label>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.staff.subtitle}
        isLoading={staff.isLoading}
        error={staff.error}
        onRetry={() => void staff.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Link
                href={`/staff/${row.id}`}
                className="truncate font-medium hover:underline"
              >
                {fullName(row)}
              </Link>
              <span className="text-muted-foreground truncate text-xs">
                {row.designation ?? copy.common.none} ·{" "}
                {copy.staff.statuses[row.status]}
              </span>
            </div>
            <Badge variant="outline">{row.employeeCode}</Badge>
          </div>
        )}
        empty={
          searching ? (
            <EmptyState
              icon={SearchIcon}
              title={copy.staff.noResultsTitle}
              description={copy.staff.noResultsBody}
            />
          ) : (
            <EmptyState
              icon={UsersIcon}
              title={copy.staff.emptyTitle}
              description={copy.staff.emptyBody}
              action={
                <PermissionGate permission="staff:create">
                  <Button onClick={() => setFormOpen(true)}>{copy.staff.add}</Button>
                </PermissionGate>
              }
            />
          )
        }
      />

      <CreateStaffDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        pending={create.isPending}
        onSubmit={async (data) => {
          // Close on success only: a refused create keeps the form up with
          // the toast's wording beside it.
          try {
            await create.submit(data);
            setFormOpen(false);
          } catch {
            // The error toast is shown by the hook; the form stays.
          }
        }}
      />
    </>
  );
}
