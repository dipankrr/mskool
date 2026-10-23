import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";

import { formatReadableDate, isoToLocalDate, localDateToIso } from "../lib/format";
import { copy } from "../lib/copy";
import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import { CapsuleButton } from "./capsule-button";
import { ThemedText } from "./themed-text";

/** Today at local midnight — the picker's starting point when no value exists. */
function todayAtMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * A calendar date as a filled field that opens the platform's own picker —
 * Android's dialog (confirm sets the value, cancel leaves it alone), iOS's
 * inline calendar with a Done pill. ISO in, ISO out: the wire format never
 * round-trips through UTC.
 *
 * The field reads `1 Apr 2026`, not `01/04/2026`: the extra characters are
 * exactly the ones that make a session range skimmable.
 */
export function DateField({
  label,
  value,
  onChange,
  help,
  error,
  minimumDate,
  maximumDate,
  disabled = false,
  testID,
}: {
  label: string;
  value: string | null;
  onChange: (next: string) => void;
  help?: string;
  error?: string;
  /** ISO bounds, inclusive. */
  minimumDate?: string;
  maximumDate?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = isoToLocalDate(value) ?? todayAtMidnight();
  const hint = [error ?? help, copy.forms.datePickerHint]
    .filter(Boolean)
    .join(" ");

  return (
    <View style={styles.wrap}>
      <ThemedText variant="caption" style={styles.label}>
        {label}
      </ThemedText>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${
          value ? formatReadableDate(value) : copy.forms.dateNotSet
        }`}
        accessibilityHint={hint}
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
          color={value ? colors.ink : colors.muted}
          style={styles.value}
        >
          {value ? formatReadableDate(value) : copy.forms.dateNotSet}
        </ThemedText>
        <AppIcon name="calendar" size={18} color={colors.muted} />
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

      {open && Platform.OS === "android" ? (
        <DateTimePicker
          value={current}
          mode="date"
          presentation="dialog"
          accentColor={colors.accent}
          minimumDate={isoToLocalDate(minimumDate) ?? undefined}
          maximumDate={isoToLocalDate(maximumDate) ?? undefined}
          onValueChange={(_event, date) => {
            onChange(localDateToIso(date));
            setOpen(false);
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
      {open && Platform.OS === "ios" ? (
        <View style={styles.inlinePicker}>
          <DateTimePicker
            value={current}
            mode="date"
            display="inline"
            accentColor={colors.accent}
            minimumDate={isoToLocalDate(minimumDate) ?? undefined}
            maximumDate={isoToLocalDate(maximumDate) ?? undefined}
            onValueChange={(_event, date) => onChange(localDateToIso(date))}
          />
          <CapsuleButton
            title={copy.forms.done}
            variant="secondary"
            size="mini"
            onPress={() => setOpen(false)}
            testID={testID ? `${testID}-done` : undefined}
          />
        </View>
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
  inlinePicker: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
});
