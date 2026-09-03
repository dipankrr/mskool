"use client";

import { ArrowLeftIcon, PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  CreateFeeStructureLineInput,
  UpdateFeeStructureLineInput,
} from "@repo/contracts";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontalIcon } from "lucide-react";
import { FeesTabs } from "@/features/fees/tabs";
import { useActiveContext } from "@/features/session/active-context";
import {
  useFeeHeads,
  useFeeStructureLines,
  useFeeStructureMutations,
  useLateFeeRules,
} from "@/features/fees/use-fee-setup";
import { LateFeeRuleDialog } from "@/features/fees/late-fee-rule-dialog";
import { StructureLineDialog } from "@/features/fees/structure-line-dialog";
import { moneyCellClass, moneyHeaderClass } from "@/features/fees/fee-styles";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type {
  FeeStructureLine,
  LateFeeRule as LateFeeRuleRow,
} from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

/**
 * STRUCTURE DETAIL — the lines (what this class pays, head by head) and
 * the late-fee rules. The structure's own summary (class, session, mode)
 * sits in the header; everything below is its content.
 *
 * Lines are what students' bills are BUILT from: amounts freeze at
 * assignment (the service snapshots), so editing a line here changes what
 * FUTURE assignments bill, never an existing student's — the updateLine
 * help wording says exactly that.
 */

const lineColumn = createAppColumnHelper<FeeStructureLine>();
const ruleColumn = createAppColumnHelper<LateFeeRuleRow>();

function monthRangeLabel(from: number, to: number): string {
  const months = new Intl.DateTimeFormat("en-IN", { month: "short" });
  const name = (m: number) => months.format(new Date(2026, m - 1, 1));
  return from === 1 && to === 12 ? copy.common.current : `${name(from)} – ${name(to)}`;
}

export default function FeeStructureDetailPage() {
  const params = useParams<{ structureId: string }>();
  const structureId = params.structureId;
  const { has, schoolId, activeSession } = useActiveContext();

  const heads = useFeeHeads();
  const lines = useFeeStructureLines(schoolId ?? undefined, structureId);
  const rules = useLateFeeRules();
  const { addLine, updateLine, addLateFeeRule } = useFeeStructureMutations();

  const [lineFormOpen, setLineFormOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<FeeStructureLine | undefined>();
  const [ruleFormOpen, setRuleFormOpen] = useState(false);

  const headNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const head of heads.data ?? []) map.set(head.id, head.name);
    return map;
  }, [heads.data]);

  const lineColumns = useMemo<DataTableColumns<FeeStructureLine>>(
    () =>
      lineColumn.columns([
        lineColumn.display({
          id: "head",
          header: copy.fees.structures.lineFields.head,
          cell: ({ row }) => headNameById.get(row.original.feeHeadId) ?? copy.common.none,
        }),
        lineColumn.accessor("annualAmount", {
          header: copy.fees.amounts.annual,
          cell: ({ row }) => formatMoney(row.original.annualAmount),
        }),
        lineColumn.accessor("installmentFrequency", {
          header: copy.fees.structures.lineFields.frequency,
          cell: ({ row }) => copy.fees.frequencies[row.original.installmentFrequency],
        }),
        lineColumn.display({
          id: "months",
          header: copy.fees.structures.lineFields.fromMonth,
          cell: ({ row }) =>
            monthRangeLabel(
              row.original.applicableFromMonth,
              row.original.applicableToMonth,
            ),
        }),
        lineColumn.display({
          id: "actions",
          header: copy.common.actions,
          cell: ({ row }) => (
            <PermissionGate permission="fee_structure:update">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={copy.common.actions}>
                      <MoreHorizontalIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditingLine(row.original)}>
                    <PencilIcon data-icon="inline-start" />
                    {copy.common.edit}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </PermissionGate>
          ),
        }),
      ]),
    [headNameById],
  );

  const ruleColumns = useMemo<DataTableColumns<LateFeeRuleRow>>(
    () =>
      ruleColumn.columns([
        ruleColumn.display({
          id: "type",
          header: copy.fees.structures.lateFeeFields.type,
          cell: ({ row }) => copy.fees.lateFeeTypes[row.original.calculationType],
        }),
        ruleColumn.accessor("value", {
          header: copy.fees.structures.lateFeeFields.value,
          cell: ({ row }) => formatMoney(row.original.value),
        }),
        ruleColumn.accessor("gracePeriodDays", {
          header: copy.fees.structures.lateFeeFields.graceDays,
          cell: ({ row }) => `${row.original.gracePeriodDays}`,
        }),
        ruleColumn.display({
          id: "max",
          header: copy.fees.structures.lateFeeFields.max,
          cell: ({ row }) =>
            row.original.maxLateFee ? formatMoney(row.original.maxLateFee) : copy.common.none,
        }),
        ruleColumn.display({
          id: "window",
          header: copy.fees.structures.lateFeeFields.from,
          cell: ({ row }) =>
            `${formatIsoDate(row.original.effectiveFrom)}${
              row.original.effectiveTo ? ` – ${formatIsoDate(row.original.effectiveTo)}` : ""
            }`,
        }),
      ]),
    [],
  );

  return (
    <>
      <PageHeader
        title={copy.fees.structures.title}
        description={copy.fees.structures.subtitle}
        actions={
          <Link href="/fees/setup" className={cn(buttonVariants({ variant: "outline" }))}>
            <ArrowLeftIcon data-icon="inline-start" />
            {copy.common.back}
          </Link>
        }
      />
      <FeesTabs has={has} />

      <Card>
        <CardHeader>
          <CardTitle>{copy.fees.structures.linesTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="text-muted-foreground text-sm">{copy.fees.structures.linesSubtitle}</p>
          <div className="flex items-center justify-end">
            <PermissionGate permission="fee_structure:create">
              <Button onClick={() => setLineFormOpen(true)} disabled={!addLine && false}>
                <PlusIcon data-icon="inline-start" />
                {copy.fees.structures.addLine}
              </Button>
            </PermissionGate>
          </div>
          <DataTable
            data={lines.data ?? []}
            columns={lineColumns}
            getRowId={(row) => row.id}
            caption={copy.fees.structures.linesTitle}
            isLoading={lines.isLoading}
            error={lines.error}
            onRetry={() => void lines.refetch()}
            renderCard={(row) => (
              <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {headNameById.get(row.feeHeadId) ?? copy.common.none}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {copy.fees.frequencies[row.installmentFrequency]}
                  </p>
                </div>
                <p className={cn("text-sm font-medium", moneyCellClass)}>
                  {formatMoney(row.annualAmount)}
                </p>
              </div>
            )}
            empty={
              <EmptyState
                title={copy.fees.structures.emptyLinesTitle}
                description={copy.fees.structures.emptyLinesBody}
                action={
                  <PermissionGate permission="fee_structure:create">
                    <Button onClick={() => setLineFormOpen(true)}>
                      {copy.fees.structures.addLine}
                    </Button>
                  </PermissionGate>
                }
              />
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.fees.structures.lateFeeTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-muted-foreground max-w-prose text-sm">
              {copy.fees.structures.lateFeeSubtitle}
            </p>
            <PermissionGate permission="fee_structure:create">
              <Button onClick={() => setRuleFormOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                {copy.fees.structures.addLateFeeRule}
              </Button>
            </PermissionGate>
          </div>
          <DataTable
            data={rules.data ?? []}
            columns={ruleColumns}
            getRowId={(row) => row.id}
            caption={copy.fees.structures.lateFeeTitle}
            isLoading={rules.isLoading}
            error={rules.error}
            onRetry={() => void rules.refetch()}
            renderCard={(row) => (
              <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {copy.fees.lateFeeTypes[row.calculationType]}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {copy.fees.structures.lateFeeFields.graceDays}: {row.gracePeriodDays}
                  </p>
                </div>
                <p className={cn("text-sm font-medium", moneyCellClass)}>
                  {formatMoney(row.value)}
                </p>
              </div>
            )}
            empty={
              <EmptyState
                title={copy.fees.structures.lateFeeTitle}
                description={copy.fees.structures.lateFeeSubtitle}
                action={
                  <PermissionGate permission="fee_structure:create">
                    <Button onClick={() => setRuleFormOpen(true)}>
                      {copy.fees.structures.addLateFeeRule}
                    </Button>
                  </PermissionGate>
                }
              />
            }
          />
        </CardContent>
      </Card>

      <StructureLineDialog
        open={lineFormOpen || Boolean(editingLine)}
        onOpenChange={(open) => {
          if (!open) {
            setLineFormOpen(false);
            setEditingLine(undefined);
          }
        }}
        line={editingLine}
        heads={heads.data ?? []}
        pending={addLine.isPending || updateLine.isPending}
        onSubmit={async (data) => {
          try {
            if (editingLine && schoolId) {
              await updateLine.submit(
                schoolId,
                editingLine.id,
                data as UpdateFeeStructureLineInput,
              );
            } else if (schoolId) {
              await addLine.submit(schoolId, structureId, data as CreateFeeStructureLineInput);
            }
            setLineFormOpen(false);
            setEditingLine(undefined);
          } catch {
            // Refused: the toast carries the wording; the form stays.
          }
        }}
      />

      <LateFeeRuleDialog
        open={ruleFormOpen}
        onOpenChange={setRuleFormOpen}
        pending={addLateFeeRule.isPending}
        onSubmit={async (data) => {
          try {
            await addLateFeeRule.submit(data);
            setRuleFormOpen(false);
          } catch {
            // Refused: the toast carries the wording; the form stays.
          }
        }}
      />
    </>
  );
}
