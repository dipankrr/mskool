import { StyleSheet } from "react-native";
import type { StyleProp, TextStyle } from "react-native";

import { spacing } from "../theme/tokens";
import { ThemedText } from "./themed-text";

/**
 * Uppercase grouping label ("YOUR CLASSES"). The 24 pt top margin is part of
 * the anatomy — the probe separates every group this way — so it is baked in
 * rather than repeated by each screen.
 */
export function SectionLabel({
  children,
  style,
  testID,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  return (
    <ThemedText variant="sectionLabel" style={[styles.label, style]} testID={testID}>
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  label: {
    marginTop: spacing.xxl,
  },
});
