"use client";

import { CircleCheckIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  AssignFeeStructureInput,
  CreateConcessionInput,
} from "@repo/contracts";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { useClasses } from "@/features/classes/use-classes";
import { useStudentEnrollments } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { AssignStructureDialog } from "./assign-structure-dialog";
import { ConcessionDialog } from "./concession-dialog";
import { SubscriptionsSection } from "./subscriptions-section";
import { OpeningBalancesSection } from "./opening-balances-section";
import { FeeStatus } from "./fee-status";
import { moneyCellClass } from "./fee-styles";
import { useFeeHeads } from "./use-fee-setup";
import { useFeeDues, useWaiveMutation } from "./use-fee-dues";
import { usePayments } from "./use-fee-payments";
import { useFeeProfileMutations, useStudentFeeAssignment } from "./use-fee-profile";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { addMoney, formatMoney, isMoneyString, subtractMoney } from "@/lib/money";
import type { FeeInstallment } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

/**
 * THE STUDENT FEE ACCOUNT (spec §§14–19) — the authoritative financial
 * view for one student: summary first (billed / concessions / paid /
 * outstanding), then instalments, recent payments, optional services,
 * opening balances. One page, distinct groups — no tabs.
 *
 * Waive moved here from Outstanding: per-instalment, never-paid-only,
 * approve-tier (hidden from the accountant — duties).
 */

export function FeeProfileCard({ studentId }: { studentId: string }) {
  const { schoolId, activeSession } = useActiveContext();
  const assignment = useStudentFeeAssignment(studentId);
  const enrollments = useStudentEnrollments();
  const heads = useFeeHeads();
  const classes = useClasses();
  const dues = useFeeDues({ academicYearId: activeSession?.id, studentId });
  const payments = usePayments(activeSession?.id, studentId);
  const { assign, generate, recompute, addConcession } = useFeeProfileMutations();
  const waive = useWaiveMutation();

  const [assignOpen, setAssignOpen] = useState(false);
  const [concessionOpen, setConcessionOpen] = useState(false);
  const [waiving, setWaiving] = useState<FeeInstallment | undefined>();

  // The assign dialog's enrollment options: this student's enrollments
  // in the active session, labelled by class.
  const enrollmentOptions = useMemo(() => {
    const classNameById = new Map((classes.data ?? []).map((c) => [c.id, c.name]));
    return (enrollments.data ?? [])
      .filter((pair) => pair.student.id === studentId)
      .map((pair) => ({
        id: pair.enrollment.id,
        label: classNameById.get(pair.enrollment.classId) ?? copy.terms.class,
      }));
  }, [enrollments.data, classes.data, studentId]);

  // Head names for the concession's applies-to select.
  const headNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const head of heads.data ?? []) map.set(head.id, head.name);
    return map;
  }, [heads.data]);

  const row = assignment.data;
  const openDues = useMemo(() => dues.data ?? [], [dues.data]);

  // Presentation sums of server balances — billed/concessions are the
  // assignment's frozen snapshots, paid/outstanding sum the dues rows.
  const finance = useMemo(() => {
    if (!row) return null;
    const base = row.baseAnnualAmount;
    const net = row.netAnnualAmount;
    const paid = openDues.reduce((sum, r) => addMoney(sum, r.paidAmount), "0.00");
    const outstanding = openDues.reduce((sum, r) => addMoney(sum, r.balanceAmount), "0.00");
    return {
      billed: base,
      concessions:
        isMoneyString(base) && isMoneyString(net) ? subtractMoney(base, net) : "0.00",
      paid,
      outstanding,
    };
  }, [row, openDues]);

  const recentPayments = useMemo(() => (payments.data ?? []).slice(0, 5), [payments.data]);

  return (
    <PermissionGate permission="student_fee_assignment:read">
      <Card>
        <CardHeader>
          <CardTitle>{copy.fees.profile.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-6">
          {assignment.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : !row ? (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm">{copy.fees.profile.notAssignedBody}</p>
              {enrollmentOptions.length > 0 ? (
                <PermissionGate permission="student_fee_assignment:create">
                  <Button
                    onClick={() => setAssignOpen(true)}
                    disabled={!assign.canSubmit}
                    className="self-start"
                  >
                    <PlusIcon data-icon="inline-start" />
                    {copy.fees.profile.assignAction}
                  </Button>
                </PermissionGate>
              ) : (
                <p className="text-muted-foreground text-xs">{copy.students.enrollment.none}</p>
              )}
            </div>
          ) : (
            <>
              {finance ? (
                <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">
                      {copy.fees.profile.billedTotal}
                    </p>
                    <p className="text-lg font-bold tabular-nums">{formatMoney(finance.billed)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">
                      {copy.fees.profile.concessionsTotal}
                    </p>
                    <p className="text-lg font-bold tabular-nums">
                      {formatMoney(finance.concessions)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">
                      {copy.fees.profile.paidTotal}
                    </p>
                    <p className="text-lg font-bold tabular-nums">{formatMoney(finance.paid)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium">
                      {copy.fees.profile.outstandingTotal}
                    </p>
                    <p className="text-lg font-bold tabular-nums">
                      {formatMoney(finance.outstanding)}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <PermissionGate permission="fee_payment:create">
                  <Link
                    href={`/fees/collect?studentId=${studentId}`}
                    className={cn(buttonVariants())}
                  >
                    {copy.fees.profile.collectAction}
                  </Link>
                </PermissionGate>
                <PermissionGate permission="student_fee_assignment:update">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => schoolId && generate.submit(schoolId, row.id)}
                    disabled={generate.isPending}
                    title={copy.fees.profile.generateHelp}
                  >
                    <CircleCheckIcon data-icon="inline-start" />
                    {copy.fees.profile.generate}
                  </Button>
                </PermissionGate>
                <PermissionGate permission="fee_waiver:create">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConcessionOpen(true)}
                    title={copy.fees.profile.concessionHelp}
                  >
                    <PlusIcon data-icon="inline-start" />
                    {copy.fees.profile.concession}
                  </Button>
                </PermissionGate>
                <PermissionGate permission="student_fee_assignment:update">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => schoolId && recompute.submit(schoolId, row.id)}
                    disabled={recompute.isPending}
                    title={copy.fees.profile.recomputeHelp}
                  >
                    <RefreshCwIcon data-icon="inline-start" />
                    {copy.fees.profile.recompute}
                  </Button>
                </PermissionGate>
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{copy.fees.profile.installmentsTitle}</h3>
                {openDues.length === 0 ? (
                  <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                    {copy.fees.profile.noInstallmentsBody}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left text-xs">
                          <th className="px-3 py-2 font-medium">Due</th>
                          <th className="px-3 py-2 text-right font-medium">
                            {copy.fees.amounts.net}
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            {copy.fees.amounts.balance}
                          </th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">{copy.common.actions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openDues.slice(0, 5).map((installment) => (
                          <tr key={installment.id} className="border-b last:border-b-0">
                            <td className="px-3 py-2">{formatIsoDate(installment.dueDate)}</td>
                            <td className={cn("px-3 py-2", moneyCellClass)}>
                              {formatMoney(installment.netAmount)}
                            </td>
                            <td className={cn("px-3 py-2 font-medium", moneyCellClass)}>
                              {formatMoney(installment.balanceAmount)}
                            </td>
                            <td className="px-3 py-2">
                              <FeeStatus kind="installment" status={installment.paymentStatus} />
                            </td>
                            <td className="px-3 py-2">
                              <PermissionGate permission="fee_waiver:approve">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setWaiving(installment)}
                                  disabled={installment.paymentStatus !== "unpaid"}
                                  title={
                                    installment.paymentStatus !== "unpaid"
                                      ? copy.fees.dues.waiveBody
                                      : undefined
                                  }
                                >
                                  {copy.fees.dues.waiveAction}
                                </Button>
                              </PermissionGate>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {openDues.length > 5 ? (
                      <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                        {copy.fees.profile.moreOpen(openDues.length - 5)}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{copy.fees.profile.recentPayments}</h3>
                  <PermissionGate permission="fee_payment:read">
                    <Link
                      href="/fees/payments"
                      className="text-primary text-sm hover:underline"
                    >
                      {copy.fees.profile.viewAllPayments}
                    </Link>
                  </PermissionGate>
                </div>
                {payments.isLoading ? (
                  <p className="text-muted-foreground text-sm">{copy.common.loading}</p>
                ) : recentPayments.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{copy.fees.payments.emptyBody}</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {recentPayments.map((payment) => (
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
                              {formatIsoDate(payment.paymentDate)}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className={cn("text-sm font-medium", moneyCellClass)}>
                              {formatMoney(payment.totalAmount)}
                            </span>
                            <FeeStatus kind="payment" status={payment.paymentStatus} />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <SubscriptionsSection studentId={studentId} activeSession={activeSession} />

              <OpeningBalancesSection studentId={studentId} activeSession={activeSession} />
            </>
          )}
        </CardContent>
      </Card>

      <AssignStructureDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        enrollments={enrollmentOptions}
        pending={assign.isPending}
        onSubmit={async (data: AssignFeeStructureInput) => {
          try {
            await assign.submit(data);
            setAssignOpen(false);
          } catch {
            // Refused: the toast carries the wording; the form stays.
          }
        }}
      />

      <ConcessionDialog
        open={concessionOpen}
        onOpenChange={setConcessionOpen}
        headNames={headNames}
        pending={addConcession.isPending}
        onSubmit={async (data: CreateConcessionInput) => {
          if (!schoolId || !row) return;
          try {
            await addConcession.submit(schoolId, row.id, data);
            setConcessionOpen(false);
          } catch {
            // Refused: the toast carries the wording; the form stays.
          }
        }}
      />

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
    </PermissionGate>
  );
}
