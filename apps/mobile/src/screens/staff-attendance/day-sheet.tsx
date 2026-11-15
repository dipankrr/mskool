import { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@expo/ui/community/bottom-sheet";

import { AppIcon } from "../../components/app-icon";
import { ErrorCard } from "../../components/error-card";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import {
  formatIsoDate,
  formatMonthLong,
  formatShortWeekday,
  todayIso,
  weekdayShort,
} from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, radius, spacing } from "../../theme/tokens";
import { clampMonth, daysInMonth, isoOf, monthIndex, shiftMonth } from "./calendar-month";
import { EXAM_TONE } from "./manage/calendar-lib";
import { dayTypeLabel, isMarkableDayType } from "./status-meta";

const weekdays = ["M", "T", "W", "T", "F", "S", "S"] as const;
const CELL_HEIGHT = 52;

/**
 * The day picker, redrawn (owner, 2026-11-15: "looks bad"). A calm month
 * grid of round days: the selected day is a filled accent disc, today a ring,
 * half and exam days a soft amber disc, holidays and weekends greyed. One dot
 * under the number says the only thing a teacher needs: green = marked, red =
 * a past working day nobody marked. A "Today" chip jumps back, and the old
 * six-swatch legend is down to three. Navigation stays inside the session and
 * the `day-option-<iso>` / `day-sheet-prev|next` test ids are unchanged.
 */
export function DaySheet({
  sectionId,
  visible,
  anchor,
  date,
  onSelect,
  onAnchorChange,
  onDismiss,
}: {
  sectionId: string;
  visible: boolean;
  /** Any ISO day in the month the picker shows — owned by the parent so
   *  opening the sheet resets it to the selected date's month. */
  anchor: string;
  date: string;
  onSelect: (iso: string) => void;
  onAnchorChange: (iso: string) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const { width, height } = useWindowDimensions();
  const start = academicYear?.startDate ?? null;
  const end = academicYear?.endDate ?? null;
  const boundedAnchor = start && end ? clampMonth(anchor, start, end) : shiftMonth(anchor, 0);
  const words = copy.attendance.marking;

  useEffect(() => {
    if (visible) {
      ref.current?.present();
    } else {
      ref.current?.dismiss();
    }
  }, [visible]);

  const year = Number(boundedAnchor.slice(0, 4));
  const month = Number(boundedAnchor.slice(5, 7));
  const calendarQuery = trpc.attendance.calendar.list.useQuery(
    {
      schoolId: schoolId ?? "",
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      month,
    },
    {
      enabled: visible && Boolean(organizationId && academicYear),
      staleTime: 300_000,
    },
  );

  const monthStart = isoOf(year, month, 1);
  const monthEnd = isoOf(year, month, daysInMonth(year, month));
  const historyQuery = trpc.attendance.statusHistory.useQuery(
    {
      schoolId: schoolId ?? "",
      organizationId: organizationId ?? "",
      sectionId,
      fromDate: monthStart,
      toDate: monthEnd,
    },
    {
      enabled: visible && Boolean(organizationId && sectionId),
      staleTime: 60_000,
    },
  );
  const markedDates = useMemo(
    () => new Set((historyQuery.data ?? []).map((row) => row.date)),
    [historyQuery.data],
  );

  const dayByDate = new Map((calendarQuery.data ?? []).map((row) => [row.date, row]));
  const dayCount = daysInMonth(year, month);
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dayCount }, (_, index) => isoOf(year, month, index + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayIso();
  const inSession = (!start || date >= start) && (!end || date <= end);
  const selectedDay = inSession ? (dayByDate.get(date) ?? null) : null;
  const canPrev = !start || monthIndex(boundedAnchor) > monthIndex(start);
  const canNext = !end || monthIndex(boundedAnchor) < monthIndex(end);
  const todayInSession = (!start || today >= start) && (!end || today <= end);
  const showTodayChip = todayInSession && today !== date;

  // On a 360 dp screen the sheet narrows its gutter and gap so the cells
  // stay at the 48 dp touch target.
  const compact = width < 380;
  const gap = compact ? spacing.xxs : spacing.xs;
  const gridWidth = Math.min(width - (compact ? spacing.sm * 2 : spacing.lg * 2), 420);
  const cellWidth = Math.floor((gridWidth - gap * 6) / 7);
  const rowWidth = cellWidth * 7 + gap * 6;

  const moveMonth = (delta: number) => {
    const next = shiftMonth(boundedAnchor, delta);
    onAnchorChange(start && end ? clampMonth(next, start, end) : next);
  };

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetScrollView
        style={{ maxHeight: Math.round(height * 0.92) }}
        contentContainerStyle={[styles.content, compact ? styles.contentCompact : null]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headRow}>
          <View style={styles.headText}>
            <ThemedText variant="title">{words.dayPickerTitle}</ThemedText>
            {start && end ? (
              <ThemedText variant="meta" numberOfLines={1}>
                {words.sessionRange(formatIsoDate(start), formatIsoDate(end))}
              </ThemedText>
            ) : null}
          </View>
          {showTodayChip ? (
            <Pressable
              testID="day-sheet-today"
              accessibilityRole="button"
              onPress={() => onSelect(today)}
              hitSlop={6}
              style={({ pressed }) => [styles.todayChip, pressed ? styles.pressed : null]}
            >
              <ThemedText variant="chip" color={colors.accentDeep}>
                {words.today}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.monthRow}>
          <ThemedText variant="bodyStrong" style={styles.monthLabel}>
            {formatMonthLong(boundedAnchor)}
          </ThemedText>
          <MonthButton
            testID="day-sheet-prev"
            icon="chevronLeft"
            label={words.prevMonth}
            enabled={canPrev}
            onPress={() => moveMonth(-1)}
          />
          <MonthButton
            testID="day-sheet-next"
            icon="chevronRight"
            label={words.nextMonth}
            enabled={canNext}
            onPress={() => moveMonth(1)}
          />
        </View>

        {calendarQuery.isPending || historyQuery.isPending ? (
          <Skeleton height={300} style={styles.skeleton} />
        ) : calendarQuery.isError || historyQuery.isError ? (
          <ErrorCard
            cause={calendarQuery.error ?? historyQuery.error}
            onRetry={() => {
              if (calendarQuery.isError) void calendarQuery.refetch();
              if (historyQuery.isError) void historyQuery.refetch();
            }}
            style={styles.error}
            testID="day-sheet-error"
          />
        ) : (
          <>
            <View style={[styles.weekRow, { width: rowWidth, columnGap: gap }]}>
              {weekdays.map((weekday, index) => (
                <View key={`${weekday}-${index}`} style={{ width: cellWidth }}>
                  <ThemedText
                    variant="caption"
                    color={index >= 5 ? colors.chevron : colors.muted}
                    style={styles.weekdayLabel}
                  >
                    {weekday}
                  </ThemedText>
                </View>
              ))}
            </View>

            <View style={[styles.grid, { width: rowWidth, columnGap: gap, rowGap: gap }]}>
              {cells.map((iso, index) => {
                if (!iso) {
                  return (
                    <View key={`blank-${index}`} style={{ width: cellWidth, height: CELL_HEIGHT }} />
                  );
                }
                const dayType = dayByDate.get(iso)?.dayType ?? null;
                const dayNumber = Number(iso.slice(8, 10));
                const isToday = iso === today;
                const selected = iso === date;
                const disabled = (start !== null && iso < start) || (end !== null && iso > end);
                const marked = markedDates.has(iso);
                const pastUnmarked =
                  !disabled && isMarkableDayType(dayType) && iso < today && !marked;
                const off = dayType === "holiday" || dayType === "weekend" || dayType === null;
                const special = dayType === "half_day";
                const exam = dayType === "exam_day";
                const numberColor = selected
                  ? colors.onAccent
                  : off
                    ? colors.chevron
                    : special
                      ? colors.tone.caution.fg
                      : exam
                        ? EXAM_TONE.fg
                        : colors.ink;
                const dot = marked
                  ? colors.tone.positive.fg
                  : pastUnmarked
                    ? colors.tone.critical.fg
                    : null;
                return (
                  <Pressable
                    key={iso}
                    testID={`day-option-${iso}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled }}
                    accessibilityLabel={`${weekdayShort(iso)} ${dayNumber}, ${dayTypeLabel(dayType)}${marked ? `, ${words.marked}` : pastUnmarked ? `, ${words.notMarked}` : ""}${isToday ? `, ${words.today}` : ""}`}
                    disabled={disabled}
                    onPress={() => onSelect(iso)}
                    style={[styles.dayCell, { width: cellWidth }]}
                  >
                    {({ pressed }) => (
                      <>
                        <View
                          style={[
                            styles.dayDisc,
                            special && !selected ? styles.dayDiscSpecial : null,
                            exam && !selected ? { backgroundColor: EXAM_TONE.bg } : null,
                            isToday && !selected ? styles.dayDiscToday : null,
                            pressed && !selected ? styles.dayDiscPressed : null,
                            selected ? styles.dayDiscOn : null,
                            disabled ? styles.dayDisabled : null,
                          ]}
                        >
                          <ThemedText
                            variant="bodyStrong"
                            color={numberColor}
                            maxFontSizeMultiplier={1.2}
                            style={[styles.dayNumber, off && !selected ? styles.dayOff : null]}
                          >
                            {dayNumber}
                          </ThemedText>
                        </View>
                        <View style={[styles.dayDot, dot ? { backgroundColor: dot } : null]} />
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.legend}>
              <LegendDot color={colors.tone.positive.fg} label={words.markedLegend} />
              <LegendDot color={colors.tone.critical.fg} label={words.unmarkedPastLegend} />
              <LegendDot color={colors.tone.caution.fg} label={words.dayTypes.half_day} />
              <LegendDot color={EXAM_TONE.fg} label={words.dayTypes.exam_day} />
              <LegendDot color={colors.chevron} hollow label={words.holidayWeekendLegend} />
            </View>

            <View
              style={[styles.footer, !inSession ? styles.footerWarn : null]}
              testID="day-sheet-selected"
            >
              <AppIcon
                name="calendar"
                size={18}
                color={inSession ? colors.accentDeep : colors.tone.caution.fg}
              />
              <View style={styles.footerCopy}>
                {inSession ? (
                  <>
                    <ThemedText variant="bodyStrong" numberOfLines={1}>
                      {formatShortWeekday(date)}
                    </ThemedText>
                    <ThemedText variant="meta" numberOfLines={2}>
                      {[
                        dayTypeLabel(selectedDay?.dayType ?? null),
                        selectedDay?.reason ?? null,
                        markedDates.has(date) ? words.marked : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </ThemedText>
                  </>
                ) : (
                  <>
                    <ThemedText variant="bodyStrong">
                      {formatShortWeekday(date)} · {formatIsoDate(date)}
                    </ThemedText>
                    <ThemedText variant="meta">{words.outsideSession}</ThemedText>
                  </>
                )}
              </View>
            </View>
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function MonthButton({
  testID,
  icon,
  label,
  enabled,
  onPress,
}: {
  testID: string;
  icon: "chevronLeft" | "chevronRight";
  label: string;
  enabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.monthButton,
        pressed ? styles.monthButtonPressed : null,
        !enabled ? styles.monthButtonDisabled : null,
      ]}
    >
      <AppIcon name={icon} size={20} color={enabled ? colors.ink : colors.chevron} />
    </Pressable>
  );
}

function LegendDot({
  color,
  label,
  hollow = false,
}: {
  color: string;
  label: string;
  hollow?: boolean;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendDot,
          hollow ? { borderWidth: 1.5, borderColor: color } : { backgroundColor: color },
        ]}
      />
      <ThemedText variant="caption" color={colors.muted}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.huge,
  },
  contentCompact: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.lg,
  },
  pressed: { opacity: 0.8 },
  headRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headText: { flex: 1, gap: spacing.xxs },
  todayChip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  monthLabel: { flex: 1, fontSize: 18 },
  monthButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  monthButtonPressed: { backgroundColor: colors.hairline },
  monthButtonDisabled: { opacity: 0.4 },
  weekRow: { flexDirection: "row", alignSelf: "center", marginBottom: spacing.xs },
  weekdayLabel: { textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", alignSelf: "center" },
  dayCell: { height: CELL_HEIGHT, alignItems: "center", justifyContent: "center" },
  dayDisc: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  dayDiscSpecial: { backgroundColor: colors.tone.caution.bg },
  dayDiscToday: { borderWidth: 2, borderColor: colors.accent },
  dayDiscPressed: { backgroundColor: colors.field },
  dayDiscOn: { backgroundColor: colors.accent },
  dayDisabled: { opacity: 0.3 },
  dayNumber: { fontVariant: ["tabular-nums"] },
  dayOff: { fontFamily: fontFamily.regular },
  dayDot: { width: 5, height: 5, borderRadius: radius.full, marginTop: 2 },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: spacing.lg,
    rowGap: spacing.xs,
    marginTop: spacing.md,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: radius.full },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.accentTint,
  },
  footerWarn: { backgroundColor: colors.tone.caution.bg },
  footerCopy: { flex: 1, gap: spacing.xxs },
  skeleton: { marginTop: spacing.md, borderRadius: radius.lg },
  error: { marginTop: spacing.sm },
});
