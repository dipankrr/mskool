import { Pressable, StyleSheet, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ThemedText } from "../../components/themed-text";
import { feesCopy } from "../../lib/fees-copy";
import { formatReadableDate } from "../../lib/format";
import { formatMoney, isPositiveMoney } from "../../lib/money";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";

export type DashboardRowData =
  inferRouterOutputs<AppRouter>["fees"]["dashboard"]["list"]["rows"][number];

const LEFT = new Set(["transferred_out", "withdrawn", "expelled"]);

function statusLine(row: DashboardRowData) {
  const words = feesCopy.dashboard;
  // Previous dues need no fee record, so a student can owe before being billed.
  if (!row.billed) {
    return isPositiveMoney(row.previousDues)
      ? { text: words.previousOnly, overdue: true }
      : { text: words.notBilled, overdue: false };
  }
  if (row.overdueMonths > 0) {
    return { text: words.monthsOverdue(row.overdueMonths), overdue: true };
  }
  if (isPositiveMoney(row.thisMonth)) return { text: words.dueThisMonthLine, overdue: false };
  if (isPositiveMoney(row.previousDues)) return { text: words.previousOnly, overdue: true };
  return { text: words.paidUp, overdue: false };
}

/**
 * One student as a row in the list: who they are and what they owe. Tapping
 * opens the breakdown in place, with the two next steps; it stays open until
 * tapped again, and the list keeps track of which are open.
 */
export function DashboardRow({
  row,
  open,
  first,
  onToggle,
  onOpen,
  onCollect,
}: {
  row: DashboardRowData;
  open: boolean;
  first: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onCollect?: () => void;
}) {
  const words = feesCopy.dashboard;
  const status = statusLine(row);
  const owes = isPositiveMoney(row.dueNow);
  const classLine = [
    row.className,
    row.sectionName,
    row.rollNumber,
    LEFT.has(row.enrollmentStatus) ? words.left : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={[styles.item, first ? null : styles.divider]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${row.studentName}. ${classLine}. ${formatMoney(row.dueNow)}. ${status.text}.`}
        accessibilityHint={open ? words.lessInfo : words.moreInfo}
        onPress={onToggle}
        style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
        testID={`fees-row-${row.studentId}`}
      >
        <View style={styles.who}>
          <ThemedText variant="name" numberOfLines={1}>
            {row.studentName}
          </ThemedText>
          <ThemedText variant="meta" numberOfLines={1}>
            {classLine}
          </ThemedText>
        </View>
        <View style={styles.amount}>
          <ThemedText
            variant="bodyStrong"
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            color={
              status.overdue
                ? colors.tone.critical.fg
                : owes
                  ? colors.ink
                  : colors.tone.positive.fg
            }
          >
            {row.billed || owes ? formatMoney(row.dueNow) : "—"}
          </ThemedText>
          <ThemedText
            variant="meta"
            numberOfLines={1}
            color={status.overdue ? colors.tone.critical.fg : undefined}
          >
            {status.text}
          </ThemedText>
        </View>
        <AppIcon name={open ? "chevronUp" : "chevronDown"} size={18} color={colors.chevron} />
      </Pressable>

      {open ? (
        <View style={styles.details} testID={`fees-row-details-${row.studentId}`}>
          {row.billed || owes ? (
            <>
              <Fact label={words.thisMonth} value={formatMoney(row.thisMonth)} />
              <Fact label={words.overdue} value={formatMoney(row.overdue)} />
              {isPositiveMoney(row.previousDues) ? (
                <Fact label={words.previous} value={formatMoney(row.previousDues)} />
              ) : null}
              {isPositiveMoney(row.later) ? (
                <Fact label={words.later} value={formatMoney(row.later)} />
              ) : null}
              <Fact
                label={words.lastPayment}
                value={
                  row.lastPaymentDate
                    ? `${formatMoney(row.lastPaymentAmount)} · ${formatReadableDate(row.lastPaymentDate)}`
                    : words.noPaymentYet
                }
              />
            </>
          ) : null}
          <View style={styles.actions}>
            <CapsuleButton
              title={words.openFees}
              variant="secondary"
              size="compact"
              onPress={onOpen}
              style={styles.action}
              testID={`fees-row-open-${row.studentId}`}
            />
            {onCollect && owes ? (
              <CapsuleButton
                title={words.collect}
                icon="collect"
                size="compact"
                onPress={onCollect}
                style={styles.action}
                testID={`fees-row-collect-${row.studentId}`}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <ThemedText variant="meta" numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText variant="bodyStrong" numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    backgroundColor: colors.surface,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  main: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  who: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  amount: {
    alignItems: "flex-end",
    gap: 2,
  },
  details: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  fact: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  actions: {
    marginTop: spacing.sm,
    flexDirection: "row",
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
