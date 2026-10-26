import { Pressable, ScrollView, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { gutter, radius, spacing } from "../../theme/tokens";

export type Chip<T extends string> = {
  value: T;
  label: string;
  /** The spoken label when the printed one is terse ("Missing, 14"). */
  accessibilityLabel?: string;
  testID: string;
};

/**
 * A single-select row of filter chips that scrolls sideways when it must —
 * the class chips on an exam, the entry list's All / Missing / Absent / Below
 * pass. Unlike `SegmentBar` its width is the content's, so a class named
 * "Nursery B" or a filter with a three-digit count never shrinks to fit.
 *
 * Bleeds to the screen edge (negative margin by the gutter) so a chip that
 * scrolls under the edge reads as scrollable, then pads back to the gutter at
 * rest. Selected is accent tint + accent text + a border, never colour alone.
 */
export function ChipRow<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly Chip<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
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
              styles.chip,
              selected ? styles.chipOn : null,
              pressed && !selected ? styles.chipPressed : null,
            ]}
          >
            <ThemedText
              variant="bodyStrong"
              color={selected ? colors.accentDeep : colors.ink}
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
            >
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    marginHorizontal: -gutter,
    flexGrow: 0,
  },
  row: {
    paddingHorizontal: gutter,
    gap: spacing.sm,
  },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  chipPressed: {
    backgroundColor: colors.field,
  },
});
