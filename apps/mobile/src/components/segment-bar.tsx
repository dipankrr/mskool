import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "./themed-text";
import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  /** The spoken label when the printed one is too terse ("Live · 4"). */
  accessibilityLabel?: string;
  testID: string;
};

/**
 * The homework surface's segment bars: Agenda ⇄ All, and the All view's
 * Live / Drafts / Closed / All. One anatomy for both so the screen has a
 * single "switch a dimension" gesture rather than two competing tab styles.
 *
 * Selected is accent tint + accent text; the tab role carries the state to a
 * screen reader and the tint doubles it for everyone else. 44 pt floor.
 */
export function SegmentBar<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (next: T) => void;
  /** A read-only view keeps the choice visible but inert. */
  disabled?: boolean;
}) {
  return (
    <View style={styles.bar} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={option.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            disabled={disabled}
            onPress={() => {
              if (selected) return;
              void Haptics.selectionAsync();
              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.segment,
              selected ? styles.segmentOn : null,
              pressed && !selected && !disabled ? styles.segmentPressed : null,
              disabled ? styles.segmentDisabled : null,
            ]}
          >
            <ThemedText
              variant="bodyStrong"
              color={selected ? colors.accentDeep : colors.muted}
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
              // Four equal segments: at large text a label shrinks to fit
              // rather than ellipsising ("Attenti…").
              adjustsFontSizeToFit
              minimumFontScale={0.75}
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
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
  },
  segmentOn: {
    backgroundColor: colors.accentTint,
  },
  segmentPressed: {
    backgroundColor: colors.surface,
  },
  segmentDisabled: {
    opacity: 0.6,
  },
});
