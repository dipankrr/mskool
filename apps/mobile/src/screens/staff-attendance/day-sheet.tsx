import { useEffect, useRef } from "react";
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import { AppIcon } from "../../components/app-icon";
import { ErrorCard } from "../../components/error-card";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { formatMonthLong, todayIso, weekdayShort } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { MARKABLE_DAY_TYPES } from "./status-meta";

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `anchor` is any ISO day in a month; `delta` shifts whole months. */
function shiftMonth(anchor: string, delta: number): string {
  const index =
    Number(anchor.slice(0, 4)) * 12 + (Number(anchor.slice(5, 7)) - 1) + delta;
  return isoOf(Math.floor(index / 12), (index % 12) + 1, 1);
}

/**
 * The day picker: one month at a time with a prev/next stepper, every day
 * tagged with what the calendar says it is (Working / Half day / Exam day /
 * Holiday / Weekend / Not set) and "Today" called out. Non-markable days can
 * still be picked — the screen explains the refusal honestly rather than the
 * picker hiding the truth.
 */
export function DaySheet({
  visible,
  anchor,
  date,
  onSelect,
  onAnchorChange,
  onDismiss,
}: {
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
  const { height } = useWindowDimensions();

  useEffect(() => {
    if (visible) {
      ref.current?.present();
    } else {
      ref.current?.dismiss();
    }
  }, [visible]);

  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
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

  const dayTypeByDate = new Map(
    (calendarQuery.data ?? []).map((row) => [row.date, row.dayType]),
  );
  const dayCount = new Date(year, month, 0).getDate();
  const days = Array.from({ length: dayCount }, (_, index) =>
    isoOf(year, month, index + 1),
  );
  const today = todayIso();

  return (
    <BottomSheetModal ref={ref} enablePanDownToClose onDismiss={onDismiss}>
      <BottomSheetView style={styles.content}>
        <SectionLabel>{copy.attendance.marking.dayPickerTitle}</SectionLabel>

        <View style={styles.monthRow}>
          <Pressable
            testID="day-sheet-prev"
            accessibilityRole="button"
            accessibilityLabel={copy.attendance.marking.prevMonth}
            hitSlop={8}
            onPress={() => onAnchorChange(shiftMonth(anchor, -1))}
            style={styles.monthButton}
          >
            <AppIcon name="chevronLeft" size={20} color={colors.muted} />
          </Pressable>
          <ThemedText variant="bodyStrong" style={styles.monthLabel}>
            {formatMonthLong(anchor)}
          </ThemedText>
          <Pressable
            testID="day-sheet-next"
            accessibilityRole="button"
            accessibilityLabel={copy.attendance.marking.nextMonth}
            hitSlop={8}
            onPress={() => onAnchorChange(shiftMonth(anchor, 1))}
            style={styles.monthButton}
          >
            <AppIcon name="chevronRight" size={20} color={colors.muted} />
          </Pressable>
        </View>

        {calendarQuery.isPending ? (
          <View style={styles.dayList}>
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <Skeleton key={row} height={44} style={styles.skeleton} />
            ))}
          </View>
        ) : calendarQuery.isError ? (
          <ErrorCard
            cause={calendarQuery.error}
            onRetry={() => void calendarQuery.refetch()}
            style={styles.error}
            testID="day-sheet-error"
          />
        ) : (
          <BottomSheetScrollView
            style={{ maxHeight: Math.round(height * 0.55) }}
            contentContainerStyle={styles.dayList}
          >
            {days.map((iso) => {
              const dayType = dayTypeByDate.get(iso) ?? null;
              const markable =
                dayType !== null && MARKABLE_DAY_TYPES.includes(dayType);
              const tagLabel = dayType
                ? copy.attendance.marking.dayTypes[dayType]
                : copy.attendance.marking.dayTypes.none;
              const dayNumber = Number(iso.slice(8, 10));
              const isToday = iso === today;
              const selected = iso === date;
              return (
                <Pressable
                  key={iso}
                  testID={`day-option-${iso}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${weekdayShort(iso)} ${dayNumber}, ${tagLabel}${isToday ? `, ${copy.attendance.marking.today}` : ""}`}
                  onPress={() => onSelect(iso)}
                  style={({ pressed }) => [
                    styles.dayRow,
                    selected ? styles.dayRowOn : null,
                    pressed ? styles.dayRowPressed : null,
                  ]}
                >
                  <ThemedText variant="caption" style={styles.dayWeekday}>
                    {weekdayShort(iso)}
                  </ThemedText>
                  <ThemedText variant="bodyStrong">{dayNumber}</ThemedText>
                  <View style={styles.spacer} />
                  {isToday ? (
                    <View style={styles.todayChip}>
                      <ThemedText variant="caption" color={colors.accentDeep}>
                        {copy.attendance.marking.today}
                      </ThemedText>
                    </View>
                  ) : null}
                  <ThemedText
                    variant="caption"
                    color={markable ? colors.muted : colors.tone.caution.fg}
                  >
                    {tagLabel}
                  </ThemedText>
                  {selected ? (
                    <AppIcon name="check" size={18} color={colors.accentDeep} />
                  ) : null}
                </Pressable>
              );
            })}
          </BottomSheetScrollView>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  monthButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  monthLabel: {
    flex: 1,
    textAlign: "center",
  },
  dayList: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  dayRowOn: {
    backgroundColor: colors.accentTint,
  },
  dayRowPressed: {
    backgroundColor: colors.field,
  },
  dayWeekday: {
    width: 36,
  },
  todayChip: {
    height: 24,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.accentStrong,
  },
  spacer: {
    flex: 1,
  },
  skeleton: {
    marginBottom: spacing.sm,
  },
  error: {
    marginTop: spacing.sm,
  },
});
