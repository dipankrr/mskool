import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { CapsuleButton } from "../../../components/capsule-button";
import { DateField } from "../../../components/date-field";
import { ErrorCard } from "../../../components/error-card";
import { FormSheet } from "../../../components/form-sheet";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext } from "../../../hooks/use-active-context";
import { copy } from "../../../lib/copy";
import { todayIso } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { DEFAULT_PATTERN, WEEK_ORDER } from "./calendar-lib";
import type { PatternDay } from "./calendar-lib";

const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TRI: readonly PatternDay[] = ["working", "half_day", "weekend"];

/** "Mon–Fri working · Sat half · Sun off". */
export function patternSummary(pattern: readonly PatternDay[] | null): string {
  if (!pattern) return copy.attendance.manage.cal.patternUnset;
  const words = { working: "working", half_day: "half", weekend: "off" } as const;
  const groups: { type: PatternDay; days: number[] }[] = [];
  for (const day of WEEK_ORDER) {
    const type = pattern[day] ?? "weekend";
    const last = groups[groups.length - 1];
    if (last && last.type === type) last.days.push(day);
    else groups.push({ type, days: [day] });
  }
  return groups
    .map((g) => {
      const first = NAMES[g.days[0]!];
      const end = NAMES[g.days[g.days.length - 1]!];
      return `${g.days.length > 1 ? `${first}–${end}` : first} ${words[g.type]}`;
    })
    .join(" · ");
}

/**
 * A new normal week from a date on (ADR-069): "from December, Saturdays are
 * off". Shows what will change before saving; named days and days with
 * attendance stay as they are.
 */
export function PatternSheet({
  current,
  start,
  end,
  onClose,
}: {
  current: PatternDay[] | null;
  start: string;
  end: string;
  onClose: () => void;
}) {
  const words = copy.attendance.manage.cal;
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const utils = trpc.useUtils();
  const today = todayIso();
  const [pattern, setPattern] = useState<PatternDay[]>(
    current ? [...current] : [...DEFAULT_PATTERN],
  );
  const [from, setFrom] = useState(today < start ? start : today > end ? end : today);
  const preview = trpc.attendance.calendar.changePattern.useMutation();
  const save = trpc.attendance.calendar.changePattern.useMutation();
  const valid = pattern.some((d) => d !== "weekend");

  const base =
    organizationId && schoolId && academicYear
      ? {
          organizationId,
          schoolId,
          data: { academicYearId: academicYear.id, weekdays: pattern, from },
        }
      : null;

  // The preview follows the form: a dry run on every change.
  const key = `${pattern.join(",")}|${from}`;
  useEffect(() => {
    if (!base || !valid) return;
    preview.mutate({ ...base, data: { ...base.data, dryRun: true } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const result = preview.data;
  return (
    <FormSheet
      title={words.patternTitle}
      onClose={onClose}
      testIDPrefix="cal-pattern"
      footer={
        <CapsuleButton
          title={words.patternSave}
          disabled={!valid || !base || (result ? result.changed === 0 : false)}
          loading={save.isPending}
          onPress={async () => {
            if (!base) return;
            try {
              await save.mutateAsync(base);
              await utils.attendance.invalidate();
              onClose();
            } catch {
              // Shown below.
            }
          }}
          testID="cal-pattern-save"
        />
      }
    >
      <ThemedText variant="meta">{words.patternBody}</ThemedText>
      <View style={styles.week}>
        {WEEK_ORDER.map((day) => (
          <View key={day} style={styles.row}>
            <ThemedText variant="bodyStrong" style={styles.name}>
              {NAMES[day]}
            </ThemedText>
            <View style={styles.tri} accessibilityRole="radiogroup">
              {TRI.map((value) => {
                const on = pattern[day] === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${NAMES[day]}, ${words.types[value]}`}
                    onPress={() => {
                      if (on) return;
                      void Haptics.selectionAsync();
                      setPattern((p) => p.map((v, i) => (i === day ? value : v)));
                    }}
                    style={[styles.option, on ? styles.optionOn : null]}
                    testID={`cal-pattern-${day}-${value}`}
                  >
                    <ThemedText
                      variant="chip"
                      color={
                        on
                          ? value === "working"
                            ? colors.accentDeep
                            : value === "half_day"
                              ? colors.tone.caution.fg
                              : colors.tone.neutral.fg
                          : colors.muted
                      }
                    >
                      {words.types[value]}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>
      <View style={styles.from}>
        <DateField
          label={words.patternFrom}
          value={from}
          onChange={setFrom}
          minimumDate={start}
          maximumDate={end}
          testID="cal-pattern-from"
        />
      </View>
      {result && valid ? (
        <View style={styles.note} testID="cal-pattern-preview">
          <ThemedText variant="bodyStrong">
            {result.changed === 0
              ? words.patternNone
              : words.patternChanged(result.changed, result.schoolDelta)}
          </ThemedText>
          <ThemedText variant="meta">{words.patternKeeps}</ThemedText>
          {result.skipped > 0 ? (
            <ThemedText variant="meta" color={colors.tone.caution.fg}>
              {words.patternSkipped(result.skipped)}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
      {save.error ? <ErrorCard cause={save.error} style={styles.gap} /> : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: spacing.md },
  week: { marginTop: spacing.md, gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { width: 40 },
  tri: {
    flex: 1,
    flexDirection: "row",
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  option: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  optionOn: { backgroundColor: colors.surface, boxShadow: "0 1px 2px rgba(16, 24, 40, 0.12)" },
  from: { marginTop: spacing.md },
  note: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.neutral.bg,
    gap: 2,
  },
});
