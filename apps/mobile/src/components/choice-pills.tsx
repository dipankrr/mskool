import { Pressable, StyleSheet, View } from "react-native";

import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { ThemedText } from "./themed-text";

type ChoicePillOption<T extends string> = {
  value: T;
  label: string;
  /** A quiet second line inside the pill ("Already added"). */
  note?: string;
  /** In grid layout, let the primary choice span both columns. */
  wide?: boolean;
  disabled?: boolean;
};

/**
 * Wrap-friendly single-choice pills for choices that are worth showing all at
 * once — the session start year, a two- or five-way enum. Selected reads as
 * accent tint plus accent border, never colour alone: the radio state is
 * announced and the border doubles the cue.
 *
 * The group owns one question, so the label is rendered above it and the
 * container announces itself as a radio group.
 */
export function ChoicePills<T extends string>({
  label,
  value,
  options,
  onChange,
  layout = "wrap",
  help,
  error,
  testIDPrefix,
}: {
  label?: string;
  /** Selected value, or null when the current values match no preset. */
  value: T | null;
  options: ChoicePillOption<T>[];
  onChange: (next: T) => void;
  /** `grid` gives descriptive choices equal card widths instead of content-sized pills. */
  layout?: "wrap" | "grid";
  help?: string;
  error?: string;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText variant="caption" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
      <View
        style={[styles.pills, layout === "grid" ? styles.grid : null]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              testID={`${testIDPrefix}-${option.value}`}
              accessibilityRole="radio"
              accessibilityState={{
                selected,
                disabled: option.disabled ?? false,
              }}
              accessibilityLabel={
                option.note ? `${option.label}, ${option.note}` : option.label
              }
              disabled={option.disabled}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.pill,
                layout === "grid" ? styles.gridCard : null,
                layout === "grid" && option.wide ? styles.gridCardWide : null,
                selected ? styles.pillOn : null,
                option.disabled ? styles.pillDisabled : null,
                pressed ? styles.pillPressed : null,
              ]}
            >
              <ThemedText
                variant="bodyStrong"
                color={selected ? colors.accentDeep : colors.ink}
                numberOfLines={layout === "grid" ? 2 : 1}
                maxFontSizeMultiplier={1.4}
              >
                {option.label}
              </ThemedText>
              {option.note ? (
                <ThemedText
                  variant="meta"
                  numberOfLines={layout === "grid" ? 2 : 1}
                  maxFontSizeMultiplier={1.4}
                >
                  {option.note}
                </ThemedText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <ThemedText
          variant="meta"
          color={colors.tone.critical.fg}
          style={styles.hint}
          accessibilityLiveRegion="polite"
        >
          {error}
        </ThemedText>
      ) : help ? (
        <ThemedText variant="meta" style={styles.hint}>
          {help}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
  },
  label: {
    marginBottom: spacing.xs,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  grid: {
    alignItems: "stretch",
  },
  pill: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  gridCard: {
    flexBasis: "45%",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    minHeight: 76,
    alignItems: "flex-start",
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  gridCardWide: {
    flexBasis: "100%",
  },
  pillOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  pillDisabled: {
    opacity: 0.45,
    backgroundColor: colors.field,
  },
  pillPressed: {
    backgroundColor: colors.field,
  },
  hint: {
    marginTop: spacing.xs,
  },
});
