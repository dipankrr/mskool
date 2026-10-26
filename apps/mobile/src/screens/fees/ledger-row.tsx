import { StyleSheet, View } from "react-native";

import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { LEDGER_DIRECTION_LABEL, ledgerTypeLabel } from "../../lib/fees";
import { formatReadableDate } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";

export type LedgerRowData = {
  id: string;
  transactionType: string;
  direction: string;
  /** What the row does to cash (ADR-049); `none` is owed, not collected. */
  cashEffect: string;
  amount: string;
  description: string | null;
  receiptNumber: string | null;
  transactionDate: string;
  studentName: string | null;
  className: string | null;
  sectionName: string | null;
};

/**
 * One appended ledger movement. The type leads, the signed amount sits on the
 * right, and the receipt number rides under the date — it is the reference a
 * parent or auditor quotes. Rows are never tappable: the ledger is read-only
 * by design, and a dead-looking chevron would promise an edit that must not
 * exist.
 */
export function LedgerRow({
  row,
  first,
}: {
  row: LedgerRowData;
  first: boolean;
}) {
  const inbound = row.cashEffect === "in";
  const noCash = row.cashEffect === "none";
  const amountColor = noCash
    ? colors.muted
    : inbound
      ? colors.tone.positive.fg
      : colors.tone.critical.fg;
  const sign = noCash ? "" : inbound ? "+" : "−";
  const who = [
    row.studentName,
    [row.className, row.sectionName].filter(Boolean).join(" · "),
  ]
    .filter(Boolean)
    .join(" · ");
  const direction = LEDGER_DIRECTION_LABEL[row.direction] ?? row.direction;

  return (
    <View
      style={[styles.row, first ? null : styles.divider]}
      accessible
      accessibilityLabel={`${ledgerTypeLabel(row.transactionType)}, ${formatMoney(row.amount)}, ${direction}, ${formatReadableDate(row.transactionDate)}`}
    >
      <View style={styles.text}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {ledgerTypeLabel(row.transactionType)}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {formatReadableDate(row.transactionDate)}
          {row.receiptNumber ? ` · ${row.receiptNumber}` : ""}
        </ThemedText>
        {who ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {who}
          </ThemedText>
        ) : null}
        {noCash ? (
          <ThemedText variant="caption" color={colors.muted}>
            {copy.fees.ledger.noCash}
          </ThemedText>
        ) : null}
        {row.description ? (
          <ThemedText
            variant="caption"
            numberOfLines={2}
            style={styles.description}
          >
            {row.description}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText
        variant="numeric"
        color={amountColor}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={styles.amount}
      >
        {`${sign}${formatMoney(row.amount)}`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  description: {
    paddingTop: spacing.xxs,
  },
  amount: {
    flexShrink: 0,
    textAlign: "right",
  },
});
