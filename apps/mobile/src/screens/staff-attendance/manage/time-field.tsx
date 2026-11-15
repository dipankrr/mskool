import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { ThemedText } from "../../../components/themed-text";
import { copy } from "../../../lib/copy";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";

/** "HH:MM" (or "HH:MM:SS") → today at that time; 08:00 when unset. */
function dateFromTime(value: string | null): Date {
  const date = new Date();
  date.setSeconds(0, 0);
  if (!value) {
    date.setHours(8, 0, 0, 0);
    return date;
  }
  const [hours, minutes] = value.split(":");
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date;
}

function timeOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

/**
 * The period editor's time field (chunk 3): a filled field that opens the
 * platform's native time picker — Android's dialog (confirm sets the value,
 * cancel leaves it as it was), iOS's inline wheel with a Done pill. The field
 * shows 24-hour HH:MM, the format the contract validates; Clear is explicit
 * because "no time" is a legitimate slot state.
 */
export function TimeField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
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
        accessibilityLabel={`${label}, ${
          value ?? copy.attendance.manage.periods.notSet
        }`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.box, pressed ? styles.boxPressed : null]}
      >
        <ThemedText
          variant="bodyStrong"
          color={value ? colors.ink : colors.muted}
        >
          {value ?? copy.attendance.manage.periods.notSet}
        </ThemedText>
        <AppIcon name="clock" size={18} color={colors.muted} />
      </Pressable>
      {value ? (
        <Pressable
          testID={testID ? `${testID}-clear` : undefined}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${copy.attendance.manage.periods.clear}`}
          hitSlop={8}
          onPress={() => onChange(null)}
          style={styles.clear}
        >
          <ThemedText variant="caption" color={colors.accentDeep}>
            {copy.attendance.manage.periods.clear}
          </ThemedText>
        </Pressable>
      ) : null}
      {open && Platform.OS === "android" ? (
        <DateTimePicker
          value={dateFromTime(value)}
          mode="time"
          presentation="dialog"
          is24Hour
          accentColor={colors.accent}
          onValueChange={(_event, date) => {
            onChange(timeOf(date));
            setOpen(false);
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
      {open && Platform.OS === "ios" ? (
        <View style={styles.inlinePicker}>
          <DateTimePicker
            value={dateFromTime(value)}
            mode="time"
            display="spinner"
            accentColor={colors.accent}
            onValueChange={(_event, date) => onChange(timeOf(date))}
          />
          <CapsuleButton
            title={copy.attendance.manage.periods.done}
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
    flex: 1,
    marginTop: spacing.md,
  },
  label: {
    marginBottom: spacing.xs,
  },
  box: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  boxPressed: {
    backgroundColor: colors.chip,
  },
  clear: {
    marginTop: spacing.xs,
    alignSelf: "flex-start",
  },
  inlinePicker: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
});
