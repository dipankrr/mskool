import { StyleSheet, TextInput, View } from "react-native";
import type { TextInputProps } from "react-native";

import { colors } from "../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../theme/tokens";
import { ThemedText } from "./themed-text";

/**
 * A labelled text field for the management forms: caption label, filled box,
 * optional suffix, then either the error (semantic red, which replaces the
 * help line — one line of guidance at a time) or the help itself. The
 * attendance policy/period editors and the branch/session forms share this
 * anatomy so the screens read as one family.
 *
 * The label is the input's accessibility label; the error/help becomes its
 * hint, so a screen reader hears the same guidance the eye sees.
 */
export function FormField({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  help,
  error,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  editable = true,
  maxLength,
  suffix,
  multiline = false,
  numberOfLines = 4,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  /** Marks the field touched (the forms validate on blur). */
  onBlur?: () => void;
  placeholder?: string;
  help?: string;
  error?: string;
  keyboardType?: TextInputProps["keyboardType"];
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoCorrect?: boolean;
  editable?: boolean;
  maxLength?: number;
  suffix?: string;
  /** A prose field: taller box, top-aligned text, no single-line scroll. */
  multiline?: boolean;
  /** Visible lines for a multiline field (default 4). */
  numberOfLines?: number;
  testID?: string;
}) {
  return (
    <View style={styles.wrap}>
      <ThemedText variant="caption" style={styles.label}>
        {label}
      </ThemedText>
      <View
        style={[
          styles.box,
          multiline ? styles.boxMultiline : null,
          error ? styles.boxError : null,
          editable ? null : styles.boxReadOnly,
        ]}
      >
        <TextInput
          testID={testID}
          style={[styles.input, multiline ? styles.inputMultiline : null]}
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          editable={editable}
          maxLength={maxLength}
          multiline={multiline}
          numberOfLines={multiline ? numberOfLines : undefined}
          textAlignVertical={multiline ? "top" : undefined}
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
  box: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  boxMultiline: {
    alignItems: "stretch",
    minHeight: 112,
    paddingVertical: spacing.sm,
  },
  boxError: {
    borderWidth: 1,
    borderColor: colors.tone.critical.fg,
  },
  boxReadOnly: {
    opacity: 0.7,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: fontSize.callout,
    fontFamily: fontFamily.regular,
  },
  inputMultiline: {
    minHeight: 88,
    paddingVertical: 0,
  },
  hint: {
    marginTop: spacing.xs,
  },
});
