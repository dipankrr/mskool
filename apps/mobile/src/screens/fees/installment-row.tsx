import { Pressable, StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import {
  canWaiveInstallment,
  dueLabel,
  dueTiming,
  installmentTitle,
  isPayable,
} from "../../lib/fees";
import { formatMoney, isPositiveMoney } from "../../lib/money";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { FactChip, InstallmentStatusPill, RowAmount } from "./status";

export type InstallmentRowData = {
  id: string;
  description: string | null;
  installmentNumber: number;
  dueDate: string;
  netAmount: string;
  paidAmount: string;
  balanceAmount: string | null;
  paymentStatus: string;
  lateFeeApplicable: string;
};

/**
 * One open installment on the desk. The balance is the loudest number, the
 * due label answers "since when", and the waive control appears only for a
 * caller who may approve a waiver AND a row that has never taken money.
 *
 * The row is not pressable by default: on the desk it is a statement, and the
 * collect flow is a separate, deliberate step. `onPress` is used by the
 * collect screen's picker, where the same anatomy becomes a choice.
 */
export function InstallmentRow({
  installment,
  today,
  can,
  onWaive,
  onPress,
  first = false,
}: {
  installment: InstallmentRowData;
  today: string;
  can: (permission: string) => boolean;
  onWaive?: () => void;
  onPress?: () => void;
  first?: boolean;
}) {
  const title = installmentTitle(installment);
  const overdue = dueTiming(installment.dueDate, today) === "overdue";
  const lateFee = isPositiveMoney(installment.lateFeeApplicable);
  const waivable = canWaiveInstallment(installment, can) && Boolean(onWaive);
  const payable = isPayable(installment);

  const content = (
    <>
      <View style={styles.body}>
        <View style={styles.text}>
          <ThemedText variant="bodyStrong" numberOfLines={2}>
            {title}
          </ThemedText>
          <ThemedText variant="meta" numberOfLines={1}>
            {dueLabel(installment.dueDate, today)}
          </ThemedText>
          <ThemedText variant="meta" numberOfLines={1}>
            {copy.fees.desk.paidOf(
              formatMoney(installment.paidAmount),
              formatMoney(installment.netAmount),
            )}
          </ThemedText>
          {lateFee ? (
            <FactChip
              label={copy.fees.desk.lateFeeChip(
                formatMoney(installment.lateFeeApplicable),
              )}
              tone="caution"
            />
          ) : null}
        </View>
        <View style={styles.trailing}>
          <RowAmount
            tone={payable ? (overdue ? "critical" : undefined) : "positive"}
          >
            {formatMoney(installment.balanceAmount)}
          </RowAmount>
          <InstallmentStatusPill
            status={installment.paymentStatus}
            overdue={overdue}
            testID={`fee-installment-status-${installment.id}`}
          />
          {waivable && onWaive ? (
            <CapsuleButton
              title={copy.fees.desk.waiverAction}
              variant="secondary"
              size="mini"
              onPress={onWaive}
              testID={`fee-waive-${installment.id}`}
            />
          ) : null}
        </View>
      </View>
    </>
  );

  const rowStyle = [styles.row, first ? null : styles.divider];

  if (!onPress) return <View style={rowStyle}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        title,
        formatMoney(installment.balanceAmount),
        dueLabel(installment.dueDate, today),
      ].join(". ")}
      accessibilityHint={copy.fees.desk.collectAction}
      onPress={onPress}
      style={({ pressed }) => [...rowStyle, pressed ? styles.pressed : null]}
      testID={`fee-installment-${installment.id}`}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
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
});
