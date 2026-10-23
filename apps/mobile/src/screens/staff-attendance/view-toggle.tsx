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
}: {
  value: AttendanceView;
  onChange: (view: AttendanceView) => void;
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
    <View style={styles.bar} accessibilityRole="tablist">
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
              selected ? styles.segmentOn : null,
              pressed && !selected ? styles.segmentPressed : null,
            ]}
          >
            <ThemedText variant="bodyStrong" color={selected ? colors.accentDeep : colors.muted}>
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
  segmentPressed: {
    backgroundColor: colors.surface,
  },
});
