import { useEffect, useRef } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@expo/ui/community/bottom-sheet";

import { Avatar } from "../../components/avatar";
import { CapsuleButton } from "../../components/capsule-button";
import { SectionLabel } from "../../components/section-label";
import { StatusMeter } from "../../components/status-meter";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import type { Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import type { RosterEntry } from "./roster";
import { StudentAttendanceMap } from "./student-attendance-map";
import { formatPercent, markedDaysForRow, presentSharePercent } from "./summary";
import type { SummaryRow } from "./summary";

/**
 * One student's attendance detail, opened from a summary row. It keeps the
 * two rates honest: the official annual percentage (the exam-eligibility
 * figure) is shown beside the present share of marked days, and the coverage
 * bar makes clear how much of the year has been recorded. Half day is a real
 * bucket now — counted as a marked day, shown in the meter and metrics, and
 * explicitly not promoted to present in the official rate.
 */
export function StudentSummarySheet({
  sectionId,
  entry,
  row,
  visible,
  onDismiss,
}: {
  sectionId: string;
  entry: RosterEntry | null;
  row: SummaryRow | null;
  visible: boolean;
  onDismiss: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const { height } = useWindowDimensions();

  useEffect(() => {
    if (visible) {
      ref.current?.present();
    } else {
      ref.current?.dismiss();
    }
  }, [visible]);

  if (!entry) {
    return null;
  }

  const working = row?.workingDays ?? 0;
  const marked = row ? markedDaysForRow(row) : 0;
  const coverage = working > 0 ? (marked / working) * 100 : 0;
  const coverageWidth = coverage <= 0 ? 0 : Math.min(100, Math.max(coverage, 4));
  const official = row ? formatPercent(row.attendancePercentage) : "—";
  const share = row ? formatPercent(presentSharePercent(row)) : "—";

  const metrics: { label: string; value: number; tone: Tone }[] = row
    ? [
        {
          label: copy.attendance.marking.statuses.present,
          value: row.daysPresent,
          tone: "positive",
        },
        { label: copy.attendance.marking.statuses.absent, value: row.daysAbsent, tone: "critical" },
        { label: copy.attendance.marking.statuses.late, value: row.daysLate, tone: "caution" },
        {
          label: copy.attendance.marking.statuses.half_day,
          value: row.daysHalfDay,
          tone: "caution",
        },
        {
          label: copy.attendance.marking.statuses.on_leave,
          value: row.daysOnLeave,
          tone: "neutral",
        },
      ]
    : [];

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetScrollView
        testID="summary-detail-sheet"
        style={{ maxHeight: Math.round(height * 0.78) }}
        contentContainerStyle={styles.content}
      >
        <View style={styles.identity}>
          <Avatar name={entry.name} size="lg" />
          <View style={styles.identityCopy}>
            <ThemedText variant="title" numberOfLines={2}>
              {entry.name}
            </ThemedText>
            {entry.roll ? (
              <ThemedText variant="meta">{copy.attendance.marking.roll(entry.roll)}</ThemedText>
            ) : null}
          </View>
        </View>

        {row ? (
          <>
            <View style={styles.block}>
              <SectionLabel style={styles.sectionLabel}>
                {copy.attendance.summary.coverageLabel}
              </SectionLabel>
              <View style={styles.coverageRow}>
                <ThemedText variant="hero" style={styles.coverageValue}>
                  {marked}
                </ThemedText>
                <ThemedText variant="body" style={styles.coverageOf}>
                  {copy.attendance.summary.detail.covered(working)}
                </ThemedText>
              </View>
              <View style={styles.coverageTrack}>
                <View style={[styles.coverageFill, { width: `${coverageWidth}%` }]} />
              </View>
            </View>

            <View style={styles.rateRow}>
              <View style={styles.rateCell}>
                <ThemedText variant="meta">
                  {copy.attendance.summary.detail.officialRate}
                </ThemedText>
                <ThemedText variant="title">{official}</ThemedText>
              </View>
              <View style={styles.rateCell}>
                <ThemedText variant="meta">
                  {copy.attendance.summary.detail.presentShare}
                </ThemedText>
                <ThemedText variant="title">{share}</ThemedText>
              </View>
            </View>

            <StudentAttendanceMap
              key={`${entry.studentId}:${visible ? "open" : "closed"}`}
              sectionId={sectionId}
              studentId={entry.studentId}
              visible={visible}
            />

            <View style={styles.meterBlock}>
              <ThemedText variant="sectionLabel">
                {copy.attendance.summary.detail.statusMix}
              </ThemedText>
              <StatusMeter
                height={10}
                segments={[
                  { key: "present", value: row.daysPresent, tone: "positive" },
                  { key: "absent", value: row.daysAbsent, tone: "critical" },
                  { key: "late", value: row.daysLate, tone: "caution" },
                  {
                    key: "half_day",
                    value: row.daysHalfDay,
                    tone: "caution",
                    opacity: 0.55,
                  },
                  { key: "on_leave", value: row.daysOnLeave, tone: "neutral" },
                ]}
                style={styles.detailMeter}
              />
              <View style={styles.metrics}>
                {metrics.map((metric) => (
                  <View
                    key={metric.label}
                    accessible
                    accessibilityLabel={`${metric.value} ${metric.label.toLowerCase()}`}
                    style={styles.metric}
                  >
                    <ThemedText variant="title" color={colors.tone[metric.tone].fg}>
                      {metric.value}
                    </ThemedText>
                    <ThemedText variant="meta">{metric.label}</ThemedText>
                  </View>
                ))}
              </View>
            </View>

            <ThemedText variant="meta" color={colors.muted}>
              {copy.attendance.summary.detail.halfDayNote}
            </ThemedText>
          </>
        ) : (
          <View style={styles.empty}>
            <ThemedText variant="bodyStrong">{copy.attendance.summary.noMarksTitle}</ThemedText>
            <ThemedText variant="meta">{copy.attendance.summary.detail.noData}</ThemedText>
          </View>
        )}

        <CapsuleButton
          title={copy.attendance.summary.detail.close}
          variant="secondary"
          size="compact"
          onPress={onDismiss}
          style={styles.close}
          testID="summary-detail-close"
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.huge,
    gap: spacing.lg,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  identityCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  block: {
    gap: spacing.sm,
  },
  sectionLabel: {
    marginTop: 0,
  },
  coverageRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  coverageValue: {
    fontVariant: ["tabular-nums"],
  },
  coverageOf: {
    flex: 1,
  },
  coverageTrack: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    overflow: "hidden",
  },
  coverageFill: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  rateRow: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  rateCell: {
    flex: 1,
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  meterBlock: {
    gap: spacing.sm,
  },
  detailMeter: {
    marginTop: spacing.xxs,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.md,
    marginTop: spacing.xs,
  },
  metric: {
    flexBasis: "33.333%",
    gap: spacing.xxs,
    paddingRight: spacing.xs,
  },
  empty: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  close: {
    alignSelf: "stretch",
  },
});
