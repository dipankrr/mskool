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
import { FilterField, FilterRow } from "@/features/fees/fee-filters";
import { directionClass, moneyCellClass } from "@/features/fees/fee-styles";
import { useLedger } from "@/features/fees/use-fee-ledger";
import { useStudents } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { formatMoney, subtractMoney, addMoney, compareMoney, fromPaise, isMoneyString, toPaise } from "@/lib/money";
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
    const filtered =
      typeFilter === ALL_TYPES
        ? all
        : all.filter((row) => row.transactionType === typeFilter);
    // Oldest movement first — the running balance accumulates in order.
    return [...filtered].sort(
      (a, b) =>
        a.transactionDate.localeCompare(b.transactionDate) || a.id.localeCompare(b.id),
    );
  }, [ledger.data, typeFilter]);

  const net = useMemo(() => {
    // Totals describe the FILTERED rows — the same set the table shows.
    let credit = "0.00";
    let debit = "0.00";
    for (const row of rows) {
      if (row.direction === "credit") credit = addMoney(credit, row.amount);
      else debit = addMoney(debit, row.amount);
    }
    return { credit, debit, net: subtractMoney(credit, debit) };
  }, [rows]);

  /** Row id → running balance after that row (oldest → newest). Paise
   *  arithmetic directly — the balance can legitimately go negative and
   *  the wire helpers refuse signed strings. */
  const runningById = useMemo(() => {
    const map = new Map<string, string>();
    let running = 0n;
    for (const row of rows) {
      if (isMoneyString(row.amount)) {
        const paise = toPaise(row.amount);
        running = row.direction === "credit" ? running + paise : running - paise;
      }
      map.set(row.id, fromPaise(running));
    }
    return map;
  }, [rows]);

  const columns = useMemo<DataTableColumns<LedgerTransaction>>(
    () =>
      column.columns([        column.accessor("transactionDate", {
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
        column.display({
          id: "moneyIn",
          header: copy.fees.ledger.moneyIn,
          cell: ({ row }) =>
            row.original.direction === "credit" ? (
              <span className={cn("font-medium", moneyCellClass, directionClass("credit"))}>
                {formatMoney(row.original.amount)}
              </span>
            ) : (
              copy.common.none
            ),
        }),
        column.display({
          id: "moneyOut",
          header: copy.fees.ledger.moneyOut,
          cell: ({ row }) =>
            row.original.direction === "debit" ? (
              <span className={cn("font-medium", moneyCellClass, directionClass("debit"))}>
                {formatMoney(row.original.amount)}
              </span>
            ) : (
              copy.common.none
            ),
        }),
        column.display({
          id: "running",
          header: copy.fees.ledger.runningBalance,
          cell: ({ row }) => {
            const balance = runningById.get(row.original.id) ?? "0.00";
            return (
              <span className={cn("font-medium", moneyCellClass)}>
                {formatMoney(balance)}
              </span>
            );
          },
        }),
      ]),
    [studentById, runningById],
  );

  const yearOptions = canSeeHistory ? sessions : sessions.filter((s) => s.isCurrent);

  return (
    <>
      <PageHeader title={copy.fees.ledger.title} description={copy.fees.ledger.subtitle} />
      <FeesTabs has={has} />

      <FilterRow className="mb-4">
        <FilterField label={copy.fees.dues.filterSession}>
          <Select value={selectedYear ?? undefined} onValueChange={(v) => setYearId(v ?? undefined)}>
            <SelectTrigger className="w-40" aria-label={copy.fees.dues.filterSession}>
              <SelectValue>
                {(value: string | null) =>
                  sessions.find((s) => s.id === value)?.name ?? copy.fees.dues.filterSession}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label={copy.fees.dues.filterStudent}>
          <Select value={studentFilter} onValueChange={(v) => setStudentFilter(v ?? "all")}>
            <SelectTrigger className="w-52" aria-label={copy.fees.dues.filterStudent}>
              <SelectValue>
                {(value: string | null) => {
                  if (!value || value === "all") return copy.fees.dues.filterAllStudents;
                  const s = studentById.get(value);
                  return s ? `${s.firstName} ${s.lastName}` : value;
                }}
              </SelectValue>
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
        </FilterField>

        <FilterField label={copy.fees.ledger.filterType}>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? ALL_TYPES)}>
            <SelectTrigger className="w-52" aria-label={copy.fees.ledger.filterType}>
              <SelectValue>
                {(value: string | null) =>
                  !value || value === ALL_TYPES
                    ? copy.fees.ledger.filterAllTypes
                    : ((copy.fees.ledgerTypes as Record<string, string>)[value] ?? value)}
              </SelectValue>
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
        </FilterField>
      </FilterRow>

      {rows.length > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-4">
            <p className="text-muted-foreground text-sm">
              {copy.fees.ledger.moneyIn}
              {typeFilter !== ALL_TYPES ? (
                <span>
                  {" "}
                  · {(copy.fees.ledgerTypes as Record<string, string>)[typeFilter] ?? typeFilter}
                </span>
              ) : null}
            </p>
            <p className={cn("text-2xl font-bold tracking-tight tabular-nums", moneyCellClass)}>
              {formatMoney(net.credit)}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-muted-foreground text-sm">
              {copy.fees.ledger.moneyOut}
              {typeFilter !== ALL_TYPES ? (
                <span>
                  {" "}
                  · {(copy.fees.ledgerTypes as Record<string, string>)[typeFilter] ?? typeFilter}
                </span>
              ) : null}
            </p>
            <p className={cn("text-2xl font-bold tracking-tight tabular-nums", moneyCellClass)}>
              {formatMoney(net.debit)}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-muted-foreground text-sm">{copy.fees.ledger.netTotal}</p>
            <p
              className={cn(
                "text-2xl font-bold tracking-tight tabular-nums",
                moneyCellClass,
                directionClass(compareMoney(net.net, "0.00") >= 0 ? "credit" : "debit"),
              )}
            >
              {formatMoney(net.net)}
            </p>
          </div>
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
              <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                {copy.fees.ledger.runningBalance}:{" "}
                {formatMoney(runningById.get(row.id) ?? "0.00")}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs font-medium",
                  row.direction === "credit"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100"
                    : "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-100",
                )}
              >
                {row.direction === "credit" ? copy.fees.ledger.moneyIn : copy.fees.ledger.moneyOut}
              </span>
              <span className={cn("text-sm font-medium tabular-nums", moneyCellClass)}>
                {formatMoney(row.amount)}
              </span>
            </div>
          </div>
        )}
        empty={
          <EmptyState title={copy.fees.ledger.emptyTitle} description={copy.fees.ledger.emptyBody} />
        }
      />
    </>
  );
}
