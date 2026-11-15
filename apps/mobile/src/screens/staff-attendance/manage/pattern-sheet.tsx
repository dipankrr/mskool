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
import { rangeLabel } from "./calendar-ui";

const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TRI: readonly PatternDay[] = ["working", "half_day", "weekend"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type WeekRangeView = { from: string; to: string; weekdays: string[] };

/** "Mon–Fri working · Sat half · Sun off". */
export function patternSummary(pattern: readonly string[] | null): string {
  if (!pattern) return "";
  const words: Record<string, string> = { working: "working", half_day: "half day", weekend: "off" };
  const groups: { type: string; days: number[] }[] = [];
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

/** "1 Dec" — the short date the Apply button and ranges use. */
function short(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

/**
 * Academic week structure (ADR-069): the structures in force, each with
 * its dates and a Remove, then "add a change" — the seven days, From, an
 * optional Until — with a live preview of what changes. Named days and days
 * with attendance never change.
 */
export function PatternSheet({
  ranges,
  start,
  end,
  onClose,
}: {
  ranges: readonly WeekRangeView[];
  start: string;
  end: string;
  onClose: () => void;
}) {
  const words = copy.attendance.manage.cal;
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const utils = trpc.useUtils();
  const today = todayIso();
  const current = ranges.find((r) => r.from <= today && today <= r.to) ?? ranges[ranges.length - 1];
  const [pattern, setPattern] = useState<PatternDay[]>(
    current ? (current.weekdays as PatternDay[]) : [...DEFAULT_PATTERN],
  );
  const [from, setFrom] = useState(today < start ? start : today > end ? end : today);
  const [until, setUntil] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const preview = trpc.attendance.calendar.changePattern.useMutation();
  const apply = trpc.attendance.calendar.changePattern.useMutation();
  const removePreview = trpc.attendance.calendar.removePatternRange.useMutation();
  const remove = trpc.attendance.calendar.removePatternRange.useMutation();
  const valid = pattern.some((d) => d !== "weekend") && (!until || until >= from);

  const target =
    organizationId && schoolId && academicYear ? { organizationId, schoolId, academicYearId: academicYear.id } : null;
  const data = target
    ? { academicYearId: target.academicYearId, weekdays: pattern, from, ...(until ? { to: until } : {}) }
    : null;

  // The preview follows the form: a dry run on every change.
  const key = `${pattern.join(",")}|${from}|${until ?? ""}`;
  useEffect(() => {
    if (!target || !data || !valid) return;
    preview.mutate({ organizationId: target.organizationId, schoolId: target.schoolId, data: { ...data, dryRun: true } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const done = async () => {
    await utils.attendance.invalidate();
    onClose();
  };

  const result = preview.data;
  const applyLabel = until ? words.structureApplyRange(short(from), short(until)) : words.structureApplyFrom(short(from));

  return (
    <FormSheet
      title={words.structureTitle}
      onClose={onClose}
      testIDPrefix="cal-structure"
      footer={
        <CapsuleButton
          title={applyLabel}
          disabled={!valid || !data || (result ? result.changed === 0 : true)}
          loading={apply.isPending}
          onPress={async () => {
            if (!target || !data) return;
            try {
              await apply.mutateAsync({ organizationId: target.organizationId, schoolId: target.schoolId, data });
              await done();
            } catch {
              // Shown below.
            }
          }}
          testID="cal-structure-apply"
        />
      }
    >
      {ranges.length > 0 ? (
        <>
          <ThemedText variant="sectionLabel">{words.structureNow}</ThemedText>
          <View style={styles.list}>
            {ranges.map((range, index) => {
              const pending = removing === range.from;
              return (
                <View key={range.from} style={[styles.range, index > 0 ? styles.separated : null]}>
                  <View style={styles.flex}>
                    <ThemedText variant="bodyStrong">{patternSummary(range.weekdays)}</ThemedText>
                    <ThemedText variant="meta">
                      {range.from === start && range.to === end ? words.structureWhole : rangeLabel(range.from, range.to)}
                    </ThemedText>
                    {pending && removePreview.data ? (
                      <ThemedText variant="meta" color={colors.tone.caution.fg}>
                        {words.structureRemoveNote(removePreview.data.changed)}
                      </ThemedText>
                    ) : null}
                  </View>
                  {ranges.length > 1 && target ? (
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={async () => {
                        const payload = {
                          organizationId: target.organizationId,
                          schoolId: target.schoolId,
                          data: { academicYearId: target.academicYearId, from: range.from },
                        };
                        if (!pending) {
                          setRemoving(range.from);
                          removePreview.mutate({ ...payload, data: { ...payload.data, dryRun: true } });
                          return;
                        }
                        try {
                          await remove.mutateAsync(payload);
                          await done();
                        } catch {
                          // Shown below.
                        }
                      }}
                      style={[styles.remove, pending ? styles.removeArmed : null]}
                      testID={`cal-structure-remove-${range.from}`}
                    >
                      <ThemedText variant="chip" color={pending ? colors.onAccent : colors.tone.critical.fg}>
                        {pending ? words.structureRemoveConfirm : words.remove}
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      <ThemedText variant="sectionLabel" style={styles.section}>
        {words.structureAdd}
      </ThemedText>
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
                    testID={`cal-structure-${day}-${value}`}
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
      <View style={styles.dates}>
        <View style={styles.flex}>
          <DateField
            label={words.structureFrom}
            value={from}
            onChange={(iso) => {
              setFrom(iso);
              if (until && until < iso) setUntil(iso);
            }}
            minimumDate={start}
            maximumDate={end}
            testID="cal-structure-from"
          />
        </View>
        <View style={styles.flex}>
          {until ? (
            <DateField
              label={words.structureUntil}
              value={until}
              onChange={setUntil}
              minimumDate={from}
              maximumDate={end}
              testID="cal-structure-until"
            />
          ) : (
            <View>
              <ThemedText variant="caption" style={styles.untilLabel}>
                {words.structureUntil}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => setUntil(end)}
                style={styles.untilEnd}
                testID="cal-structure-until-set"
              >
                <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {words.structureEnd}
                </ThemedText>
                <ThemedText variant="chip" color={colors.accentDeep}>
                  {words.structurePick}
                </ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      </View>
      {until ? (
        <Pressable accessibilityRole="button" onPress={() => setUntil(null)} hitSlop={8} style={styles.clearUntil}>
          <ThemedText variant="chip" color={colors.accentDeep}>
            {words.structureNoEnd}
          </ThemedText>
        </Pressable>
      ) : null}
      {result && valid ? (
        <View style={styles.note} testID="cal-structure-preview">
          <ThemedText variant="bodyStrong">
            {result.changed === 0 ? words.patternNone : words.patternChanged(result.changed, result.schoolDelta)}
          </ThemedText>
          <ThemedText variant="meta">{words.patternKeeps}</ThemedText>
          {result.skipped > 0 ? (
            <ThemedText variant="meta" color={colors.tone.caution.fg}>
              {words.patternSkipped(result.skipped)}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
      {apply.error ?? remove.error ? <ErrorCard cause={apply.error ?? remove.error} style={styles.section} /> : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginTop: spacing.lg },
  list: { marginTop: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline },
  range: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  separated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  remove: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.tone.critical.bg,
  },
  removeArmed: { backgroundColor: colors.tone.critical.fg },
  week: { marginTop: spacing.sm, gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { width: 40 },
  tri: { flex: 1, flexDirection: "row", padding: 3, borderRadius: radius.full, backgroundColor: colors.field },
  option: { flex: 1, minHeight: 36, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  optionOn: { backgroundColor: colors.surface, boxShadow: "0 1px 2px rgba(16, 24, 40, 0.12)" },
  dates: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.md },
  untilLabel: { marginBottom: spacing.xs },
  untilEnd: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputLine,
    backgroundColor: colors.field,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  clearUntil: { alignSelf: "flex-end", marginTop: spacing.xs },
  note: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.neutral.bg,
    gap: 2,
  },
});
