import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors } from "../theme/brand-admin";
import type { Tone } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { ThemedText } from "./themed-text";

/**
 * One number of a live count, in its status tint (probe anatomy: 74 pt tile,
 * tinted fill, tinted text, tabular digits). Colour = information: the tile
 * tone must match what the number counts, never decorate it. Read as one
 * sentence by screen readers ("35 Present"), not two fragments.
 *
 * Labels wrap to a second line rather than truncate: in a five-tile strip
 * ("On leave", "Half day") the longest two-word labels do not fit one line at
 * every font scale, and an honest wrap beats a clipped word (walk finding #2,
 * fixed 2026-10-18).
 */
export function StatTile({
  value,
  label,
  tone,
  testID,
  style,
}: {
  value: string | number;
  label: string;
  tone: Tone;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { fg, bg } = colors.tone[tone];
  return (
    <View
      testID={testID}
      style={[styles.tile, { backgroundColor: bg }, style]}
      accessible
      accessibilityLabel={`${value} ${label}`}
    >
      <ThemedText variant="numeric" color={fg} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {value}
      </ThemedText>
      <ThemedText variant="caption" color={fg} numberOfLines={2} maxFontSizeMultiplier={1.3}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 74,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
});
