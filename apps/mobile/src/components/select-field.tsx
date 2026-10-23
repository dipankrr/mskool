import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import { ChoiceSheet } from "./choice-sheet";
import type { ChoiceOption } from "./choice-sheet";
import { ThemedText } from "./themed-text";

/**
 * A filled select field: label, current choice, chevron, and the app's one
 * single-select sheet. Used by the branch form for the board.
 *
 * The component owns the sheet's open state because the choice is applied
 * immediately; the caller owns the value and the validation message. A
 * disabled field shows its value but opens nothing, so a read-only edit screen
 * still reads as a form rather than a wall of text.
 */
export function SelectField({
  label,
  valueLabel,
  placeholder,
  options,
  currentId,
  onSelect,
  help,
  error,
  disabled = false,
  testID,
}: {
  label: string;
  /** The chosen option's display label, or null when nothing is chosen. */
  valueLabel: string | null;
  placeholder: string;
  options: ChoiceOption[];
  /** Selected option id; the sheet checkmarks it. */
  currentId: string;
  onSelect: (id: string) => void;
  help?: string;
  error?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <ThemedText variant="caption" style={styles.label}>
        {label}
      </ThemedText>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${valueLabel ?? placeholder}`}
        accessibilityHint={error ?? help}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.box,
          error ? styles.boxError : null,
          disabled ? styles.boxDisabled : null,
          pressed ? styles.boxPressed : null,
        ]}
      >
        <ThemedText
          variant="bodyStrong"
          color={valueLabel ? colors.ink : colors.muted}
          numberOfLines={1}
          style={styles.value}
        >
          {valueLabel ?? placeholder}
        </ThemedText>
        <AppIcon name="chevronDown" size={18} color={colors.muted} />
      </Pressable>
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
      <ChoiceSheet
        visible={open}
        title={label}
        options={options}
        currentId={currentId}
        onSelect={(id) => {
          onSelect(id);
          setOpen(false);
        }}
        onDismiss={() => setOpen(false)}
        testIDPrefix={testID ?? "select"}
      />
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
  box: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  boxError: {
    borderWidth: 1,
    borderColor: colors.tone.critical.fg,
  },
  boxDisabled: {
    opacity: 0.7,
  },
  boxPressed: {
    backgroundColor: colors.chip,
  },
  value: {
    flex: 1,
  },
  hint: {
    marginTop: spacing.xs,
  },
});
