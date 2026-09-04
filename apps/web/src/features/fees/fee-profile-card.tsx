"use client";

import { CircleCheckIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AssignFeeStructureInput,
  CreateConcessionInput,
} from "@repo/contracts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PermissionGate } from "@/components/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { useClasses } from "@/features/classes/use-classes";
import { useStudentEnrollments } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { AssignStructureDialog } from "./assign-structure-dialog";
import { ConcessionDialog } from "./concession-dialog";
import { SubscriptionsSection } from "./subscriptions-section";
import { OpeningBalancesSection } from "./opening-balances-section";
import { installmentStatusClass, moneyCellClass } from "./fee-styles";
import { useFeeHeads } from "./use-fee-setup";
import { useFeeDues } from "./use-fee-dues";
import { useFeeProfileMutations, useStudentFeeAssignment } from "./use-fee-profile";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * THE FEE PROFILE CARD — on the student detail page. Three shapes: NULL
 * assignment (the Assign CTA — null is "not yet", never an error),
 * active (summary + generate / concession / recompute + the open-dues
 * mini-table), suspended/cancelled (badge, no actions). Subscriptions
 * (UI5) and opening balances (UI9) join as sections inside this card.
 *
 * The mini-table reads the same `fees.installment.dues` rows the Dues
 * tab shows — the card and the tab cannot disagree about what is owed.
 * The dues read is permission-degraded: a caller with the profile read
 * but not the (same) dues permission sees the summary without the
 * table, not a failed card.
 */

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export function FeeProfileCard({ studentId }: { studentId: string }) {
  const { schoolId, activeSession } = useActiveContext();
  const assignment = useStudentFeeAssignment(studentId);
  const enrollments = useStudentEnrollments();
  const heads = useFeeHeads();
  const classes = useClasses();
  const dues = useFeeDues({ academicYearId: activeSession?.id, studentId });
  const { assign, generate, recompute, addConcession } = useFeeProfileMutations();

  const [assignOpen, setAssignOpen] = useState(false);
  const [concessionOpen, setConcessionOpen] = useState(false);

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
  const openDues = dues.data ?? [];

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
              <div className="grid gap-4 sm:grid-cols-2">
                <Detail label={copy.fees.profile.baseAnnual}>
                  {formatMoney(row.baseAnnualAmount)}
                </Detail>
                <Detail label={copy.fees.profile.netAnnual}>
                  {formatMoney(row.netAnnualAmount)}
                </Detail>
                <Detail label={copy.fees.profile.fields.effectiveFrom}>
                  {formatIsoDate(row.feeEffectiveFrom)}
                </Detail>
                <Detail label={copy.students.enrollment.statusLabel}>
                  <span
                    className={cn(
                      "self-start",
                      installmentStatusClass(row.status === "active" ? "paid" : "cancelled"),
                    )}
                  >
                    {copy.fees.assignmentStatuses[row.status]}
                  </span>
                </Detail>
              </div>

              <div className="flex flex-wrap gap-2">
                <PermissionGate permission="student_fee_assignment:update">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => schoolId && generate.submit(schoolId, row.id)}
                    disabled={generate.isPending}
                  >
                    <CircleCheckIcon data-icon="inline-start" />
                    {copy.fees.profile.generate}
                  </Button>
                </PermissionGate>
                <PermissionGate permission="fee_waiver:create">
                  <Button variant="outline" size="sm" onClick={() => setConcessionOpen(true)}>
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
                              <span className={installmentStatusClass(installment.paymentStatus)}>
                                {copy.fees.installmentStatuses[installment.paymentStatus]}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {openDues.length > 5 ? (
                      <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                        +{openDues.length - 5} more open
                      </p>
                    ) : null}
                  </div>
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
    </PermissionGate>
  );
}
