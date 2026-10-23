import { StyleSheet, useWindowDimensions, View } from "react-native";

import { Card } from "../../components/card";
import { StatusMeter } from "../../components/status-meter";
import type { StatusMeterSegment } from "../../components/status-meter";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import type { Status, StatusCounts } from "./draft";
import { statusLabel, statusTone } from "./status-meta";

const statOrder: readonly Status[] = [
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
];

/**
 * The day's register at a glance. Compact on purpose: one focal present
 * count, one thick composition bar, and five labelled buckets — half day
 * included at zero. The old card spent its height on a hero line, a legend,
 * and a separate half-day row; this one carries the same facts in roughly
 * two-thirds of the space. Colour is redundant with the labels, and the
 * meter is hidden from screen readers because every count is printed.
 */
export function DayPulse({ counts }: { counts: StatusCounts }) {
  const { fontScale } = useWindowDimensions();
  const total = counts.marked + counts.unmarked;
  const started = counts.marked > 0;
  const presentShare = started
    ? Math.round((counts.present / counts.marked) * 100)
    : 0;
  // Five columns fit at normal text. At 1.3× the two-word labels need a
  // 3 + 2 grid instead of overflowing into each other.
  const wrapStats = fontScale >= 1.2;
  const segments: StatusMeterSegment[] = [
    { key: "present", value: counts.present, tone: statusTone.present },
    { key: "absent", value: counts.absent, tone: statusTone.absent },
    { key: "late", value: counts.late, tone: statusTone.late },
    { key: "half_day", value: counts.half_day, tone: statusTone.half_day, opacity: 0.55 },
    { key: "on_leave", value: counts.on_leave, tone: statusTone.on_leave },
  ];

  return (
    <Card style={styles.card} testID="attendance-pulse">
      {/* Progress lives on the save button. This card stays a read of the
          day's composition, so it never prints a second marked/total count. */}
      <View style={styles.head}>
        <ThemedText variant="sectionLabel">{copy.attendance.marking.pulseLabel}</ThemedText>
      </View>

      <View style={styles.heroRow}>
        <ThemedText variant="hero" style={styles.heroNumber}>
          {started ? counts.present : copy.attendance.summary.noValue}
        </ThemedText>
        <View style={styles.heroCopy}>
          <ThemedText variant="bodyStrong">
            {started ? copy.attendance.marking.pulsePresentLabel : copy.attendance.marking.unmarked}
          </ThemedText>
          <ThemedText variant="meta">
            {started
              ? copy.attendance.marking.pulsePresentShare(presentShare)
              : copy.attendance.studentsCount(total)}
          </ThemedText>
        </View>
      </View>

      <StatusMeter height={12} segments={segments} style={styles.meter} />

      <View style={[styles.stats, wrapStats ? styles.statsWrap : null]}>
        {statOrder.map((status) => (
          <View
            key={status}
            accessible
            accessibilityLabel={`${counts[status]} ${statusLabel(status).toLowerCase()}`}
            style={[styles.stat, wrapStats ? styles.statWrap : null]}
          >
            <ThemedText variant="title" color={colors.tone[statusTone[status]].fg}>
              {counts[status]}
            </ThemedText>
            <ThemedText variant="caption" color={colors.muted} numberOfLines={2} style={styles.statLabel}>
              {statusLabel(status)}
            </ThemedText>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    padding: spacing.md,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  heroNumber: {
    minWidth: 46,
    fontVariant: ["tabular-nums"],
  },
  heroCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  meter: {
    marginTop: spacing.sm,
  },
  stats: {
    flexDirection: "row",
    marginTop: spacing.md,
  },
  statsWrap: {
    flexWrap: "wrap",
    rowGap: spacing.md,
  },
  stat: {
    flex: 1,
    gap: spacing.xxs,
    minHeight: 42,
  },
  statWrap: {
    flexBasis: "33.333%",
    flexGrow: 0,
    paddingRight: spacing.xs,
  },
  statLabel: {
    minHeight: 28,
    flexShrink: 1,
  },
});
