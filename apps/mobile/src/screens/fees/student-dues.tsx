import { useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useSessionOpen } from "../../hooks/use-session-open";
import { copy } from "../../lib/copy";
import {
  feeNameOf,
  groupDues,
  installmentTitle,
  isPayable,
  monthKeyOf,
  monthNameOf,
} from "../../lib/fees";
import { feesCopy } from "../../lib/fees-copy";
import { formatReadableDate, todayIso } from "../../lib/format";
import { formatMoney, isPositiveMoney, parseMoney, sumMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { DueSheet } from "./desk-actions";
import { PayButton } from "./installment-row";

type Show = "open" | "paid" | "all";
type By = "month" | "fee";

type SheetDue = {
  id: string;
  title: string;
  net: string;
  paid: string;
  dueDate: string;
  status: string;
};

/**
 * Every due for one student, under its month or its fee. "Pay" on a row pays
 * that due; "Pay" on a heading pays the group. Tapping the rest of a row opens
 * waive or cancel, so paying and forgiving never share a button.
 */
export function StudentDuesScreen() {
  const params = useLocalSearchParams<{
    studentId?: string;
    studentName?: string;
    className?: string;
  }>();
  const { organizationId, schoolId, academicYear, ready, yearPending } = useActiveContext();
  const { has, hasAny } = usePermissions();
  const sessionOpen = useSessionOpen();
  const words = feesCopy.everyDue;

  const studentId = params.studentId ?? "";
  const studentName = typeof params.studentName === "string" ? params.studentName : "";
  const canRead = hasAny("fee_report:read", "student_fee_assignment:read");
  const canCollect = has("fee_payment:create") && sessionOpen;
  const canManage = has("student_fee_assignment:update") && sessionOpen;

  const [show, setShow] = useState<Show>("open");
  const [by, setBy] = useState<By>("month");
  const [sheet, setSheet] = useState<SheetDue | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const summary = trpc.fees.dashboard.student.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      studentId,
    },
    {
      enabled:
        ready &&
        canRead &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id) &&
        Boolean(studentId),
    },
  );
  const data = summary.data;
  const name = data?.student.name ?? studentName;

  const openCollect = (focus: string) =>
    router.push({
      pathname: "/fees/collect/[studentId]",
      params: {
        studentId,
        studentName: name,
        className: typeof params.className === "string" ? params.className : "",
        focus,
      },
    });

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={words.title}
      meta={name ? words.meta(name) : null}
      backAccessibilityLabel={copy.common.back}
      onRefresh={canRead ? () => void summary.refetch() : undefined}
      refreshing={summary.isRefetching}
      titleTestID="fee-dues-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState icon="shield" title={copy.fees.noAccessTitle} message={copy.fees.noAccessBody} />,
    );
  }
  if (!ready || yearPending || (summary.isPending && !data && !summary.isError)) {
    return frame(
      <View style={styles.body}>
        <Skeleton height={44} />
        <Skeleton height={180} />
        <Skeleton height={180} />
      </View>,
    );
  }
  if (summary.isError || !data || !organizationId || !schoolId) {
    return frame(
      <ErrorCard
        cause={summary.error}
        onRetry={() => void summary.refetch()}
        testID="fee-dues-error"
      />,
    );
  }

  const today = todayIso();
  const currentMonth = monthKeyOf(today);
  const live = data.dues.filter((due) => due.paymentStatus !== "cancelled");
  const settled = (due: (typeof live)[number]) =>
    due.paymentStatus === "paid" || due.paymentStatus === "waived";
  const shown = live.filter((due) =>
    show === "open" ? isPayable(due) : show === "paid" ? settled(due) : true,
  );
  const groups = groupDues(shown, by);
  const previous = data.previousDues.filter((row) =>
    show === "open"
      ? isPositiveMoney(row.balanceAmount)
      : show === "paid"
        ? !isPositiveMoney(row.balanceAmount)
        : true,
  );
  const openTotal = sumMoney([
    ...live.filter(isPayable).map((due) => due.balanceAmount),
    ...data.previousDues.map((row) => row.balanceAmount),
  ]);

  const chip = (value: Show, label: string, extra?: string) => (
    <Pressable
      key={value}
      accessibilityRole="button"
      accessibilityState={{ selected: show === value }}
      onPress={() => setShow(value)}
      style={[styles.chip, show === value ? styles.chipOn : null]}
      testID={`fee-dues-show-${value}`}
    >
      <ThemedText variant="bodyStrong" color={show === value ? colors.accentDeep : colors.muted}>
        {label}
      </ThemedText>
      {extra ? (
        <ThemedText variant="caption" color={show === value ? colors.accentDeep : colors.muted}>
          {extra}
        </ThemedText>
      ) : null}
    </Pressable>
  );

  const groupHead = (label: string, balance: string, focus: string, overdue: boolean) => (
    <View style={styles.groupHead}>
      <View style={styles.groupLabel}>
        <ThemedText variant="sectionLabel" numberOfLines={1}>
          {label}
        </ThemedText>
        {overdue ? (
          <ThemedText variant="caption" color={colors.tone.critical.fg}>
            {words.overdue}
          </ThemedText>
        ) : null}
      </View>
      {canCollect && isPositiveMoney(balance) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${words.payGroup(formatMoney(balance))}, ${label}`}
          hitSlop={8}
          onPress={() => openCollect(focus)}
          style={styles.groupPay}
          testID={`fee-dues-pay-${focus}`}
        >
          <ThemedText variant="meta" color={colors.accentDeep}>
            {words.payGroup(formatMoney(balance))}
          </ThemedText>
          <AppIcon name="chevronRight" size={16} color={colors.accentDeep} />
        </Pressable>
      ) : isPositiveMoney(balance) ? (
        <ThemedText variant="meta">{formatMoney(balance)}</ThemedText>
      ) : null}
    </View>
  );

  return frame(
    <View style={styles.body}>
      {notice ? <Notice tone="positive" message={notice} testID="fee-dues-notice" /> : null}
      <View style={styles.chips}>
        {chip("open", words.open, formatMoney(openTotal))}
        {chip("paid", words.paid)}
        {chip("all", words.all)}
      </View>
      <View style={styles.toggle}>
        {(["month", "fee"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: by === value }}
            onPress={() => setBy(value)}
            style={[styles.toggleItem, by === value ? styles.toggleOn : null]}
            testID={`fee-dues-by-${value}`}
          >
            <ThemedText variant="meta" color={by === value ? colors.accentDeep : colors.muted}>
              {value === "month" ? words.byMonth : words.byFee}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {by === "fee" ? (
        <FeeShares
          parts={[
            ...(isPositiveMoney(sumMoney(data.previousDues.map((row) => row.balanceAmount)))
              ? [
                  {
                    key: "previous",
                    label: words.previous,
                    amount: sumMoney(data.previousDues.map((row) => row.balanceAmount)),
                  },
                ]
              : []),
            ...groupDues(live.filter(isPayable), "fee").map((group) => ({
              key: group.key,
              label: group.label,
              amount: sumMoney(
                group.rows
                  .filter((due) => monthKeyOf(due.dueDate) <= currentMonth)
                  .map((due) => due.balanceAmount),
              ),
            })),
          ].filter((part) => isPositiveMoney(part.amount))}
        />
      ) : null}

      {previous.length > 0 ? (
        <View>
          {groupHead(
            words.previous,
            sumMoney(previous.map((row) => row.balanceAmount)),
            "previous",
            false,
          )}
          <Card padless>
            {previous.map((row, index) => (
              <DueLine
                key={row.id}
                first={index === 0}
                title={row.description?.trim() || words.previousRow}
                detail={null}
                amount={
                  isPositiveMoney(row.balanceAmount)
                    ? formatMoney(row.balanceAmount)
                    : formatMoney(row.amount)
                }
                paid={!isPositiveMoney(row.balanceAmount)}
                onPay={
                  canCollect && isPositiveMoney(row.balanceAmount)
                    ? () => openCollect("previous")
                    : undefined
                }
                testID={`fee-dues-previous-${row.id}`}
              />
            ))}
          </Card>
        </View>
      ) : null}

      {groups.map((group) => {
        const overdue =
          by === "month" && group.key < currentMonth && isPositiveMoney(group.balance);
        return (
          <View key={group.key}>
            {groupHead(
              group.label,
              // Paying a fee type pays only what is due up to this month, so
              // the heading offers that, not the months still to come.
              by === "month"
                ? group.balance
                : sumMoney(
                    group.rows
                      .filter((due) => isPayable(due) && monthKeyOf(due.dueDate) <= currentMonth)
                      .map((due) => due.balanceAmount),
                  ),
              by === "month" ? `month:${group.key}` : `fee:${group.key}`,
              overdue,
            )}
            <Card padless>
              {group.rows.map((due, index) => {
                const title =
                  by === "month"
                    ? feeNameOf(due.description)
                    : `${monthNameOf(monthKeyOf(due.dueDate))} ${due.dueDate.slice(0, 4)}`;
                const partly =
                  isPositiveMoney(due.paidAmount) && isPositiveMoney(due.balanceAmount);
                const detail =
                  due.paymentStatus === "waived"
                    ? words.waived
                    : partly
                      ? words.partPaid(formatMoney(due.paidAmount), formatMoney(due.netAmount))
                      : words.dueOn(formatReadableDate(due.dueDate));
                return (
                  <DueLine
                    key={due.id}
                    first={index === 0}
                    title={title}
                    detail={detail}
                    amount={formatMoney(isPayable(due) ? due.balanceAmount : due.netAmount)}
                    paid={!isPayable(due)}
                    onPay={
                      canCollect && isPayable(due) ? () => openCollect(`due:${due.id}`) : undefined
                    }
                    onPress={() =>
                      setSheet({
                        id: due.id,
                        title: installmentTitle(due),
                        net: due.netAmount,
                        paid: due.paidAmount,
                        dueDate: due.dueDate,
                        status: due.paymentStatus,
                      })
                    }
                    testID={`fee-dues-row-${due.id}`}
                  />
                );
              })}
            </Card>
          </View>
        );
      })}

      {groups.length === 0 && previous.length === 0 ? (
        <EmptyState
          icon="check"
          title={show === "open" ? words.emptyOpen : words.emptyPaid}
          testID="fee-dues-empty"
        />
      ) : (
        <ThemedText variant="meta" style={styles.hint}>
          {words.tapHint}
        </ThemedText>
      )}

      {sheet ? (
        <DueSheet
          organizationId={organizationId}
          schoolId={schoolId}
          due={sheet}
          canManage={canManage}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setNotice(message);
            setSheet(null);
            AccessibilityInfo.announceForAccessibility(message);
          }}
        />
      ) : null}
    </View>,
  );
}

/** Shades of the one accent, so fee types differ without a colour meaning status. */
const SHARE_SHADES = [1, 0.72, 0.5, 0.34, 0.22];

/**
 * Each fee type's share of what is due now: one bar, then a line per type with
 * its amount and percentage. Previous dues keep their slate.
 */
function FeeShares({ parts }: { parts: { key: string; label: string; amount: string }[] }) {
  const words = feesCopy.everyDue;
  if (parts.length === 0) return null;
  const total = sumMoney(parts.map((part) => part.amount));
  const totalPaise = Number(parseMoney(total) ?? 0n);
  const colourOf = (key: string, index: number) =>
    key === "previous" ? colors.tone.neutral.fg : colors.accent;
  const opacityOf = (key: string, index: number) => {
    const fees = parts.filter((part) => part.key !== "previous");
    const at = fees.findIndex((part) => part.key === key);
    return key === "previous" ? 1 : (SHARE_SHADES[Math.min(at, SHARE_SHADES.length - 1)] ?? 0.22);
  };
  return (
    <Card style={styles.shares} testID="fee-dues-shares">
      <View style={styles.sharesHead}>
        <ThemedText variant="sectionLabel">{words.sharesTitle}</ThemedText>
        <ThemedText variant="bodyStrong">{formatMoney(total)}</ThemedText>
      </View>
      <View style={styles.shareBar}>
        {parts.map((part, index) => (
          <View
            key={part.key}
            style={[
              styles.shareSlice,
              {
                flex: Number(parseMoney(part.amount) ?? 0n),
                backgroundColor: colourOf(part.key, index),
                opacity: opacityOf(part.key, index),
              },
            ]}
          />
        ))}
      </View>
      {parts.map((part, index) => {
        const percent =
          totalPaise > 0
            ? Math.round((Number(parseMoney(part.amount) ?? 0n) * 100) / totalPaise)
            : 0;
        return (
          <View key={part.key} style={styles.shareRow}>
            <View
              style={[
                styles.shareDot,
                { backgroundColor: colourOf(part.key, index), opacity: opacityOf(part.key, index) },
              ]}
            />
            <ThemedText variant="body" numberOfLines={1} style={styles.shareLabel}>
              {part.label}
            </ThemedText>
            <ThemedText variant="meta">{`${percent}%`}</ThemedText>
            <ThemedText variant="bodyStrong" style={styles.shareAmount}>
              {formatMoney(part.amount)}
            </ThemedText>
          </View>
        );
      })}
    </Card>
  );
}

function DueLine({
  title,
  detail,
  amount,
  paid,
  first,
  onPay,
  onPress,
  testID,
}: {
  title: string;
  detail: string | null;
  amount: string;
  paid: boolean;
  first: boolean;
  onPay?: () => void;
  onPress?: () => void;
  testID: string;
}) {
  const words = feesCopy.everyDue;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={[title, amount, detail].filter(Boolean).join(". ")}
      accessibilityHint={onPress ? words.tapHint : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <View style={styles.rowText}>
        <ThemedText variant="name" numberOfLines={detail ? 1 : 2}>
          {title}
        </ThemedText>
        {detail ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText
        variant="bodyStrong"
        color={paid ? colors.muted : undefined}
        maxFontSizeMultiplier={1.2}
      >
        {amount}
      </ThemedText>
      {onPay ? (
        <PayButton onPress={onPay} testID={`${testID}-pay`} />
      ) : paid ? (
        <AppIcon name="checkCircle" size={20} color={colors.accentDeep} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  chips: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  chip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  chipOn: {
    backgroundColor: colors.accentTint,
  },
  toggle: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  toggleItem: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  toggleOn: {
    backgroundColor: colors.surface,
  },
  groupHead: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.xs,
  },
  groupLabel: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  groupPay: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  hint: {
    textAlign: "center",
  },
  shares: {
    gap: spacing.sm,
  },
  sharesHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  shareBar: {
    height: 10,
    flexDirection: "row",
    gap: 2,
  },
  shareSlice: {
    minWidth: 6,
    borderRadius: radius.full,
  },
  shareRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  shareDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
  },
  shareLabel: {
    flex: 1,
    minWidth: 0,
  },
  shareAmount: {
    minWidth: 72,
    textAlign: "right",
  },
});
