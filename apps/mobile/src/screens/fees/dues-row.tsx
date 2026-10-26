import { Pressable, StyleSheet, View } from "react-native";

import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { dueLabel, dueTiming } from "../../lib/fees";
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
};

/**
 * One student on the dues list. The amount is the loudest thing on the row;
 * the status pill says why the row is here; the oldest due date answers the
 * counter's real question ("since when?") without opening the desk.
 */
export function DuesRow({
  row,
  today,
  onPress,
}: {
  row: DuesRowData;
  today: string;
  onPress: () => void;
}) {
  const overdue = row.timingState === "overdue";
  const balance = row.totals.balanceAmount;
  const opening = row.openingBalance.balance;
  const total = sumMoney([balance, opening]);
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

  const due =
    settled || notGenerated
      ? null
      : row.oldestDueDate
        ? dueLabel(row.oldestDueDate, today)
        : null;

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
              settled
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

      {notGenerated || isPositiveMoney(opening) || due ? (
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
            <FactChip
              label={due}
              tone={
                dueTiming(row.oldestDueDate, today) === "overdue"
                  ? "critical"
                  : "neutral"
              }
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
