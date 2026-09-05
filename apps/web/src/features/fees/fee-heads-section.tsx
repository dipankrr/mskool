"use client";

import { CircleOffIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, ReceiptIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { CreateFeeHeadInput } from "@repo/contracts";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FeeHead } from "@/lib/trpc/types";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { copy } from "@/lib/copy";
import { formatMoneyPlain } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { FeeHeadCategory } from "./fee-enums";
import { FeeHeadDialog } from "./fee-head-dialog";
import { useFeeHeadMutations, useFeeHeads } from "./use-fee-setup";

/**
 * FEE HEADS — the first section of the Setup tab. Everything a school
 * charges is named here before any structure references it.
 *
 * Retiring is the only "removal" — the head flips `isActive` and the list
 * (which reads ACTIVE only) drops it; rows keep pointing at it forever
 * (hard rule 2). The list shows active heads only, per the service, so a
 * retired head vanishing from this table is correct behavior, not data
 * loss — the confirm dialog says so in words.
 */

const column = createAppColumnHelper<FeeHead>();

function categoryTint(category: FeeHeadCategory): string {
  switch (category) {
    case "regular":
      return "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-100";
    case "optional":
      return "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-100";
    case "one_time":
      return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300";
  }
}

export function FeeHeadsSection() {
  const heads = useFeeHeads();
  const { create, update, deactivate } = useFeeHeadMutations();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FeeHead | undefined>();
  const [retiring, setRetiring] = useState<FeeHead | undefined>();

  const columns = useMemo<DataTableColumns<FeeHead>>(
    () =>
      column.columns([
        column.accessor("name", {
          header: copy.fees.heads.fields.name,
          cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
        }),
        column.accessor("shortCode", {
          header: copy.fees.heads.fields.shortCode,
          cell: ({ row }) =>
            row.original.shortCode ? (
              <Badge variant="outline">{row.original.shortCode}</Badge>
            ) : (
              copy.common.none
            ),
        }),
        column.accessor("category", {
          header: copy.fees.heads.fields.category,
          cell: ({ row }) => (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                categoryTint(row.original.category),
              )}
            >
              {copy.fees.headCategories[row.original.category]}
            </span>
          ),
        }),
        column.display({
          id: "tax",
          header: copy.fees.heads.fields.isTaxable,
          cell: ({ row }) =>
            row.original.isTaxable
              ? `${copy.common.yes} · ${formatMoneyPlain(row.original.taxPercentage)}%`
              : copy.common.no,
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
                <PermissionGate permission="fee_head:update">
                  <DropdownMenuItem onClick={() => setEditing(row.original)}>
                    <PencilIcon data-icon="inline-start" />
                    {copy.common.edit}
                  </DropdownMenuItem>
                </PermissionGate>
                <PermissionGate permission="fee_head:update">
                  <DropdownMenuItem onClick={() => setRetiring(row.original)}>
                    <CircleOffIcon data-icon="inline-start" />
                    {copy.fees.heads.retireAction}
                  </DropdownMenuItem>
                </PermissionGate>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        }),
      ]),
    [],
  );

  const rows = heads.data ?? [];

  return (
    <section aria-labelledby="fee-heads-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="fee-heads-heading" className="font-heading text-base font-semibold">
          {copy.fees.heads.title}
        </h2>
        <PermissionGate permission="fee_head:create">
          <Button onClick={() => setFormOpen(true)} disabled={!create.canSubmit}>
            <PlusIcon data-icon="inline-start" />
            {copy.fees.heads.add}
          </Button>
        </PermissionGate>
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">{copy.fees.heads.subtitle}</p>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.fees.heads.title}
        isLoading={heads.isLoading}
        error={heads.error}
        onRetry={() => void heads.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="truncate font-medium">{row.name}</p>
              <p className="text-muted-foreground text-xs">
                {copy.fees.headCategories[row.category]}
                {row.isTaxable ? ` · GST ${formatMoneyPlain(row.taxPercentage)}%` : ""}
              </p>
            </div>
            <PermissionGate permission="fee_head:update">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={copy.common.actions}>
                      <MoreHorizontalIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditing(row)}>
                    <PencilIcon data-icon="inline-start" />
                    {copy.common.edit}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setRetiring(row)}>
                    <CircleOffIcon data-icon="inline-start" />
                    {copy.fees.heads.retireAction}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </PermissionGate>
          </div>
        )}
        empty={
          <EmptyState
            icon={ReceiptIcon}
            title={copy.fees.heads.emptyTitle}
            description={copy.fees.heads.emptyBody}
            action={
              <PermissionGate permission="fee_head:create">
                <Button onClick={() => setFormOpen(true)}>{copy.fees.heads.add}</Button>
              </PermissionGate>
            }
          />
        }
      />

      <FeeHeadDialog
        open={formOpen || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditing(undefined);
          }
        }}
        head={editing}
        pending={create.isPending || update.isPending}
        onSubmit={async (data) => {
          try {
            if (editing) {
              await update.submit(editing.schoolId, editing.id, data);
            } else {
              await create.submit(data as CreateFeeHeadInput);
            }
            setFormOpen(false);
            setEditing(undefined);
          } catch {
            // Refused: the toast carries the server's wording; the form stays.
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(retiring)}
        onOpenChange={(open) => !open && setRetiring(undefined)}
        title={copy.fees.heads.retireTitle}
        consequence={copy.fees.heads.retireBody}
        confirmLabel={copy.fees.heads.retireConfirm}
        destructive
        pending={deactivate.isPending}
        onConfirm={async () => {
          if (!retiring) return;
          try {
            await deactivate.submit(retiring.schoolId, retiring.id);
          } finally {
            setRetiring(undefined);
          }
        }}
      />
    </section>
  );
}
