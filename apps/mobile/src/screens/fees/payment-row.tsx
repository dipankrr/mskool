import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { paymentModeLabel } from "../../lib/fees";
import { formatReadableDate } from "../../lib/format";
import { formatMoney, isPositiveMoney } from "../../lib/money";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { FactChip, PaymentStatusPill, RowAmount } from "./status";

export type PaymentRowData = {
  id: string;
  receiptNumber: string;
  paymentDate: string;
  paymentMode: string;
  totalAmount: string | null;
  lateFeeAmount: string;
  paymentStatus: string;
};

/**
 * One receipt in a history list. The receipt number is the identity — it is
 * what a parent reads back over the phone — so it leads, the amount sits on
 * the right, and the status pill says whether the money still counts.
 *
 * `onPress` is omitted when the payment detail route is not reachable; the
 * row then reads as information rather than a dead control.
 */
export function PaymentRow({
  payment,
  onPress,
  first = false,
}: {
  payment: PaymentRowData;
  onPress?: () => void;
  first?: boolean;
}) {
  const lateFee = isPositiveMoney(payment.lateFeeAmount);

  const content = (
    <>
      <View style={styles.text}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {payment.receiptNumber}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {formatReadableDate(payment.paymentDate)} ·{" "}
          {paymentModeLabel(payment.paymentMode)}
        </ThemedText>
        {lateFee ? (
          <FactChip
            label={copy.fees.desk.lateFeeChip(
              formatMoney(payment.lateFeeAmount),
            )}
            tone="caution"
          />
        ) : null}
      </View>
      <View style={styles.trailing}>
        <RowAmount>{formatMoney(payment.totalAmount)}</RowAmount>
        <PaymentStatusPill status={payment.paymentStatus} />
      </View>
    </>
  );

  const rowStyle = [styles.row, first ? null : styles.divider];

  if (!onPress) return <View style={rowStyle}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        payment.receiptNumber,
        formatMoney(payment.totalAmount),
        formatReadableDate(payment.paymentDate),
        paymentModeLabel(payment.paymentMode),
      ].join(". ")}
      accessibilityHint={copy.fees.desk.paymentRowHint}
      onPress={onPress}
      style={({ pressed }) => [...rowStyle, pressed ? styles.pressed : null]}
      testID={`fee-payment-row-${payment.id}`}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
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
});
