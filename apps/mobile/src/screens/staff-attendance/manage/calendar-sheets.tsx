import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { CapsuleButton } from "../../../components/capsule-button";
import { DateField } from "../../../components/date-field";
import { ErrorCard } from "../../../components/error-card";
import { FormSheet } from "../../../components/form-sheet";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext } from "../../../hooks/use-active-context";
import { copy } from "../../../lib/copy";
import { formatShortWeekday } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { fontFamily, radius, spacing } from "../../../theme/tokens";
import {
  datesBetween,
  isSchoolDay,
  parseImport,
  patternType,
} from "./calendar-lib";
import type { DayType, Entry, PatternDay } from "./calendar-lib";
import { TypePicker, typeName } from "./calendar-ui";

const words = () => copy.attendance.manage.cal;

type Usage = { date: string; sectionId: string; label: string; students: number }[];
type Write = { dates: string[]; dayType: DayType; reason: string | null };

const MON_FRI: PatternDay[] = ["weekend", "working", "working", "working", "working", "working", "weekend"];

/**
 * Calendar writes from the editing screens. A change that turns days with
 * saved attendance into non-school days stops for one confirm first (B5):
 * the marks are kept but stop counting (ADR-069).
 */
export function useCalendarWrites(pattern: readonly PatternDay[] | null) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const utils = trpc.useUtils();
  const setDays = trpc.attendance.calendar.setDays.useMutation();
  const [confirm, setConfirm] = useState<{ writes: Write[]; usage: Usage; onDone: () => void } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = async (writes: Write[]) => {
    if (!organizationId || !schoolId || !academicYear) return;
    for (const write of writes) {
      if (write.dates.length === 0) continue;
      await setDays.mutateAsync({
        organizationId,
        schoolId,
        data: { academicYearId: academicYear.id, dates: write.dates, dayType: write.dayType, reason: write.reason },
      });
    }
    await utils.attendance.invalidate();
  };

  /** Writes, or asks first when marked days would stop being school days. */
  const submit = async (writes: Write[], onDone: () => void) => {
    setError(null);
    if (!organizationId || !schoolId || !academicYear) return;
    try {
      const closing = writes.filter((w) => !isSchoolDay(w.dayType)).flatMap((w) => w.dates);
      if (closing.length > 0) {
        const usage = await utils.attendance.calendar.usage.fetch({
          organizationId,
          schoolId,
          academicYearId: academicYear.id,
          dates: closing,
        });
        if (usage.length > 0) {
          setConfirm({ writes, usage, onDone });
          return;
        }
      }
      await run(writes);
      onDone();
    } catch (cause) {
      setError(cause);
    }
  };

  /** The writes that put dates back to the normal week, grouped by type. */
  const revertWrites = (dates: readonly string[]): Write[] => {
    const week = pattern ?? MON_FRI;
    const by = new Map<DayType, string[]>();
    for (const iso of dates) {
      const type = patternType(week, iso);
      by.set(type, [...(by.get(type) ?? []), iso]);
    }
    return [...by].map(([dayType, list]) => ({ dates: list, dayType, reason: null }));
  };

  const confirmSheet = confirm ? (
    <MarkedConfirmSheet
      usage={confirm.usage}
      type={confirm.writes.find((w) => !isSchoolDay(w.dayType))?.dayType ?? "holiday"}
      submitting={setDays.isPending}
      error={error}
      onClose={() => setConfirm(null)}
      onConfirm={async () => {
        try {
          await run(confirm.writes);
          const done = confirm.onDone;
          setConfirm(null);
          done();
        } catch (cause) {
          setError(cause);
        }
      }}
    />
  ) : null;

  return { submit, revertWrites, pending: setDays.isPending, error, confirmSheet };
}

/** B5: which sections already marked these days, then one confirm. */
function MarkedConfirmSheet({
  usage,
  type,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  usage: Usage;
  type: DayType;
  submitting: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dates = [...new Set(usage.map((u) => u.date))];
  const sections = new Map(usage.map((u) => [u.sectionId, u.label]));
  const typeWord = copy.attendance.manage.cal.typesLong[type].toLowerCase();
  return (
    <FormSheet
      title={dates.length === 1 ? words().markedTitle(formatShortWeekday(dates[0])) : words().markedTitleMany(dates.length)}
      onClose={onClose}
      testIDPrefix="cal-marked"
      footer={
        <View style={styles.footerRow}>
          <CapsuleButton title={words().back} variant="secondary" onPress={onClose} style={styles.flex} />
          <CapsuleButton
            title={words().markedConfirm(type === "holiday" ? "a holiday" : typeWord)}
            loading={submitting}
            onPress={onConfirm}
            style={styles.flex}
            testID="cal-marked-confirm"
          />
        </View>
      }
    >
      <ThemedText variant="meta">{words().markedBody(sections.size)}</ThemedText>
      <View style={styles.sections}>
        {[...sections.values()].map((label) => (
          <View key={label} style={styles.sectionChip}>
            <ThemedText variant="chip" color={colors.accentDeep}>
              {label}
            </ThemedText>
          </View>
        ))}
      </View>
      <View style={styles.note}>
        <ThemedText variant="meta" color={colors.ink}>
          {words().markedKeep(typeWord)}
        </ThemedText>
      </View>
      {error ? <ErrorCard cause={error} style={styles.error} /> : null}
    </FormSheet>
  );
}

const ALL_TYPES: readonly DayType[] = ["working", "half_day", "exam_day", "holiday", "weekend"];

/** B2: one or several picked days set to one type and name. */
export function SetDaysSheet({
  dates,
  initialType,
  initialReason,
  pending,
  error,
  onSave,
  onClose,
}: {
  dates: readonly string[];
  initialType: DayType;
  initialReason: string | null;
  pending: boolean;
  error: unknown;
  onSave: (type: DayType, reason: string | null) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<DayType>(initialType);
  const [reason, setReason] = useState(initialReason ?? "");
  const title =
    dates.length === 1 ? formatShortWeekday(dates[0]) : words().setTitle(dates.length);
  return (
    <FormSheet
      title={title}
      onClose={onClose}
      testIDPrefix="cal-set"
      footer={
        <CapsuleButton
          title={words().save(dates.length)}
          loading={pending}
          onPress={() => onSave(type, reason.trim() || null)}
          testID="cal-set-save"
        />
      }
    >
      {dates.length === 1 ? (
        <ThemedText variant="sectionLabel">{words().setTitle(1)}</ThemedText>
      ) : null}
      <View style={styles.gap}>
        <TypePicker value={type} options={ALL_TYPES} onChange={setType} />
      </View>
      <ThemedText variant="sectionLabel" style={styles.label}>
        {words().nameLabel}
      </ThemedText>
      <TextInput
        testID="cal-set-name"
        value={reason}
        onChangeText={setReason}
        placeholder={words().namePlaceholder}
        placeholderTextColor={colors.muted}
        maxLength={255}
        style={styles.input}
      />
      {error ? <ErrorCard cause={error} style={styles.error} /> : null}
    </FormSheet>
  );
}

const ENTRY_TYPES: readonly DayType[] = ["holiday", "exam_day", "half_day"];

/**
 * B4: add or edit a named entry — one day or a range. Used live on the
 * calendar and as a draft editor in set-up. Mentions overlaps with other
 * entries instead of overwriting silently.
 */
export function EntrySheet({
  entry,
  start,
  end,
  others,
  pending,
  error,
  onSave,
  onRemove,
  onClose,
}: {
  entry: Entry | null;
  start: string;
  end: string;
  /** The other entries, for the overlap note. */
  others: readonly Entry[];
  pending: boolean;
  error: unknown;
  onSave: (next: Omit<Entry, "key">) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(entry?.reason ?? "");
  const [type, setType] = useState<DayType>(entry?.dayType ?? "holiday");
  const [several, setSeveral] = useState(entry ? entry.from !== entry.to : false);
  const [from, setFrom] = useState(entry?.from ?? "");
  const [to, setTo] = useState(entry?.to ?? "");
  const [tried, setTried] = useState(false);

  const effectiveTo = several ? to || from : from;
  const valid = Boolean(reason.trim() && from && effectiveTo && effectiveTo >= from);
  const overlap = useMemo(() => {
    if (!from) return null;
    const mine = new Set(datesBetween(from, effectiveTo || from));
    return (
      others.find(
        (other) => other.key !== entry?.key && datesBetween(other.from, other.to).some((iso) => mine.has(iso)),
      ) ?? null
    );
  }, [from, effectiveTo, others, entry?.key]);

  return (
    <FormSheet
      title={entry ? words().editTitle : words().addTitle}
      onClose={onClose}
      testIDPrefix="cal-entry"
      footer={
        <View style={styles.footerRow}>
          {onRemove ? (
            <CapsuleButton
              title={words().remove}
              variant="secondary"
              onPress={onRemove}
              style={styles.flex}
              testID="cal-entry-remove"
            />
          ) : null}
          <CapsuleButton
            title={entry ? copy.attendance.manage.calendar.save : words().add}
            loading={pending}
            onPress={() => {
              setTried(true);
              if (!valid) return;
              onSave({ from, to: effectiveTo, dayType: type as Entry["dayType"], reason: reason.trim() });
            }}
            style={styles.flex}
            testID="cal-entry-save"
          />
        </View>
      }
    >
      <TextInput
        testID="cal-entry-name"
        value={reason}
        onChangeText={setReason}
        placeholder={words().namePlaceholder}
        placeholderTextColor={colors.muted}
        maxLength={255}
        style={styles.input}
      />
      {tried && !reason.trim() ? (
        <ThemedText variant="caption" color={colors.tone.critical.fg} style={styles.inline}>
          {words().nameRequired}
        </ThemedText>
      ) : null}
      <View style={styles.chips}>
        {[false, true].map((value) => (
          <Pressable
            key={String(value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: several === value }}
            onPress={() => setSeveral(value)}
            style={[styles.chip, several === value ? styles.chipOn : null]}
            testID={value ? "cal-entry-several" : "cal-entry-one"}
          >
            <ThemedText variant="chip" color={several === value ? colors.onAccent : colors.ink}>
              {value ? words().severalDays : words().oneDay}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <View style={styles.dates}>
        <View style={styles.flex}>
          <DateField
            label={several ? words().from : words().on}
            value={from || null}
            onChange={(iso) => {
              setFrom(iso);
              if (to && to < iso) setTo(iso);
            }}
            minimumDate={start}
            maximumDate={end}
            initialDate={start}
            testID="cal-entry-from"
          />
        </View>
        {several ? (
          <View style={styles.flex}>
            <DateField
              label={words().to}
              value={to || null}
              onChange={setTo}
              minimumDate={from || start}
              maximumDate={end}
              initialDate={from || start}
              testID="cal-entry-to"
            />
          </View>
        ) : null}
      </View>
      <ThemedText variant="sectionLabel" style={styles.label}>
        {words().type}
      </ThemedText>
      <View style={styles.gap}>
        <TypePicker value={type} options={ENTRY_TYPES} onChange={setType} />
      </View>
      {overlap ? (
        <View style={styles.note}>
          <ThemedText variant="meta" color={colors.ink}>
            {words().overlap(overlap.reason ?? typeName(overlap.dayType))}
          </ThemedText>
        </View>
      ) : null}
      {onRemove ? (
        <ThemedText variant="caption" color={colors.muted} style={styles.inline}>
          {words().removeHint}
        </ThemedText>
      ) : null}
      {error ? <ErrorCard cause={error} style={styles.error} /> : null}
    </FormSheet>
  );
}

/** Paste import: rows from Excel / Sheets, CSV lines, or a .ics file. */
export function ImportSheet({
  start,
  end,
  onUse,
  onClose,
}: {
  start: string;
  end: string;
  onUse: (entries: Entry[], outside: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const result = useMemo(() => parseImport(text), [text]);
  const inside = result.entries.filter((e) => e.from >= start && e.to <= end);
  const outside = result.entries.length - inside.length;
  return (
    <FormSheet
      title={words().importTitle}
      onClose={onClose}
      testIDPrefix="cal-import"
      footer={
        <CapsuleButton
          title={words().importUse(inside.length)}
          disabled={inside.length === 0}
          onPress={() => onUse(inside, outside)}
          testID="cal-import-use"
        />
      }
    >
      <ThemedText variant="meta">{words().importHelp}</ThemedText>
      <TextInput
        testID="cal-import-text"
        value={text}
        onChangeText={setText}
        multiline
        placeholder={words().importPlaceholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.paste]}
        textAlignVertical="top"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {text.trim() ? (
        <ThemedText variant="meta" style={styles.inline}>
          {words().importRead(result.entries.length, result.skipped.length)}
          {outside > 0 ? ` · ${words().outside(outside)}` : ""}
        </ThemedText>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginTop: spacing.sm },
  label: { marginTop: spacing.lg },
  inline: { marginTop: spacing.xs },
  input: {
    marginTop: spacing.sm,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.regular,
    fontSize: 16,
    color: colors.ink,
  },
  paste: { minHeight: 160, paddingTop: spacing.sm, fontSize: 14 },
  chips: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  chipOn: { backgroundColor: colors.ink },
  dates: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  note: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.neutral.bg,
  },
  sections: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  sectionChip: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  footerRow: { flexDirection: "row", gap: spacing.sm },
  error: { marginTop: spacing.md },
});
