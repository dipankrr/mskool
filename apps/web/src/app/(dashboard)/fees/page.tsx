"use client";

import Link from "next/link";
import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { FeesTabs } from "@/features/fees/tabs";
import { FeeStatus, OverdueFlag } from "@/features/fees/fee-status";
import { moneyCellClass } from "@/features/fees/fee-styles";
import { useFeeDues } from "@/features/fees/use-fee-dues";
import { usePayments } from "@/features/fees/use-fee-payments";
import { useStudents } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate, todayIso } from "@/lib/format";
import { addMoney, compareMoney, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * OVERVIEW (spec §3) — the Fees home: session figures first (collected,
 * outstanding, overdue, students with dues), one strong Collect action,
 * compact outstanding + recent payments with links onward.
 *
 * Figures are client-side sums of server rows (the aggregates endpoint is
 * on the backend shopping list — docs/FEES-BACKEND-NEEDS.md). Collected
 * sums cleared payments; outstanding/overdue sum open dues.
 */
export default function FeesOverviewPage() {
  const { has, activeSession } = useActiveContext();
  const today = todayIso();

  const dues = useFeeDues({ academicYearId: activeSession?.id });
  const payments = usePayments(activeSession?.id);
  const students = useStudents();

  const studentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students.data ?? []) {
      map.set(s.id, `${s.firstName} ${s.lastName}`);
    }
    return map;
  }, [students.data]);

  const figures = useMemo(() => {
    let outstanding = "0.00";
    let overdue = "0.00";
    const debtors = new Set<string>();
    const overdueDebtors = new Set<string>();
    for (const row of dues.data ?? []) {
      outstanding = addMoney(outstanding, row.balanceAmount);
      if (row.dueDate < today) {
        overdue = addMoney(overdue, row.balanceAmount);
        overdueDebtors.add(row.studentId);
      }
      debtors.add(row.studentId);
    }
    let collected = "0.00";
    for (const payment of payments.data ?? []) {
      if (payment.paymentStatus === "cleared") {
        collected = addMoney(collected, payment.totalAmount);
      }
    }
    return {
      outstanding,
      overdue,
      collected,
      studentsWithDues: debtors.size,
      studentsOverdue: overdueDebtors.size,
    };
  }, [dues.data, payments.data, today]);

  const topOutstanding = useMemo(() => {
    const byStudent = new Map<string, { total: string; overdue: boolean; oldestDue: string }>();
    for (const row of dues.data ?? []) {
      const current = byStudent.get(row.studentId) ?? {
        total: "0.00",
        overdue: false,
        oldestDue: row.dueDate,
      };
      current.total = addMoney(current.total, row.balanceAmount);
      if (row.dueDate < today) current.overdue = true;
      if (row.dueDate < current.oldestDue) current.oldestDue = row.dueDate;
      byStudent.set(row.studentId, current);
    }
    return [...byStudent.entries()]
      .map(([studentId, g]) => ({ studentId, ...g }))
      .sort((a, b) => compareMoney(b.total, a.total))
      .slice(0, 5);
  }, [dues.data, today]);

  const recent = useMemo(() => (payments.data ?? []).slice(0, 5), [payments.data]);

  const loading = dues.isLoading || payments.isLoading;

  return (
    <>
      <PageHeader
        title={`${copy.fees.overview.title} · ${activeSession?.name ?? ""}`}
        description={copy.fees.overview.subtitle}
        actions={
          <Link href="/fees/collect" className={cn(buttonVariants())}>
            + {copy.fees.overview.collectAction}
          </Link>
        }
      />
      <FeesTabs has={has} />

      {loading ? (
        <p className="text-muted-foreground py-8 text-sm">{copy.common.loading}</p>
      ) : (
        <div className="flex max-w-4xl flex-col gap-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">{copy.fees.overview.collected}</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums">
                {formatMoney(figures.collected)}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">{copy.fees.overview.outstanding}</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums">
                {formatMoney(figures.outstanding)}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">{copy.fees.overview.overdue}</p>
              <p className="text-destructive text-2xl font-bold tracking-tight tabular-nums">
                {formatMoney(figures.overdue)}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">{copy.fees.overview.studentsWithDues}</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums">
                {figures.studentsWithDues}
              </p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {copy.fees.dues.studentsOverdueCount(figures.studentsOverdue)}
              </p>
            </div>
          </div>

          <section aria-labelledby="fees-ov-outstanding">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="fees-ov-outstanding" className="text-base font-semibold">
                {copy.fees.overview.outstandingTitle}
              </h2>
              <Link href="/fees/outstanding" className="text-primary text-sm hover:underline">
                {copy.fees.overview.viewAll}
              </Link>
            </div>
            {topOutstanding.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                {copy.fees.overview.emptyOutstandingBody}
              </p>
            ) : (
              <ul className="mt-2 divide-y rounded-lg border">
                {topOutstanding.map((row) => (
                  <li key={row.studentId}>
                    <Link
                      href={`/students/${row.studentId}`}
                      className="hover:bg-accent flex items-center justify-between gap-2 px-3 py-2 transition-colors"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {studentNameById.get(row.studentId) ?? copy.common.none}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatIsoDate(row.oldestDue)}{" "}
                          {row.overdue ? <OverdueFlag /> : null}
                        </span>
                      </span>
                      <span className={cn("text-sm font-semibold tabular-nums", moneyCellClass)}>
                        {formatMoney(row.total)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="fees-ov-recent">
            <h2 id="fees-ov-recent" className="text-base font-semibold">
              {copy.fees.overview.recentTitle}
            </h2>
            {recent.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                {copy.fees.overview.emptyRecentBody}
              </p>
            ) : (
              <ul className="mt-2 divide-y rounded-lg border">
                {recent.map((payment) => (
                  <li key={payment.id}>
                    <Link
                      href={`/fees/payments/${payment.id}`}
                      className="hover:bg-accent flex items-center justify-between gap-2 px-3 py-2 transition-colors"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm">
                          {payment.receiptNumber}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {studentNameById.get(payment.studentId) ?? copy.common.none} ·{" "}
                          {formatIsoDate(payment.paymentDate)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={cn("text-sm font-medium tabular-nums", moneyCellClass)}>
                          {formatMoney(payment.totalAmount)}
                        </span>
                        <FeeStatus kind="payment" status={payment.paymentStatus} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(dues.error || payments.error) && (
            <EmptyState
              title={copy.errors.listFailedTitle}
              description={copy.errors.network}
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    void dues.refetch();
                    void payments.refetch();
                  }}
                >
                  {copy.common.retry}
                </Button>
              }
            />
          )}
        </div>
      )}
    </>
  );
}
