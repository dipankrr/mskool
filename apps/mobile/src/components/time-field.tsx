import { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";

import { formatClock } from "../lib/homework";
import { copy } from "../lib/copy";
import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import { CapsuleButton } from "./capsule-button";
import { ThemedText } from "./themed-text";

/** A `HH:mm` value on today's date, in the reader's calendar. */
function timeToDate(value: string | null): Date {
  const now = new Date();
  const [hour, minute] = (value ?? "08:00").split(":").map(Number);
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number.isInteger(hour) ? hour : 8,
    Number.isInteger(minute) ? minute : 0,
    0,
    0,
  );
}

/**
 * A wall-clock time as a filled field that opens the platform's own picker.
 *
 * `HH:mm` in, `HH:mm` out — 24-hour on the wire (the form composes it with a
 * date into one timestamp), 12-hour in the field because that is how a school
 * timetable is read out loud. Android gets its dialog; iOS gets an inline
 * spinner with a Done pill, the same anatomy as `DateField`.
 */
export function TimeField({
  label,
  value,
  onChange,
  help,
  error,
  disabled = false,
  testID,
}: {
  label: string;
  value: string | null;
  onChange: (next: string) => void;
  help?: string;
  error?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = useMemo(() => timeToDate(value), [value]);
  const hint = [error ?? help, copy.forms.timePickerHint]
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
        accessibilityLabel={`${label}, ${value ? formatClock(value) : copy.forms.timeNotSet}`}
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
          {value ? formatClock(value) : copy.forms.timeNotSet}
        </ThemedText>
        <AppIcon name="clock" size={18} color={colors.muted} />
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
          mode="time"
          display="default"
          presentation="dialog"
          is24Hour={false}
          accentColor={colors.accent}
          positiveButton={{ label: copy.forms.done }}
          negativeButton={{ label: copy.common.cancel }}
          onValueChange={(_event, date) => {
            onChange(
              `${String(date.getHours()).padStart(2, "0")}:${String(
                date.getMinutes(),
              ).padStart(2, "0")}`,
            );
            setOpen(false);
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
      {open && Platform.OS === "ios" ? (
        <View style={styles.inlinePicker}>
          <DateTimePicker
            value={current}
            mode="time"
            display="spinner"
            accentColor={colors.accent}
            themeVariant="light"
            onValueChange={(_event, date) =>
              onChange(
                `${String(date.getHours()).padStart(2, "0")}:${String(
                  date.getMinutes(),
                ).padStart(2, "0")}`,
              )
            }
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
