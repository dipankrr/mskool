import { useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { LinkRow } from "../../components/link-row";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useSessionOpen } from "../../hooks/use-session-open";
import { copy } from "../../lib/copy";
import { CONCESSION_TYPE_LABEL, installmentTitle } from "../../lib/fees";
import { feesCopy } from "../../lib/fees-copy";
import { formatReadableDate } from "../../lib/format";
import { formatMoney, isPositiveMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ConcessionSheet } from "./concession-sheet";
import {
  AssignSheet,
  OneOffSheet,
  StatusSheet,
  VoidConcessionSheet,
  DueSheet,
} from "./desk-actions";
import { MonthSheet } from "./month-sheet";
import { PaymentRow } from "./payment-row";
import { PrintSheet } from "./print-sheet";
import { SectionHead } from "./status";

type DeskSheet =
  | { kind: "assign" }
  | { kind: "concession"; assignmentId: string }
  | { kind: "one-off" }
  | { kind: "status"; assignmentId: string; next: "active" | "suspended" }
  | { kind: "void"; concessionId: string; label: string }
  | { kind: "due"; due: { id: string; title: string; net: string; paid: string; dueDate: string; status: string } }
  | { kind: "month"; month: string; label: string };

type DeskNotice = { message: string; tone: "positive" | "caution" };

const MONTH_TONE = {
  overdue: colors.tone.critical.fg,
  due: colors.tone.caution.fg,
  upcoming: colors.tone.neutral.fg,
  paid: colors.tone.positive.fg,
  none: colors.grabber,
} as const;

/**
 * One student's fee page, from one read. What matters comes first: what they
 * owe now and Collect. Then the months, then past payments. The individual dues
 * and the rarer actions sit a tap further in, so a stray tap can't waive a fee
 * and the page doesn't open on two dozen rows.
 */
export function StudentFeeDeskScreen() {
  const params = useLocalSearchParams<{
    studentId?: string;
    studentName?: string;
  }>();
  const { organizationId, schoolId, academicYear, yearPending, ready } =
    useActiveContext();
  const { has, hasAny } = usePermissions();
  const sessionOpen = useSessionOpen();
  const words = feesCopy.student;

  const studentId = params.studentId ?? "";
  const canRead = hasAny("fee_report:read", "student_fee_assignment:read");
  const canCollect = has("fee_payment:create") && sessionOpen;
  const canBill = has("student_fee_assignment:create") && sessionOpen;
  const canManage = has("student_fee_assignment:update") && sessionOpen;
  const canConcession = has("fee_waiver:create") && sessionOpen;
  const canReadPayments = has("fee_payment:read");

  const [sheet, setSheet] = useState<DeskSheet | null>(null);
  const [notice, setNotice] = useState<DeskNotice | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [printing, setPrinting] = useState<"statement" | "noDues" | null>(null);
  const canPrint = has("fee_report:read");
  const utils = trpc.useUtils();

  const summary = trpc.fees.dashboard.student.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      studentId,
    },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(academicYear?.id) && Boolean(studentId),
    },
  );

  const data = summary.data;
  const title =
    data?.student.name ??
    (typeof params.studentName === "string" ? params.studentName : copy.fees.desk.title);
  const classLine = data
    ? [
        data.student.className,
        data.student.sectionName,
        data.student.rollNumber ? `Roll ${data.student.rollNumber}` : null,
        data.student.admissionNumber,
      ]
        .filter(Boolean)
        .join(" · ")
    : copy.fees.desk.title;

  const onDone = (message: string, tone: "positive" | "caution" = "positive") => {
    setNotice({ message, tone });
    setSheet(null);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const hasDues = Boolean(data && data.dues.length + data.previousDues.length > 0);

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <ScreenFrame
      title={title}
      meta={classLine}
      backAccessibilityLabel={copy.common.back}
      onRefresh={canRead ? () => void summary.refetch() : undefined}
      refreshing={summary.isRefetching}
      footer={footer}
      titleTestID="fee-desk-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.fees.noAccessTitle}
        message={copy.fees.noAccessBody}
        testID="fee-desk-no-access"
      />,
    );
  }
  if (!ready || yearPending || (summary.isPending && !data && !summary.isError)) {
    return frame(
      <View style={styles.body}>
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
  if (summary.isError || !data) {
    return frame(
      <ErrorCard
        cause={summary.error}
        onRetry={() => void summary.refetch()}
        testID="fee-desk-error"
      />,
    );
  }

  const record = data.feeRecord;
  const { totals } = data;

  return frame(
    <View style={styles.body}>
      {!sessionOpen ? (
        <Notice tone="caution" message={copy.fees.sessionClosed} testID="fees-session-closed" />
      ) : null}
      {notice ? (
        <Notice tone={notice.tone} message={notice.message} testID="fee-desk-notice">
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
          <ThemedText variant="sectionLabel">{words.dueNow}</ThemedText>
          {record && record.status !== "active" ? (
            <StatusPill
              label={words.recordStatus[record.status as "suspended" | "cancelled"] ?? record.status}
              tone="caution"
              testID="fee-desk-status"
            />
          ) : null}
        </View>
        <ThemedText
          variant="hero"
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
          testID="fee-desk-due-now"
        >
          {formatMoney(totals.dueNow)}
        </ThemedText>
        <Fact label={words.thisMonth} value={formatMoney(totals.thisMonth)} />
        <Fact
          label={words.overdue}
          value={formatMoney(totals.overdue)}
          critical={isPositiveMoney(totals.overdue)}
        />
        {isPositiveMoney(totals.previousDues) ? (
          <Fact label={words.previous} value={formatMoney(totals.previousDues)} />
        ) : null}
        {isPositiveMoney(totals.later) ? (
          <Fact label={words.later} value={formatMoney(totals.later)} />
        ) : null}
        <Fact label={words.paid} value={formatMoney(totals.paid)} />
        {isPositiveMoney(totals.concession) ? (
          <Fact label={words.concession} value={formatMoney(totals.concession)} />
        ) : null}
      </Card>

      {!record ? (
        <Card style={styles.actions}>
          <ThemedText variant="bodyStrong">{copy.fees.desk.notAssignedTitle}</ThemedText>
          <ThemedText variant="meta">{copy.fees.desk.notAssignedBody}</ThemedText>
          {canBill ? (
            <CapsuleButton
              title={copy.fees.desk.assignAction}
              icon="check"
              variant="primary"
              size="compact"
              onPress={() => setSheet({ kind: "assign" })}
              testID="fee-desk-assign"
            />
          ) : null}
        </Card>
      ) : null}

      {data.months.some((month) => month.state !== "none") ? (
        <View style={styles.months}>
          <SectionHead title={copy.fees.desk.monthsTitle} hint={copy.fees.desk.monthsHint} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.monthRow}
            accessibilityLabel={copy.fees.desk.monthsTitle}
          >
            {data.months.map((month) => (
              <Pressable
                key={month.month}
                accessibilityRole="button"
                accessibilityLabel={`${month.label}. ${isPositiveMoney(month.balance) ? `${formatMoney(month.balance)} open` : words.monthState[month.state]}`}
                onPress={() =>
                  setSheet({ kind: "month", month: month.month, label: month.label })
                }
                style={({ pressed }) => [styles.month, pressed ? styles.monthPressed : null]}
                testID={`fee-month-${month.month}`}
              >
                <ThemedText variant="caption" numberOfLines={1}>
                  {month.label}
                </ThemedText>
                <View style={[styles.monthDot, { backgroundColor: MONTH_TONE[month.state] }]} />
                <ThemedText variant="meta" numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {isPositiveMoney(month.balance) ? formatMoney(month.balance) : "—"}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {canReadPayments ? (
        <>
          <SectionHead title={copy.fees.desk.paymentHistoryTitle} />
          {data.recentPayments.length === 0 ? (
            <ThemedText variant="meta" style={styles.paymentEmpty}>
              {copy.fees.desk.paymentHistoryEmpty}
            </ThemedText>
          ) : (
            <Card padless>
              {data.recentPayments.map((payment, index) => (
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

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        accessibilityLabel={words.more}
        onPress={() => setMoreOpen((value) => !value)}
        style={styles.moreToggle}
        testID="fee-desk-more"
      >
        <ThemedText variant="bodyStrong">{words.more}</ThemedText>
        <AppIcon
          name={moreOpen ? "chevronUp" : "chevronDown"}
          size={20}
          color={colors.muted}
        />
      </Pressable>

      {moreOpen ? (
        <View style={styles.more}>
          {data.dues.length > 0 ? (
            <>
              <SectionHead title={words.allDues} hint={words.tapDue} />
              <Card padless>
                {data.dues.map((due, index) => (
                  <LinkRow
                    key={due.id}
                    first={index === 0}
                    title={installmentTitle(due)}
                    detail={
                      due.paymentStatus === "waived"
                        ? words.waivedLine
                        : `${formatMoney(due.balanceAmount)} · ${words.dueOn(formatReadableDate(due.dueDate))}`
                    }
                    onPress={() =>
                      setSheet({
                        kind: "due",
                        due: {
                          id: due.id,
                          title: installmentTitle(due),
                          net: due.netAmount,
                          paid: due.paidAmount,
                          dueDate: due.dueDate,
                          status: due.paymentStatus,
                        },
                      })
                    }
                    testID={`fee-due-${due.id}`}
                  />
                ))}
              </Card>
            </>
          ) : null}

          {data.concessions.length > 0 ? (
            <>
              <SectionHead title={words.concessions} />
              <Card padless>
                {data.concessions.map((concession, index) => {
                  const label =
                    CONCESSION_TYPE_LABEL[
                      concession.concessionType as keyof typeof CONCESSION_TYPE_LABEL
                    ] ?? concession.concessionType;
                  return (
                    <LinkRow
                      key={concession.id}
                      first={index === 0}
                      title={label}
                      detail={formatMoney(concession.concessionAmount)}
                      onPress={() => {
                        if (!canConcession) return;
                        setSheet({
                          kind: "void",
                          concessionId: concession.id,
                          label,
                        });
                      }}
                      testID={`fee-concession-${concession.id}`}
                    />
                  );
                })}
              </Card>
            </>
          ) : null}

          <SectionHead title={words.actions} />
          <Card padless>
            {record && canConcession ? (
              <LinkRow
                first
                icon="fees"
                title={copy.fees.desk.concessionAction}
                detail={words.concessionHint}
                onPress={() => setSheet({ kind: "concession", assignmentId: record.id })}
                testID="fee-desk-concession"
              />
            ) : null}
            {canManage ? (
              <LinkRow
                first={!record || !canConcession}
                icon="add"
                title={words.oneOffAction}
                detail={words.oneOffHint}
                onPress={() => setSheet({ kind: "one-off" })}
                testID="fee-desk-one-off"
              />
            ) : null}
            {record && canManage && record.status !== "cancelled" ? (
              <LinkRow
                first={false}
                icon="clock"
                title={record.status === "active" ? words.suspendAction : words.restoreAction}
                detail={record.status === "active" ? words.suspendHint : words.restoreHint}
                onPress={() =>
                  setSheet({
                    kind: "status",
                    assignmentId: record.id,
                    next: record.status === "active" ? "suspended" : "active",
                  })
                }
                testID="fee-desk-status-action"
              />
            ) : null}
            {canPrint ? (
              <>
                <LinkRow
                  first={!canManage && !(record && canConcession)}
                  icon="print"
                  title={feesCopy.print.statementAction}
                  detail={feesCopy.print.statementHint}
                  onPress={() => setPrinting("statement")}
                  testID="fee-desk-print-statement"
                />
                <LinkRow
                  first={false}
                  icon="receipt"
                  title={feesCopy.print.noDuesAction}
                  detail={feesCopy.print.noDuesHint}
                  onPress={() => setPrinting("noDues")}
                  testID="fee-desk-print-no-dues"
                />
              </>
            ) : null}
            <LinkRow
              first={!canManage && !(record && canConcession) && !canPrint}
              icon="ledger"
              title={copy.fees.desk.ledgerLink}
              onPress={() =>
                router.push({
                  pathname: "/fees/ledger",
                  params: { studentId, studentName: title },
                })
              }
              testID="fee-desk-open-ledger"
            />
          </Card>
        </View>
      ) : null}

      {printing ? (
        <PrintSheet
          title={printing === "statement" ? feesCopy.print.statementTitle : feesCopy.print.noDuesTitle}
          onClose={() => setPrinting(null)}
          load={() => {
            const input = { organizationId, schoolId, academicYearId: academicYear.id, studentId };
            return printing === "statement"
              ? utils.fees.document.statement.fetch(input, { staleTime: 0 })
              : utils.fees.document.noDues.fetch(input, { staleTime: 0 });
          }}
          testIDPrefix={`fee-desk-print-${printing}`}
        />
      ) : null}
      {sheet?.kind === "assign" ? (
        <AssignSheet
          organizationId={organizationId}
          schoolId={schoolId}
          enrollmentId={data.student.enrollmentId}
          className={data.student.className}
          choices={data.structureChoices}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "concession" ? (
        <ConcessionSheet
          organizationId={organizationId}
          schoolId={schoolId}
          assignmentId={sheet.assignmentId}
          academicYearStart={academicYear.startDate}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "one-off" ? (
        <OneOffSheet
          organizationId={organizationId}
          schoolId={schoolId}
          studentId={studentId}
          academicYearId={academicYear.id}
          studentName={title}
          className={[data.student.className, data.student.sectionName].filter(Boolean).join(" · ")}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "status" ? (
        <StatusSheet
          organizationId={organizationId}
          schoolId={schoolId}
          assignmentId={sheet.assignmentId}
          next={sheet.next}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "void" ? (
        <VoidConcessionSheet
          organizationId={organizationId}
          schoolId={schoolId}
          concessionId={sheet.concessionId}
          label={sheet.label}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "due" ? (
        <DueSheet
          organizationId={organizationId}
          schoolId={schoolId}
          due={sheet.due}
          canManage={canManage}
          onClose={() => setSheet(null)}
          onDone={onDone}
        />
      ) : null}
      {sheet?.kind === "month" ? (
        <MonthSheet
          organizationId={organizationId}
          studentId={studentId}
          academicYearId={academicYear.id}
          month={sheet.month}
          label={sheet.label}
          onClose={() => setSheet(null)}
          onWaive={(installment) =>
            setSheet({
              kind: "due",
              due: {
                id: installment.id,
                title: installment.title,
                net: "0.00",
                paid: "0.00",
                dueDate: "",
                status: "unpaid",
              },
            })
          }
        />
      ) : null}
    </View>,
    canCollect && hasDues ? (
      <CapsuleButton
        title={copy.fees.desk.collectAction}
        icon="collect"
        onPress={() =>
          router.push({
            pathname: "/fees/collect/[studentId]",
            params: {
              studentId,
              studentName: title,
              className: [data.student.className, data.student.sectionName]
                .filter(Boolean)
                .join(" · "),
            },
          })
        }
        testID="fee-desk-collect"
      />
    ) : undefined,
  );
}

function Fact({
  label,
  value,
  critical = false,
}: {
  label: string;
  value: string;
  critical?: boolean;
}) {
  return (
    <View style={styles.fact}>
      <ThemedText variant="meta" color={critical ? colors.tone.critical.fg : undefined}>
        {label}
      </ThemedText>
      <ThemedText
        variant="meta"
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        color={critical ? colors.tone.critical.fg : undefined}
      >
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
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
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  fact: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  actions: {
    gap: spacing.sm,
  },
  months: {
    gap: spacing.xs,
  },
  monthRow: {
    gap: spacing.sm,
  },
  month: {
    minWidth: 68,
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  monthPressed: {
    backgroundColor: colors.field,
  },
  monthDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  paymentEmpty: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  moreToggle: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  more: {
    gap: spacing.md,
  },
});
