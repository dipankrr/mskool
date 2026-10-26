import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { DateField } from "../../components/date-field";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  PAYMENT_STATUS_NOTE,
  paymentActions,
  allocationLabel,
  openingBalanceLabel,
  paymentModeLabel,
  referenceFields,
  REFUND_MODES,
  REFUND_MODE_LABEL,
} from "../../lib/fees";
import type {
  PaymentActionSpec,
  PaymentMode,
  PaymentStatus,
} from "../../lib/fees";
import { formatReadableDate, todayIso } from "../../lib/format";
import {
  formatMoney,
  parseMoney,
  sumMoney,
  toMoneyString,
  sanitizeAmountInput,
  toInputAmount,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { PaymentStatusPill, SectionHead } from "./status";

type SheetState =
  { kind: "transition"; spec: PaymentActionSpec } | { kind: "refund" } | null;

/**
 * One payment, and only the moves that are legal from its status (Step 5C).
 *
 * The action list comes from `paymentActions`, which mirrors the service's
 * transitions AND the caller's grants: the accountant sees Refund on a cleared
 * receipt but never Reverse, because they do not hold `fee_payment:approve`.
 * Each transition asks for a reason because the server requires one; the sheet
 * states the consequence before the act.
 *
 * Prior refunds are not on `payment.detail` (documented gap), so the remaining
 * refundable amount is derived from the ledger's `fee_refund` rows that point
 * at this payment. When that read fails the refund sheet refuses to guess.
 */
export function PaymentDetailScreen() {
  const params = useLocalSearchParams<{ paymentId?: string }>();
  const { organizationId, schoolId, ready, yearPending } = useActiveContext();
  const { has } = usePermissions();

  const paymentId = params.paymentId ?? "";
  const canRead = has("fee_payment:read");
  const canReadLedger = has("fee_report:read");
  const canReadStudent = has("student:read");

  const [sheet, setSheet] = useState<SheetState>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  // One list for the "Applied to" card: carried-forward dues, then
  // installments — both labelled by the server.
  const lines = [
    ...(detail.data?.openingBalanceAllocations ?? []).map((allocation) => ({
      key: allocation.openingBalanceId,
      label: openingBalanceLabel(allocation),
      amount: allocation.amountAllocated,
    })),
    ...(detail.data?.allocations ?? []).map((allocation) => ({
      key: allocation.installmentId,
      label: allocationLabel(allocation),
      amount: allocation.amountAllocated,
    })),
  ];

  const student = trpc.student.byId.useQuery(
    { organizationId: organizationId ?? "", id: payment?.studentId ?? "" },
    {
      enabled:
        ready &&
        canReadStudent &&
        Boolean(organizationId) &&
        Boolean(payment?.studentId),
    },
  );

  const ledger = trpc.fees.ledger.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: payment?.academicYearId ?? "",
      studentId: payment?.studentId,
    },
    {
      enabled:
        ready &&
        canReadLedger &&
        Boolean(organizationId) &&
        Boolean(payment?.academicYearId) &&
        Boolean(payment?.studentId),
    },
  );

  const refunds = useMemo(
    () =>
      (ledger.data ?? []).filter(
        (row) =>
          row.transactionType === "fee_refund" && row.referenceId === paymentId,
      ),
    [ledger.data, paymentId],
  );

  const refunded = useMemo(
    () => sumMoney(refunds.map((row) => row.amount)),
    [refunds],
  );

  const refundable = useMemo(() => {
    if (!payment) return "0.00";
    const amount = parseMoney(payment.amount) ?? 0n;
    const already = parseMoney(refunded) ?? 0n;
    return toMoneyString(amount > already ? amount - already : 0n);
  }, [payment, refunded]);

  const actions = useMemo(
    () => (payment ? paymentActions(payment.paymentStatus, has) : []),
    [payment, has],
  );

  const studentName = student.data
    ? [student.data.firstName, student.data.middleName, student.data.lastName]
        .filter(Boolean)
        .join(" ")
    : copy.fees.collect.studentFallback;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.fees.payment.title}
      meta={payment ? payment.receiptNumber : null}
      backAccessibilityLabel={copy.common.back}
      onRefresh={canRead ? () => void detail.refetch() : undefined}
      refreshing={detail.isRefetching}
      titleTestID="fee-payment-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.payments.deniedTitle}
        message={copy.fees.payments.deniedBody}
        testID="fee-payment-denied"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={190} />
        <Skeleton height={120} />
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
        testID="fee-payment-no-branch"
      />,
    );
  }

  if (!paymentId) {
    return frame(
      <EmptyState
        icon="receipt"
        title={copy.fees.payment.notFoundTitle}
        message={copy.fees.payment.notFoundBody}
        testID="fee-payment-missing"
      />,
    );
  }

  if (detail.isError) {
    return frame(
      <ErrorCard
        cause={detail.error}
        onRetry={() => void detail.refetch()}
        testID="fee-payment-error"
      />,
    );
  }

  if (detail.isPending && !payment) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={190} />
        <Skeleton height={120} />
        <Skeleton height={140} />
      </View>,
    );
  }

  if (!payment) {
    return frame(
      <EmptyState
        icon="receipt"
        title={copy.fees.payment.notFoundTitle}
        message={copy.fees.payment.notFoundBody}
        testID="fee-payment-not-found"
      />,
    );
  }

  const statusNote =
    PAYMENT_STATUS_NOTE[payment.paymentStatus as PaymentStatus] ?? null;
  const hasRefunds =
    parseMoney(refunded) !== null && (parseMoney(refunded) ?? 0n) > 0n;
  const refundSheetEnabled = canReadLedger && !ledger.isError;

  return frame(
    <View style={styles.body}>
      {notice ? (
        <Notice tone="positive" message={notice} testID="fee-payment-notice" />
      ) : null}

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
              testID="fee-payment-receipt-number"
            >
              {payment.receiptNumber}
            </ThemedText>
          </View>
          <PaymentStatusPill
            status={payment.paymentStatus}
            testID="fee-payment-status"
          />
        </View>

        <View style={styles.student}>
          <ThemedText variant="name" numberOfLines={2}>
            {studentName}
          </ThemedText>
          <ThemedText variant="meta">
            {formatReadableDate(payment.paymentDate)} ·{" "}
            {paymentModeLabel(payment.paymentMode)}
          </ThemedText>
        </View>

        <View style={styles.totalLine}>
          <ThemedText variant="sectionLabel">
            {copy.fees.receipt.totalLabel}
          </ThemedText>
          <ThemedText
            variant="hero"
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
            testID="fee-payment-total"
          >
            {formatMoney(payment.totalAmount)}
          </ThemedText>
        </View>

        {statusNote ? (
          <Notice
            tone={
              payment.paymentStatus === "pending"
                ? "caution"
                : payment.paymentStatus === "cancelled"
                  ? "neutral"
                  : "critical"
            }
            message={statusNote}
            testID="fee-payment-status-note"
          />
        ) : null}

        {payment.statusReason ? (
          <View style={styles.statusReason}>
            <ThemedText variant="sectionLabel">
              {copy.fees.payment.statusReasonLabel}
            </ThemedText>
            <ThemedText variant="body">{payment.statusReason}</ThemedText>
          </View>
        ) : null}

        <CapsuleButton
          title={copy.fees.payment.receiptLink}
          icon="receipt"
          variant="secondary"
          size="compact"
          onPress={() =>
            router.push({
              pathname: "/fees/receipt/[paymentId]",
              params: {
                paymentId: payment.id,
                studentId: payment.studentId,
                studentName,
              },
            })
          }
          testID="fee-payment-open-receipt"
        />
      </Card>

      <SectionHead
        title={copy.fees.payment.appliedTitle}
        hint={copy.fees.payment.appliedHint}
      />
      <Card padless>
        {lines.length === 0 ? (
          <View style={styles.emptyRow}>
            <ThemedText variant="meta">
              {copy.fees.payment.noAllocations}
            </ThemedText>
          </View>
        ) : (
          lines.map((line, index) => (
            <View
              key={`${line.key}-${index}`}
              style={[styles.line, index === 0 ? null : styles.divider]}
            >
              <ThemedText
                variant="body"
                numberOfLines={1}
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
        <View style={styles.factRow}>
          <ThemedText variant="meta">
            {copy.fees.receipt.amountLabel}
          </ThemedText>
          <ThemedText variant="bodyStrong">
            {formatMoney(payment.amount)}
          </ThemedText>
        </View>
        <View style={styles.factRow}>
          <ThemedText variant="meta">
            {copy.fees.receipt.lateFeeLabel}
          </ThemedText>
          <ThemedText variant="bodyStrong">
            {formatMoney(payment.lateFeeAmount)}
          </ThemedText>
        </View>
        {hasRefunds ? (
          <View style={styles.factRow}>
            <ThemedText variant="meta">
              {copy.fees.payment.refundsTitle}
            </ThemedText>
            <ThemedText variant="bodyStrong" color={colors.tone.critical.fg}>
              {formatMoney(refunded)}
            </ThemedText>
          </View>
        ) : null}
        <View style={[styles.factRow, styles.grandTotal]}>
          <ThemedText variant="bodyStrong">
            {copy.fees.receipt.totalLabel}
          </ThemedText>
          <ThemedText variant="title">
            {formatMoney(payment.totalAmount)}
          </ThemedText>
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

      {hasRefunds ? (
        <>
          <SectionHead
            title={copy.fees.payment.refundsTitle}
            hint={copy.fees.payment.refundsHint}
          />
          <Card padless>
            {refunds.map((refund, index) => (
              <View
                key={refund.id}
                style={[styles.line, index === 0 ? null : styles.divider]}
              >
                <View style={styles.lineText}>
                  <ThemedText variant="bodyStrong">
                    {formatReadableDate(refund.transactionDate)}
                  </ThemedText>
                  <ThemedText variant="meta" numberOfLines={2}>
                    {refund.description ?? copy.fees.payment.refundsTitle}
                  </ThemedText>
                </View>
                <ThemedText
                  variant="numeric"
                  color={colors.tone.critical.fg}
                  numberOfLines={1}
                >
                  {formatMoney(refund.amount)}
                </ThemedText>
              </View>
            ))}
            <View style={styles.refundFooter}>
              <ThemedText variant="meta">
                {copy.fees.payment.refundedOf(
                  formatMoney(refunded),
                  formatMoney(payment.amount),
                )}
              </ThemedText>
              <ThemedText variant="meta">
                {copy.fees.payment.refundableLabel} {formatMoney(refundable)}
              </ThemedText>
            </View>
          </Card>
        </>
      ) : null}

      <SectionHead
        title={copy.fees.payment.actionsTitle}
        hint={copy.fees.payment.actionsHint}
      />
      {actions.length === 0 ? (
        <Card>
          <ThemedText variant="meta">
            {/* Only a closed payment has no legal move at all; an open one
                with no actions means this login may not make them. */}
            {payment.paymentStatus === "pending" ||
            payment.paymentStatus === "cleared"
              ? payment.paymentStatus === "pending"
                ? copy.fees.payment.noActionsPending
                : copy.fees.payment.noActionsCleared
              : copy.fees.payment.noActions}
          </ThemedText>
        </Card>
      ) : (
        <View style={styles.actions}>
          {actions.map((spec) => (
            <CapsuleButton
              key={spec.action}
              title={spec.label}
              variant={spec.destructive ? "destructive" : "secondary"}
              size="compact"
              onPress={() => {
                if (spec.action === "refund") {
                  if (!refundSheetEnabled) return;
                  setSheet({ kind: "refund" });
                  return;
                }
                setSheet({ kind: "transition", spec });
              }}
              disabled={spec.action === "refund" && !refundSheetEnabled}
              testID={`fee-payment-action-${spec.action}`}
            />
          ))}
        </View>
      )}

      {ledger.isError && canReadLedger ? (
        <Notice
          tone="caution"
          message={copy.fees.payment.refundsLoadError}
          testID="fee-payment-refunds-error"
        />
      ) : null}

      {sheet?.kind === "transition" ? (
        <TransitionSheet
          organizationId={organizationId}
          schoolId={schoolId}
          spec={sheet.spec}
          paymentId={payment.id}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setSheet(null);
            setNotice(message);
          }}
        />
      ) : null}

      {sheet?.kind === "refund" ? (
        <RefundSheet
          organizationId={organizationId}
          schoolId={schoolId}
          paymentId={payment.id}
          maxAmount={refundable}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setSheet(null);
            setNotice(message);
          }}
        />
      ) : null}
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

/**
 * A status transition (clear / cancel / bounce / reverse). The server requires
 * a reason on every one, so the sheet cannot submit without it.
 */
function TransitionSheet({
  organizationId,
  schoolId,
  spec,
  paymentId,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  spec: PaymentActionSpec;
  paymentId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const clear = trpc.fees.payment.clear.useMutation();
  const cancel = trpc.fees.payment.cancel.useMutation();
  const bounce = trpc.fees.payment.bounce.useMutation();
  const reverse = trpc.fees.payment.reverse.useMutation();
  const utils = trpc.useUtils();

  const pending =
    clear.isPending ||
    cancel.isPending ||
    bounce.isPending ||
    reverse.isPending;

  const reasonError =
    submitted && reason.trim().length === 0
      ? copy.fees.payment.reasonRequired
      : undefined;

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (reason.trim().length === 0) return;

    const payload = {
      organizationId,
      schoolId,
      id: paymentId,
      reason: reason.trim(),
    };

    try {
      if (spec.action === "clear") await clear.mutateAsync(payload);
      else if (spec.action === "cancel") await cancel.mutateAsync(payload);
      else if (spec.action === "bounce") await bounce.mutateAsync(payload);
      else if (spec.action === "reverse") await reverse.mutateAsync(payload);
      else return;

      await Promise.all([
        utils.fees.payment.list.invalidate(),
        utils.fees.payment.detail.invalidate(),
        utils.fees.installment.dues.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
        utils.fees.ledger.list.invalidate(),
        utils.fees.assignment.byStudent.invalidate(),
      ]);

      onDone(copy.fees.payment.done(spec.label));
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={copy.fees.payment.confirmTitle(spec.label)}
      onClose={onClose}
      testIDPrefix="fee-payment-transition"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={copy.common.cancel}
            variant="secondary"
            size="compact"
            onPress={onClose}
            testID="fee-payment-transition-cancel"
          />
          <CapsuleButton
            title={
              pending
                ? copy.fees.payment.working
                : copy.fees.payment.confirmAction
            }
            variant={spec.destructive ? "destructive" : "primary"}
            size="compact"
            loading={pending}
            onPress={() => void submit()}
            testID="fee-payment-transition-confirm"
          />
        </View>
      }
    >
      <Notice
        tone={spec.destructive ? "critical" : "neutral"}
        message={spec.warning}
        testID="fee-payment-transition-warning"
      />

      <FormField
        label={copy.fees.payment.reasonLabel}
        value={reason}
        onChangeText={setReason}
        placeholder={copy.fees.payment.reasonPlaceholder}
        help={copy.fees.payment.reasonHelp}
        error={reasonError}
        multiline
        numberOfLines={3}
        maxLength={255}
        testID="fee-payment-transition-reason"
      />

      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="fee-payment-transition-error"
        />
      ) : null}
    </FormSheet>
  );
}

/**
 * A refund against this payment. The amount cannot exceed what the payment
 * still holds; the reference is required for every non-cash mode, matching the
 * server's refund contract.
 */
function RefundSheet({
  organizationId,
  schoolId,
  paymentId,
  maxAmount,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  paymentId: string;
  maxAmount: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [amount, setAmount] = useState(toInputAmount(maxAmount));
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState<(typeof REFUND_MODES)[number]>("cash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refund = trpc.fees.payment.refund.useMutation();
  const utils = trpc.useUtils();

  const fields = referenceFields(mode as PaymentMode);
  const today = todayIso();

  const parsed = parseMoney(amount);
  const limit = parseMoney(maxAmount) ?? 0n;
  const amountError =
    submitted && (parsed === null || parsed <= 0n || parsed > limit)
      ? copy.fees.payment.refundAmountError(maxAmount)
      : undefined;
  const referenceError =
    submitted && fields.reference && reference.trim().length === 0
      ? copy.fees.payment.refundReferenceRequired
      : undefined;
  const reasonError =
    submitted && reason.trim().length === 0
      ? copy.fees.payment.refundReasonRequired
      : undefined;

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (parsed === null || parsed <= 0n || parsed > limit) return;
    if (fields.reference && reference.trim().length === 0) return;
    if (reason.trim().length === 0) return;

    try {
      await refund.mutateAsync({
        organizationId,
        schoolId,
        data: {
          originalPaymentId: paymentId,
          refundAmount: toMoneyString(parsed),
          refundDate: date,
          refundMode: mode,
          transactionReference: fields.reference ? reference.trim() : null,
          reason: reason.trim(),
        },
      });

      await Promise.all([
        utils.fees.payment.list.invalidate(),
        utils.fees.payment.detail.invalidate(),
        utils.fees.installment.dues.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
        utils.fees.ledger.list.invalidate(),
        utils.fees.assignment.byStudent.invalidate(),
      ]);

      onDone(copy.fees.payment.refundDone(toMoneyString(parsed)));
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={copy.fees.payment.refundTitle}
      onClose={onClose}
      testIDPrefix="fee-payment-refund"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={copy.common.cancel}
            variant="secondary"
            size="compact"
            onPress={onClose}
            testID="fee-payment-refund-cancel"
          />
          <CapsuleButton
            title={
              refund.isPending
                ? copy.fees.payment.refunding
                : copy.fees.payment.refundSubmit
            }
            variant="destructive"
            size="compact"
            loading={refund.isPending}
            onPress={() => void submit()}
            testID="fee-payment-refund-confirm"
          />
        </View>
      }
    >
      <Notice
        tone="critical"
        message={copy.fees.payment.refundIntro}
        testID="fee-payment-refund-intro"
      />

      <FormField
        label={copy.fees.payment.refundAmountLabel}
        value={amount}
        onChangeText={(next) => setAmount(sanitizeAmountInput(next))}
        keyboardType="decimal-pad"
        suffix="₹"
        help={copy.fees.payment.refundAmountHelp(formatMoney(maxAmount))}
        error={amountError}
        maxLength={12}
        testID="fee-payment-refund-amount"
      />

      <DateField
        label={copy.fees.payment.refundDateLabel}
        value={date}
        onChange={setDate}
        maximumDate={today}
        testID="fee-payment-refund-date"
      />

      <ChoicePills
        label={copy.fees.payment.refundModeLabel}
        value={mode}
        options={REFUND_MODES.map((option) => ({
          value: option,
          label: REFUND_MODE_LABEL[option],
        }))}
        onChange={setMode}
        testIDPrefix="fee-payment-refund-mode"
      />

      {fields.reference ? (
        <FormField
          label={copy.fees.payment.refundReferenceLabel}
          value={reference}
          onChangeText={setReference}
          placeholder={fields.placeholder}
          help={fields.hint ?? undefined}
          error={referenceError}
          autoCapitalize="characters"
          maxLength={150}
          testID="fee-payment-refund-reference"
        />
      ) : null}

      <FormField
        label={copy.fees.payment.refundReasonLabel}
        value={reason}
        onChangeText={setReason}
        placeholder={copy.fees.payment.refundReasonPlaceholder}
        error={reasonError}
        multiline
        numberOfLines={3}
        maxLength={500}
        testID="fee-payment-refund-reason"
      />

      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID="fee-payment-refund-error"
        />
      ) : null}
    </FormSheet>
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
  student: {
    gap: spacing.xxs,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  totalLine: {
    gap: spacing.xxs,
  },
  statusReason: {
    gap: spacing.xxs,
  },
  emptyRow: {
    padding: spacing.lg,
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
  lineText: {
    flex: 1,
    gap: spacing.xxs,
  },
  refundFooter: {
    gap: spacing.xxs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  totals: {
    gap: spacing.sm,
  },
  factRow: {
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
  actions: {
    gap: spacing.sm,
  },
  sheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
