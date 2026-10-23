import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors } from "../theme/brand-admin";
import type { Tone } from "../theme/brand-admin";
import { radius } from "../theme/tokens";

export type StatusMeterSegment = {
  key: string;
  value: number;
  tone: Tone;
  /** Half day shares amber with late; the legend still names it. */
  opacity?: number;
};

/**
 * A stacked composition bar (present / absent / late / half day / leave). It
 * is intentionally decorative: every caller prints the exact counts beside
 * it, so screen readers get the numbers once, not a colour-only summary. The
 * track is the visible empty state before a section has any marks.
 *
 * The default is deliberately legible rather than hairline-thin; full-width
 * cards pass 12, detail surfaces 10, and compact student rows stay at 8.
 */
export function StatusMeter({
  segments,
  height = 10,
  style,
  testID,
}: {
  segments: readonly StatusMeterSegment[];
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);

  return (
    <View
      testID={testID}
      style={[styles.track, { height }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {total > 0
        ? segments.map((segment) =>
            segment.value > 0 ? (
              <View
                key={segment.key}
                style={{
                  flexGrow: segment.value,
                  flexBasis: 0,
                  backgroundColor: colors.tone[segment.tone].fg,
                  opacity: segment.opacity ?? 1,
                }}
              />
            ) : null,
          )
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    borderRadius: radius.full,
    backgroundColor: colors.field,
    overflow: "hidden",
  },
});
