import { Pressable, StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { feesCopy } from "../../lib/fees-copy";
import {
  canWaiveInstallment,
  dueLabel,
  dueTiming,
  installmentTitle,
  isPayable,
} from "../../lib/fees";
import { formatMoney, isPositiveMoney } from "../../lib/money";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { FactChip, InstallmentStatusPill, RowAmount } from "./status";

export type InstallmentRowData = {
  id: string;
  description: string | null;
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
  onPay,
  onPress,
  first = false,
}: {
  installment: InstallmentRowData;
  today: string;
  can: (permission: string) => boolean;
  onWaive?: () => void;
  /** Opens collect with just this due; shown only while it has a balance. */
  onPay?: () => void;
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
        <ThemedText variant="bodyStrong" numberOfLines={2} style={styles.text}>
          {title}
        </ThemedText>
        <RowAmount tone={payable ? (overdue ? "critical" : undefined) : "positive"}>
          {formatMoney(installment.balanceAmount)}
        </RowAmount>
      </View>
      <View style={styles.body}>
        <View style={styles.text}>
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
              label={copy.fees.desk.lateFeeChip(formatMoney(installment.lateFeeApplicable))}
              tone="caution"
            />
          ) : null}
        </View>
        <InstallmentStatusPill
          status={installment.paymentStatus}
          overdue={overdue}
          testID={`fee-installment-status-${installment.id}`}
        />
      </View>
      {(payable && onPay) || (waivable && onWaive) ? (
        <View style={styles.actions}>
          {waivable && onWaive ? (
            <CapsuleButton
              title={copy.fees.desk.waiverAction}
              variant="secondary"
              size="mini"
              onPress={onWaive}
              testID={`fee-waive-${installment.id}`}
            />
          ) : null}
          {payable && onPay ? (
            <PayButton onPress={onPay} testID={`fee-pay-${installment.id}`} />
          ) : null}
        </View>
      ) : null}
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

/**
 * The one Pay control for a due: a solid tint, so it reads as the action on
 * the row and never as a ghost beside the amount.
 */
export function PayButton({
  onPress,
  label = feesCopy.everyDue.pay,
  testID,
}: {
  onPress: () => void;
  label?: string;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={onPress}
      style={({ pressed }) => [styles.pay, pressed ? styles.payPressed : null]}
      testID={testID}
    >
      <ThemedText variant="bodyStrong" color={colors.onAccent} maxFontSizeMultiplier={1.2}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  actions: {
    marginTop: spacing.xs,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
  },
  pay: {
    minHeight: 36,
    minWidth: 64,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  payPressed: {
    backgroundColor: colors.accentDeep,
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
    alignItems: "center",
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
