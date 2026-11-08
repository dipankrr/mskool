import { useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { formatClock, isoToLocalDate, localDateToIso } from "../../lib/format";
import { shortDay } from "../../lib/homework";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

const text = copy.homework.give;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Give's small controls, drawn one way: a choice is a white chip with a thin
 * border (green when picked), so it never looks like a text field (grey).
 */
export function Chip({
  label,
  on,
  onPress,
  icon,
  testID,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  icon?: AppIconName;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on ? styles.chipOn : null, pressed ? styles.pressed : null]}
      testID={testID}
    >
      {icon ? <AppIcon name={icon} size={16} color={on ? colors.onAccent : colors.accentDeep} /> : null}
      <ThemedText variant="bodyStrong" color={on ? colors.onAccent : colors.ink}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function dayLabel(iso: string): string {
  return `${shortDay(iso)} ${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

/**
 * The due date and time on one row: the type's preset days, a chip that opens
 * a calendar for any other day, and a chip for the time (8:00 am unless changed).
 */
export function DueChips({
  presets,
  day,
  onDay,
  time,
  onTime,
  minimumDate,
}: {
  presets: { label: string; day: string }[];
  day: string;
  onDay: (d: string) => void;
  time: string;
  onTime: (t: string) => void;
  minimumDate: string;
}) {
  const [open, setOpen] = useState<null | "date" | "time">(null);
  const custom = !presets.some((p) => p.day === day);
  const [h, m] = time.split(":").map(Number);
  const timeValue = new Date(2000, 0, 1, h ?? 8, m ?? 0);
  const dateValue = isoToLocalDate(day) ?? new Date();

  const picked = (mode: "date" | "time", value: Date) => {
    if (mode === "date") onDay(localDateToIso(value));
    else onTime(`${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`);
  };

  return (
    <View>
      <View style={styles.row}>
        {presets.map((p) => (
          <Chip key={p.day} label={p.label} on={p.day === day} onPress={() => onDay(p.day)} testID={`due-${p.day}`} />
        ))}
        <Chip
          label={custom ? dayLabel(day) : text.otherDay}
          icon="calendar"
          on={custom}
          onPress={() => setOpen(open === "date" ? null : "date")}
          testID="due-pick-day"
        />
        <Chip label={formatClock(time)} icon="clock" on={false} onPress={() => setOpen(open === "time" ? null : "time")} testID="due-pick-time" />
      </View>
      {open && Platform.OS === "android" ? (
        <DateTimePicker
          value={open === "date" ? dateValue : timeValue}
          mode={open}
          presentation="dialog"
          accentColor={colors.accent}
          minimumDate={open === "date" ? (isoToLocalDate(minimumDate) ?? undefined) : undefined}
          onValueChange={(_e, value) => {
            picked(open, value);
            setOpen(null);
          }}
          onDismiss={() => setOpen(null)}
        />
      ) : null}
      {open && Platform.OS === "ios" ? (
        <View style={styles.inline}>
          <DateTimePicker
            value={open === "date" ? dateValue : timeValue}
            mode={open}
            display={open === "date" ? "inline" : "spinner"}
            accentColor={colors.accent}
            minimumDate={open === "date" ? (isoToLocalDate(minimumDate) ?? undefined) : undefined}
            onValueChange={(_e, value) => picked(open, value)}
          />
          <CapsuleButton title={copy.forms.done} variant="secondary" size="mini" onPress={() => setOpen(null)} />
        </View>
      ) : null}
    </View>
  );
}

/** Marks out of: the − and + steps, and the number itself is typed straight in. */
export function MarksStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? String(value);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= 1 && n <= 500) onChange(n);
    setTyped(null);
  };
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.lessMarks}
        onPress={() => onChange(Math.max(1, value - (value > 10 ? 5 : 1)))}
        style={({ pressed }) => [styles.stepKey, pressed ? styles.pressed : null]}
      >
        <ThemedText variant="bodyStrong">−</ThemedText>
      </Pressable>
      <TextInput
        value={shown}
        onChangeText={(v) => setTyped(v.replace(/[^0-9]/g, "").slice(0, 3))}
        onBlur={() => commit(shown)}
        onSubmitEditing={() => commit(shown)}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={3}
        style={styles.stepInput}
        accessibilityLabel={text.outOf}
        testID="give-max-marks"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.moreMarks}
        onPress={() => onChange(Math.min(500, value + (value >= 10 ? 5 : 1)))}
        style={({ pressed }) => [styles.stepKey, pressed ? styles.pressed : null]}
      >
        <ThemedText variant="bodyStrong">+</ThemedText>
      </Pressable>
    </View>
  );
}

const MINUTES = [10, 15, 30, 45, 60] as const;

/** About how long: common lengths as chips, and "Other" for any number of minutes. */
export function MinutesChips({ value, onChange }: { value: number | null; onChange: (m: number | null) => void }) {
  const preset = value !== null && (MINUTES as readonly number[]).includes(value);
  const [other, setOther] = useState(value !== null && !preset);
  const [typed, setTyped] = useState(value !== null && !preset ? String(value) : "");
  return (
    <View>
      <View style={styles.row}>
        {MINUTES.map((m) => (
          <Chip
            key={m}
            label={text.minutes(m)}
            on={value === m && !other}
            onPress={() => {
              setOther(false);
              onChange(value === m && !other ? null : m);
            }}
            testID={`give-minutes-${m}`}
          />
        ))}
        <Chip label={text.otherMinutes} on={other} onPress={() => setOther((o) => !o)} testID="give-minutes-other" />
      </View>
      {other ? (
        <View style={styles.otherRow}>
          <TextInput
            value={typed}
            onChangeText={(v) => {
              const clean = v.replace(/[^0-9]/g, "").slice(0, 3);
              setTyped(clean);
              const n = Number(clean);
              onChange(clean && n >= 1 && n <= 600 ? n : null);
            }}
            keyboardType="number-pad"
            autoFocus
            placeholder="20"
            placeholderTextColor={colors.muted}
            style={styles.otherInput}
            testID="give-minutes-input"
          />
          <ThemedText variant="body">{text.minutesUnit}</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(16, 24, 40, 0.14)",
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.85 },
  inline: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(16, 24, 40, 0.14)",
  },
  stepKey: {
    width: 44,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
  stepInput: { minWidth: 56, height: 40, textAlign: "center", fontSize: 20, fontWeight: "700", color: colors.ink },
  otherRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  otherInput: {
    width: 88,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: colors.ink,
  },
});
