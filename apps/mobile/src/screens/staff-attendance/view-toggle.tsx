import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

export type AttendanceView = "mark" | "summary";

/**
 * Mark ⇄ Summary segments (chunk 2). Two tabs over one section context — the
 * panel swap keeps the marking body mounted underneath, so a draft survives a
 * glance at the summary. Selected state uses the accent tint the day picker
 * and period chips already use; the tab roles give screen readers the same
 * "selected" fact.
 */
export function ViewToggle({
  value,
  onChange,
  compact = false,
}: {
  value: AttendanceView;
  onChange: (view: AttendanceView) => void;
  /** The small right-aligned pill on the marking screen's day row (v2 mockup). */
  compact?: boolean;
}) {
  const options: {
    value: AttendanceView;
    label: string;
    a11y: string;
    testID: string;
  }[] = [
    {
      value: "mark",
      label: copy.attendance.views.mark,
      a11y: copy.attendance.viewsA11y.mark,
      testID: "attendance-view-mark",
    },
    {
      value: "summary",
      label: copy.attendance.views.summary,
      a11y: copy.attendance.viewsA11y.summary,
      testID: "attendance-view-summary",
    },
  ];

  return (
    <View style={[styles.bar, compact ? styles.barCompact : null]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={option.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.a11y}
            onPress={() => {
              if (!selected) void Haptics.selectionAsync();
              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.segment,
              compact ? styles.segmentCompact : null,
              selected ? (compact ? styles.segmentOnCompact : styles.segmentOn) : null,
              pressed && !selected ? styles.segmentPressed : null,
            ]}
          >
            <ThemedText
              variant={compact ? "chip" : "bodyStrong"}
              color={selected ? (compact ? colors.ink : colors.accentDeep) : colors.muted}
              numberOfLines={1}
            >
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    padding: 3,
    marginTop: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  segmentOn: {
    backgroundColor: colors.accentTint,
  },
  barCompact: { marginTop: 0, alignSelf: "center" },
  segmentCompact: { flex: 0, minHeight: 34, paddingHorizontal: spacing.md },
  segmentOnCompact: { backgroundColor: colors.surface, boxShadow: "0 1px 2px rgba(16, 24, 40, 0.12)" },
  segmentPressed: {
    backgroundColor: colors.surface,
  },
});
