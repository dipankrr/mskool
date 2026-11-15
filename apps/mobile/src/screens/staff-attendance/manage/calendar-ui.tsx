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
                        { backgroundColor: isSelected ? colors.ink : (look?.bg ?? "transparent"), borderRadius: radius.md, overflow: "hidden" },
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
        const swatch = type === "working" ? colors.accent : type === "weekend" ? colors.chevron : DAY_LOOK[type].fg;
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
            <View
              style={[
                styles.swatch,
                { backgroundColor: swatch },
              ]}
            />
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
