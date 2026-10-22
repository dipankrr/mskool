import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
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
import { toHHMM } from "./period-form";

/**
 * One section's periods (chunk 3): the timetable slots period-wise marking
 * reads, in sequence order. Daily-marking schools still see them — the note
 * explains the relationship instead of hiding the screen — and the caution on
 * the policy screen links here when the mode needs slots that do not exist.
 */
export function ManagePeriods() {
  const { has } = usePermissions();
  const canManage = has("attendance:update");
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const { section, sectionLabel } = useAttendanceSection(params.sectionId);
  const ready = Boolean(organizationId && academicYear && section);

  const policyQuery = trpc.attendance.policy.get.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: ready && canManage, staleTime: 60_000 },
  );
  const periodsQuery = trpc.attendance.period.list.useQuery(
    { organizationId: organizationId ?? "", sectionId: section?.id ?? "" },
    { enabled: ready && canManage, staleTime: 60_000 },
  );

  const sectionName = sectionLabel ?? section?.name ?? "";
  const meta =
    [sectionName, academicYear?.name ?? ""].filter(Boolean).join(" · ") ||
    null;

  if (!canManage) {
    return (
      <ManageFrame title={copy.attendance.manage.rows.periods} meta={meta}>
        <EmptyState
          icon="clock"
          title={copy.attendance.manage.noAccessTitle}
          message={copy.attendance.manage.noAccessBody}
          testID="periods-no-access"
        />
      </ManageFrame>
    );
  }

  // The policy row may be absent (defaults = daily) — the note still applies.
  const marksDaily =
    policyQuery.data !== undefined &&
    (policyQuery.data === null || policyQuery.data.markingMode === "daily");

  return (
    <ManageFrame title={copy.attendance.manage.rows.periods} meta={meta}>
      {!ready ? (
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
          {marksDaily ? (
            <Card style={styles.note}>
              <ThemedText variant="meta">
                {copy.attendance.manage.periods.dailyNote}
              </ThemedText>
            </Card>
          ) : null}
          <CapsuleButton
            title={copy.attendance.manage.periods.add}
            size="compact"
            onPress={() =>
              router.push({
                pathname: "/attendance/manage/period-edit",
                params: { sectionId: section?.id ?? "" },
              })
            }
            testID="period-add"
            style={styles.add}
          />
          {periodsQuery.isPending ? (
            <View style={styles.skeletonBlock}>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} height={64} style={styles.skeletonRow} />
              ))}
            </View>
          ) : periodsQuery.isError ? (
            <ErrorCard
              cause={periodsQuery.error}
              onRetry={() => void periodsQuery.refetch()}
              testID="periods-error"
            />
          ) : (periodsQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon="clock"
              title={copy.attendance.manage.periods.emptyTitle}
              message={copy.attendance.manage.periods.emptyBody}
              testID="periods-empty"
            />
          ) : (
            <Card padless style={styles.card}>
              {(periodsQuery.data ?? []).map((period, index) => {
                const detail = timeDetail(period.startTime, period.endTime);
                return (
                  <View key={period.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <Pressable
                      testID={`period-${period.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={copy.attendance.manage.periods.rowA11y(
                        period.sequenceNumber,
                        period.name,
                        detail,
                        period.isHomeroom,
                      )}
                      onPress={() =>
                        router.push({
                          pathname: "/attendance/manage/period-edit",
                          params: {
                            sectionId: section?.id ?? "",
                            periodId: period.id,
                          },
                        })
                      }
                      style={({ pressed }) => [
                        styles.row,
                        pressed ? styles.rowPressed : null,
                      ]}
                    >
                      <View style={styles.seqBadge}>
                        <ThemedText variant="caption" color={colors.muted}>
                          {period.sequenceNumber}
                        </ThemedText>
                      </View>
                      <View style={styles.rowText}>
                        <ThemedText variant="bodyStrong" numberOfLines={1}>
                          {period.name}
                        </ThemedText>
                        <ThemedText variant="meta">{detail}</ThemedText>
                      </View>
                      {period.isHomeroom ? (
                        <View style={styles.homeroomTag}>
                          <ThemedText
                            variant="caption"
                            color={colors.accentDeep}
                          >
                            {copy.attendance.manage.periods.homeroom}
                          </ThemedText>
                        </View>
                      ) : null}
                      <AppIcon
                        name="chevronRight"
                        size={18}
                        color={colors.chevron}
                      />
                    </Pressable>
                  </View>
                );
              })}
            </Card>
          )}
        </>
      )}
    </ManageFrame>
  );
}

function timeDetail(start: string | null, end: string | null): string {
  const from = toHHMM(start);
  const until = toHHMM(end);
  if (from && until) return copy.attendance.manage.periods.times(from, until);
  if (from) return copy.attendance.manage.periods.startsAt(from);
  if (until) return copy.attendance.manage.periods.endsAt(until);
  return copy.attendance.manage.periods.noTimes;
}

const styles = StyleSheet.create({
  cardBody: {
    marginTop: spacing.xs,
  },
  note: {
    marginTop: spacing.sm,
    backgroundColor: colors.field,
  },
  add: {
    marginTop: spacing.lg,
    alignSelf: "flex-start",
  },
  card: {
    marginTop: spacing.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.hairline,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  seqBadge: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  homeroomTag: {
    minHeight: 24,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  skeletonBlock: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  skeletonRow: {
    borderRadius: radius.lg,
  },
});
