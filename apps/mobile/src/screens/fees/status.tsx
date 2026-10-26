import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import type { Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import {
  INSTALLMENT_STATUS_LABEL,
  MATRIX_PAYMENT_STATE_LABEL,
  PAYMENT_STATUS_LABEL,
} from "../../lib/fees";
import type { InstallmentStatus, PaymentStatus } from "../../lib/fees";

/**
 * Fee status vocabulary → tone. The mapping lives here, once, because the
 * same word must wear the same colour on the dues list, the desk and a
 * receipt. "Overdue" is passed in where the status alone cannot know it:
 * an unpaid row due next month is caution, not critical.
 */
export function installmentTone(status: string, overdue = false): Tone {
  switch (status) {
    case "paid":
      return "positive";
    case "partial":
      return "caution";
    case "unpaid":
      return overdue ? "critical" : "caution";
    default:
      return "neutral";
  }
}

export function paymentTone(status: string): Tone {
  switch (status) {
    case "cleared":
      return "positive";
    case "pending":
      return "caution";
    case "bounced":
    case "reversed":
      return "critical";
    default:
      return "neutral";
  }
}

export function matrixTone(paymentState: string, timingState: string): Tone {
  if (paymentState === "paid" || paymentState === "conceded") return "positive";
  if (timingState === "overdue") return "critical";
  if (paymentState === "partial") return "caution";
  if (paymentState === "unpaid") return "caution";
  return "neutral";
}

export function InstallmentStatusPill({
  status,
  overdue,
  testID,
}: {
  status: string;
  overdue?: boolean;
  testID?: string;
}) {
  return (
    <StatusPill
      label={INSTALLMENT_STATUS_LABEL[status as InstallmentStatus] ?? status}
      tone={installmentTone(status, overdue)}
      testID={testID}
    />
  );
}

export function PaymentStatusPill({
  status,
  testID,
}: {
  status: string;
  testID?: string;
}) {
  return (
    <StatusPill
      label={PAYMENT_STATUS_LABEL[status as PaymentStatus] ?? status}
      tone={paymentTone(status)}
      testID={testID}
    />
  );
}

export function MatrixStatusPill({
  paymentState,
  timingState,
  testID,
}: {
  paymentState: string;
  timingState: string;
  testID?: string;
}) {
  const label = MATRIX_PAYMENT_STATE_LABEL[paymentState] ?? paymentState;
  return (
    <StatusPill
      label={label}
      tone={matrixTone(paymentState, timingState)}
      testID={testID}
    />
  );
}

/**
 * The amount that carries a row. Tabular figures, right-aligned, one line —
 * a wrapped amount is a misread amount. Shrinks a little at large text sizes
 * rather than colliding with the name.
 */
export function RowAmount({
  children,
  tone,
}: {
  children: string;
  tone?: Tone;
}) {
  return (
    <ThemedText
      variant="numeric"
      color={tone ? colors.tone[tone].fg : colors.ink}
      numberOfLines={1}
      maxFontSizeMultiplier={1.15}
      style={styles.amount}
    >
      {children}
    </ThemedText>
  );
}

/** A section's title row: label on the left, an optional hint on the right. */
export function SectionHead({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.sectionHead}>
      <ThemedText variant="sectionLabel">{title}</ThemedText>
      {hint ? (
        <ThemedText variant="meta" numberOfLines={1} style={styles.hint}>
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

/** A small neutral chip used for facts inside a fee row (late fee, roll). */
export function FactChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: Tone;
}) {
  const { fg, bg } = colors.tone[tone];
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <ThemedText
        variant="caption"
        color={fg}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  amount: {
    textAlign: "right",
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  hint: {
    flexShrink: 1,
    textAlign: "right",
  },
  chip: {
    minHeight: 24,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
});
