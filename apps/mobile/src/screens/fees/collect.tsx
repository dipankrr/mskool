import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

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
  installmentTitle,
  isPayable,
  nextClientReference,
  oldestFirst,
  PAYMENT_MODES,
  paymentModeLabel,
  prefillAllocations,
  referenceFields,
} from "../../lib/fees";
import type { PaymentMode } from "../../lib/fees";
import { rememberInstallmentLabels } from "../../lib/fees-receipt-cache";
import { formatReadableDate, todayIso } from "../../lib/format";
import {
  clampAllocation,
  formatMoney,
  parseMoney,
  sumMoney,
  toMoneyString,
  isPositiveMoney,
  sanitizeAmountInput,
} from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import {
  fontFamily,
  fontSize,
  radius,
  spacing,
  touch,
} from "../../theme/tokens";
import { SectionHead } from "./status";

/**
 * Take the money (Step 5B).
 *
 * The screen's one idea: the cashier allocates, never types a total. Every
 * open installment is listed oldest-first with its full balance already in the
 * amount box — the common case is "pay everything" — and the total is the sum
 * of those boxes. An amount cannot exceed its installment: typing past the
 * balance is capped on blur with a visible reason, and again at review, so the
 * server never has to reject an over-allocation.
 *
 * `clientReference` is minted once per mount and kept across retries. A
 * dropped response can therefore be retried safely: the server returns the
 * payment it already recorded instead of taking the money twice.
 */
export function CollectPaymentScreen() {
  const params = useLocalSearchParams<{
    studentId?: string;
    studentName?: string;
    className?: string;
    carriedForward?: string;
  }>();
  const { organizationId, schoolId, academicYear, ready, yearPending } =
    useActiveContext();
  const { has } = usePermissions();

  const studentId = params.studentId ?? "";
  const canCollect = has("fee_payment:create");
  const canReadDues = has("student_fee_assignment:read");

  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [clamped, setClamped] = useState<Record<string, string | null>>({});
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [review, setReview] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // One key for this attempt. Kept for the component's life so a retry after
  // a network failure is idempotent rather than a second payment.
  const clientReference = useRef(nextClientReference()).current;
  const prefilled = useRef(false);

  const today = todayIso();

  const student = trpc.student.byId.useQuery(
    { organizationId: organizationId ?? "", id: studentId },
    {
      enabled:
        ready &&
        Boolean(organizationId) &&
        Boolean(studentId) &&
        !params.studentName,
    },
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
        canReadDues &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id) &&
        Boolean(studentId),
    },
  );

  const installments = useMemo(
    () => oldestFirst((dues.data ?? []).filter(isPayable)),
    [dues.data],
  );

  useEffect(() => {
    if (prefilled.current || !dues.data) return;
    prefilled.current = true;
    const next: Record<string, string> = {};
    for (const row of dues.data) {
      if (!isPayable(row)) continue;
      const full = prefillAllocations([row])[0];
      if (full) next[row.id] = full.amount;
    }
    setAmounts(next);
  }, [dues.data]);

  const allocations = useMemo(
    () =>
      installments
        .map((row) => ({
          row,
          amount: clampAllocation(
            amounts[row.id] ?? "",
            row.balanceAmount ?? "0.00",
          ),
        }))
        .filter((entry) => (parseMoney(entry.amount) ?? 0n) > 0n),
    [installments, amounts],
  );

  const total = useMemo(
    () => sumMoney(allocations.map((entry) => entry.amount)),
    [allocations],
  );
  const outstanding = useMemo(
    () => sumMoney(installments.map((row) => row.balanceAmount)),
    [installments],
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

  const fields = referenceFields(mode);
  const referenceError =
    submitted && fields.reference && reference.trim().length === 0
      ? copy.fees.collect.referenceRequired
      : undefined;
  const bankError =
    submitted && fields.bank && bankName.trim().length === 0
      ? copy.fees.collect.bankRequired
      : undefined;
  const chequeDateError =
    submitted && fields.chequeDate && !chequeDate
      ? copy.fees.collect.chequeDateRequired
      : undefined;

  const anyClamped = Object.values(clamped).some(Boolean);

  const setAmount = (id: string, next: string) => {
    setAmounts((current) => ({
      ...current,
      [id]: sanitizeAmountInput(next),
    }));
    setClamped((current) => ({ ...current, [id]: null }));
  };

  const settleAmount = (id: string, balance: string | null) => {
    const raw = parseMoney(amounts[id] ?? "");
    const limit = parseMoney(balance ?? "0.00") ?? 0n;
    if (raw === null) {
      setAmounts((current) => ({ ...current, [id]: "" }));
      return;
    }
    if (raw > limit) {
      setAmounts((current) => ({
        ...current,
        [id]: limit > 0n ? toMoneyString(limit) : "",
      }));
      setClamped((current) => ({
        ...current,
        [id]: formatMoney(balance),
      }));
      return;
    }
    setAmounts((current) => ({
      ...current,
      [id]: raw > 0n ? toMoneyString(raw) : "",
    }));
    setClamped((current) => ({ ...current, [id]: null }));
  };

  const payFull = () => {
    const next: Record<string, string> = {};
    for (const row of installments) {
      const full = prefillAllocations([row])[0];
      if (full) next[row.id] = full.amount;
    }
    setAmounts(next);
    setClamped({});
  };

  const openReview = () => {
    setSubmitted(true);
    setError(null);
    if (allocations.length === 0) return;
    if (fields.reference && reference.trim().length === 0) return;
    if (fields.bank && bankName.trim().length === 0) return;
    if (fields.chequeDate && !chequeDate) return;
    setReview(true);
  };

  const record = trpc.fees.payment.record.useMutation();
  const utils = trpc.useUtils();

  const confirm = async () => {
    if (!academicYear) return;
    setError(null);
    try {
      const payment = await record.mutateAsync({
        organizationId: organizationId ?? "",
        schoolId: schoolId ?? "",
        data: {
          studentId,
          academicYearId: academicYear.id,
          paymentDate,
          paymentMode: mode,
          allocations: allocations.map((entry) => ({
            installmentId: entry.row.id,
            amount: entry.amount,
          })),
          transactionReference: fields.reference ? reference.trim() : null,
          bankName: fields.bank ? bankName.trim() : null,
          chequeDate: fields.chequeDate ? chequeDate : null,
          remarks: remarks.trim().length > 0 ? remarks.trim() : null,
          clientReference,
        },
      });

      // The receipt that follows labels its lines from this hand-off:
      // `payment.detail` carries only installment ids (documented gap). The
      // amounts it prints are the server's, never this attempt's split.
      rememberInstallmentLabels(
        installments.map((row) => ({
          id: row.id,
          label: installmentTitle(row),
        })),
      );

      await Promise.all([
        utils.fees.installment.dues.invalidate(),
        utils.fees.matrix.list.invalidate(),
        utils.fees.matrix.cell.invalidate(),
        utils.fees.payment.list.invalidate(),
        utils.fees.ledger.list.invalidate(),
        utils.fees.assignment.byStudent.invalidate(),
      ]);

      router.replace({
        pathname: "/fees/receipt/[paymentId]",
        params: {
          paymentId: payment.id,
          studentId: payment.studentId,
          studentName,
          className: classLine ?? "",
        },
      });
    } catch (cause) {
      setError(cause);
    }
  };

  const footer =
    installments.length > 0 ? (
      <View style={styles.footerRow}>
        <View style={styles.footerTotal}>
          <ThemedText variant="sectionLabel">
            {copy.fees.collect.totalLabel}
          </ThemedText>
          <ThemedText
            variant="title"
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
            testID="fee-collect-total"
          >
            {formatMoney(total)}
          </ThemedText>
        </View>
        <CapsuleButton
          title={copy.fees.collect.reviewAction}
          icon="check"
          size="compact"
          onPress={openReview}
          disabled={allocations.length === 0}
          testID="fee-collect-review"
        />
      </View>
    ) : undefined;

  const frame = (children: ReactNode, footerSlot?: ReactNode) => (
    <ScreenFrame
      title={copy.fees.collect.title}
      meta={classLine ? `${studentName} · ${classLine}` : studentName}
      backAccessibilityLabel={copy.common.back}
      onRefresh={canReadDues ? () => void dues.refetch() : undefined}
      refreshing={dues.isRefetching}
      footer={footerSlot}
      titleTestID="fee-collect-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canCollect) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.fees.collect.deniedTitle}
        message={copy.fees.collect.deniedBody}
        testID="fee-collect-denied"
      >
        <CapsuleButton
          title={copy.fees.collect.backToDesk}
          variant="secondary"
          size="compact"
          onPress={() => router.back()}
          testID="fee-collect-back"
        />
      </EmptyState>,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={120} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </View>,
    );
  }

  if (!organizationId || !schoolId || !academicYear) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-collect-no-context"
      />,
    );
  }

  if (!canReadDues) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.collect.missingTitle}
        message={copy.fees.collect.missingBody}
        testID="fee-collect-no-dues"
      />,
    );
  }

  if (dues.isError) {
    return frame(
      <ErrorCard
        cause={dues.error}
        onRetry={() => void dues.refetch()}
        testID="fee-collect-error"
      />,
    );
  }

  if (dues.isPending && !dues.data) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={120} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </View>,
    );
  }

  if (installments.length === 0) {
    return frame(
      <EmptyState
        icon="check"
        title={copy.fees.collect.emptyTitle}
        message={copy.fees.collect.emptyBody}
        testID="fee-collect-empty"
      >
        <CapsuleButton
          title={copy.fees.collect.backToDesk}
          variant="secondary"
          size="compact"
          onPress={() => router.back()}
          testID="fee-collect-back"
        />
      </EmptyState>,
    );
  }

  return frame(
    <>
      <View style={styles.body}>
        <Card style={styles.summary}>
          <ThemedText variant="sectionLabel">
            {copy.fees.collect.balanceLabel}
          </ThemedText>
          <ThemedText
            variant="hero"
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
          >
            {formatMoney(outstanding)}
          </ThemedText>
          <ThemedText variant="meta">
            {copy.fees.collect.collectingOf(
              formatMoney(total),
              formatMoney(outstanding),
            )}
          </ThemedText>
          <ThemedText variant="meta">{copy.fees.desk.lateFeeNote}</ThemedText>
        </Card>

        {isPositiveMoney(params.carriedForward) ? (
          <Notice
            tone="caution"
            message={copy.fees.collect.carriedForwardNotice(
              formatMoney(params.carriedForward),
            )}
            testID="fee-collect-carried-forward"
          />
        ) : null}

        <View style={styles.sectionHead}>
          <View style={styles.sectionHeadText}>
            <SectionHead
              title={copy.fees.collect.allocationTitle}
              hint={copy.fees.collect.allocationHint}
            />
          </View>
          <CapsuleButton
            title={copy.fees.collect.payFull}
            variant="secondary"
            size="mini"
            onPress={payFull}
            testID="fee-collect-pay-full"
          />
        </View>

        <Card padless>
          {installments.map((row, index) => {
            const title = installmentTitle(row);
            const note = clamped[row.id];
            const value = amounts[row.id] ?? "";
            return (
              <View
                key={row.id}
                style={[styles.row, index === 0 ? null : styles.divider]}
              >
                <View style={styles.rowText}>
                  <ThemedText variant="bodyStrong" numberOfLines={2}>
                    {title}
                  </ThemedText>
                  <ThemedText variant="meta" numberOfLines={2}>
                    {copy.fees.desk.paidOf(
                      formatMoney(row.paidAmount),
                      formatMoney(row.netAmount),
                    )}
                  </ThemedText>
                  {note ? (
                    <ThemedText
                      variant="caption"
                      color={colors.tone.caution.fg}
                    >
                      {copy.fees.collect.clamped(note)}
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.rowTrailing}>
                  <View style={styles.amountBox}>
                    <ThemedText variant="body" color={colors.muted}>
                      ₹
                    </ThemedText>
                    <TextInput
                      value={value}
                      onChangeText={(next) => setAmount(row.id, next)}
                      onBlur={() => settleAmount(row.id, row.balanceAmount)}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      placeholder="0"
                      placeholderTextColor={colors.muted}
                      accessibilityLabel={copy.fees.collect.amountA11y(
                        title,
                        formatMoney(row.balanceAmount),
                      )}
                      selectTextOnFocus
                      maxFontSizeMultiplier={1.2}
                      style={styles.amountInput}
                      testID={`fee-collect-amount-${row.id}`}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${copy.fees.collect.clearRow} ${title}`}
                    hitSlop={8}
                    onPress={() => {
                      setAmount(row.id, "");
                      setClamped((current) => ({
                        ...current,
                        [row.id]: null,
                      }));
                    }}
                    style={styles.clear}
                    testID={`fee-collect-clear-${row.id}`}
                  >
                    <ThemedText variant="caption" color={colors.accentDeep}>
                      {copy.fees.collect.clearRow}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </Card>

        {anyClamped ? (
          <Notice
            tone="caution"
            message={copy.fees.collect.clampedNotice}
            testID="fee-collect-clamped"
          />
        ) : null}

        <SectionHead title={copy.fees.collect.modeLabel} />
        <ChoicePills
          label={copy.fees.collect.modeLabel}
          value={mode}
          options={PAYMENT_MODES.map((option) => ({
            value: option,
            label: paymentModeLabel(option),
          }))}
          onChange={setMode}
          testIDPrefix="fee-collect-mode"
        />
        {mode !== "cash" ? (
          <Notice
            tone="neutral"
            message={copy.fees.collect.modeHint}
            testID="fee-collect-mode-hint"
          />
        ) : null}

        <DateField
          label={copy.fees.collect.paymentDateLabel}
          value={paymentDate}
          onChange={setPaymentDate}
          help={copy.fees.collect.paymentDateHelp}
          maximumDate={today}
          testID="fee-collect-date"
        />

        {fields.reference ? (
          <FormField
            label={copy.fees.collect.referenceLabel}
            value={reference}
            onChangeText={setReference}
            placeholder={fields.placeholder}
            help={fields.hint ?? undefined}
            error={referenceError}
            autoCapitalize="characters"
            maxLength={150}
            testID="fee-collect-reference"
          />
        ) : null}

        {fields.bank ? (
          <FormField
            label={copy.fees.collect.bankLabel}
            value={bankName}
            onChangeText={setBankName}
            placeholder={copy.fees.collect.bankLabel}
            error={bankError}
            maxLength={100}
            testID="fee-collect-bank"
          />
        ) : null}

        {fields.chequeDate ? (
          <DateField
            label={copy.fees.collect.chequeDateLabel}
            value={chequeDate}
            onChange={setChequeDate}
            error={chequeDateError}
            testID="fee-collect-cheque-date"
          />
        ) : null}

        <FormField
          label={copy.fees.collect.remarksLabel}
          value={remarks}
          onChangeText={setRemarks}
          placeholder={copy.fees.collect.remarksPlaceholder}
          multiline
          numberOfLines={3}
          maxLength={500}
          testID="fee-collect-remarks"
        />

        {submitted && allocations.length === 0 ? (
          <Notice
            tone="critical"
            message={copy.fees.collect.noAllocations}
            testID="fee-collect-no-allocations"
          />
        ) : null}

        {error && !review ? (
          <Notice
            tone="critical"
            message={toFriendlyError(error).message}
            testID="fee-collect-error-notice"
          />
        ) : null}
      </View>

      {review ? (
        <FormSheet
          title={copy.fees.collect.reviewTitle}
          onClose={() => setReview(false)}
          testIDPrefix="fee-collect-review"
          scroll={
            <>
              <Notice
                tone="neutral"
                message={copy.fees.collect.reviewIntro}
                testID="fee-collect-review-intro"
              />
              <View style={styles.reviewStudent}>
                <ThemedText variant="bodyStrong" numberOfLines={2}>
                  {studentName}
                </ThemedText>
                {classLine ? (
                  <ThemedText variant="meta">{classLine}</ThemedText>
                ) : null}
              </View>

              <View style={styles.reviewLines}>
                {allocations.map((entry) => (
                  <View key={entry.row.id} style={styles.reviewLine}>
                    <ThemedText
                      variant="body"
                      numberOfLines={2}
                      style={styles.flex}
                    >
                      {installmentTitle(entry.row)}
                    </ThemedText>
                    <ThemedText variant="numeric">
                      {formatMoney(entry.amount)}
                    </ThemedText>
                  </View>
                ))}
              </View>

              <View style={styles.reviewTotal}>
                <ThemedText variant="bodyStrong">
                  {copy.fees.collect.reviewTotal}
                </ThemedText>
                <ThemedText variant="title">{formatMoney(total)}</ThemedText>
              </View>

              <View style={styles.reviewFacts}>
                <ThemedText variant="meta">
                  {copy.fees.collect.reviewMode}: {paymentModeLabel(mode)}
                </ThemedText>
                <ThemedText variant="meta">
                  {copy.fees.collect.reviewDate}:{" "}
                  {formatReadableDate(paymentDate)}
                </ThemedText>
                {fields.reference && reference.trim().length > 0 ? (
                  <ThemedText variant="meta">
                    {copy.fees.collect.reviewReference}: {reference.trim()}
                  </ThemedText>
                ) : null}
                {fields.bank && bankName.trim().length > 0 ? (
                  <ThemedText variant="meta">
                    {copy.fees.collect.bankLabel}: {bankName.trim()}
                  </ThemedText>
                ) : null}
                {fields.chequeDate && chequeDate ? (
                  <ThemedText variant="meta">
                    {copy.fees.collect.chequeDateLabel}:{" "}
                    {formatReadableDate(chequeDate)}
                  </ThemedText>
                ) : null}
              </View>

              {mode !== "cash" ? (
                <Notice
                  tone="caution"
                  message={copy.fees.collect.modeHint}
                  testID="fee-collect-review-pending"
                />
              ) : null}

              {error ? (
                <Notice
                  tone="critical"
                  message={toFriendlyError(error).message}
                  testID="fee-collect-review-error"
                />
              ) : null}
            </>
          }
          footer={
            <View style={styles.sheetFooter}>
              <CapsuleButton
                title={copy.common.cancel}
                variant="secondary"
                size="compact"
                onPress={() => setReview(false)}
                testID="fee-collect-review-cancel"
              />
              <CapsuleButton
                title={
                  record.isPending
                    ? copy.fees.collect.recording
                    : copy.fees.collect.confirm
                }
                variant="primary"
                size="compact"
                loading={record.isPending}
                onPress={() => void confirm()}
                testID="fee-collect-confirm"
              />
            </View>
          }
        />
      ) : null}
    </>,
    footer,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  skeletons: {
    gap: spacing.md,
  },
  summary: {
    gap: spacing.xs,
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  // The hint shrinks (and ellipsizes) so "Pay full balance" never leaves the
  // screen.
  sectionHeadText: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touch.row,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTrailing: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  amountBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    // Wide enough for "100000.00" at the capped text size: a right-aligned
    // input that overflows scrolls its LEADING digits out of view, so a
    // ₹5000.00 line would read "000.00".
    minWidth: 148,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  amountInput: {
    flex: 1,
    minHeight: touch.comfortable,
    paddingVertical: spacing.xs,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.body,
    color: colors.ink,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  clear: {
    minHeight: touch.min,
    justifyContent: "center",
  },
  flex: {
    flex: 1,
  },
  reviewStudent: {
    gap: spacing.xxs,
  },
  reviewLines: {
    gap: spacing.sm,
  },
  reviewLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  reviewTotal: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  reviewFacts: {
    gap: spacing.xxs,
  },
  sheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  footerTotal: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
});
