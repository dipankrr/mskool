import { useEffect, useMemo, useRef } from "react";
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
} from "@expo/ui/community/bottom-sheet";

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
import { radius, spacing } from "../../theme/tokens";
import {
  clampMonth,
  daysInMonth,
  isoOf,
  monthIndex,
  shiftMonth,
} from "./calendar-month";
import { dayTypeLabel, dayTypeShort, isMarkableDayType } from "./status-meta";

const weekdays = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * The day picker: one session-bounded month at a time in a Monday-first grid.
 * Navigation cannot leave the academic year, out-of-session days are
 * disabled, and each cell is a tinted square with a short category label
 * (½, EX, HOL, OFF) instead of the old 4 px dot. The custom grid stays
 * because it already speaks the API's day types and keeps the
 * `day-option-<iso>` Maestro contract; the third-party picker was evaluated
 * and recorded in the slice plan, not adopted.
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
  const boundedAnchor =
    start && end ? clampMonth(anchor, start, end) : shiftMonth(anchor, 0);

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
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
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
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
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

  // 52 dp cells with 4 dp gaps; on a 360 dp screen the sheet narrows its
  // gutter and gap so the cells stay at the 48 dp touch target.
  const compact = width < 380;
  const gap = compact ? spacing.xxs : spacing.xs;
  const gridWidth = Math.min(
    width - (compact ? spacing.xs * 2 : spacing.lg * 2),
    420,
  );
  const cellWidth = Math.floor((gridWidth - gap * 6) / 7);

  const moveMonth = (delta: number) => {
    const next = shiftMonth(boundedAnchor, delta);
    onAnchorChange(
      start && end ? clampMonth(next, start, end) : next,
    );
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
        <ThemedText variant="sectionLabel" style={styles.sheetLabel}>
          {copy.attendance.marking.dayPickerTitle}
        </ThemedText>
        {start && end ? (
          <ThemedText variant="meta" style={styles.sessionLabel}>
            {copy.attendance.marking.sessionRange(
              formatIsoDate(start),
              formatIsoDate(end),
            )}
          </ThemedText>
        ) : null}

        <View style={styles.monthRow}>
          <Pressable
            testID="day-sheet-prev"
            accessibilityRole="button"
            accessibilityLabel={copy.attendance.marking.prevMonth}
            accessibilityState={{ disabled: !canPrev }}
            disabled={!canPrev}
            hitSlop={4}
            onPress={() => moveMonth(-1)}
            style={({ pressed }) => [
              styles.monthButton,
              pressed ? styles.monthButtonPressed : null,
              !canPrev ? styles.monthButtonDisabled : null,
            ]}
          >
            <AppIcon name="chevronLeft" size={20} color={canPrev ? colors.ink : colors.chevron} />
          </Pressable>
          <ThemedText variant="bodyStrong" style={styles.monthLabel}>
            {formatMonthLong(boundedAnchor)}
          </ThemedText>
          <Pressable
            testID="day-sheet-next"
            accessibilityRole="button"
            accessibilityLabel={copy.attendance.marking.nextMonth}
            accessibilityState={{ disabled: !canNext }}
            disabled={!canNext}
            hitSlop={4}
            onPress={() => moveMonth(1)}
            style={({ pressed }) => [
              styles.monthButton,
              pressed ? styles.monthButtonPressed : null,
              !canNext ? styles.monthButtonDisabled : null,
            ]}
          >
            <AppIcon name="chevronRight" size={20} color={canNext ? colors.ink : colors.chevron} />
          </Pressable>
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
            <View style={[styles.weekRow, { width: cellWidth * 7 + gap * 6 }]}>
              {weekdays.map((weekday, index) => (
                <View key={`${weekday}-${index}`} style={{ width: cellWidth }}>
                  <ThemedText variant="caption" color={colors.muted} style={styles.weekdayLabel}>
                    {weekday}
                  </ThemedText>
                </View>
              ))}
            </View>

            <View
              style={[styles.grid, { width: cellWidth * 7 + gap * 6, columnGap: gap, rowGap: gap }]}
            >
              {cells.map((iso, index) => {
                if (!iso) {
                  return (
                    <View
                      key={`blank-${index}`}
                      style={{ width: cellWidth, height: compact ? 48 : 52 }}
                    />
                  );
                }
                const day = dayByDate.get(iso) ?? null;
                const dayType = day?.dayType ?? null;
                const dayNumber = Number(iso.slice(8, 10));
                const isToday = iso === today;
                const selected = iso === date;
                const disabled =
                  (start !== null && iso < start) || (end !== null && iso > end);
                const marked = markedDates.has(iso);
                const pastUnmarked =
                  !disabled && isMarkableDayType(dayType) && iso < today && !marked;
                const quietDay = dayType === "holiday" || dayType === "weekend";
                const cellTone = dayCellTone(dayType);
                return (
                  <Pressable
                    key={iso}
                    testID={`day-option-${iso}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled }}
                    accessibilityLabel={`${weekdayShort(iso)} ${dayNumber}, ${dayTypeLabel(dayType)}${marked ? `, ${copy.attendance.marking.marked}` : pastUnmarked ? `, ${copy.attendance.marking.notMarked}` : ""}${isToday ? `, ${copy.attendance.marking.today}` : ""}`}
                    disabled={disabled}
                    onPress={() => onSelect(iso)}
                    style={({ pressed }) => [
                      styles.dayCell,
                      compact ? styles.dayCellCompact : null,
                      {
                        width: cellWidth,
                        backgroundColor: cellTone.bg,
                        borderColor: selected
                          ? colors.accent
                          : isToday
                            ? colors.accent
                            : pastUnmarked
                              ? colors.tone.critical.fg
                              : cellTone.border,
                        borderWidth: selected || isToday ? 2 : 1,
                      },
                      pastUnmarked && !selected && !isToday ? styles.dayCellUnmarked : null,
                      disabled ? styles.dayCellDisabled : null,
                      dayType === null ? styles.dayCellNone : null,
                      pressed ? styles.dayCellPressed : null,
                    ]}
                  >
                    {marked ? <View style={styles.markedDot} /> : null}
                    <ThemedText
                      variant="bodyStrong"
                      color={cellTone.fg}
                      style={quietDay ? styles.dayCellQuietText : null}
                    >
                      {dayNumber}
                    </ThemedText>
                    <ThemedText
                      variant="tab"
                      color={cellTone.fg}
                      numberOfLines={1}
                      style={[styles.dayCellLabel, quietDay ? styles.dayCellQuietText : null]}
                    >
                      {dayTypeShort(dayType) || " "}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.footer} testID="day-sheet-selected">
              <View style={styles.footerCopy}>
                {inSession ? (
                  <>
                    <ThemedText variant="bodyStrong">
                      {copy.attendance.marking.selectedDay} · {formatShortWeekday(date)}
                    </ThemedText>
                    <ThemedText variant="meta" numberOfLines={2}>
                      {dayTypeLabel(selectedDay?.dayType ?? null)}
                      {selectedDay?.reason ? ` · ${selectedDay.reason}` : ""}
                    </ThemedText>
                  </>
                ) : (
                  <>
                    <ThemedText variant="bodyStrong">
                      {formatShortWeekday(date)} · {formatIsoDate(date)}
                    </ThemedText>
                    <ThemedText variant="meta">{copy.attendance.marking.outsideSession}</ThemedText>
                  </>
                )}
              </View>
              <View style={styles.legend}>
                <LegendSwatch kind="working" label={copy.attendance.marking.workingLegend} />
                <LegendSwatch
                  kind="caution"
                  label={`${copy.attendance.marking.dayTypes.half_day} / ${copy.attendance.marking.dayTypes.exam_day}`}
                />
                <LegendSwatch
                  kind="neutral"
                  label={copy.attendance.marking.holidayWeekendLegend}
                />
                <LegendSwatch kind="none" label={copy.attendance.marking.dayTypes.none} />
                <LegendSwatch kind="marked" label={copy.attendance.marking.markedLegend} />
                <LegendSwatch
                  kind="unmarkedPast"
                  label={copy.attendance.marking.unmarkedPastLegend}
                />
              </View>
            </View>
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function dayCellTone(dayType: string | null): {
  bg: string;
  fg: string;
  border: string;
} {
  if (dayType === "working") {
    return { bg: colors.surface, fg: colors.ink, border: colors.hairline };
  }
  if (dayType === "half_day" || dayType === "exam_day") {
    return {
      bg: colors.tone.caution.bg,
      fg: colors.tone.caution.fg,
      border: colors.tone.caution.bg,
    };
  }
  if (dayType === "holiday" || dayType === "weekend") {
    return {
      bg: colors.tone.neutral.bg,
      fg: colors.tone.neutral.fg,
      border: colors.tone.neutral.bg,
    };
  }
  return { bg: "transparent", fg: colors.muted, border: colors.hairline };
}

function LegendSwatch({
  kind,
  label,
}: {
  kind: "working" | "caution" | "neutral" | "none" | "marked" | "unmarkedPast";
  label: string;
}) {
  const style =
    kind === "working"
      ? { backgroundColor: colors.surface, borderColor: colors.hairline, borderWidth: 1 }
      : kind === "caution"
        ? { backgroundColor: colors.tone.caution.bg, borderColor: colors.tone.caution.bg }
        : kind === "neutral"
          ? { backgroundColor: colors.tone.neutral.bg, borderColor: colors.tone.neutral.bg }
          : kind === "marked"
            ? { backgroundColor: colors.surface, borderColor: colors.hairline, borderWidth: 1 }
            : kind === "unmarkedPast"
              ? {
                  borderColor: colors.tone.critical.fg,
                  borderWidth: 1,
                  borderStyle: "dotted" as const,
                }
              : { borderColor: colors.muted, borderWidth: 1, borderStyle: "dotted" as const };
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSquare, style]}>
        {kind === "marked" ? <View style={styles.legendDot} /> : null}
      </View>
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
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.lg,
  },
  sheetLabel: {
    marginTop: spacing.sm,
  },
  sessionLabel: {
    marginTop: spacing.xxs,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  monthButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  monthButtonPressed: {
    backgroundColor: colors.field,
  },
  monthButtonDisabled: {
    opacity: 0.45,
  },
  monthLabel: {
    flex: 1,
    textAlign: "center",
  },
  weekRow: {
    flexDirection: "row",
    alignSelf: "center",
    marginBottom: spacing.xs,
  },
  weekdayLabel: {
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignSelf: "center",
  },
  dayCell: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  dayCellCompact: {
    height: 48,
  },
  dayCellNone: {
    borderStyle: "dotted",
  },
  dayCellUnmarked: {
    borderStyle: "dotted",
  },
  dayCellDisabled: {
    opacity: 0.3,
  },
  dayCellPressed: {
    transform: [{ scale: 0.96 }],
  },
  dayCellQuietText: {
    opacity: 0.5,
  },
  dayCellLabel: {
    minHeight: 12,
    textAlign: "center",
  },
  markedDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  footer: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    gap: spacing.sm,
  },
  footerCopy: {
    gap: spacing.xxs,
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: spacing.md,
    rowGap: spacing.sm,
    flexWrap: "wrap",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendSquare: {
    width: 14,
    height: 14,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  legendDot: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  skeleton: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
  },
  error: {
    marginTop: spacing.sm,
  },
});
