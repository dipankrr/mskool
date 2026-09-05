"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FeesTabs } from "@/features/fees/tabs";
import { OverdueFlag } from "@/features/fees/fee-status";
import { FilterField, FilterRow } from "@/features/fees/fee-filters";
import { moneyCellClass } from "@/features/fees/fee-styles";
import { useFeeDues } from "@/features/fees/use-fee-dues";
import { useClasses } from "@/features/classes/use-classes";
import { useStudentEnrollments, useStudents } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate, todayIso } from "@/lib/format";
import { addMoney, compareMoney, formatMoney } from "@/lib/money";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { cn } from "@/lib/utils";

/**
 * OUTSTANDING (spec §13) — one compact row per student: who owes what,
 * oldest due, status, and the two actions that matter (Collect, View
 * account). Instalment detail lives on the student account, not inline —
 * this screen stays scannable at thousands of students.
 *
 * Amounts are presentation sums of server balances (addMoney, paise-exact).
 * Class names join client-side from enrollments and degrade to a dash for
 * callers without the enrollment read. Waive lives on the student account.
 */

const column = createAppColumnHelper<OutstandingRow>();

type OutstandingRow = {
  studentId: string;
  name: string;
  admissionNumber: string;
  classId: string;
  className: string;
  total: string;
  overdueTotal: string;
  oldestDue: string;
  overdue: boolean;
  openCount: number;
};

type StatusFilter = "all" | "overdue" | "due";

export default function FeesOutstandingPage() {
  const { has, sessions, activeSession, canSeeHistory } = useActiveContext();

  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [dueBy, setDueBy] = useState("");

  const selectedYear = yearId ?? activeSession?.id;
  const today = todayIso();
  const dues = useFeeDues({
    academicYearId: selectedYear,
    dueOnOrBefore: dueBy || undefined,
  });
  const students = useStudents();
  const enrollments = useStudentEnrollments();
  const classes = useClasses();

  const studentById = useMemo(() => {
    const map = new Map<string, { name: string; admissionNumber: string }>();
    for (const s of students.data ?? []) {
      map.set(s.id, {
        name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "),
        admissionNumber: s.admissionNumber,
      });
    }
    return map;
  }, [students.data]);

  const classByStudentId = useMemo(() => {
    const classNameById = new Map((classes.data ?? []).map((c) => [c.id, c.name]));
    const map = new Map<string, { classId: string; className: string }>();
    for (const pair of enrollments.data ?? []) {
      map.set(pair.student.id, {
        classId: pair.enrollment.classId,
        className: classNameById.get(pair.enrollment.classId) ?? copy.common.none,
      });
    }
    return map;
  }, [enrollments.data, classes.data]);

  const classOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const pair of enrollments.data ?? []) {
      if (!names.has(pair.enrollment.classId)) {
        names.set(
          pair.enrollment.classId,
          (classes.data ?? []).find((c) => c.id === pair.enrollment.classId)?.name ??
            copy.common.none,
        );
      }
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [enrollments.data, classes.data]);

  const grouped = useMemo<OutstandingRow[]>(() => {
    const byStudent = new Map<string, { oldestDue: string; total: string; overdueTotal: string; count: number }>();
    for (const row of dues.data ?? []) {
      const current = byStudent.get(row.studentId) ?? {
        oldestDue: row.dueDate,
        total: "0.00",
        overdueTotal: "0.00",
        count: 0,
      };
      current.oldestDue =
        row.dueDate < current.oldestDue ? row.dueDate : current.oldestDue;
      current.total = addMoney(current.total, row.balanceAmount);
      if (row.dueDate < today) current.overdueTotal = addMoney(current.overdueTotal, row.balanceAmount);
      current.count += 1;
      byStudent.set(row.studentId, current);
    }
    return [...byStudent.entries()].map(([studentId, g]) => {
      const student = studentById.get(studentId);
      const cls = classByStudentId.get(studentId);
      return {
        studentId,
        name: student?.name ?? copy.common.none,
        admissionNumber: student?.admissionNumber ?? "",
        classId: cls?.classId ?? "",
        className: cls?.className ?? copy.common.none,
        total: g.total,
        overdueTotal: g.overdueTotal,
        oldestDue: g.oldestDue,
        overdue: compareMoney(g.overdueTotal, "0.00") > 0,
        openCount: g.count,
      };
    });
  }, [dues.data, studentById, classByStudentId, today]);

  const query = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      grouped
        .filter((row) => (classFilter === "all" ? true : row.classId === classFilter))
        .filter((row) =>
          statusFilter === "all" ? true : statusFilter === "overdue" ? row.overdue : !row.overdue,
        )
        .filter((row) =>
          query
            ? row.name.toLowerCase().includes(query) ||
              row.admissionNumber.toLowerCase().includes(query)
            : true,
        )
        .sort((a, b) => compareMoney(b.total, a.total)),
    [grouped, classFilter, statusFilter, query],
  );

  const summary = useMemo(() => {
    let total = "0.00";
    let overdue = "0.00";
    let studentsOverdue = 0;
    for (const row of grouped) {
      total = addMoney(total, row.total);
      overdue = addMoney(overdue, row.overdueTotal);
      if (row.overdue) studentsOverdue += 1;
    }
    return { total, overdue, studentsOverdue, students: grouped.length };
  }, [grouped]);

  const columns = useMemo<DataTableColumns<OutstandingRow>>(
    () =>
      column.columns([
        column.accessor("name", {
          header: copy.fees.dues.studentHeader,
          cell: ({ row }) => (
            <span>
              <Link
                href={`/students/${row.original.studentId}`}
                className="font-medium hover:underline"
              >
                {row.original.name}
              </Link>{" "}
              <span className="text-muted-foreground text-xs font-normal">
                {row.original.admissionNumber}
              </span>
            </span>
          ),
        }),
        column.accessor("className", {
          header: copy.terms.class,
          cell: ({ row }) => row.original.className,
        }),
        column.accessor("total", {
          header: copy.fees.dues.grandTotal,
          cell: ({ row }) => (
            <span className={cn("font-semibold", moneyCellClass)}>{formatMoney(row.original.total)}</span>
          ),
        }),
        column.accessor("oldestDue", {
          header: copy.fees.dues.oldestDue,
          cell: ({ row }) => (
            <span>
              {formatIsoDate(row.original.oldestDue)}{" "}
              {row.original.overdue ? <OverdueFlag /> : null}
            </span>
          ),
        }),
        column.display({
          id: "status",
          header: copy.fees.dues.statusHeader,
          cell: ({ row }) =>
            row.original.overdue ? (
              <OverdueFlag />
            ) : (
              <span className="text-muted-foreground text-xs font-medium">
                {copy.fees.dues.statusDue}
              </span>
            ),
        }),
        column.display({
          id: "actions",
          header: copy.common.actions,
          cell: ({ row }) => (
            <span className="flex items-center gap-1">
              <Link
                href={`/fees/collect?studentId=${row.original.studentId}`}
                className={cn(buttonVariants({ variant: "default", size: "sm" }))}
              >
                {copy.fees.dues.collectAction}
              </Link>
              <Link
                href={`/students/${row.original.studentId}`}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                {copy.fees.dues.viewAccount}
              </Link>
            </span>
          ),
        }),
      ]),
    [],
  );

  const yearOptions = canSeeHistory ? sessions : sessions.filter((s) => s.isCurrent);

  return (
    <>
      <PageHeader title={copy.fees.dues.title} description={copy.fees.dues.subtitle} />
      <FeesTabs has={has} />

      {selectedYear && !yearOptions.find((y) => y.id === selectedYear)?.isCurrent ? (
        <p role="note" className="mb-4 rounded-lg border border-dashed p-3 text-sm font-medium">
          {copy.fees.dues.historyNote}
        </p>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-muted-foreground text-sm">{copy.fees.dues.grandTotal}</p>
          <p className="text-2xl font-bold tracking-tight tabular-nums">
            {formatMoney(summary.total)}
          </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {copy.fees.dues.studentsWithDuesCount(summary.students)}
            </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-muted-foreground text-sm">{copy.fees.dues.overdueTotal}</p>
          <p className="text-destructive text-2xl font-bold tracking-tight tabular-nums">
            {formatMoney(summary.overdue)}
          </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {copy.fees.dues.studentsOverdueCount(summary.studentsOverdue)}
            </p>
        </div>
      </div>

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

        <FilterField label={copy.terms.class}>
          <Select value={classFilter} onValueChange={(v) => setClassFilter(v ?? "all")}>
            <SelectTrigger className="w-40" aria-label={copy.terms.class}>
              <SelectValue>
                {(value: string | null) =>
                  (!value || value === "all"
                    ? undefined
                    : classOptions.find(([id]) => id === value)?.[1]) ??
                  copy.fees.dues.filterAllStudents}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy.fees.dues.filterAllStudents}</SelectItem>
              {classOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label={copy.fees.dues.filterStatus}>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter((v ?? "all") as StatusFilter)}
          >
            <SelectTrigger className="w-36" aria-label={copy.fees.dues.filterStatus}>
              <SelectValue>
                {(value: string | null) =>
                  value === "overdue"
                    ? copy.fees.dues.statusOverdue
                    : value === "due"
                      ? copy.fees.dues.statusDue
                      : copy.fees.dues.filterAllStatuses}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy.fees.dues.filterAllStatuses}</SelectItem>
              <SelectItem value="overdue">{copy.fees.dues.statusOverdue}</SelectItem>
              <SelectItem value="due">{copy.fees.dues.statusDue}</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label={copy.fees.dues.dueBy}>
          <Input
            type="date"
            value={dueBy}
            onChange={(event) => setDueBy(event.target.value)}
            aria-label={copy.fees.dues.dueBy}
            className="w-44"
          />
        </FilterField>

        <FilterField label={copy.fees.dues.searchLabel} className="min-w-48 flex-1">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.fees.dues.searchPlaceholder}
            aria-label={copy.fees.dues.searchLabel}
          />
        </FilterField>
      </FilterRow>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.studentId}
        caption={copy.fees.dues.title}
        isLoading={dues.isLoading}
        error={dues.error}
        onRetry={() => void dues.refetch()}
        renderCard={(row) => (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <Link
                href={`/students/${row.studentId}`}
                className="truncate font-medium hover:underline"
              >
                {row.name}
              </Link>
              <p className="text-muted-foreground text-xs tabular-nums">
                {row.className} · {formatMoney(row.total)} ·{" "}
                {row.overdue ? copy.fees.dues.statusOverdue : copy.fees.dues.statusDue}
              </p>
            </div>
            <Link
              href={`/fees/collect?studentId=${row.studentId}`}
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "min-h-11")}
            >
              {copy.fees.dues.collectAction}
            </Link>
          </div>
        )}
        empty={
          <EmptyState title={copy.fees.dues.emptyTitle} description={copy.fees.dues.emptyBody} />
        }
      />
    </>
  );
}
