import { memo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../../components/app-icon";
import { ThemedText } from "../../../components/themed-text";
import { copy } from "../../../lib/copy";
import { formatIsoDate, weekdayShort } from "../../../lib/format";
import { colors } from "../../../theme/brand-admin";
import { fontFamily, radius, spacing } from "../../../theme/tokens";
import { daysInMonth, isoOf } from "../calendar-month";
import { DAY_LOOK, EXAM_TONE } from "./calendar-lib";
import type { DayType, Entry } from "./calendar-lib";

const WEEK_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function typeName(type: DayType): string {
  return copy.attendance.manage.cal.types[type];
}

/** "Mon 9 – Wed 11 Nov", "Thu 24 Dec – Fri 1 Jan", or one day. */
export function rangeLabel(from: string, to: string): string {
  const one = (iso: string, withMonth: boolean) =>
    `${weekdayShort(iso)} ${Number(iso.slice(8, 10))}${withMonth ? ` ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}` : ""}`;
  if (from === to) return one(from, true);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${one(from, !sameMonth)} – ${one(to, true)}`;
}

export function monthShort(iso: string): string {
  return MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? "";
}

/**
 * The month grid (B1): days read at a glance — ½ amber, OFF grey, HOL red,
 * EXAM indigo — a green dot where attendance is saved, today ringed, picked
 * days filled ink.
 */
export const MonthGrid = memo(function MonthGrid({
  anchor,
  typeOf,
  marked,
  today,
  selected,
  start,
  end,
  onPress,
  onLongPress,
}: {
  /** Any ISO day in the month shown. */
  anchor: string;
  typeOf: ReadonlyMap<string, DayType>;
  marked: ReadonlySet<string>;
  today: string;
  selected: ReadonlySet<string>;
  start: string;
  end: string;
  onPress?: (iso: string) => void;
  onLongPress?: (iso: string) => void;
}) {
  // Measured, so the seven columns always fit whatever card holds the grid.
  const [width, setWidth] = useState(0);
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  const first = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const count = daysInMonth(year, month);
  const cells: (string | null)[] = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: count }, (_, i) => isoOf(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const cellWidth = Math.floor(Math.min(width, 440) / 7);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {cellWidth > 0 ? (
        <>
          <View style={styles.weekRow}>
            {WEEK_LETTERS.map((letter, index) => (
              <ThemedText
                key={`${letter}-${index}`}
                variant="caption"
                color={index >= 5 ? colors.chevron : colors.muted}
                style={[styles.weekLetter, { width: cellWidth }]}
              >
                {letter}
              </ThemedText>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((iso, index) => {
              if (!iso) return <View key={`b-${index}`} style={{ width: cellWidth, height: 52 }} />;
              const type = typeOf.get(iso) ?? null;
              const look = type ? DAY_LOOK[type] : null;
              const outside = iso < start || iso > end;
              const isSelected = selected.has(iso);
              const isToday = iso === today;
              const day = Number(iso.slice(8, 10));
              const fg = isSelected ? colors.onAccent : type ? look!.fg : colors.tone.caution.fg;
              return (
                <Pressable
                  key={iso}
                  testID={`cal-day-${iso}`}
                  disabled={outside || (!onPress && !onLongPress)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: outside }}
                  accessibilityLabel={`${weekdayShort(iso)} ${day}, ${type ? copy.attendance.manage.cal.typesLong[type] : copy.attendance.marking.dayTypes.none}${marked.has(iso) ? `, ${copy.attendance.marking.marked}` : ""}`}
                  onPress={() => onPress?.(iso)}
                  onLongPress={() => {
                    if (!onLongPress) return;
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onLongPress(iso);
                  }}
                  delayLongPress={350}
                  style={{ width: cellWidth, height: 52, padding: 2 }}
                >
                  {({ pressed }) => (
                    <View
                      style={[
                        styles.cell,
                        {
                          backgroundColor: isSelected ? colors.ink : (look?.bg ?? "transparent"),
                          borderRadius: radius.md,
                          overflow: "hidden",
                        },
                        type === null && !outside ? styles.cellMissing : null,
                        isToday && !isSelected ? styles.cellToday : null,
                        pressed && !isSelected ? styles.cellPressed : null,
                        outside ? styles.cellOutside : null,
                      ]}
                    >
                      {marked.has(iso) && !isSelected ? <View style={styles.dot} /> : null}
                      <ThemedText
                        variant="bodyStrong"
                        color={fg}
                        maxFontSizeMultiplier={1.2}
                        style={[
                          styles.dayNum,
                          type === "weekend" && !isSelected ? styles.dayOff : null,
                        ]}
                      >
                        {day}
                      </ThemedText>
                      <ThemedText
                        variant="tab"
                        color={fg}
                        maxFontSizeMultiplier={1}
                        style={styles.short}
                      >
                        {type ? look!.short || " " : outside ? " " : "—"}
                      </ThemedText>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
});

/** The five types as a grid of big targets (B2, B4). */
export function TypePicker({
  value,
  options,
  onChange,
}: {
  value: DayType;
  options: readonly DayType[];
  onChange: (type: DayType) => void;
}) {
  return (
    <View style={styles.types} accessibilityRole="radiogroup">
      {options.map((type) => {
        const on = type === value;
        const swatch =
          type === "working"
            ? colors.accent
            : type === "weekend"
              ? colors.chevron
              : DAY_LOOK[type].fg;
        return (
          <Pressable
            key={type}
            testID={`cal-type-${type}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => {
              if (!on) void Haptics.selectionAsync();
              onChange(type);
            }}
            style={({ pressed }) => [
              styles.type,
              on ? styles.typeOn : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <View style={[styles.swatch, { backgroundColor: swatch }]} />
            <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.typeText}>
              {typeName(type)}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One holiday-list row: date tile, name, range, type pill or check flag. */
export function EntryRow({
  entry,
  meta,
  onPress,
  first,
}: {
  entry: Entry;
  meta: string;
  onPress?: () => void;
  first?: boolean;
}) {
  const look = DAY_LOOK[entry.dayType];
  return (
    <Pressable
      testID={`cal-entry-${entry.from}`}
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.entry,
        first ? null : styles.entrySeparated,
        pressed ? styles.entryPressed : null,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: look.bg }]}>
        <ThemedText variant="bodyStrong" color={look.fg} style={styles.tileDay}>
          {Number(entry.from.slice(8, 10))}
        </ThemedText>
        <ThemedText variant="tab" color={look.fg} style={styles.tileMonth}>
          {monthShort(entry.from).toUpperCase()}
        </ThemedText>
      </View>
      <View style={styles.entryText}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {entry.reason ?? typeName(entry.dayType)}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {meta}
        </ThemedText>
      </View>
      {entry.check ? (
        <View style={[styles.pill, { backgroundColor: colors.tone.caution.bg }]}>
          <AppIcon name="warning" size={12} color={colors.tone.caution.fg} />
          <ThemedText variant="chip" color={colors.tone.caution.fg}>
            {copy.attendance.manage.cal.checkDate}
          </ThemedText>
        </View>
      ) : (
        <View style={[styles.pill, { backgroundColor: look.bg }]}>
          <ThemedText variant="chip" color={look.fg}>
            {typeName(entry.dayType)}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

/** "1 Apr 2027 – 31 Mar 2028". */
export function sessionRange(start: string, end: string): string {
  return `${formatIsoDate(start)} – ${formatIsoDate(end)}`;
}

export const examSwatch = EXAM_TONE;

const styles = StyleSheet.create({
  weekRow: { flexDirection: "row", alignSelf: "center", marginBottom: spacing.xxs },
  weekLetter: { textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", alignSelf: "center" },
  cell: {
    flex: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cellMissing: { borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.tone.caution.fg },
  cellToday: { borderWidth: 2, borderColor: colors.accent },
  cellPressed: { backgroundColor: colors.field },
  cellOutside: { opacity: 0.25 },
  dot: {
    position: "absolute",
    top: 5,
    right: 6,
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  dayNum: { fontVariant: ["tabular-nums"], fontSize: 15, lineHeight: 18 },
  dayOff: { fontFamily: fontFamily.regular },
  short: { fontSize: 9, lineHeight: 11, fontFamily: fontFamily.bold, letterSpacing: 0.3 },
  types: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  type: {
    flexBasis: "30%",
    flexGrow: 1,
    minHeight: 48,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.xs,
  },
  typeOn: { borderWidth: 2, borderColor: colors.ink },
  typeText: { flexShrink: 1 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  pressed: { opacity: 0.8 },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  entrySeparated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  entryPressed: { backgroundColor: colors.field },
  tile: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  tileDay: { fontSize: 17, lineHeight: 19, fontFamily: fontFamily.bold },
  tileMonth: { fontSize: 10, lineHeight: 12, fontFamily: fontFamily.semibold, letterSpacing: 0.4 },
  entryText: { flex: 1, gap: 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
});

/** Day colours at a glance (owner, 2026-11-15: stronger than the first pass). */
export const MINI_FILL: Record<DayType, string> = {
  working: "#8FCFAC",
  half_day: "#F6C46F",
  exam_day: "#93AEFA",
  holiday: "#EE8E85",
  weekend: "#E4E7EC",
};

const MIX_ORDER: readonly DayType[] = ["working", "half_day", "exam_day", "holiday", "weekend"];
const MIX_WORDS: Record<DayType, string> = {
  working: "working",
  half_day: "half",
  exam_day: "exam",
  holiday: "holidays",
  weekend: "off",
};

export type DayCounts = Record<DayType, number>;

export function countDays(
  from: string,
  to: string,
  typeAt: (iso: string) => DayType | null,
): DayCounts {
  const counts: DayCounts = { working: 0, half_day: 0, exam_day: 0, holiday: 0, weekend: 0 };
  const cursor = new Date(`${from}T00:00:00Z`);
  const stop = new Date(`${to}T00:00:00Z`);
  while (cursor <= stop) {
    const t = typeAt(cursor.toISOString().slice(0, 10));
    if (t) counts[t] += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return counts;
}

/** The session in one card: school days big, the mix as one bar, a legend. */
export function SessionMix({ counts, caption }: { counts: DayCounts; caption: string }) {
  const school = counts.working + counts.half_day + counts.exam_day;
  return (
    <View style={mixStyles.card} testID="cal-mix">
      <View style={mixStyles.heroRow}>
        <ThemedText style={mixStyles.heroNum} color={colors.accentDeep}>
          {school}
        </ThemedText>
        <ThemedText variant="bodyStrong">{copy.attendance.manage.cal.schoolDays}</ThemedText>
      </View>
      <ThemedText variant="meta">{caption}</ThemedText>
      <View style={mixStyles.split}>
        {MIX_ORDER.map((type) =>
          counts[type] > 0 ? (
            <View key={type} style={{ flex: counts[type], backgroundColor: MINI_FILL[type] }} />
          ) : null,
        )}
      </View>
      <View style={mixStyles.legend}>
        {MIX_ORDER.map((type) => (
          <View key={type} style={mixStyles.legendItem}>
            <View style={[mixStyles.legendDot, { backgroundColor: MINI_FILL[type] }]} />
            <ThemedText variant="caption" color={colors.muted}>
              <ThemedText variant="caption" color={colors.ink} style={mixStyles.bold}>
                {counts[type]}
              </ThemedText>{" "}
              {MIX_WORDS[type]}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Month by month: a bar of the month's days and its numbers; tap opens it. */
export function MonthBreakdown({
  from,
  end,
  typeAt,
  onPickMonth,
}: {
  from: string;
  end: string;
  typeAt: (iso: string) => DayType | null;
  onPickMonth?: (monthIso: string) => void;
}) {
  const words = copy.attendance.manage.cal;
  const rows: { key: string; counts: DayCounts }[] = [];
  for (let m = from.slice(0, 7); m <= end.slice(0, 7);) {
    const y = Number(m.slice(0, 4));
    const mo = Number(m.slice(5, 7));
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const a = `${m}-01` < from ? from : `${m}-01`;
    const b =
      `${m}-${String(last).padStart(2, "0")}` > end ? end : `${m}-${String(last).padStart(2, "0")}`;
    rows.push({ key: m, counts: countDays(a, b, typeAt) });
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return (
    <View testID="cal-breakdown">
      {rows.map(({ key, counts }, index) => {
        const school = counts.working + counts.half_day + counts.exam_day;
        const extras = [
          counts.holiday ? words.breakHol(counts.holiday) : null,
          counts.exam_day ? words.breakExam(counts.exam_day) : null,
          counts.half_day ? words.breakHalf(counts.half_day) : null,
        ].filter(Boolean);
        return (
          <Pressable
            key={key}
            disabled={!onPickMonth}
            onPress={() => onPickMonth?.(`${key}-01`)}
            accessibilityRole={onPickMonth ? "button" : undefined}
            style={({ pressed }) => [
              breakStyles.row,
              index > 0 ? breakStyles.separated : null,
              pressed ? breakStyles.pressed : null,
            ]}
            testID={`cal-breakdown-${key}`}
          >
            <ThemedText variant="bodyStrong" style={breakStyles.month}>
              {MONTHS_SHORT[Number(key.slice(5, 7)) - 1]}
            </ThemedText>
            <View style={breakStyles.body}>
              <View style={breakStyles.bar}>
                {MIX_ORDER.map((type) =>
                  counts[type] > 0 ? (
                    <View
                      key={type}
                      style={{ flex: counts[type], backgroundColor: MINI_FILL[type] }}
                    />
                  ) : null,
                )}
              </View>
              <ThemedText variant="caption" color={colors.muted} numberOfLines={1}>
                {extras.length > 0 ? extras.join(" · ") : words.breakNone}
              </ThemedText>
            </View>
            <ThemedText variant="bodyStrong" color={colors.accentDeep} style={breakStyles.num}>
              {school}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const mixStyles = StyleSheet.create({
  card: { gap: spacing.xs },
  heroRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  heroNum: {
    fontSize: 48,
    lineHeight: 54,
    fontFamily: fontFamily.bold,
    letterSpacing: -1.5,
    fontVariant: ["tabular-nums"],
  },
  split: {
    flexDirection: "row",
    height: 12,
    borderRadius: radius.full,
    overflow: "hidden",
    gap: 2,
    marginTop: spacing.sm,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.md,
    rowGap: spacing.xxs,
    marginTop: spacing.xs,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 3 },
  bold: { fontFamily: fontFamily.semibold },
});

const breakStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  separated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  pressed: { backgroundColor: colors.field },
  month: { width: 36 },
  body: { flex: 1, gap: 4 },
  bar: { flexDirection: "row", height: 8, borderRadius: radius.full, overflow: "hidden", gap: 1.5 },
  num: { width: 28, textAlign: "right", fontVariant: ["tabular-nums"] },
});

/**
 * The whole session at a glance: one tiny month per tile with its school-day
 * count. Used by set-up's review and the calendar's Year view, where a tap
 * opens that month.
 */
export function YearGrid({
  from,
  end,
  typeAt,
  onPickMonth,
}: {
  from: string;
  end: string;
  /** The day's type, or null when the calendar has no entry. */
  typeAt: (iso: string) => DayType | null;
  onPickMonth?: (monthIso: string) => void;
}) {
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= end.slice(0, 7);) {
    months.push(m);
    const y = Number(m.slice(0, 4));
    const mo = Number(m.slice(5, 7));
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return (
    <View style={yearStyles.wrap} testID="cal-year">
      {months.map((key) => {
        const y = Number(key.slice(0, 4));
        const mo = Number(key.slice(5, 7));
        const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        const first = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
        const days = Array.from(
          { length: last },
          (_, i) => `${key}-${String(i + 1).padStart(2, "0")}`,
        );
        const school = days.filter((iso) => {
          if (iso < from || iso > end) return false;
          const t = typeAt(iso);
          return t === "working" || t === "half_day" || t === "exam_day";
        }).length;
        return (
          <Pressable
            key={key}
            disabled={!onPickMonth}
            accessibilityRole={onPickMonth ? "button" : undefined}
            accessibilityLabel={`${MONTHS_SHORT[mo - 1]} ${y}, ${school} ${copy.attendance.manage.cal.schoolDays}`}
            onPress={() => onPickMonth?.(`${key}-01`)}
            style={({ pressed }) => [yearStyles.mini, pressed ? yearStyles.pressed : null]}
            testID={`cal-year-${key}`}
          >
            <View style={yearStyles.head}>
              <ThemedText variant="tab" color={colors.muted}>
                {MONTHS_SHORT[mo - 1]}
              </ThemedText>
              <ThemedText variant="tab" color={colors.ink} style={yearStyles.bold}>
                {school}
              </ThemedText>
            </View>
            <View style={yearStyles.grid}>
              {Array.from({ length: first }, (_, i) => (
                <View key={`e${i}`} style={yearStyles.cell} />
              ))}
              {days.map((iso) => {
                const outside = iso < from || iso > end;
                const t = outside ? null : typeAt(iso);
                return (
                  <View
                    key={iso}
                    style={[
                      yearStyles.cell,
                      t ? { backgroundColor: MINI_FILL[t] } : outside ? null : yearStyles.missing,
                    ]}
                  />
                );
              })}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const yearStyles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.md,
  },
  mini: { width: "31%", borderRadius: radius.sm, padding: 3 },
  pressed: { backgroundColor: colors.field },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  bold: { fontFamily: fontFamily.semibold },
  grid: { flexDirection: "row", flexWrap: "wrap", width: 7 * 14 },
  cell: { width: 12, height: 12, margin: 1, borderRadius: 3 },
  missing: { borderWidth: 1, borderColor: colors.tone.caution.fg },
});
