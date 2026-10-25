import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

export type CheckPillOption<T extends string> = {
  value: T;
  label: string;
  /** A quiet second line: why the option is unavailable, or what it means. */
  note?: string;
  disabled?: boolean;
};

/**
 * Multi-select pills — the submission-types question.
 *
 * Single-select has `ChoicePills`; this is its checkbox sibling. A disabled
 * option stays visible and selected, because an existing row may carry a type
 * the app cannot author (a legacy `file`); hiding it would silently change what
 * students can hand in. Selection is never colour alone: the border, the tint
 * and the checkbox state all move together.
 */
export function CheckPills<T extends string>({
  label,
  values,
  options,
  onToggle,
  help,
  error,
  testIDPrefix,
}: {
  label: string;
  values: readonly T[];
  options: readonly CheckPillOption<T>[];
  onToggle: (next: T) => void;
  help?: string;
  error?: string;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.wrap}>
      <ThemedText variant="caption" style={styles.label}>
        {label}
      </ThemedText>
      <View style={styles.pills} accessibilityLabel={label}>
        {options.map((option) => {
          const selected = values.includes(option.value);
          return (
            <Pressable
              key={option.value}
              testID={`${testIDPrefix}-${option.value}`}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: selected,
                disabled: option.disabled ?? false,
              }}
              accessibilityLabel={
                option.note ? `${option.label}, ${option.note}` : option.label
              }
              disabled={option.disabled}
              onPress={() => {
                void Haptics.selectionAsync();
                onToggle(option.value);
              }}
              style={({ pressed }) => [
                styles.pill,
                selected ? styles.pillOn : null,
                option.disabled ? styles.pillDisabled : null,
                pressed && !option.disabled ? styles.pillPressed : null,
              ]}
            >
              <View style={[styles.dot, selected ? styles.dotOn : null]} />
              <View style={styles.text}>
                <ThemedText
                  variant="bodyStrong"
                  color={selected ? colors.accentDeep : colors.ink}
                  numberOfLines={2}
                  maxFontSizeMultiplier={1.4}
                >
                  {option.label}
                </ThemedText>
                {option.note ? (
                  <ThemedText
                    variant="meta"
                    numberOfLines={2}
                    maxFontSizeMultiplier={1.4}
                  >
                    {option.note}
                  </ThemedText>
                ) : null}
              </View>
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
  pill: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  pillOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  pillDisabled: {
    opacity: 0.6,
  },
  pillPressed: {
    backgroundColor: colors.field,
  },
  dot: {
    width: 16,
    height: 16,
    marginTop: 2,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.chevron,
    backgroundColor: colors.surface,
  },
  dotOn: {
    borderColor: colors.accentDeep,
    backgroundColor: colors.accent,
  },
  text: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  hint: {
    marginTop: spacing.xs,
  },
});
