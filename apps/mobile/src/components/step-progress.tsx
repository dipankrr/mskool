import { StyleSheet, View } from "react-native";

import { colors } from "../theme/brand-admin";
import { gutter, radius, spacing } from "../theme/tokens";

/**
 * Where a multi-step flow stands: one segment per step, filled up to the current
 * one. Sits in `ScreenFrame`'s sticky slot, which runs edge to edge, so it brings
 * its own gutter. The label is for screen readers; sighted users get the same
 * words from the screen's meta line.
 */
export function StepProgress({
  current,
  total,
  label,
  testID,
}: {
  /** Zero-based. */
  current: number;
  total: number;
  label: string;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={styles.row}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 1, max: total, now: current + 1 }}
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={[styles.segment, index <= current ? styles.segmentOn : null]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: gutter,
    paddingVertical: spacing.sm,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.chip,
  },
  segmentOn: {
    backgroundColor: colors.accent,
  },
});
