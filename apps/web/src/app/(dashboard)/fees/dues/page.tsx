"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useEffect } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FeesTabs } from "@/features/fees/tabs";
import {
  installmentStatusClass,
  moneyCellClass,
} from "@/features/fees/fee-styles";
import { useFeeDues, useWaiveMutation } from "@/features/fees/use-fee-dues";
import { useStudents } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { addMoney, formatMoney } from "@/lib/money";
import type { FeeInstallment } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

/**
 * DUES — the arrears view: who owes what, grouped by student. Rows are
 * installment-level from the server (no names joined); the page joins
 * names from the register (a permissive read) and groups client-side —
 * the GROUPING is presentation, the OWED amounts are the server's.
 *
 * Waive is the one action on a row: fee_waiver:approve (principal-tier),
 * never-paid-only (the server refuses the rest — the confirm says so).
 * A class teacher's whole view is exactly this screen minus the buttons.
 *
 * The grand total is a client-side sum of balanceAmount — presentation
 * of server-computed balances, not new math (addMoney, paise-exact).
 */

const SEARCH_DEBOUNCE_MS = 300;

type StudentRef = { id: string; name: string; admissionNumber: string };

export default function FeesDuesPage() {
  const { has, sessions, activeSession, canSeeHistory, schoolId } = useActiveContext();

  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const [studentFilter, setStudentFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dueBy, setDueBy] = useState("");
  const [waiving, setWaiving] = useState<FeeInstallment | undefined>();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const selectedYear = yearId ?? activeSession?.id;
  const dues = useFeeDues({
    academicYearId: selectedYear,
    studentId: studentFilter !== "all" ? studentFilter : undefined,
    dueOnOrBefore: dueBy || undefined,
  });
  const students = useStudents(debouncedSearch || undefined);
  const waive = useWaiveMutation();

  // Name/admission lookup — the register read is permissive; a caller
  // who cannot see a student's dues cannot see their rows here either,
  // so the join never leaks.
  const studentById = useMemo(() => {
    const map = new Map<string, StudentRef>();
    for (const s of students.data ?? []) {
      map.set(s.id, {
        id: s.id,
        name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "),
        admissionNumber: s.admissionNumber,
      });
    }
    return map;
  }, [students.data]);

  // Group by student, oldest due first within each; student sections by name.
  const grouped = useMemo(() => {
    const byStudent = new Map<string, FeeInstallment[]>();
    for (const row of dues.data ?? []) {
      const group = byStudent.get(row.studentId) ?? [];
      group.push(row);
      byStudent.set(row.studentId, group);
    }
    return [...byStudent.entries()]
      .map(([studentId, rows]) => ({
        studentId,
        student: studentById.get(studentId),
        rows: [...rows].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
        total: rows.reduce((sum, r) => addMoney(sum, r.balanceAmount), "0.00"),
      }))
      .sort((a, b) =>
        (a.student?.name ?? "").localeCompare(b.student?.name ?? ""),
      );
  }, [dues.data, studentById]);

  const grandTotal = useMemo(
    () => grouped.reduce((sum, g) => addMoney(sum, g.total), "0.00"),
    [grouped],
  );

  const yearOptions = canSeeHistory ? sessions : sessions.filter((s) => s.isCurrent);

  return (
    <>
      <PageHeader title={copy.fees.dues.title} description={copy.fees.dues.subtitle} />
      <FeesTabs has={has} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
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
        </div>

        <div>
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

        <div>
          <Input
            type="date"
            value={dueBy}
            onChange={(event) => setDueBy(event.target.value)}
            aria-label={copy.fees.dues.dueBy}
            className="w-44"
          />
          <p className="text-muted-foreground mt-1 text-xs">{copy.fees.dues.dueByHelp}</p>
        </div>

        <div className="relative min-w-48 flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.students.searchPlaceholder}
            aria-label={copy.students.searchLabel}
            className="pl-9"
          />
        </div>
      </div>

      {dues.isLoading ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{copy.common.loading}</p>
      ) : grouped.length === 0 ? (
        <EmptyState title={copy.fees.dues.emptyTitle} description={copy.fees.dues.emptyBody} />
      ) : (
        <div className="flex flex-col gap-6">
          {selectedYear && !yearOptions.find((y) => y.id === selectedYear)?.isCurrent ? (
            <p className="text-muted-foreground text-xs">{copy.fees.dues.historyNote}</p>
          ) : null}

          {grouped.map(({ studentId, student, rows, total }) => (
            <section
              key={studentId}
              aria-labelledby={`dues-${studentId}`}
              className="flex flex-col gap-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`dues-${studentId}`} className="text-sm font-semibold">
                  {student ? (
                    <Link href={`/students/${studentId}`} className="hover:underline">
                      {student.name}
                    </Link>
                  ) : (
                    copy.common.none
                  )}
                  <span className="text-muted-foreground ml-2 font-normal">
                    {student?.admissionNumber}
                  </span>
                </h2>
                <p className={cn("text-sm font-semibold", moneyCellClass)}>
                  {formatMoney(total)}
                </p>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="px-3 py-2 font-medium">Due</th>
                      <th className="px-3 py-2 font-medium">Instalment</th>
                      <th className="px-3 py-2 text-right font-medium">{copy.fees.amounts.net}</th>
                      <th className="px-3 py-2 text-right font-medium">{copy.fees.amounts.paid}</th>
                      <th className="px-3 py-2 text-right font-medium">{copy.fees.amounts.balance}</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">{copy.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b last:border-b-0">
                        <td className="px-3 py-2">{formatIsoDate(row.dueDate)}</td>
                        <td className="px-3 py-2">{row.description ?? copy.common.none}</td>
                        <td className={cn("px-3 py-2", moneyCellClass)}>{formatMoney(row.netAmount)}</td>
                        <td className={cn("px-3 py-2", moneyCellClass)}>{formatMoney(row.paidAmount)}</td>
                        <td className={cn("px-3 py-2 font-medium", moneyCellClass)}>
                          {formatMoney(row.balanceAmount)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={installmentStatusClass(row.paymentStatus)}>
                            {copy.fees.installmentStatuses[row.paymentStatus]}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <PermissionGate permission="fee_waiver:approve">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setWaiving(row)}
                              disabled={row.paidAmount !== "0.00"}
                            >
                              {copy.fees.dues.waiveAction}
                            </Button>
                          </PermissionGate>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-muted-foreground text-sm">{copy.fees.dues.grandTotal}</span>
            <span className={cn("text-base font-semibold", moneyCellClass)}>
              {formatMoney(grandTotal)}
            </span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(waiving)}
        onOpenChange={(open) => !open && setWaiving(undefined)}
        title={copy.fees.dues.waiveTitle}
        consequence={copy.fees.dues.waiveBody}
        confirmLabel={copy.fees.dues.waiveConfirm}
        destructive
        pending={waive.isPending}
        onConfirm={async () => {
          if (!waiving || !schoolId) return;
          try {
            await waive.submit(schoolId, waiving.id);
          } finally {
            setWaiving(undefined);
          }
        }}
      />
    </>
  );
}
