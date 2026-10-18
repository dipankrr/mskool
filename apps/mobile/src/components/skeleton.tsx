import { StyleSheet, View } from "react-native";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";

import { colors } from "../theme/brand-admin";
import { radius } from "../theme/tokens";

/**
 * A muted placeholder bar for loading states. Hidden from screen readers —
 * the loading announcement belongs to the screen ("Loading your classes…"),
 * never to decorative geometry.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  style,
  testID,
}: {
  width?: DimensionValue;
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[styles.base, { width, height }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.chip,
    borderRadius: radius.sm,
  },
});
