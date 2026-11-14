import { StyleSheet, View } from "react-native";

import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";

/**
 * Where someone stands with the app (ADR-068): Joined (green, with a dot),
 * Invited (neutral), Not invited (amber — they can't work in the app yet).
 * The word always carries the meaning; colour only repeats it.
 */
export function JoinPill({ state }: { state: "joined" | "invited" | "not_invited" }) {
  const look =
    state === "joined"
      ? { ...colors.tone.positive, label: "Joined", dot: true }
      : state === "invited"
        ? { ...colors.tone.neutral, label: "Invited", dot: false }
        : { ...colors.tone.caution, label: "Not invited", dot: false };
  return (
    <View style={[styles.pill, { backgroundColor: look.bg }]}>
      {look.dot ? <View style={[styles.dot, { backgroundColor: look.fg }]} /> : null}
      <ThemedText variant="caption" style={[styles.text, { color: look.fg }]}>
        {look.label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 24,
    paddingHorizontal: spacing.sm + 1,
    borderRadius: 999,
  },
  dot: { width: 6, height: 6, borderRadius: 99 },
  text: { fontWeight: undefined },
});
