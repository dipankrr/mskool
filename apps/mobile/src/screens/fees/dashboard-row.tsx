import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
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
 * One student, compact by default: who they are and what they owe. "More info"
 * opens the breakdown in place. Tapping the rest of the row opens their page.
 */
export function DashboardRow({
  row,
  onPress,
}: {
  row: DashboardRowData;
  onPress: () => void;
}) {
  const [open, setOpen] = useState(false);
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
    <Card padless style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.studentName}. ${classLine}. ${formatMoney(row.dueNow)}. ${status.text}.`}
        accessibilityHint={words.openStudent}
        onPress={onPress}
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
      </Pressable>

      {row.billed || owes ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? words.lessInfo : words.moreInfo}
          onPress={() => setOpen((value) => !value)}
          style={styles.moreRow}
          hitSlop={4}
          testID={`fees-row-more-${row.studentId}`}
        >
          <ThemedText variant="meta" color={colors.accentDeep}>
            {open ? words.lessInfo : words.moreInfo}
          </ThemedText>
          <AppIcon
            name={open ? "chevronUp" : "chevronDown"}
            size={16}
            color={colors.accentDeep}
          />
        </Pressable>
      ) : null}

      {open ? (
        <View style={styles.details} testID={`fees-row-details-${row.studentId}`}>
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
        </View>
      ) : null}
    </Card>
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
  card: {
    overflow: "hidden",
  },
  main: {
    minHeight: 64,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  who: {
    flex: 1,
    gap: 2,
  },
  amount: {
    alignItems: "flex-end",
    gap: 2,
  },
  moreRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.md,
  },
  details: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  fact: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
});
