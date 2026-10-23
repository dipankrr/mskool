import { useMemo, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { ErrorCard } from "../../components/error-card";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { formatIsoDate, formatMonthLong, todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontSize, radius, spacing } from "../../theme/tokens";
import { clampMonth, daysInMonth, isoOf, monthIndex, shiftMonth } from "./calendar-month";
import type { Status } from "./draft";
import { monthCells, studentStatusByDate } from "./student-calendar";
import { statusLabel, statusShort, statusTone } from "./status-meta";

const weekdays = ["M", "T", "W", "T", "F", "S", "S"] as const;
const legendOrder: readonly Status[] = [
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
];

/**
 * One student's month-by-month status map inside the summary detail sheet.
 * It reads the same bounded, section-scoped `statusHistory` layer as the Mark
 * screen's recent strip and filters the month to this student on the client.
 * Month navigation is bounded to the session, so a past year cannot silently
 * turn this into an unbounded report.
 */
export function StudentAttendanceMap({
  sectionId,
  studentId,
  visible,
}: {
  sectionId: string;
  studentId: string;
  visible: boolean;
}) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const { width } = useWindowDimensions();
  const start = academicYear?.startDate ?? null;
  const end = academicYear?.endDate ?? null;
  const [anchor, setAnchor] = useState(todayIso);

  const boundedAnchor =
    start && end ? clampMonth(anchor, start, end) : shiftMonth(anchor, 0);
  const year = Number(boundedAnchor.slice(0, 4));
  const month = Number(boundedAnchor.slice(5, 7));
  const fromDate = isoOf(year, month, 1);
  const toDate = isoOf(year, month, daysInMonth(year, month));
  const query = trpc.attendance.statusHistory.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      sectionId,
      fromDate,
      toDate,
    },
    {
      enabled: visible && Boolean(organizationId && sectionId),
      staleTime: 60_000,
    },
  );

  const statuses = useMemo(
    () => studentStatusByDate(query.data ?? [], studentId),
    [query.data, studentId],
  );
  const cells = useMemo(() => monthCells(boundedAnchor), [boundedAnchor]);
  const canPrev = !start || monthIndex(boundedAnchor) > monthIndex(start);
  const canNext = !end || monthIndex(boundedAnchor) < monthIndex(end);
  const today = todayIso();

  // Compact cells at phone width; the map stays a calmer calendar on tablets.
  const gap = spacing.xs;
  const mapWidth = Math.min(width - spacing.lg * 2, 360);
  const cellWidth = Math.floor((mapWidth - gap * 6) / 7);

  const moveMonth = (delta: number) => {
    const next = shiftMonth(boundedAnchor, delta);
    setAnchor(start && end ? clampMonth(next, start, end) : next);
  };

  return (
    <View style={styles.wrap}>
      <SectionLabel style={styles.label}>
        {copy.attendance.summary.detail.attendanceMap}
      </SectionLabel>

      <View style={[styles.monthRow, { width: cellWidth * 7 + gap * 6 }]}>
        <Pressable
          testID="student-calendar-prev"
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
          <AppIcon name="chevronLeft" size={18} color={canPrev ? colors.ink : colors.chevron} />
        </Pressable>
        <ThemedText variant="bodyStrong" style={styles.monthLabel}>
          {formatMonthLong(boundedAnchor)}
        </ThemedText>
        <Pressable
          testID="student-calendar-next"
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
          <AppIcon name="chevronRight" size={18} color={canNext ? colors.ink : colors.chevron} />
        </Pressable>
      </View>

      {query.isPending ? (
        <Skeleton height={246} style={styles.skeleton} />
      ) : query.isError ? (
        <ErrorCard
          cause={query.error}
          onRetry={() => void query.refetch()}
          style={styles.error}
          testID="student-calendar-error"
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
            style={[
              styles.grid,
              { width: cellWidth * 7 + gap * 6, columnGap: gap, rowGap: gap },
            ]}
          >
            {cells.map((iso, index) => {
              if (!iso) {
                return <View key={`blank-${index}`} style={{ width: cellWidth, height: 38 }} />;
              }
              const status = statuses.get(iso) ?? null;
              const dayNumber = Number(iso.slice(8, 10));
              const tone = status ? colors.tone[statusTone[status]] : null;
              const isToday = iso === today;
              return (
                <View
                  key={iso}
                  accessible
                  accessibilityLabel={`${formatIsoDate(iso)}, ${
                    status ? statusLabel(status) : copy.attendance.marking.unmarked
                  }`}
                  style={[
                    styles.dayCell,
                    {
                      width: cellWidth,
                      backgroundColor: tone?.bg ?? colors.surface,
                      borderColor: isToday ? colors.accent : colors.hairline,
                      borderWidth: isToday ? 2 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <ThemedText
                    variant="tab"
                    color={tone?.fg ?? colors.muted}
                    style={styles.dayNumber}
                  >
                    {dayNumber}
                  </ThemedText>
                  {status ? (
                    <ThemedText variant="caption" color={tone?.fg} style={styles.statusLetter}>
                      {statusShort(status)}
                    </ThemedText>
                  ) : null}
                </View>
              );
            })}
          </View>

          <View style={styles.legend}>
            {legendOrder.map((status) => {
              const tone = colors.tone[statusTone[status]];
              return (
                <View key={status} style={styles.legendItem}>
                  <View style={[styles.legendSquare, { backgroundColor: tone.bg }]}>
                    <ThemedText variant="tab" color={tone.fg} style={styles.legendLetter}>
                      {statusShort(status)}
                    </ThemedText>
                  </View>
                  <ThemedText variant="caption" color={colors.muted}>
                    {statusLabel(status)}
                  </ThemedText>
                </View>
              );
            })}
          </View>

          {statuses.size === 0 ? (
            <ThemedText variant="meta" style={styles.emptyLine}>
              {copy.attendance.summary.detail.mapEmpty}
            </ThemedText>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  label: {
    marginTop: 0,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
  },
  monthButton: {
    width: 40,
    height: 40,
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
  skeleton: {
    marginTop: spacing.xs,
    borderRadius: radius.lg,
  },
  error: {
    marginTop: spacing.xs,
  },
  weekRow: {
    flexDirection: "row",
    alignSelf: "center",
    marginTop: spacing.xs,
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
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  dayNumber: {
    fontSize: fontSize.micro,
  },
  statusLetter: {
    fontSize: fontSize.caption,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.md,
    rowGap: spacing.xs,
    marginTop: spacing.xs,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendSquare: {
    width: 18,
    height: 18,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  legendLetter: {
    fontSize: fontSize.micro,
  },
  emptyLine: {
    marginTop: spacing.xxs,
  },
});
