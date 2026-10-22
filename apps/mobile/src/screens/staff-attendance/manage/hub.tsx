import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../../components/app-icon";
import type { AppIconName } from "../../../components/app-icon";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext } from "../../../hooks/use-active-context";
import { usePermissions } from "../../../hooks/use-permissions";
import { copy } from "../../../lib/copy";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { useAttendanceSection } from "../use-attendance-section";
import { ManageFrame } from "./frame";

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
          ? copy.attendance.manage.periodsSummary.count(
              periodsQuery.data.length,
              sectionName,
            )
          : copy.attendance.manage.periodsSummary.none(sectionName);

  return (
    <ManageFrame
      title={copy.attendance.manage.title}
      meta={academicYear ? academicYear.name : null}
    >
      <Card padless style={styles.rows}>
        <HubRow
          icon="calendar"
          title={copy.attendance.manage.rows.calendar}
          detail={copy.attendance.manage.rows.calendarHint}
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
    </ManageFrame>
  );
}

/** The policy row's subtitle, from the stored shape (defaults when unset). */
function policySummary(policy: {
  markingMode: string;
  dailyStatusRule: string;
  thresholdPercentage: number | null;
} | null): string {
  if (!policy) return copy.attendance.manage.policySummary.unset;
  if (policy.markingMode === "daily") {
    return copy.attendance.manage.policySummary.daily;
  }
  if (
    policy.dailyStatusRule === "threshold_percentage" &&
    policy.thresholdPercentage != null
  ) {
    return copy.attendance.manage.policySummary.periodThreshold(
      String(policy.thresholdPercentage),
    );
  }
  return copy.attendance.manage.policySummary.periodHomeroom;
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
