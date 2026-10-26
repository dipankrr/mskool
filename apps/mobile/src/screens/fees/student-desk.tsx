import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import {
  ASSIGNMENT_STATUS_LABEL,
  canWaiveInstallment,
  installmentTitle,
  oldestFirst,
  outstandingTotals,
} from "../../lib/fees";
import { formatReadableDate, todayIso } from "../../lib/format";
import {
  formatMoney,
  isPositiveMoney,
  paidPercent,
  sumMoney,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ConcessionSheet } from "./concession-sheet";
import {
  AssignSheet,
  GenerateSheet,
  RecomputeSheet,
  WaiveSheet,
} from "./desk-actions";
import { InstallmentRow } from "./installment-row";
import { MonthSheet } from "./month-sheet";
import { MonthStrip } from "./month-strip";
import { PaymentRow } from "./payment-row";
import {
  FactChip,
  InstallmentStatusPill,
  MatrixStatusPill,
  SectionHead,
} from "./status";

type MatrixOutput = inferRouterOutputs<AppRouter>["fees"]["matrix"]["list"];
type MatrixRow = MatrixOutput["rows"][number];

type DeskSheet =
  | { kind: "assign" }
  | { kind: "generate"; assignmentId: string }
  | { kind: "recompute"; assignmentId: string }
  | { kind: "concession"; assignmentId: string }
  | { kind: "waive"; installment: { id: string; title: string } }
  | { kind: "month"; month: string; label: string };

type DeskNotice = { message: string; tone: "positive" | "caution" };

/**
 * One student's fee desk (Step 5A) — the counter's answer to "what does this
 * child owe, and since when?".
 *
 * The hero comes from the matrix row because the principal can read the
 * report but NOT `student_fee_assignment:read`. The open-installment list and
 * the assignment actions therefore appear only for a caller who can read the
 * assignment; everyone with the report sees the month strip, which opens a
 * month's installments from `matrix.cell` and carries the principal's waiver.
 *
 * The hero's total is the year's balance PLUS any carried-forward opening
 * balance — the same sum the server's matrix sorts by. The two are shown
 * separately because only the year's installments can take a counter payment
 * in this build; the opening balance is a recorded debt with no collection
 * endpoint yet (documented gap).
 */
export function StudentFeeDeskScreen() {
  const params = useLocalSearchParams<{
    studentId?: string;
    admissionNumber?: string;
    studentName?: string;
  }>();
  const { organizationId, schoolId, academicYear, yearPending, ready } =
    useActiveContext();
  const { has, hasAny } = usePermissions();

  const studentId = params.studentId ?? "";
  const admissionParam =
    typeof params.admissionNumber === "string"
      ? params.admissionNumber
      : undefined;

  const canReadDesk = hasAny("fee_report:read", "student_fee_assignment:read");
  const canReadMatrix = has("fee_report:read");
  const canReadAssignment = has("student_fee_assignment:read");
  const canAssign = has("student_fee_assignment:create");
  const canUpdateAssignment = has("student_fee_assignment:update");
  const canCreateConcession = has("fee_waiver:create");
  const canReadStructure = has("fee_structure:read");
  const canReadPayments = has("fee_payment:read");
  const canCollect = has("fee_payment:create");

  const [sheet, setSheet] = useState<DeskSheet | null>(null);
  const [notice, setNotice] = useState<DeskNotice | null>(null);

  const student = trpc.student.byId.useQuery(
    { organizationId: organizationId ?? "", id: studentId },
    {
      enabled: ready && Boolean(studentId) && !admissionParam,
    },
  );

  const admissionNumber =
    admissionParam ?? student.data?.admissionNumber ?? null;

  const matrix = trpc.fees.matrix.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      search: admissionNumber ?? undefined,
      page: 1,
      pageSize: 50,
      sort: "student",
      view: "all",
    },
    {
      enabled:
        ready &&
        canReadMatrix &&
        Boolean(academicYear?.id) &&
        Boolean(admissionNumber),
    },
  );

  const row: MatrixRow | null = useMemo(
    () =>
      matrix.data?.rows.find((entry) => entry.studentId === studentId) ?? null,
    [matrix.data, studentId],
  );

  const assignmentQuery = trpc.fees.assignment.byStudent.useQuery(
    {
      organizationId: organizationId ?? "",
      studentId,
      academicYearId: academicYear?.id ?? "",
      schoolId: schoolId ?? "",
    },
    {
      enabled:
        ready &&
        canReadAssignment &&
        Boolean(schoolId) &&
        Boolean(academicYear?.id) &&
        Boolean(studentId),
    },
  );
  const assignment = assignmentQuery.data ?? null;

  const structures = trpc.fees.structure.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      includeHistory: true,
    },
    {
      enabled: ready && canReadStructure && Boolean(academicYear?.id),
      staleTime: 5 * 60_000,
    },
  );

  const classStructure = useMemo(() => {
    if (!row) return null;
    return (
      structures.data?.find(
        (structure) => structure.classId === row.classId && structure.isActive,
      ) ?? null
    );
  }, [structures.data, row]);

  const assignedStructureName = useMemo(() => {
    if (!assignment) return null;
    return (
      structures.data?.find(
        (structure) => structure.id === assignment.feeStructureId,
      )?.name ?? null
    );
  }, [structures.data, assignment]);

  const enrollments = trpc.enrollment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      classId: row?.classId,
    },
    {
      enabled:
        ready &&
        canAssign &&
        Boolean(academicYear?.id) &&
        Boolean(row?.classId),
    },
  );
  const enrollment = useMemo(
    () =>
      enrollments.data?.find((entry) => entry.student.id === studentId)
        ?.enrollment ?? null,
    [enrollments.data, studentId],
  );

  const dues = trpc.fees.installment.dues.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      studentId,
    },
    {
      enabled:
        ready &&
        canReadAssignment &&
        Boolean(academicYear?.id) &&
        Boolean(studentId),
    },
  );
  const installments = useMemo(() => oldestFirst(dues.data ?? []), [dues.data]);
  const openTotals = useMemo(
    () => outstandingTotals(installments),
    [installments],
  );

  const payments = trpc.fees.payment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      studentId,
    },
    {
      enabled:
        ready &&
        canReadPayments &&
        Boolean(academicYear?.id) &&
        Boolean(studentId),
    },
  );
  const recentPayments = useMemo(
    () => [...(payments.data ?? [])].reverse().slice(0, 5),
    [payments.data],
  );

  const today = todayIso();
  const yearBalance = row?.totals.balanceAmount ?? "0.00";
  const openingBalance = row?.openingBalance.balance ?? "0.00";
  const outstanding = sumMoney([yearBalance, openingBalance]);
  const settled = !isPositiveMoney(outstanding);
  const percent = row
    ? paidPercent(row.totals.paidAmount, row.totals.netAmount)
    : 0;

  const title =
    (typeof params.studentName === "string" ? params.studentName : null) ??
    row?.studentName ??
    (student.data
      ? [student.data.firstName, student.data.middleName, student.data.lastName]
          .filter(Boolean)
          .join(" ")
      : copy.fees.desk.title);

  const classLine = row
    ? [
        row.className,
        row.sectionName,
        row.rollNumber ? `Roll ${row.rollNumber}` : null,
        row.admissionNumber,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const onDone = (
    message: string,
    tone: "positive" | "caution" = "positive",
  ) => {
    setNotice({ message, tone });
    setSheet(null);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const refreshAll = () => {
    void matrix.refetch();
    void assignmentQuery.refetch();
    void dues.refetch();
    void payments.refetch();
  };

  const frame = (children: ReactNode, footerSlot?: ReactNode) => (
    <ScreenFrame
      title={title}
      meta={classLine ?? copy.fees.desk.title}
      backAccessibilityLabel={copy.common.back}
      onRefresh={canReadMatrix ? refreshAll : undefined}
      refreshing={
        matrix.isRefetching ||
        assignmentQuery.isRefetching ||
        dues.isRefetching ||
        payments.isRefetching
      }
      footer={footerSlot}
      titleTestID="fee-desk-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canReadDesk) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.fees.noAccessTitle}
        message={copy.fees.noAccessBody}
        testID="fee-desk-no-access"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletonWrap}>
        <Skeleton height={150} />
        <Skeleton height={84} />
        <Skeleton height={220} />
      </View>,
    );
  }

  if (!organizationId || !schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-desk-no-branch"
      />,
    );
  }

  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.fees.noYearTitle}
        message={copy.fees.noYearBody}
        testID="fee-desk-no-year"
      />,
    );
  }

  if (!canReadMatrix) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.noReportTitle}
        message={copy.fees.noReportBody}
        testID="fee-desk-no-report"
      >
        {canReadPayments ? (
          <CapsuleButton
            title={copy.fees.openPayments}
            variant="secondary"
            size="compact"
            onPress={() => router.push("/fees/payments")}
            testID="fee-desk-open-payments"
          />
        ) : null}
      </EmptyState>,
    );
  }

  if (student.isError) {
    return frame(
      <ErrorCard
        cause={student.error}
        onRetry={() => void student.refetch()}
        testID="fee-desk-student-error"
      />,
    );
  }

  if (matrix.isError) {
    return frame(
      <ErrorCard
        cause={matrix.error}
        onRetry={() => void matrix.refetch()}
        testID="fee-desk-error"
      />,
    );
  }

  if ((matrix.isPending && !matrix.data) || !row) {
    if (matrix.data && !row) {
      return frame(
        <EmptyState
          icon="search"
          title={copy.fees.desk.missingTitle}
          message={copy.fees.desk.missingBody}
          testID="fee-desk-missing"
        />,
      );
    }
    return frame(
      <View style={styles.skeletonWrap}>
        <Skeleton height={150} />
        <Skeleton height={84} />
        <Skeleton height={220} />
      </View>,
    );
  }

  const assigned =
    Boolean(row.assignmentId) || row.assignmentState !== "unassigned";
  const generated = row.generationState === "generated";
  const opening = row.openingBalance;

  const statusPill =
    row.assignmentState === "unassigned" ? (
      <StatusPill
        label={copy.fees.desk.unassignedPill}
        tone="neutral"
        testID="fee-desk-status"
      />
    ) : row.assignmentState === "cancelled" ? (
      <StatusPill
        label={ASSIGNMENT_STATUS_LABEL.cancelled ?? "Cancelled"}
        tone="critical"
        testID="fee-desk-status"
      />
    ) : row.assignmentState === "suspended" ? (
      <StatusPill
        label={ASSIGNMENT_STATUS_LABEL.suspended ?? "Suspended"}
        tone="caution"
        testID="fee-desk-status"
      />
    ) : !generated ? (
      <StatusPill
        label={copy.fees.desk.notGeneratedPill}
        tone="caution"
        testID="fee-desk-status"
      />
    ) : settled ? (
      <StatusPill
        label={copy.fees.desk.settledPill}
        tone="positive"
        testID="fee-desk-status"
      />
    ) : (
      <MatrixStatusPill
        paymentState={row.paymentState}
        timingState={row.timingState}
        testID="fee-desk-status"
      />
    );

  return frame(
    <View style={styles.body}>
      {notice ? (
        <Notice
          tone={notice.tone}
          message={notice.message}
          testID="fee-desk-notice"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.common.dismiss}
            onPress={() => setNotice(null)}
            style={styles.dismiss}
            testID="fee-desk-notice-dismiss"
          >
            <ThemedText variant="meta" color={colors.accentDeep}>
              {copy.common.dismiss}
            </ThemedText>
          </Pressable>
        </Notice>
      ) : null}

      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroText}>
            <ThemedText variant="sectionLabel">
              {copy.fees.desk.balanceLabel}
            </ThemedText>
            <ThemedText
              variant="hero"
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
              testID="fee-desk-outstanding"
            >
              {formatMoney(outstanding)}
            </ThemedText>
            <ThemedText variant="meta">
              {copy.fees.desk.thisSession(formatMoney(yearBalance))}
            </ThemedText>
            {isPositiveMoney(openingBalance) ? (
              <ThemedText variant="meta">
                {copy.fees.desk.includesOpening(formatMoney(openingBalance))}
              </ThemedText>
            ) : null}
          </View>
          {statusPill}
        </View>

        <View style={styles.facts}>
          <ThemedText variant="meta">
            {copy.fees.desk.assessedLabel} {formatMoney(row.totals.netAmount)}
          </ThemedText>
          <ThemedText variant="meta">
            {copy.fees.desk.paidLabel} {formatMoney(row.totals.paidAmount)}
          </ThemedText>
          {isPositiveMoney(row.totals.concessionAmount) ? (
            <ThemedText variant="meta">
              {copy.fees.desk.concessionLabel}{" "}
              {formatMoney(row.totals.concessionAmount)}
            </ThemedText>
          ) : null}
        </View>

        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          accessibilityLabel={copy.fees.desk.progress(percent)}
        >
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
        <ThemedText variant="meta">
          {copy.fees.desk.progress(percent)}
        </ThemedText>
      </Card>

      {isPositiveMoney(opening.amount) ? (
        <Card style={styles.opening}>
          <SectionHead
            title={copy.fees.desk.openingTitle}
            hint={copy.fees.desk.openingOrigins(opening.originCount)}
          />
          <ThemedText variant="bodyStrong" numberOfLines={2}>
            {copy.fees.desk.openingBody(
              formatMoney(opening.amount),
              formatMoney(opening.balance),
            )}
          </ThemedText>
          <View style={styles.facts}>
            <ThemedText variant="meta">
              {copy.fees.desk.openingPaid(
                formatMoney(opening.paid),
                formatMoney(opening.amount),
              )}
            </ThemedText>
            <ThemedText variant="meta">
              {copy.fees.desk.openingIncluded}
            </ThemedText>
          </View>
          <InstallmentStatusPill
            status={opening.status}
            testID="fee-desk-opening-status"
          />
        </Card>
      ) : null}

      {canReadAssignment ? (
        <Card style={styles.actions}>
          <SectionHead
            title={copy.fees.desk.actionsTitle}
            hint={copy.fees.desk.actionsHint}
          />

          {assignmentQuery.isError ? (
            <Notice
              tone="critical"
              message={copy.fees.desk.assignmentLoadError}
              testID="fee-desk-assignment-error"
            >
              <CapsuleButton
                title={copy.common.retry}
                variant="secondary"
                size="mini"
                onPress={() => void assignmentQuery.refetch()}
                testID="fee-desk-assignment-retry"
              />
            </Notice>
          ) : assignmentQuery.isPending ? (
            <Skeleton height={96} />
          ) : !assigned ? (
            <>
              <ThemedText variant="bodyStrong">
                {copy.fees.desk.notAssignedTitle}
              </ThemedText>
              <ThemedText variant="meta">
                {copy.fees.desk.notAssignedBody}
              </ThemedText>
              {canAssign && canReadStructure ? (
                <>
                  {enrollments.isError || structures.isError ? (
                    <Notice
                      tone="critical"
                      message={
                        enrollments.isError
                          ? copy.fees.desk.enrollmentLoadError
                          : copy.fees.desk.structureLoadError
                      }
                      testID="fee-desk-assign-load-error"
                    >
                      <CapsuleButton
                        title={copy.common.retry}
                        variant="secondary"
                        size="mini"
                        onPress={() => {
                          void enrollments.refetch();
                          void structures.refetch();
                        }}
                        testID="fee-desk-assign-load-retry"
                      />
                    </Notice>
                  ) : null}
                  <CapsuleButton
                    title={copy.fees.desk.assignAction}
                    icon="check"
                    variant="primary"
                    size="compact"
                    disabled={enrollments.isPending || structures.isPending}
                    loading={enrollments.isPending || structures.isPending}
                    onPress={() => setSheet({ kind: "assign" })}
                    testID="fee-desk-assign"
                  />
                </>
              ) : null}
            </>
          ) : !assignment ? (
            <Notice
              tone="caution"
              message={copy.fees.desk.assignmentLoadError}
              testID="fee-desk-assignment-missing"
            >
              <CapsuleButton
                title={copy.common.retry}
                variant="secondary"
                size="mini"
                onPress={() => void assignmentQuery.refetch()}
                testID="fee-desk-assignment-missing-retry"
              />
            </Notice>
          ) : (
            <>
              <ThemedText variant="bodyStrong" numberOfLines={2}>
                {assignedStructureName ?? copy.fees.desk.assignmentTitle}
              </ThemedText>
              <View style={styles.facts}>
                <ThemedText variant="meta">
                  {copy.fees.desk.assignmentEffective(
                    formatReadableDate(assignment.feeEffectiveFrom),
                  )}
                </ThemedText>
                <ThemedText variant="meta">
                  {copy.fees.desk.assignmentBaseAnnual(
                    formatMoney(assignment.baseAnnualAmount),
                  )}
                </ThemedText>
                <ThemedText variant="meta">
                  {copy.fees.desk.assignmentNetAnnual(
                    formatMoney(assignment.netAnnualAmount),
                  )}
                </ThemedText>
              </View>
              <FactChip
                label={
                  ASSIGNMENT_STATUS_LABEL[assignment.status] ??
                  assignment.status
                }
                tone={assignment.status === "active" ? "positive" : "caution"}
              />

              {!generated ? (
                <>
                  <Notice
                    tone="caution"
                    message={copy.fees.desk.notGeneratedHint}
                    testID="fee-desk-not-generated"
                  />
                  {canUpdateAssignment ? (
                    <CapsuleButton
                      title={copy.fees.desk.generateAction}
                      icon="check"
                      variant="primary"
                      size="compact"
                      onPress={() =>
                        setSheet({
                          kind: "generate",
                          assignmentId: assignment.id,
                        })
                      }
                      testID="fee-desk-generate"
                    />
                  ) : null}
                </>
              ) : (
                <View style={styles.actionRow}>
                  {canCreateConcession ? (
                    <CapsuleButton
                      title={copy.fees.desk.concessionAction}
                      icon="fees"
                      variant="secondary"
                      size="compact"
                      onPress={() =>
                        setSheet({
                          kind: "concession",
                          assignmentId: assignment.id,
                        })
                      }
                      testID="fee-desk-concession"
                    />
                  ) : null}
                  {canUpdateAssignment &&
                  isPositiveMoney(row.totals.concessionAmount) ? (
                    <CapsuleButton
                      title={copy.fees.desk.recomputeAction}
                      icon="receipt"
                      variant="secondary"
                      size="compact"
                      onPress={() =>
                        setSheet({
                          kind: "recompute",
                          assignmentId: assignment.id,
                        })
                      }
                      testID="fee-desk-recompute"
                    />
                  ) : null}
                </View>
              )}
              {generated &&
              canUpdateAssignment &&
              isPositiveMoney(row.totals.concessionAmount) ? (
                <ThemedText variant="meta">
                  {copy.fees.desk.recomputeHint}
                </ThemedText>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {matrix.data && row.cells.length > 0 ? (
        <View style={styles.months}>
          <SectionHead
            title={copy.fees.desk.monthsTitle}
            hint={copy.fees.desk.monthsHint}
          />
          <MonthStrip
            months={matrix.data.months}
            cells={row.cells}
            onSelect={(month, label) =>
              setSheet({ kind: "month", month, label })
            }
          />
        </View>
      ) : null}

      {canReadAssignment ? (
        <>
          <SectionHead
            title={copy.fees.desk.outstandingTitle}
            hint={copy.fees.desk.installmentsOpen(openTotals.count)}
          />
          {dues.isPending ? (
            <Skeleton height={160} />
          ) : dues.isError ? (
            <ErrorCard
              cause={dues.error}
              onRetry={() => void dues.refetch()}
              testID="fee-desk-dues-error"
            />
          ) : installments.length === 0 ? (
            <EmptyState
              icon={generated ? "check" : "fees"}
              title={
                generated
                  ? copy.fees.desk.nothingTitle
                  : copy.fees.desk.noInstallmentsTitle
              }
              message={
                generated
                  ? copy.fees.desk.nothingBody
                  : copy.fees.desk.noInstallmentsBody
              }
              testID="fee-desk-installments-empty"
            />
          ) : (
            <Card padless>
              {installments.map((installment, index) => (
                <InstallmentRow
                  key={installment.id}
                  installment={installment}
                  today={today}
                  can={has}
                  onWaive={
                    canWaiveInstallment(installment, has)
                      ? () =>
                          setSheet({
                            kind: "waive",
                            installment: {
                              id: installment.id,
                              title: installmentTitle(installment),
                            },
                          })
                      : undefined
                  }
                  first={index === 0}
                />
              ))}
            </Card>
          )}
        </>
      ) : null}

      {canReadPayments ? (
        <>
          <SectionHead
            title={copy.fees.desk.paymentHistoryTitle}
            hint={
              payments.data
                ? copy.fees.desk.paymentHistoryCount(payments.data.length)
                : undefined
            }
          />
          {payments.isPending ? (
            <Skeleton height={140} />
          ) : payments.isError ? (
            <ErrorCard
              cause={payments.error}
              onRetry={() => void payments.refetch()}
              testID="fee-desk-payments-error"
            />
          ) : recentPayments.length === 0 ? (
            <ThemedText variant="meta" style={styles.paymentEmpty}>
              {copy.fees.desk.paymentHistoryEmpty}
            </ThemedText>
          ) : (
            <Card padless>
              {recentPayments.map((payment, index) => (
                <PaymentRow
                  key={payment.id}
                  payment={payment}
                  first={index === 0}
                  onPress={() =>
                    router.push({
                      pathname: "/fees/payments/[paymentId]",
                      params: { paymentId: payment.id },
                    })
                  }
                />
              ))}
            </Card>
          )}
        </>
      ) : null}

      {canReadMatrix ? (
        <CapsuleButton
          title={copy.fees.desk.ledgerLink}
          icon="ledger"
          variant="secondary"
          size="compact"
          onPress={() =>
            router.push({
              pathname: "/fees/ledger",
              params: { studentId, studentName: title },
            })
          }
          testID="fee-desk-open-ledger"
        />
      ) : null}

      {sheet?.kind === "assign" ? (
        <AssignSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId ?? ""}
          enrollmentId={enrollment?.id ?? null}
          className={row.className}
          structure={
            classStructure
              ? {
                  id: classStructure.id,
                  name: classStructure.name,
                  installmentMode: classStructure.installmentMode,
                }
              : null
          }
          effectiveFrom={enrollment?.enrollmentDate ?? null}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}

      {sheet?.kind === "generate" ? (
        <GenerateSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId ?? ""}
          assignmentId={sheet.assignmentId}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}

      {sheet?.kind === "recompute" ? (
        <RecomputeSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId ?? ""}
          assignmentId={sheet.assignmentId}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}

      {sheet?.kind === "concession" ? (
        <ConcessionSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId ?? ""}
          assignmentId={sheet.assignmentId}
          academicYearStart={academicYear.startDate}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}

      {sheet?.kind === "waive" ? (
        <WaiveSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId ?? ""}
          installment={sheet.installment}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}

      {sheet?.kind === "month" ? (
        <MonthSheet
          organizationId={organizationId ?? ""}
          studentId={studentId}
          academicYearId={academicYear.id}
          month={sheet.month}
          label={sheet.label}
          onClose={() => setSheet(null)}
          onWaive={(installment) => setSheet({ kind: "waive", installment })}
        />
      ) : null}
    </View>,
    canCollect && isPositiveMoney(outstanding) ? (
      <CapsuleButton
        title={copy.fees.desk.collectAction}
        icon="collect"
        onPress={() =>
          router.push({
            pathname: "/fees/collect/[studentId]",
            params: {
              studentId,
              studentName: title,
              className: [row.className, row.sectionName]
                .filter(Boolean)
                .join(" · "),
              // Display only: collect explains why this amount is not in its
              // total (there is no write that pays an opening balance).
              carriedForward: isPositiveMoney(openingBalance)
                ? openingBalance
                : "",
            },
          })
        }
        testID="fee-desk-collect"
      />
    ) : undefined,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeletonWrap: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  dismiss: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  hero: {
    gap: spacing.xs,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  heroText: {
    flex: 1,
    gap: spacing.xxs,
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  track: {
    height: 8,
    marginTop: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  opening: {
    gap: spacing.xs,
  },
  actions: {
    gap: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  months: {
    gap: spacing.xs,
  },
  paymentEmpty: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
});
