import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Share, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import {
  buildReceiptText,
  PAYMENT_STATUS_NOTE,
  paymentModeLabel,
} from "../../lib/fees";
import type { PaymentStatus, ReceiptLine } from "../../lib/fees";
import { recallInstallmentLabel } from "../../lib/fees-receipt-cache";
import { formatReadableDate } from "../../lib/format";
import { formatMoney, parseMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { PaymentStatusPill, SectionHead } from "./status";

/**
 * The receipt (Step 5B).
 *
 * Everything printed here is server truth: the receipt number, the amount, the
 * late fee frozen at collection time, the status. The only client-supplied
 * values are the student's name and class, carried in the route from the desk
 * because `payment.detail` does not join them (documented gap).
 *
 * There is no PDF endpoint. A parent who wants the receipt on WhatsApp gets
 * this screen's text through the system share sheet — a receipt number the
 * server issued, never one composed here.
 */
export function ReceiptScreen() {
  const params = useLocalSearchParams<{
    paymentId?: string;
    studentId?: string;
    studentName?: string;
    className?: string;
  }>();
  const { organizationId, schoolId, ready, yearPending } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const paymentId = params.paymentId ?? "";
  const canRead = has("fee_payment:read");

  const [shareError, setShareError] = useState<unknown>(null);

  const detail = trpc.fees.payment.detail.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
      id: paymentId,
    },
    {
      enabled:
        ready &&
        canRead &&
        Boolean(organizationId) &&
        Boolean(schoolId) &&
        Boolean(paymentId),
    },
  );

  const payment = detail.data?.payment ?? null;
  const allocations = useMemo(
    () => detail.data?.allocations ?? [],
    [detail.data?.allocations],
  );

  const student = trpc.student.byId.useQuery(
    { organizationId: organizationId ?? "", id: payment?.studentId ?? "" },
    {
      enabled:
        ready &&
        Boolean(organizationId) &&
        Boolean(payment?.studentId) &&
        !params.studentName,
    },
  );

  const studentName =
    (typeof params.studentName === "string" && params.studentName.length > 0
      ? params.studentName
      : null) ??
    (student.data
      ? [student.data.firstName, student.data.middleName, student.data.lastName]
          .filter(Boolean)
          .join(" ")
      : copy.fees.collect.studentFallback);

  const classLine =
    typeof params.className === "string" && params.className.length > 0
      ? params.className
      : null;

  const lines: ReceiptLine[] = useMemo(() => {
    if (!payment) return [];
    return allocations.map((allocation) => ({
      label:
        recallInstallmentLabel(allocation.installmentId) ??
        copy.fees.receipt.lineFallback(allocation.installmentId),
      amount: allocation.amountAllocated,
    }));
  }, [payment, allocations]);

  const total = payment?.totalAmount ?? null;
  const lateFee = payment?.lateFeeAmount ?? "0.00";
  const hasLateFee = (parseMoney(lateFee) ?? 0n) > 0n;

  const share = async () => {
    if (!payment) return;
    setShareError(null);
    try {
      await Share.share({
        title: copy.fees.receipt.shareTitle,
        message: buildReceiptText({
          schoolName: branchName ?? copy.fees.receipt.schoolFallback,
          receiptNumber: payment.receiptNumber,
          paymentDate: payment.paymentDate,
          studentName,
          className: classLine ?? "—",
          lines,
          amount: payment.amount,
          lateFee,
          total: total ?? payment.amount,
          modeLabel: paymentModeLabel(payment.paymentMode),
          reference: payment.transactionReference,
          status: payment.paymentStatus,
        }),
      });
    } catch (cause) {
      setShareError(cause);
    }
  };

  const frame = (children: ReactNode, footerSlot?: ReactNode) => (
    <ScreenFrame
      title={copy.fees.receipt.title}
      meta={payment ? payment.receiptNumber : null}
      backAccessibilityLabel={copy.common.back}
      onRefresh={canRead ? () => void detail.refetch() : undefined}
      refreshing={detail.isRefetching}
      footer={footerSlot}
      titleTestID="fee-receipt-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.noAccessTitle}
        message={copy.fees.noAccessBody}
        testID="fee-receipt-denied"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={180} />
        <Skeleton height={140} />
      </View>,
    );
  }

  if (!organizationId || !schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-receipt-no-context"
      />,
    );
  }

  if (!paymentId) {
    return frame(
      <EmptyState
        icon="receipt"
        title={copy.fees.receipt.notFoundTitle}
        message={copy.fees.receipt.notFoundBody}
        testID="fee-receipt-missing"
      />,
    );
  }

  if (detail.isError) {
    return frame(
      <ErrorCard
        cause={detail.error}
        onRetry={() => void detail.refetch()}
        testID="fee-receipt-error"
      />,
    );
  }

  if (detail.isPending && !payment) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={180} />
        <Skeleton height={140} />
      </View>,
    );
  }

  if (!payment) {
    return frame(
      <EmptyState
        icon="receipt"
        title={copy.fees.receipt.notFoundTitle}
        message={copy.fees.receipt.notFoundBody}
        testID="fee-receipt-not-found"
      />,
    );
  }

  const statusNote =
    PAYMENT_STATUS_NOTE[payment.paymentStatus as PaymentStatus] ?? null;
  const statusTone =
    payment.paymentStatus === "bounced" || payment.paymentStatus === "reversed"
      ? "critical"
      : payment.paymentStatus === "cancelled"
        ? "neutral"
        : "caution";

  return frame(
    <View style={styles.body}>
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroText}>
            <ThemedText variant="sectionLabel">
              {copy.fees.receipt.receiptNumberLabel}
            </ThemedText>
            <ThemedText
              variant="title"
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              testID="fee-receipt-number"
            >
              {payment.receiptNumber}
            </ThemedText>
          </View>
          <PaymentStatusPill
            status={payment.paymentStatus}
            testID="fee-receipt-status"
          />
        </View>

        <View style={styles.heroStudent}>
          <ThemedText variant="name" numberOfLines={2}>
            {studentName}
          </ThemedText>
          {classLine ? (
            <ThemedText variant="meta">{classLine}</ThemedText>
          ) : null}
        </View>

        <View style={styles.heroTotal}>
          <ThemedText variant="sectionLabel">
            {copy.fees.receipt.totalLabel}
          </ThemedText>
          <ThemedText
            variant="hero"
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
            testID="fee-receipt-total"
          >
            {formatMoney(total)}
          </ThemedText>
        </View>

        {statusNote ? (
          <Notice
            tone={statusTone}
            message={statusNote}
            testID="fee-receipt-status-note"
          />
        ) : null}
      </Card>

      <SectionHead title={copy.fees.receipt.linesLabel} />
      <Card padless>
        {lines.length === 0 ? (
          <View style={styles.emptyLines}>
            <ThemedText variant="meta">
              {copy.fees.receipt.amountLabel}
            </ThemedText>
          </View>
        ) : (
          lines.map((line, index) => (
            <View
              key={`${line.label}-${index}`}
              style={[styles.line, index === 0 ? null : styles.divider]}
            >
              <ThemedText
                variant="body"
                numberOfLines={2}
                style={styles.lineLabel}
              >
                {line.label}
              </ThemedText>
              <ThemedText variant="numeric" numberOfLines={1}>
                {formatMoney(line.amount)}
              </ThemedText>
            </View>
          ))
        )}
      </Card>

      <Card style={styles.totals}>
        <View style={styles.totalRow}>
          <ThemedText variant="meta">
            {copy.fees.receipt.amountLabel}
          </ThemedText>
          <ThemedText variant="bodyStrong">
            {formatMoney(payment.amount)}
          </ThemedText>
        </View>
        {hasLateFee ? (
          <View style={styles.totalRow}>
            <ThemedText variant="meta">
              {copy.fees.receipt.lateFeeLabel}
            </ThemedText>
            <ThemedText variant="bodyStrong">{formatMoney(lateFee)}</ThemedText>
          </View>
        ) : null}
        <View style={[styles.totalRow, styles.grandTotal]}>
          <ThemedText variant="bodyStrong">
            {copy.fees.receipt.totalLabel}
          </ThemedText>
          <ThemedText variant="title">{formatMoney(total)}</ThemedText>
        </View>
      </Card>

      <SectionHead title={copy.fees.receipt.modeLabel} />
      <Card style={styles.facts}>
        <Fact
          label={copy.fees.receipt.modeLabel}
          value={paymentModeLabel(payment.paymentMode)}
        />
        <Fact
          label={copy.fees.receipt.dateLabel}
          value={formatReadableDate(payment.paymentDate)}
        />
        {payment.transactionReference ? (
          <Fact
            label={copy.fees.receipt.referenceLabel}
            value={payment.transactionReference}
          />
        ) : null}
        {payment.bankName ? (
          <Fact label={copy.fees.collect.bankLabel} value={payment.bankName} />
        ) : null}
        {payment.chequeDate ? (
          <Fact
            label={copy.fees.collect.chequeDateLabel}
            value={formatReadableDate(payment.chequeDate)}
          />
        ) : null}
        {payment.remarks ? (
          <Fact
            label={copy.fees.collect.remarksLabel}
            value={payment.remarks}
          />
        ) : null}
      </Card>

      <ThemedText variant="caption" style={styles.serverNote}>
        {copy.fees.receipt.serverIssued}
      </ThemedText>

      {shareError ? (
        <Notice
          tone="critical"
          message={copy.fees.receipt.shareError}
          testID="fee-receipt-share-error"
        />
      ) : null}
    </View>,
    <View style={styles.footerRow}>
      <CapsuleButton
        title={copy.fees.receipt.share}
        icon="share"
        variant="secondary"
        size="compact"
        onPress={() => void share()}
        style={styles.footerButton}
        testID="fee-receipt-share"
      />
      <CapsuleButton
        title={copy.fees.receipt.done}
        size="compact"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/fees");
        }}
        style={styles.footerButton}
        testID="fee-receipt-done"
      />
    </View>,
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <ThemedText variant="meta" style={styles.factLabel}>
        {label}
      </ThemedText>
      <ThemedText variant="body" style={styles.factValue}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  skeletons: {
    gap: spacing.md,
  },
  hero: {
    gap: spacing.md,
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
  heroStudent: {
    gap: spacing.xxs,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  heroTotal: {
    gap: spacing.xxs,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  lineLabel: {
    flex: 1,
  },
  emptyLines: {
    padding: spacing.lg,
  },
  totals: {
    gap: spacing.sm,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  grandTotal: {
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  facts: {
    gap: spacing.sm,
  },
  fact: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  factLabel: {
    flexShrink: 0,
  },
  factValue: {
    flex: 1,
    textAlign: "right",
  },
  serverNote: {
    paddingHorizontal: spacing.xs,
  },
  footerRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  footerButton: {
    flex: 1,
  },
});
