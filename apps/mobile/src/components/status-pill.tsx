import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors } from "../theme/brand-admin";
import type { Tone } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { ThemedText } from "./themed-text";

/**
 * The status word in a tinted capsule ("Present", "On leave"). Visual only —
 * inside a row the row is the target and the accessibility label carries the
 * status, so the pill exposes no semantics of its own.
 */
export function StatusPill({
  label,
  tone,
  style,
  testID,
}: {
  label: string;
  tone: Tone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { fg, bg } = colors.tone[tone];
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: bg }, style]}>
      <ThemedText variant="caption" color={fg} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 26,
    paddingHorizontal: spacing.sm + spacing.xxs, // 10
    borderRadius: radius.full,
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
  },
});
