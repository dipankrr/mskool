"use client";

import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FeesTabs } from "@/features/fees/tabs";
import { directionClass, moneyCellClass } from "@/features/fees/fee-styles";
import type { LedgerDirection } from "@/features/fees/fee-enums";
import { useLedger } from "@/features/fees/use-fee-ledger";
import { useStudents } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { formatMoney, subtractMoney, addMoney } from "@/lib/money";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { LedgerTransaction } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

/**
 * LEDGER — every money movement, appended as it happened. Read-only BY
 * DESIGN (hard rule 3's trigger enforces it server-side; the UI offers
 * filters, nothing else). Credit = money in, debit = money out — the
 * running net is a presentation sum of server rows (addMoney/subtract).
 */

const column = createAppColumnHelper<LedgerTransaction>();

const ALL_TYPES = "__all__" as const;

export default function FeesLedgerPage() {
  const { has, sessions, activeSession, canSeeHistory } = useActiveContext();

  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const [studentFilter, setStudentFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);

  const selectedYear = yearId ?? activeSession?.id;
  const ledger = useLedger(
    selectedYear,
    studentFilter !== "all" ? studentFilter : undefined,
  );
  const students = useStudents();

  // O(1) name lookup (see payments list) — names outside the register
  // page read render as a dash; the server joins no names here.
  const studentById = useMemo(() => {
    const map = new Map<string, { firstName: string; lastName: string }>();
    for (const s of students.data ?? []) map.set(s.id, s);
    return map;
  }, [students.data]);

  const rows = useMemo(() => {
    const all = ledger.data ?? [];
    return typeFilter === ALL_TYPES
      ? all
      : all.filter((row) => row.transactionType === typeFilter);
  }, [ledger.data, typeFilter]);

  const net = useMemo(() => {
    // Totals describe the FILTERED rows — the same set the table shows.
    // Summing the unfiltered query here made the header disagree with
    // the table the moment a type filter was picked.
    let credit = "0.00";
    let debit = "0.00";
    for (const row of rows) {
      if (row.direction === "credit") credit = addMoney(credit, row.amount);
      else debit = addMoney(debit, row.amount);
    }
    return { credit, debit, net: subtractMoney(credit, debit) };
  }, [rows]);

  const columns = useMemo<DataTableColumns<LedgerTransaction>>(
    () =>
      column.columns([
        column.accessor("transactionDate", {
          header: "Date",
          cell: ({ row }) => formatIsoDate(row.original.transactionDate),
        }),
        column.accessor("transactionType", {
          header: copy.fees.ledger.filterType,
          cell: ({ row }) =>
            copy.fees.ledgerTypes[row.original.transactionType] ?? row.original.transactionType,
        }),
        column.display({
          id: "student",
          header: "Student",
          cell: ({ row }) => {
            const id = row.original.studentId;
            const s = id ? studentById.get(id) : undefined;
            return s ? `${s.firstName} ${s.lastName}` : copy.common.none;
          },
        }),
        column.accessor("description", {
          header: "Description",
          cell: ({ row }) => row.original.description ?? copy.common.none,
        }),
        column.display({
          id: "receipt",
          header: copy.fees.payments.receipt,
          cell: ({ row }) => row.original.receiptNumber ?? copy.common.none,
        }),
        column.accessor("direction", {
          header: "Flow",
          cell: ({ row }) => (
            <span className={directionClass(row.original.direction as LedgerDirection)}>
              {copy.fees.ledgerDirections[row.original.direction as LedgerDirection]}
            </span>
          ),
        }),
        column.accessor("amount", {
          header: copy.fees.amounts.total,
          cell: ({ row }) => formatMoney(row.original.amount),
        }),
      ]),
    [studentById],
  );

  const yearOptions = canSeeHistory ? sessions : sessions.filter((s) => s.isCurrent);

  return (
    <>
      <PageHeader title={copy.fees.ledger.title} description={copy.fees.ledger.subtitle} />
      <FeesTabs has={has} />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedYear ?? undefined} onValueChange={(v) => setYearId(v ?? undefined)}>
          <SelectTrigger className="w-40" aria-label={copy.fees.structures.fields.academicYear}>
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

        <Select value={studentFilter} onValueChange={(v) => setStudentFilter(v ?? "all")}>
          <SelectTrigger className="w-52" aria-label={copy.fees.dues.filterStudent}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{copy.fees.dues.filterAllStudents}</SelectItem>
            {(students.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.firstName} {s.lastName} · {s.admissionNumber}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? ALL_TYPES)}>
          <SelectTrigger className="w-52" aria-label={copy.fees.ledger.filterType}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>{copy.fees.ledger.filterAllTypes}</SelectItem>
            {Object.entries(copy.fees.ledgerTypes).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length > 0 ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
          {typeFilter !== ALL_TYPES ? (
            <span>
              {copy.fees.ledger.filterType}:{" "}
              <span className="font-medium">
                {(copy.fees.ledgerTypes as Record<string, string>)[typeFilter] ?? typeFilter}
              </span>
            </span>
          ) : null}
          <span>
            In: <span className="font-medium">{formatMoney(net.credit)}</span>
          </span>
          <span>
            Out: <span className="font-medium">{formatMoney(net.debit)}</span>
          </span>
          <span>
            Net: <span className="font-medium">{formatMoney(net.net)}</span>
          </span>
        </div>
      ) : null}

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.fees.ledger.title}
        isLoading={ledger.isLoading}
        error={ledger.error}
        onRetry={() => void ledger.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {copy.fees.ledgerTypes[row.transactionType] ?? row.transactionType}
              </p>
              <p className="text-muted-foreground text-xs">
                {formatIsoDate(row.transactionDate)} ·{" "}
                {row.receiptNumber ?? row.description ?? copy.common.none}
              </p>
            </div>
            <p className={cn("text-sm font-medium", moneyCellClass, directionClass(row.direction))}>
              {formatMoney(row.amount)}
            </p>
          </div>
        )}
        empty={
          <EmptyState title={copy.fees.ledger.emptyTitle} description={copy.fees.ledger.emptyBody} />
        }
      />
    </>
  );
}
