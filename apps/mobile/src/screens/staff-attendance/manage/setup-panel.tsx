import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { DateField } from "../../../components/date-field";
import { ErrorCard } from "../../../components/error-card";
import { ScreenFrame } from "../../../components/screen-frame";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext } from "../../../hooks/use-active-context";
import { usePermissions } from "../../../hooks/use-permissions";
import { copy } from "../../../lib/copy";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { fontFamily, radius, spacing } from "../../../theme/tokens";
import {
  DEFAULT_PATTERN,
  WEEK_ORDER,
  countSession,
  datesBetween,
  groupEntries,
  nationalHolidays,
  patternType,
} from "./calendar-lib";
import type { DayType, Entry, PatternDay } from "./calendar-lib";
import { EntrySheet, ImportSheet } from "./calendar-sheets";
import { EntryRow, rangeLabel, sessionRange } from "./calendar-ui";

type Source = "last" | "national" | "import" | "empty";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TRI: readonly PatternDay[] = ["working", "half_day", "weekend"];

/**
 * The guided set-up (ADR-069, mockup A2–A4): the normal week, the holidays
 * from a starting list, then the totals — saved in one call. Nothing is
 * written until "Save calendar".
 */
export function CalendarSetup() {
  const { has } = usePermissions();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const utils = trpc.useUtils();
  const words = copy.attendance.manage.cal;

  const start = academicYear?.startDate ?? "";
  const end = academicYear?.endDate ?? "";
  const [step, setStep] = useState(1);
  const [pattern, setPattern] = useState<PatternDay[]>([...DEFAULT_PATTERN]);
  const [startFrom, setStartFrom] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editing, setEditing] = useState<{ entry: Entry | null } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const ready = Boolean(organizationId && schoolId && academicYear);
  const previous = trpc.attendance.calendar.previousEntries.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: ready && has("attendance:update"), staleTime: 300_000 },
  );
  const lastEntries = useMemo(() => {
    const rows = previous.data?.entries ?? [];
    const grouped = groupEntries(rows.map((r) => ({ date: r.date, dayType: r.dayType as DayType, reason: r.reason })));
    const checkOf = new Map(rows.map((r) => [r.date, r.check]));
    return grouped.map((e) => ({ ...e, check: datesBetween(e.from, e.to).some((iso) => checkOf.get(iso)) }));
  }, [previous.data]);

  const setup = trpc.attendance.calendar.setup.useMutation();

  const from = startFrom ?? start;
  const overrides = useMemo(() => {
    const map = new Map<string, DayType>();
    for (const entry of entries) {
      for (const iso of datesBetween(entry.from, entry.to)) {
        // A range keeps its off days off.
        if (entry.from !== entry.to && patternType(pattern, iso) === "weekend") continue;
        map.set(iso, entry.dayType);
      }
    }
    return map;
  }, [entries, pattern]);
  const weekOnly = useMemo(() => (start ? countSession(pattern, from, end, new Map()) : null), [pattern, from, end, start]);
  const totals = useMemo(() => (start ? countSession(pattern, from, end, overrides) : null), [pattern, from, end, overrides, start]);

  if (!ready || !academicYear) {
    return (
      <ScreenFrame title={words.setupTitle} backAccessibilityLabel={copy.attendance.manage.back} padForTabBar>
        <Card>
          <ThemedText variant="bodyStrong">{copy.session.noYearTitle}</ThemedText>
        </Card>
      </ScreenFrame>
    );
  }

  const pick = (next: Source) => {
    setSource(next);
    setNote(null);
    if (next === "last") setEntries(lastEntries);
    if (next === "national") setEntries(nationalHolidays(start, end));
    if (next === "empty") setEntries([]);
    if (next === "import") setImportOpen(true);
  };

  const save = async () => {
    if (!organizationId || !schoolId) return;
    try {
      await setup.mutateAsync({
        organizationId,
        schoolId,
        data: {
          academicYearId: academicYear.id,
          weekdays: pattern,
          ...(startFrom ? { startFrom } : {}),
          entries: entries.map((e) => ({ from: e.from, to: e.to, dayType: e.dayType, reason: e.reason })),
        },
      });
      await utils.attendance.invalidate();
      router.back();
    } catch {
      // The error card below shows it.
    }
  };

  const footer =
    step === 1 ? (
      <View>
        <ThemedText variant="meta" style={styles.footHint}>
          {weekOnly ? words.weekFoot(weekOnly.working, weekOnly.half_day) : ""}
        </ThemedText>
        <CapsuleButton title={words.nextHolidays} onPress={() => setStep(2)} disabled={!pattern.some((d) => d !== "weekend")} testID="setup-next-1" />
      </View>
    ) : step === 2 ? (
      <CapsuleButton title={words.nextReview} onPress={() => setStep(3)} testID="setup-next-2" />
    ) : (
      <View>
        <ThemedText variant="meta" style={styles.footHint}>
          {words.reviewFoot}
        </ThemedText>
        <CapsuleButton title={words.saveCalendar} icon="check" loading={setup.isPending} onPress={() => void save()} testID="setup-save" />
      </View>
    );

  return (
    <ScreenFrame
      title={[words.weekTitle, words.holidaysTitle, words.reviewTitle][step - 1]!}
      meta={`${words.setupTitle} · ${academicYear.name}`}
      backAccessibilityLabel={copy.attendance.manage.back}
      backTestID="setup-back"
      padForTabBar
      footer={footer}
      footerVariant="bar"
      stickyHeader={<Steps step={step} onStep={(n) => n < step && setStep(n)} />}
    >
      {step === 1 ? (
        <>
          <ThemedText variant="meta">{words.weekBody}</ThemedText>
          <Card padless style={styles.week}>
            {WEEK_ORDER.map((day, index) => (
              <View key={day} style={[styles.weekRow, index > 0 ? styles.separated : null]}>
                <ThemedText variant="bodyStrong" style={styles.weekName}>
                  {WEEKDAY_NAMES[day]}
                </ThemedText>
                <View style={styles.tri} accessibilityRole="radiogroup">
                  {TRI.map((value) => {
                    const on = pattern[day] === value;
                    return (
                      <Pressable
                        key={value}
                        testID={`setup-day-${day}-${value}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${WEEKDAY_NAMES[day]}, ${words.types[value]}`}
                        onPress={() => {
                          if (on) return;
                          void Haptics.selectionAsync();
                          setPattern((current) => current.map((v, i) => (i === day ? value : v)));
                        }}
                        style={[styles.triOption, on ? styles.triOn : null]}
                      >
                        <ThemedText
                          variant="chip"
                          color={on ? (value === "working" ? colors.accentDeep : value === "half_day" ? colors.tone.caution.fg : colors.tone.neutral.fg) : colors.muted}
                        >
                          {words.types[value]}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </Card>
          <Card style={styles.startCard}>
            <DateField
              label={words.startFrom}
              help={words.startFromHint}
              value={startFrom ?? start}
              onChange={(iso) => setStartFrom(iso === start ? null : iso)}
              minimumDate={start}
              maximumDate={end}
              testID="setup-start-from"
            />
          </Card>
        </>
      ) : step === 2 ? (
        <>
          <ThemedText variant="meta">{words.holidaysBody}</ThemedText>
          <Choice
            on={source === "last"}
            title={words.sourceLast}
            body={lastEntries.length > 0 ? words.sourceLastBody(lastEntries.length) : words.sourceLastNone}
            disabled={lastEntries.length === 0}
            onPress={() => pick("last")}
            testID="setup-source-last"
          />
          <Choice on={source === "national"} title={words.sourceNational} body={words.sourceNationalBody} onPress={() => pick("national")} testID="setup-source-national" />
          <Choice on={source === "import"} title={words.sourceImport} body={words.sourceImportBody} onPress={() => pick("import")} testID="setup-source-import" />
          <Choice on={source === "empty"} title={words.sourceEmpty} body={words.sourceEmptyBody} onPress={() => pick("empty")} testID="setup-source-empty" />
          {note ? (
            <ThemedText variant="meta" color={colors.tone.caution.fg} style={styles.note}>
              {note}
            </ThemedText>
          ) : null}
          <View style={styles.listHead}>
            <ThemedText variant="sectionLabel">
              {words.draftCount(entries.length, entries.filter((e) => e.check).length)}
            </ThemedText>
          </View>
          {entries.length > 0 ? (
            <Card padless>
              {entries.map((entry, index) => (
                <EntryRow
                  key={entry.key}
                  entry={entry}
                  first={index === 0}
                  meta={rangeLabel(entry.from, entry.to)}
                  onPress={() => setEditing({ entry })}
                />
              ))}
            </Card>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => setEditing({ entry: null })}
            style={({ pressed }) => [styles.addRow, pressed ? styles.pressed : null]}
            testID="setup-add"
          >
            <AppIcon name="add" size={18} color={colors.accentDeep} />
            <ThemedText variant="bodyStrong" color={colors.accentDeep}>
              {words.addHoliday}
            </ThemedText>
          </Pressable>
        </>
      ) : totals ? (
        <Review totals={totals} pattern={pattern} overrides={overrides} from={from} end={end} range={sessionRange(from, end)} />
      ) : null}
      {step === 3 && setup.error ? <ErrorCard cause={setup.error} style={styles.note} /> : null}

      {editing ? (
        <EntrySheet
          entry={editing.entry}
          start={start}
          end={end}
          others={entries}
          pending={false}
          error={null}
          onClose={() => setEditing(null)}
          onRemove={
            editing.entry
              ? () => {
                  setEntries((list) => list.filter((e) => e.key !== editing.entry!.key));
                  setEditing(null);
                }
              : undefined
          }
          onSave={(next) => {
            setEntries((list) => {
              const kept = list.filter((e) => e.key !== editing.entry?.key);
              return [...kept, { ...next, key: `${next.from}-${Date.now()}`, check: false }].sort((a, b) => (a.from < b.from ? -1 : 1));
            });
            setEditing(null);
          }}
        />
      ) : null}
      {importOpen ? (
        <ImportSheet
          start={start}
          end={end}
          onClose={() => setImportOpen(false)}
          onUse={(list, outside) => {
            setEntries((current) => [...current, ...list].sort((a, b) => (a.from < b.from ? -1 : 1)));
            setNote(outside > 0 ? words.outside(outside) : null);
            setImportOpen(false);
          }}
        />
      ) : null}
    </ScreenFrame>
  );
}

function Steps({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  return (
    <View style={styles.steps}>
      {[1, 2, 3].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="button"
          accessibilityLabel={copy.attendance.manage.cal.step(n)}
          disabled={n >= step}
          onPress={() => onStep(n)}
          hitSlop={8}
          style={[styles.stepBar, n <= step ? styles.stepOn : null]}
        />
      ))}
      <ThemedText variant="caption" color={colors.muted}>
        {copy.attendance.manage.cal.step(step)}
      </ThemedText>
    </View>
  );
}

function Choice({
  on,
  title,
  body,
  disabled = false,
  onPress,
  testID,
}: {
  on: boolean;
  title: string;
  body: string;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, on ? styles.choiceOn : null, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
    >
      <View style={[styles.radio, on ? styles.radioOn : null]} />
      <View style={styles.flex}>
        <ThemedText variant="bodyStrong">{title}</ThemedText>
        <ThemedText variant="meta">{body}</ThemedText>
      </View>
    </Pressable>
  );
}

const MINI: Record<DayType, string> = {
  working: "#D9EFE3",
  half_day: "#FCE3B6",
  exam_day: "#C7D7FE",
  holiday: "#F9C7C2",
  weekend: "#F2F4F7",
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A4: the number every % divides by, the mix, and twelve tiny months. */
function Review({
  totals,
  pattern,
  overrides,
  from,
  end,
  range,
}: {
  totals: ReturnType<typeof countSession>;
  pattern: readonly PatternDay[];
  overrides: ReadonlyMap<string, DayType>;
  from: string;
  end: string;
  range: string;
}) {
  const words = copy.attendance.manage.cal;
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= end.slice(0, 7); ) {
    months.push(m);
    const y = Number(m.slice(0, 4));
    const mo = Number(m.slice(5, 7));
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  const mix: [DayType, number][] = [
    ["working", totals.working],
    ["half_day", totals.half_day],
    ["exam_day", totals.exam_day],
    ["holiday", totals.holiday],
    ["weekend", totals.weekend],
  ];
  return (
    <>
      <Card style={styles.hero}>
        <View style={styles.heroRow}>
          <ThemedText style={styles.heroNum} color={colors.accentDeep} testID="setup-school-days">
            {totals.school}
          </ThemedText>
          <ThemedText variant="bodyStrong">{words.schoolDays}</ThemedText>
        </View>
        <ThemedText variant="meta">{words.reviewBody(range)}</ThemedText>
        <View style={styles.split}>
          {mix.map(([type, n]) =>
            n > 0 ? <View key={type} style={{ flex: n, backgroundColor: type === "working" ? "#9BD3B4" : type === "weekend" ? "#E4E7EC" : MINI[type] }} /> : null,
          )}
        </View>
        <View style={styles.legend}>
          {mix.map(([type, n]) => (
            <View key={type} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: type === "working" ? "#9BD3B4" : type === "weekend" ? "#E4E7EC" : MINI[type] }]} />
              <ThemedText variant="caption" color={colors.muted}>
                <ThemedText variant="caption" color={colors.ink} style={styles.bold}>
                  {n}
                </ThemedText>{" "}
                {words.typesLong[type].toLowerCase()}
              </ThemedText>
            </View>
          ))}
        </View>
      </Card>
      <Card style={styles.months}>
        {months.map((key) => {
          const y = Number(key.slice(0, 4));
          const mo = Number(key.slice(5, 7));
          const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
          const first = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
          const days = Array.from({ length: last }, (_, i) => `${key}-${String(i + 1).padStart(2, "0")}`);
          const school = days.filter((iso) => {
            if (iso < from || iso > end) return false;
            const t = overrides.get(iso) ?? patternType(pattern, iso);
            return t === "working" || t === "half_day" || t === "exam_day";
          }).length;
          return (
            <View key={key} style={styles.mini}>
              <View style={styles.miniHead}>
                <ThemedText variant="tab" color={colors.muted}>
                  {MONTH_NAMES[mo - 1]}
                </ThemedText>
                <ThemedText variant="tab" color={colors.ink} style={styles.bold}>
                  {school}
                </ThemedText>
              </View>
              <View style={styles.miniGrid}>
                {Array.from({ length: first }, (_, i) => (
                  <View key={`e${i}`} style={styles.miniCell} />
                ))}
                {days.map((iso) => {
                  const outside = iso < from || iso > end;
                  const t = overrides.get(iso) ?? patternType(pattern, iso);
                  return <View key={iso} style={[styles.miniCell, { backgroundColor: outside ? "transparent" : MINI[t] }]} />;
                })}
              </View>
            </View>
          );
        })}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontFamily: fontFamily.semibold },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  steps: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingBottom: spacing.sm },
  stepBar: { flex: 1, height: 4, borderRadius: radius.full, backgroundColor: colors.field },
  stepOn: { backgroundColor: colors.accent },
  footHint: { textAlign: "center", marginBottom: spacing.sm },
  week: { marginTop: spacing.md },
  weekRow: { flexDirection: "row", alignItems: "center", minHeight: 56, paddingHorizontal: spacing.md, gap: spacing.sm },
  separated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  weekName: { width: 44 },
  tri: { flex: 1, flexDirection: "row", padding: 3, borderRadius: radius.full, backgroundColor: colors.field },
  triOption: { flex: 1, minHeight: 36, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  triOn: { backgroundColor: colors.surface, boxShadow: "0 1px 2px rgba(16, 24, 40, 0.12)" },
  startCard: { marginTop: spacing.md },
  choice: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  choiceOn: { borderWidth: 2, borderColor: colors.accent },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.inputLine, marginTop: 2 },
  radioOn: { borderWidth: 6, borderColor: colors.accent },
  note: { marginTop: spacing.sm },
  listHead: { marginTop: spacing.lg, marginBottom: spacing.xs, paddingHorizontal: spacing.xs },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: 48,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.inputLine,
  },
  hero: { marginTop: spacing.xs, gap: spacing.xs },
  heroRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  heroNum: { fontSize: 52, lineHeight: 58, fontFamily: fontFamily.bold, letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  split: { flexDirection: "row", height: 10, borderRadius: radius.full, overflow: "hidden", gap: 2, marginTop: spacing.sm },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: spacing.xxs, marginTop: spacing.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 3 },
  months: { marginTop: spacing.md, flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md, columnGap: "4%" as unknown as number },
  mini: { width: "22%" },
  miniHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  miniGrid: { flexDirection: "row", flexWrap: "wrap" },
  miniCell: { width: `${100 / 7}%`, aspectRatio: 1, borderWidth: 0.75, borderColor: colors.surface, borderRadius: 2 },
});
