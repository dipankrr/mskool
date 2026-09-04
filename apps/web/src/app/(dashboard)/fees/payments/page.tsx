"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

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
import { paymentStatusClass, moneyCellClass } from "@/features/fees/fee-styles";
import { usePayments } from "@/features/fees/use-fee-payments";
import { useStudents } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { FeePayment, Student } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

/**
 * PAYMENTS — the session's collections, every status, newest first in the
 * default sort. Row → the detail page where the state machine lives.
 * The list itself is read-only for everyone: transitions belong to ONE
 * payment's own page, where the consequence text has room to be read.
 */

const column = createAppColumnHelper<FeePayment>();

function studentName(lookup: Map<string, Student>, studentId: string): string {
  const s = lookup.get(studentId);
  return s ? `${s.firstName} ${s.lastName}` : copy.common.none;
}

export default function FeesPaymentsPage() {
  const { has, sessions, activeSession, canSeeHistory } = useActiveContext();

  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const [studentFilter, setStudentFilter] = useState<string>("all");

  const selectedYear = yearId ?? activeSession?.id;
  const payments = usePayments(
    selectedYear,
    studentFilter !== "all" ? studentFilter : undefined,
  );
  const students = useStudents();

  // O(1) name lookup — the per-cell .find() re-ran on every render and
  // re-memoized columns on the whole array identity.
  const studentById = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of students.data ?? []) map.set(s.id, s);
    return map;
  }, [students.data]);

  const columns = useMemo<DataTableColumns<FeePayment>>(
    () =>
      column.columns([
        column.accessor("receiptNumber", {
          header: copy.fees.payments.receipt,
          cell: ({ row }) => (
            <Link
              href={`/fees/payments/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {row.original.receiptNumber}
            </Link>
          ),
        }),
        column.display({
          id: "student",
          header: "Student",
          cell: ({ row }) => studentName(studentById, row.original.studentId),
        }),
        column.accessor("paymentDate", {
          header: copy.fees.counter.paymentDate,
          cell: ({ row }) => formatIsoDate(row.original.paymentDate),
        }),
        column.accessor("paymentMode", {
          header: copy.fees.counter.mode,
          cell: ({ row }) =>
            copy.fees.paymentModes[row.original.paymentMode as keyof typeof copy.fees.paymentModes] ??
            copy.common.none,
        }),
        column.accessor("amount", {
          header: copy.fees.amounts.total,
          cell: ({ row }) => formatMoney(row.original.totalAmount),
        }),
        column.display({
          id: "lateFee",
          header: copy.fees.amounts.lateFee,
          cell: ({ row }) =>
            row.original.lateFeeAmount && row.original.lateFeeAmount !== "0.00"
              ? formatMoney(row.original.lateFeeAmount)
              : copy.common.none,
        }),
        column.accessor("paymentStatus", {
          header: "Status",
          cell: ({ row }) => (
            <span className={paymentStatusClass(row.original.paymentStatus)}>
              {copy.fees.paymentStatuses[row.original.paymentStatus]}
            </span>
          ),
        }),
      ]),
    [studentById],
  );

  const yearOptions = canSeeHistory ? sessions : sessions.filter((s) => s.isCurrent);

  return (
    <>
      <PageHeader title={copy.fees.payments.title} description={copy.fees.payments.subtitle} />
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
      </div>

      <DataTable
        data={payments.data ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.fees.payments.title}
        isLoading={payments.isLoading}
        error={payments.error}
        onRetry={() => void payments.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <Link
                href={`/fees/payments/${row.id}`}
                className="truncate font-medium hover:underline"
              >
                {row.receiptNumber}
              </Link>
              <p className="text-muted-foreground text-xs">
                {studentName(studentById, row.studentId)} ·{" "}
                {formatIsoDate(row.paymentDate)} ·{" "}
                {copy.fees.paymentModes[row.paymentMode as keyof typeof copy.fees.paymentModes] ??
                  copy.common.none}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={cn("text-sm font-medium", moneyCellClass)}>
                {formatMoney(row.totalAmount)}
              </span>
              <span className={paymentStatusClass(row.paymentStatus)}>
                {copy.fees.paymentStatuses[row.paymentStatus]}
              </span>
            </div>
          </div>
        )}
        empty={
          <EmptyState title={copy.fees.payments.emptyTitle} description={copy.fees.payments.emptyBody} />
        }
      />
    </>
  );
}
