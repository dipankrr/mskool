import { Pressable, StyleSheet, View } from "react-native";

import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { dueLabel, dueTiming, splitByMonth } from "../../lib/fees";
import { formatMoney, isPositiveMoney, sumMoney } from "../../lib/money";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { FactChip, MatrixStatusPill, RowAmount } from "./status";

export type DuesRowData = {
  studentId: string;
  admissionNumber: string;
  studentName: string;
  className: string;
  sectionName: string | null;
  rollNumber: string | null;
  generationState: string;
  paymentState: string;
  timingState: string;
  oldestDueDate: string | null;
  totals: { balanceAmount: string };
  openingBalance: { balance: string };
  cells: { month: string; balanceAmount: string }[];
};

/**
 * One student on the dues list. The amount is the loudest thing on the row;
 * the status pill says why the row is here; the oldest due date answers the
 * counter's real question ("since when?") without opening the desk.
 */
export function DuesRow({
  row,
  today,
  currentMonth,
  period = "month",
  onPress,
}: {
  row: DuesRowData;
  today: string;
  /** "2026-10": the month the row's amount is measured up to. */
  currentMonth: string;
  /** "month" leads with what is due now; "session" with the whole year. */
  period?: "month" | "session";
  onPress: () => void;
}) {
  const overdue = row.timingState === "overdue";
  const balance = row.totals.balanceAmount;
  const opening = row.openingBalance.balance;
  const split = splitByMonth(row.cells, currentMonth, opening);
  const total =
    period === "month" ? split.dueNow : sumMoney([balance, opening]);
  const laterOnly =
    period === "month" &&
    !isPositiveMoney(split.dueNow) &&
    isPositiveMoney(split.later);
  const carriedOnly = !isPositiveMoney(balance) && isPositiveMoney(opening);
  const settled = !isPositiveMoney(total);
  const notGenerated = row.generationState !== "generated";

  const classLine = [
    row.className,
    row.sectionName,
    row.rollNumber ? `Roll ${row.rollNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Month view counts months, which is how a parent hears it ("3 months
  // overdue"); the session view keeps the oldest due date.
  const due =
    settled || notGenerated
      ? null
      : period === "month" && split.overdueMonths > 0
        ? copy.fees.dues.monthsOverdue(split.overdueMonths)
        : row.oldestDueDate
          ? dueLabel(row.oldestDueDate, today)
          : null;
  const dueCritical =
    period === "month"
      ? split.overdueMonths > 0
      : dueTiming(row.oldestDueDate ?? today, today) === "overdue";

  const label = [
    row.studentName,
    classLine,
    `Balance ${formatMoney(total)}`,
    carriedOnly
      ? copy.fees.dues.carriedForward
      : notGenerated
        ? copy.fees.dues.notGenerated
        : settled
          ? copy.fees.dues.settled
          : due,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={copy.fees.dues.rowHint}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      testID={`fee-dues-row-${row.studentId}`}
    >
      <View style={styles.body}>
        <View style={styles.text}>
          <ThemedText variant="name" numberOfLines={1}>
            {row.studentName}
          </ThemedText>
          <ThemedText variant="meta" numberOfLines={1}>
            {classLine}
          </ThemedText>
          <ThemedText variant="meta" numberOfLines={1}>
            {row.admissionNumber}
          </ThemedText>
        </View>
        <View style={styles.trailing}>
          <RowAmount
            tone={
              settled || laterOnly
                ? "positive"
                : overdue || carriedOnly
                  ? "critical"
                  : undefined
            }
          >
            {formatMoney(total)}
          </RowAmount>
          {carriedOnly ? (
            <StatusPill
              label={copy.fees.dues.carriedForward}
              tone="caution"
              testID={`fee-dues-status-${row.studentId}`}
            />
          ) : (
            <MatrixStatusPill
              paymentState={row.paymentState}
              timingState={row.timingState}
              testID={`fee-dues-status-${row.studentId}`}
            />
          )}
        </View>
      </View>

      {notGenerated || isPositiveMoney(opening) || due || laterOnly ? (
        <View style={styles.facts}>
          {notGenerated ? (
            <FactChip label={copy.fees.dues.notGenerated} tone="caution" />
          ) : null}
          {isPositiveMoney(opening) ? (
            <FactChip
              label={`${copy.fees.dues.openingBalance} ${formatMoney(opening)}`}
              tone="caution"
            />
          ) : null}
          {due ? (
            <FactChip label={due} tone={dueCritical ? "critical" : "neutral"} />
          ) : null}
          {period === "month" && isPositiveMoney(split.later) ? (
            <FactChip
              label={copy.fees.dues.laterThisSession(formatMoney(split.later))}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  body: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  trailing: {
    alignItems: "flex-end",
    gap: spacing.xs,
    flexShrink: 0,
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
});
