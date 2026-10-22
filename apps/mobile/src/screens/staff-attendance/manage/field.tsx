import { StyleSheet, TextInput, View } from "react-native";

import { ThemedText } from "../../../components/themed-text";
import { colors } from "../../../theme/brand-admin";
import { fontSize, radius, spacing } from "../../../theme/tokens";

/**
 * A labelled text field for the manage forms (chunk 3): caption label, filled
 * box, optional suffix, then either the error (semantic red, which replaces
 * the help line — one line of guidance at a time) or the help itself. Policy
 * numbers and period names share this anatomy so the screens read as one
 * family.
 */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  help,
  error,
  keyboardType,
  maxLength,
  suffix,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  help?: string;
  error?: string;
  keyboardType?: "default" | "number-pad";
  maxLength?: number;
  suffix?: string;
  testID?: string;
}) {
  return (
    <View style={styles.wrap}>
      <ThemedText variant="caption" style={styles.label}>
        {label}
      </ThemedText>
      <View style={[styles.box, error ? styles.boxError : null]}>
        <TextInput
          testID={testID}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={keyboardType}
          maxLength={maxLength}
          accessibilityLabel={label}
          accessibilityHint={error ?? help}
        />
        {suffix ? (
          <ThemedText variant="bodyStrong" color={colors.muted}>
            {suffix}
          </ThemedText>
        ) : null}
      </View>
      {error ? (
        <ThemedText
          variant="meta"
          color={colors.tone.critical.fg}
          style={styles.hint}
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
  box: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  boxError: {
    borderWidth: 1,
    borderColor: colors.tone.critical.fg,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: fontSize.callout,
  },
  hint: {
    marginTop: spacing.xs,
  },
});
