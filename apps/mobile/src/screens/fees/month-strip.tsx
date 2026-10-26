import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ThemedText } from "../../components/themed-text";
import { formatMoney, isPositiveMoney } from "../../lib/money";
import { colors } from "../../theme/brand-admin";
import type { Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

type MonthCell = {
  month: string;
  balanceAmount: string;
  paymentState: string;
  timingState: string;
};

/**
 * The matrix's month columns, rotated for a phone: a horizontal strip of
 * twelve month chips instead of a table that would squeeze a student's year
 * into unreadable columns. Each chip carries the month, a state dot and the
 * open balance; the tap opens that month's installment breakdown.
 *
 * A month with no fee is muted, not hidden — the shape of the year (April to
 * March, with a gap where nothing is billed) is information.
 */
export function MonthStrip({
  months,
  cells,
  onSelect,
}: {
  months: { key: string; label: string }[];
  cells: MonthCell[];
  onSelect: (month: string, label: string) => void;
}) {
  const byKey = new Map(cells.map((cell) => [cell.month, cell]));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      accessibilityLabel="Months of this session"
    >
      {months.map((month) => {
        const cell = byKey.get(month.key);
        const tone = cellTone(cell);
        const hasFee = Boolean(
          cell &&
          (isPositiveMoney(cell.balanceAmount) ||
            cell.paymentState !== "no_fee"),
        );
        const short = month.label.split(" ")[0] ?? month.label;

        return (
          <Pressable
            key={month.key}
            accessibilityRole="button"
            accessibilityLabel={[
              month.label,
              cell ? statusWord(cell) : "No fee",
              cell && isPositiveMoney(cell.balanceAmount)
                ? `${formatMoney(cell.balanceAmount)} open`
                : null,
            ]
              .filter(Boolean)
              .join(". ")}
            accessibilityHint="Opens this month's installment breakdown"
            onPress={() => onSelect(month.key, month.label)}
            style={({ pressed }) => [
              styles.month,
              pressed ? styles.pressed : null,
            ]}
            testID={`fee-month-${month.key}`}
          >
            <ThemedText
              variant="caption"
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {short}
            </ThemedText>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: hasFee
                    ? colors.tone[tone].fg
                    : colors.hairline,
                },
              ]}
            />
            <ThemedText
              variant="meta"
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
              style={styles.amount}
            >
              {cell && isPositiveMoney(cell.balanceAmount)
                ? formatMoney(cell.balanceAmount)
                : "—"}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function cellTone(cell: MonthCell | undefined): Tone {
  if (!cell) return "neutral";
  if (cell.paymentState === "paid" || cell.paymentState === "conceded")
    return "positive";
  if (cell.timingState === "overdue") return "critical";
  if (cell.paymentState === "partial" || cell.paymentState === "unpaid")
    return "caution";
  return "neutral";
}

function statusWord(cell: MonthCell): string {
  if (cell.paymentState === "paid") return "Paid";
  if (cell.paymentState === "conceded") return "Conceded";
  if (cell.paymentState === "partial") return "Part paid";
  if (cell.paymentState === "unpaid") return "Unpaid";
  return "No fee";
}

const styles = StyleSheet.create({
  strip: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  month: {
    width: 78,
    minHeight: 84,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  amount: {
    textAlign: "center",
  },
});
