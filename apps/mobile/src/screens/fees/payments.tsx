import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { SegmentBar } from "../../components/segment-bar";
import type { SegmentOption } from "../../components/segment-bar";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { formatMoney, sumMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { PaymentRow } from "./payment-row";
import { SectionHead } from "./status";

type PaymentFilter = "all" | "pending" | "cleared" | "closed";

const FILTERS: readonly SegmentOption<PaymentFilter>[] = [
  { value: "all", label: "All", testID: "fee-payments-filter-all" },
  {
    value: "pending",
    label: "Pending",
    testID: "fee-payments-filter-pending",
  },
  {
    value: "cleared",
    label: "Cleared",
    testID: "fee-payments-filter-cleared",
  },
  { value: "closed", label: "Closed", testID: "fee-payments-filter-closed" },
];

/**
 * The session's receipts, newest first (Step 5C).
 *
 * `payment.list` returns raw rows with no student join (documented gap), so a
 * row leads with its receipt number — the identity a parent reads back over
 * the phone — and carries the amount, mode and status. The status filter is
 * client-side because the endpoint takes no status argument and the year's
 * list is small enough to hold; that keeps one read and instant switching.
 */
export function PaymentsScreen() {
  const { organizationId, academicYear, yearPending, ready } =
    useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("fee_payment:read");
  const canReadLedger = has("fee_report:read");

  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [query, setQuery] = useState("");

  const list = trpc.fees.payment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
    },
    {
      enabled:
        ready &&
        canRead &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id),
    },
  );

  const payments = useMemo(
    () =>
      [...(list.data ?? [])].sort((left, right) => {
        if (left.paymentDate !== right.paymentDate) {
          return right.paymentDate.localeCompare(left.paymentDate);
        }
        return right.receiptNumber.localeCompare(left.receiptNumber);
      }),
    [list.data],
  );

  const collected = useMemo(
    () =>
      sumMoney(
        payments
          .filter((payment) => payment.paymentStatus === "cleared")
          .map((payment) => payment.totalAmount),
      ),
    [payments],
  );

  const pending = useMemo(
    () => payments.filter((payment) => payment.paymentStatus === "pending"),
    [payments],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return payments.filter((payment) => {
      if (filter === "pending" && payment.paymentStatus !== "pending") {
        return false;
      }
      if (filter === "cleared" && payment.paymentStatus !== "cleared") {
        return false;
      }
      if (
        filter === "closed" &&
        !["bounced", "reversed", "cancelled"].includes(payment.paymentStatus)
      ) {
        return false;
      }
      if (needle && !payment.receiptNumber.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [payments, filter, query]);

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.fees.payments.title}
      meta={list.data ? copy.fees.payments.meta(payments.length) : branchName}
      backAccessibilityLabel={copy.common.back}
      action={
        canReadLedger
          ? {
              label: copy.fees.ledger.title,
              icon: "ledger",
              onPress: () => router.push("/fees/ledger"),
              accessibilityHint: copy.fees.ledger.readOnly,
              testID: "fee-payments-ledger",
            }
          : undefined
      }
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="fee-payments-title"
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
        testID="fee-payments-denied"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={120} />
        <Skeleton height={44} />
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} height={76} />
        ))}
      </View>,
    );
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-payments-no-branch"
      />,
    );
  }

  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.fees.payments.noYearTitle}
        message={copy.fees.payments.noYearBody}
        testID="fee-payments-no-year"
      />,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="fee-payments-error"
      />,
    );
  }

  if (list.isPending && !list.data) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={120} />
        <Skeleton height={44} />
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} height={76} />
        ))}
      </View>,
    );
  }

  if (payments.length === 0) {
    return frame(
      <EmptyState
        icon="receipt"
        title={copy.fees.payments.emptyTitle}
        message={copy.fees.payments.emptyBody}
        testID="fee-payments-empty"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      <Card style={styles.summary}>
        <ThemedText variant="sectionLabel">
          {copy.fees.payments.summaryLabel}
        </ThemedText>
        <ThemedText
          variant="hero"
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
          testID="fee-payments-collected"
        >
          {formatMoney(collected)}
        </ThemedText>
        <ThemedText variant="meta">
          {copy.fees.payments.meta(payments.length)}
        </ThemedText>
        {pending.length > 0 ? (
          <View style={styles.pendingLine}>
            <ThemedText variant="meta">
              {copy.fees.payments.summaryPending}
            </ThemedText>
            <ThemedText variant="bodyStrong" color={colors.tone.caution.fg}>
              {formatMoney(
                sumMoney(pending.map((payment) => payment.totalAmount)),
              )}
            </ThemedText>
            <ThemedText variant="caption" color={colors.tone.caution.fg}>
              {copy.fees.payments.summaryPendingCount(pending.length)}
            </ThemedText>
          </View>
        ) : null}
      </Card>

      <SegmentBar
        label={copy.fees.payments.filterLabel}
        value={filter}
        options={FILTERS}
        onChange={setFilter}
      />

      <View style={styles.searchWrap}>
        <AppIcon
          name="search"
          size={18}
          color={colors.muted}
          style={styles.searchIcon}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={copy.fees.payments.searchPlaceholder}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="characters"
          returnKeyType="search"
          accessibilityLabel={copy.fees.payments.searchPlaceholder}
          style={styles.searchInput}
          testID="fee-payments-search"
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.fees.dues.clearSearch}
            hitSlop={8}
            onPress={() => setQuery("")}
            style={styles.clear}
            testID="fee-payments-search-clear"
          >
            <AppIcon name="close" size={16} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <SectionHead
        title={copy.fees.payments.title}
        hint={copy.fees.payments.count(visible.length, payments.length)}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon="search"
          title={copy.fees.payments.filterEmptyTitle}
          message={copy.fees.payments.filterEmptyBody}
          testID="fee-payments-filter-empty"
        />
      ) : (
        <Card padless>
          {visible.map((payment, index) => (
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
    </View>,
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
  pendingLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    color: colors.ink,
  },
  clear: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
});
