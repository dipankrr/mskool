import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext, useBranchMeta } from "../../../hooks/use-active-context";
import { usePermissions } from "../../../hooks/use-permissions";
import { copy } from "../../../lib/copy";
import {
  formatMonthLong,
  formatShortWeekday,
  todayIso,
} from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import {
  clampMonth,
  daysInMonth,
  isoOf,
  monthIndex,
  shiftMonth,
} from "../calendar-month";
import { dayTypeLabel, isMarkableDayType } from "../status-meta";
import { DayEditorSheet } from "./day-editor-sheet";
import { ManageFrame } from "./frame";
import { GenerateSheet } from "./generate-sheet";

/**
 * The manage calendar (chunk 3): one month at a time, bounded to the session
 * year, every day showing what the calendar says it is. Tapping a day opens
 * the day editor; Generate opens the weekday template. Both writes invalidate
 * `attendance.calendar.list`, which the marking screen's day picker shares —
 * a day's new type is one refetch away everywhere.
 */
export function ManageCalendar() {
  const { has } = usePermissions();
  const canManage = has("attendance:update");
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const branchMeta = useBranchMeta();
  const [anchor, setAnchor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);

  const ready = Boolean(organizationId && schoolId && academicYear);
  const start = academicYear?.startDate ?? null;
  const end = academicYear?.endDate ?? null;

  // The anchor is a first-of-month ISO day: today's month, clamped into the
  // session year; the stepper moves it within the same bounds.
  const monthAnchor = useMemo(() => {
    if (anchor) return anchor;
    if (!start || !end) return null;
    return clampMonth(todayIso(), start, end);
  }, [anchor, start, end]);
  const month = monthAnchor ? Number(monthAnchor.slice(5, 7)) : 0;

  const calendarQuery = trpc.attendance.calendar.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
      month,
    },
    { enabled: ready && monthAnchor !== null, staleTime: 300_000 },
  );

  const byDate = useMemo(
    () =>
      new Map(
        (calendarQuery.data ?? []).map((row) => [
          row.date,
          { dayType: row.dayType, reason: row.reason },
        ]),
      ),
    [calendarQuery.data],
  );

  const rows = useMemo(() => {
    if (!monthAnchor) return [];
    const year = Number(monthAnchor.slice(0, 4));
    return Array.from({ length: daysInMonth(year, month) }, (_, index) => {
      const iso = isoOf(year, month, index + 1);
      const stored = byDate.get(iso);
      return {
        iso,
        dayType: stored?.dayType ?? null,
        reason: stored?.reason ?? null,
      };
    });
  }, [monthAnchor, month, byDate]);

  const canPrev = Boolean(
    monthAnchor && start && monthIndex(monthAnchor) > monthIndex(start),
  );
  const canNext = Boolean(
    monthAnchor && end && monthIndex(monthAnchor) < monthIndex(end),
  );

  if (!canManage) {
    return (
      <ManageFrame title={copy.attendance.manage.rows.calendar}>
        <EmptyState
          icon="calendar"
          title={copy.attendance.manage.noAccessTitle}
          message={copy.attendance.manage.noAccessBody}
          testID="calendar-no-access"
        />
      </ManageFrame>
    );
  }

  return (
    <ManageFrame
      title={copy.attendance.manage.rows.calendar}
      meta={branchMeta}
    >
      {!ready || !monthAnchor ? (
        <Card>
          <ThemedText variant="bodyStrong">
            {copy.session.noYearTitle}
          </ThemedText>
          <ThemedText variant="meta" style={styles.cardBody}>
            {copy.session.noYearBody}
          </ThemedText>
        </Card>
      ) : (
        <>
          <CapsuleButton
            title={copy.attendance.manage.calendar.generate}
            size="compact"
            onPress={() => setGenerateOpen(true)}
            testID="calendar-generate"
          />
          <Card padless style={styles.card}>
            <View style={styles.monthRow}>
              <Pressable
                testID="calendar-prev"
                accessibilityRole="button"
                accessibilityLabel={copy.attendance.marking.prevMonth}
                accessibilityState={{ disabled: !canPrev }}
                disabled={!canPrev}
                hitSlop={8}
                onPress={() =>
                  monthAnchor && setAnchor(shiftMonth(monthAnchor, -1))
                }
                style={[
                  styles.monthButton,
                  canPrev ? null : styles.monthButtonOff,
                ]}
              >
                <AppIcon name="chevronLeft" size={20} color={colors.muted} />
              </Pressable>
              <ThemedText variant="bodyStrong" style={styles.monthLabel}>
                {formatMonthLong(monthAnchor)}
              </ThemedText>
              <Pressable
                testID="calendar-next"
                accessibilityRole="button"
                accessibilityLabel={copy.attendance.marking.nextMonth}
                accessibilityState={{ disabled: !canNext }}
                disabled={!canNext}
                hitSlop={8}
                onPress={() =>
                  monthAnchor && setAnchor(shiftMonth(monthAnchor, 1))
                }
                style={[
                  styles.monthButton,
                  canNext ? null : styles.monthButtonOff,
                ]}
              >
                <AppIcon name="chevronRight" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.divider} />
            {calendarQuery.isPending ? (
              <View style={styles.skeletonBlock}>
                {[0, 1, 2, 3, 4].map((row) => (
                  <Skeleton key={row} height={44} style={styles.skeletonRow} />
                ))}
              </View>
            ) : calendarQuery.isError ? (
              <ErrorCard
                cause={calendarQuery.error}
                onRetry={() => void calendarQuery.refetch()}
                style={styles.error}
                testID="calendar-error"
              />
            ) : (calendarQuery.data ?? []).length === 0 ? (
              <ThemedText variant="meta" style={styles.emptyMonth}>
                {copy.attendance.manage.calendar.monthEmpty}
              </ThemedText>
            ) : (
              rows.map((row, index) => (
                <View key={row.iso}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <Pressable
                    testID={`manage-day-${row.iso}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatShortWeekday(row.iso)}, ${dayTypeLabel(row.dayType)}${row.reason ? `, ${row.reason}` : ""}`}
                    onPress={() => setEditing(row.iso)}
                    style={({ pressed }) => [
                      styles.dayRow,
                      pressed ? styles.dayRowPressed : null,
                    ]}
                  >
                    <View style={styles.dayText}>
                      <ThemedText variant="bodyStrong">
                        {formatShortWeekday(row.iso)}
                      </ThemedText>
                      {row.reason ? (
                        <ThemedText variant="meta" numberOfLines={1}>
                          {row.reason}
                        </ThemedText>
                      ) : null}
                    </View>
                    <ThemedText
                      variant="caption"
                      color={
                        isMarkableDayType(row.dayType)
                          ? colors.muted
                          : colors.tone.caution.fg
                      }
                    >
                      {dayTypeLabel(row.dayType)}
                    </ThemedText>
                    <AppIcon
                      name="chevronRight"
                      size={18}
                      color={colors.chevron}
                    />
                  </Pressable>
                </View>
              ))
            )}
          </Card>
        </>
      )}
      <DayEditorSheet
        visible={editing !== null}
        iso={editing}
        dayType={editing ? (byDate.get(editing)?.dayType ?? null) : null}
        reason={editing ? (byDate.get(editing)?.reason ?? null) : null}
        onDismiss={() => setEditing(null)}
      />
      <GenerateSheet
        visible={generateOpen}
        onDismiss={() => setGenerateOpen(false)}
      />
    </ManageFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
  },
  cardBody: {
    marginTop: spacing.xs,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  monthButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  monthButtonOff: {
    opacity: 0.3,
  },
  monthLabel: {
    flex: 1,
    textAlign: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.hairline,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  dayRowPressed: {
    backgroundColor: colors.field,
  },
  dayText: {
    flex: 1,
    gap: spacing.xxs,
  },
  skeletonBlock: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  skeletonRow: {
    borderRadius: radius.md,
  },
  error: {
    margin: spacing.md,
  },
  emptyMonth: {
    padding: spacing.lg,
  },
});
