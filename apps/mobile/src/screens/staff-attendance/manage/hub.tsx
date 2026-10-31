import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../../components/app-icon";
import type { AppIconName } from "../../../components/app-icon";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { SectionLabel } from "../../../components/section-label";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext, useBranchMeta } from "../../../hooks/use-active-context";
import { usePermissions } from "../../../hooks/use-permissions";
import { copy } from "../../../lib/copy";
import { formatShortWeekday, todayIso } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { useAttendanceSection } from "../use-attendance-section";
import { ManageFrame } from "./frame";
import { summarizeCalendar } from "./manage-summary";

/**
 * Manage attendance — the hub (chunk 3). Three rows over the session context:
 * the calendar (day types and generation), the school's marking policy, and
 * the current section's periods. The policy and periods rows carry live
 * subtitles; while those load (or if they fail) the rows fall back to static
 * hints and stay open — a subtitle is information, never a gate.
 */
export function ManageHub() {
  const { has } = usePermissions();
  const canManage = has("attendance:update");
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const branchMeta = useBranchMeta();
  const { section, sectionLabel } = useAttendanceSection(params.sectionId);

  const ready = Boolean(organizationId && schoolId && academicYear);

  const policyQuery = trpc.attendance.policy.get.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: ready && canManage, staleTime: 60_000 },
  );
  const periodsQuery = trpc.attendance.period.list.useQuery(
    { organizationId: organizationId ?? "", sectionId: section?.id ?? "" },
    { enabled: ready && canManage && Boolean(section), staleTime: 60_000 },
  );
  const calendarQuery = trpc.attendance.calendar.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
    },
    { enabled: ready && canManage, staleTime: 300_000 },
  );
  const calendar = useMemo(
    () =>
      summarizeCalendar(
        calendarQuery.data ?? [],
        todayIso(),
        academicYear?.startDate,
        academicYear?.endDate,
      ),
    [calendarQuery.data, academicYear?.startDate, academicYear?.endDate],
  );

  if (!canManage) {
    return (
      <ManageFrame title={copy.attendance.manage.title}>
        <EmptyState
          icon="attendance"
          title={copy.attendance.manage.noAccessTitle}
          message={copy.attendance.manage.noAccessBody}
          testID="manage-no-access"
        />
      </ManageFrame>
    );
  }

  const sectionName = sectionLabel ?? section?.name ?? "";
  const calendarDetail = calendarQuery.isPending
    ? null
    : calendarQuery.isError
      ? copy.attendance.manage.rows.calendarHint
      : calendarQuery.data && calendarQuery.data.length > 0
        ? `${copy.attendance.manage.calendarSummary.working(calendar.workingDays)} · ${
            calendar.nextHoliday
              ? copy.attendance.manage.calendarSummary.nextHoliday(
                  formatShortWeekday(calendar.nextHoliday.date),
                  calendar.nextHoliday.reason,
                )
              : copy.attendance.manage.calendarSummary.noNextHoliday
          }`
        : copy.attendance.manage.calendarSummary.unset;
  const calendarGap =
    !calendarQuery.isPending && !calendarQuery.isError && calendar.missingThisMonth > 0;
  const policyDetail = policyQuery.isPending
    ? null
    : policyQuery.isError
      ? copy.attendance.manage.rows.policyHint
      : policySummary(policyQuery.data ?? null);
  const periodsDetail = !section
    ? copy.attendance.manage.rows.periodsHint
    : periodsQuery.isPending
      ? null
      : periodsQuery.isError || !periodsQuery.data
        ? copy.attendance.manage.rows.periodsHint
        : periodsQuery.data.length > 0
          ? copy.attendance.manage.periodsSummary.count(periodsQuery.data.length, sectionName)
          : copy.attendance.manage.periodsSummary.none(sectionName);

  return (
    <ManageFrame
      title={copy.attendance.manage.title}
      meta={branchMeta}
    >
      <SectionLabel>{copy.attendance.manage.sessionLabel}</SectionLabel>
      <Card padless style={styles.rows}>
        <HubRow
          icon="calendar"
          title={copy.attendance.manage.rows.calendar}
          detail={calendarDetail}
          testID="manage-calendar"
          onPress={() => router.push("/attendance/manage/calendar")}
        />
        <RowDivider />
        <HubRow
          icon="edit"
          title={copy.attendance.manage.rows.policy}
          detail={policyDetail}
          testID="manage-policy"
          onPress={() =>
            router.push({
              pathname: "/attendance/manage/policy",
              params: { sectionId: section?.id ?? "" },
            })
          }
        />
        <RowDivider />
        <HubRow
          icon="clock"
          title={copy.attendance.manage.rows.periods}
          detail={periodsDetail}
          testID="manage-periods"
          onPress={() =>
            router.push({
              pathname: "/attendance/manage/periods",
              params: { sectionId: section?.id ?? "" },
            })
          }
        />
      </Card>
      {calendarGap ? (
        <Pressable
          testID="manage-calendar-gap"
          accessibilityRole="button"
          onPress={() => router.push("/attendance/manage/calendar")}
          style={({ pressed }) => [styles.gapNote, pressed ? styles.gapNotePressed : null]}
        >
          <AppIcon name="calendarOff" size={18} color={colors.tone.caution.fg} />
          <ThemedText variant="caption" color={colors.tone.caution.fg} style={styles.gapText}>
            {copy.attendance.manage.calendarSummary.missingMonth(calendar.missingThisMonth)}
          </ThemedText>
          <AppIcon name="chevronRight" size={16} color={colors.chevron} />
        </Pressable>
      ) : null}
    </ManageFrame>
  );
}

/** The policy row's subtitle, from the stored shape (defaults when unset). */
function policySummary(
  policy: {
    markingMode: string;
    dailyStatusRule: string;
    thresholdPercentage: number | null;
    lateArrivalMinutes: number;
  } | null,
): string {
  if (!policy) return copy.attendance.manage.policySummary.unset;
  const late = copy.attendance.manage.policySummary.lateWindow(policy.lateArrivalMinutes);
  if (policy.markingMode === "daily") {
    return `${copy.attendance.manage.policySummary.daily} · ${late}`;
  }
  if (policy.dailyStatusRule === "threshold_percentage" && policy.thresholdPercentage != null) {
    return `${copy.attendance.manage.policySummary.periodThreshold(
      String(policy.thresholdPercentage),
    )} · ${late}`;
  }
  return `${copy.attendance.manage.policySummary.periodHomeroom} · ${late}`;
}

function HubRow({
  icon,
  title,
  detail,
  onPress,
  testID,
}: {
  icon: AppIconName;
  title: string;
  /** null while the live subtitle loads — a skeleton line takes its place. */
  detail: string | null;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.iconChip}>
        <AppIcon name={icon} size={18} color={colors.muted} />
      </View>
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong">{title}</ThemedText>
        {detail === null ? (
          <Skeleton width={150} height={12} style={styles.rowSkeleton} />
        ) : (
          <ThemedText variant="meta" numberOfLines={2}>
            {detail}
          </ThemedText>
        )}
      </View>
      <AppIcon name="chevronRight" size={18} color={colors.chevron} />
    </Pressable>
  );
}

function RowDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  rows: {
    marginTop: spacing.sm,
  },
  gapNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.caution.bg,
  },
  gapNotePressed: {
    opacity: 0.8,
  },
  gapText: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  iconChip: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowSkeleton: {
    marginTop: spacing.xxs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.hairline,
  },
});
