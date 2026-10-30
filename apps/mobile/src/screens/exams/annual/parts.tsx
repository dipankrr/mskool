import { StyleSheet, View } from "react-native";

import { StatusPill } from "../../../components/status-pill";
import { ThemedText } from "../../../components/themed-text";
import { annualCopy } from "../../../lib/annual-copy";
import { statusTone } from "../../../lib/annual";
import type { StatusKind } from "../../../lib/annual";
import type { Tone } from "../../../theme/brand-admin";
import { spacing } from "../../../theme/tokens";

/** Shared by the year-end screens: the verdict pill and the status chip. */

const VERDICT_TONE: Record<"promoted" | "compartment" | "detained", Tone> = {
  promoted: "positive",
  compartment: "caution",
  detained: "critical",
};

export function VerdictPill({
  status,
  testID,
}: {
  status: "promoted" | "compartment" | "detained";
  testID?: string;
}) {
  return <StatusPill label={annualCopy.verdicts[status]} tone={VERDICT_TONE[status]} testID={testID} />;
}

export function StatusChip({ status, testID }: { status: StatusKind; testID?: string }) {
  return <StatusPill label={annualCopy.final.status[status]} tone={statusTone(status)} testID={testID} />;
}

/** "83.00" -> "83", "54.29" stays: a percentage as a person would say it. */
export function pct(value: string | null | undefined): string {
  if (value == null) return "-";
  return value.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kv}>
      <ThemedText variant="meta">{label}</ThemedText>
      <ThemedText variant="bodyStrong">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  kv: { gap: spacing.xxs },
});
