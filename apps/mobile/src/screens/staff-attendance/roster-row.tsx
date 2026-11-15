import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { formatShortWeekday } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import type { Status } from "./draft";
import { RollRing } from "./roll-ring";
import type { SessionMix } from "./roll-ring";
import { statusLabel, statusShort, statusTone } from "./status-meta";

export type RecentMark = {
  date: string;
  /** null represents a day the student has no status for. */
  status: Status | null;
};

export type RosterRowData = {
  studentId: string;
  name: string;
  roll: string | null;
  status: Status | null;
  /** The last few marked days, oldest first. Empty hides the strip. */
  recent: readonly RecentMark[];
  /** The session so far for the ring; null hides it. */
  mix: SessionMix | null;
  /** Session percentage as text, for the screen reader only. */
  percentText: string | null;
  /** The stored status a past-day correction is changing, shown as "was …". */
  was: Status | null;
};

/**
 * One roster line (v2 mockup, owner-approved 2026-11-15): the roll number in
 * a circle ringed by the session so far, the name over the last-5-days strip,
 * and the status as a word. An absent row takes a light red tint so absentees
 * can be found by eye before saving. Tap marks a blank row present, then
 * toggles present ⇄ absent; long-press opens the five-status sheet. Screen
 * readers get the same second choice as a named action.
 */
export const RosterRow = memo(function RosterRow({
  row,
  canMark,
  onToggle,
  onOpenSheet,
  style,
}: {
  row: RosterRowData;
  canMark: boolean;
  onToggle: (studentId: string) => void;
  onOpenSheet: (studentId: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const label = row.status ? statusLabel(row.status) : copy.attendance.marking.unmarked;
  const recentText = row.recent
    .map((mark) =>
      copy.attendance.marking.recentA11y(
        formatShortWeekday(mark.date),
        mark.status ? statusLabel(mark.status) : copy.attendance.marking.unmarked,
      ),
    )
    .join(", ");
  const base = copy.attendance.marking.a11y.row(row.name, row.roll, label);
  const parts = [
    base,
    row.was ? copy.attendance.marking.was(statusLabel(row.was)) : null,
    row.percentText ? copy.attendance.marking.ringA11y(row.percentText) : null,
  ].filter(Boolean);
  const a11yLabel = recentText
    ? copy.attendance.marking.a11y.recent(parts.join(". "), recentText)
    : parts.join(". ");
  const absent = row.status === "absent";

  const pill = (
    <View
      testID={`roster-pill-${row.studentId}`}
      style={[styles.pill, pillStyle(row.status, canMark)]}
    >
      <ThemedText
        variant="bodyStrong"
        color={pillInk(row.status)}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={styles.pillText}
      >
        {row.status
          ? statusLabel(row.status)
          : canMark
            ? copy.attendance.marking.tapShort
            : copy.attendance.marking.unmarkedShort}
      </ThemedText>
    </View>
  );

  const content = (
    <>
      <RollRing roll={row.roll} mix={row.mix} tone={absent ? "absent" : "default"} />
      <View style={styles.text}>
        <ThemedText variant="name" numberOfLines={1}>
          {row.name}
        </ThemedText>
        {row.recent.length > 0 ? (
          <View style={styles.recent}>
            {row.recent.map((mark) => (
              <RecentSquare key={mark.date} mark={mark} onTint={absent} />
            ))}
          </View>
        ) : null}
      </View>
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={styles.pillCol}
      >
        {pill}
        {row.was ? (
          <ThemedText variant="caption" color={colors.muted} numberOfLines={1}>
            {copy.attendance.marking.was(statusLabel(row.was))}
          </ThemedText>
        ) : null}
      </View>
    </>
  );

  const rowStyle = [
    styles.row,
    absent ? styles.rowAbsent : null,
    row.was ? styles.rowChanged : null,
  ];

  if (!canMark) {
    return (
      <View
        testID={`roster-row-${row.studentId}`}
        accessible
        accessibilityLabel={a11yLabel}
        style={[rowStyle, style]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={`roster-row-${row.studentId}`}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={copy.attendance.marking.a11y.rowHint}
      accessibilityActions={[{ name: "longpress", label: copy.attendance.marking.a11y.changeAction }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") onOpenSheet(row.studentId);
      }}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggle(row.studentId);
      }}
      delayLongPress={400}
      onLongPress={() => onOpenSheet(row.studentId)}
      style={({ pressed }) => [rowStyle, pressed ? styles.rowPressed : null, style]}
    >
      {content}
    </Pressable>
  );
});

function pillStyle(status: Status | null, canMark: boolean): ViewStyle {
  if (!status) {
    return canMark
      ? { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.grabber }
      : { backgroundColor: colors.field };
  }
  if (status === "absent") return { backgroundColor: colors.tone.critical.fg };
  return { backgroundColor: colors.tone[statusTone[status]].bg };
}

function pillInk(status: Status | null): string {
  if (!status) return colors.chevron;
  if (status === "absent") return colors.onAccent;
  return colors.tone[statusTone[status]].fg;
}

function RecentSquare({ mark, onTint }: { mark: RecentMark; onTint: boolean }) {
  if (!mark.status) {
    return (
      <View style={[styles.square, styles.squareEmpty]}>
        <ThemedText variant="tab" color={colors.muted}>
          ·
        </ThemedText>
      </View>
    );
  }
  const { fg, bg } = colors.tone[statusTone[mark.status]];
  return (
    <View style={[styles.square, { backgroundColor: onTint ? colors.surface : bg }]}>
      <ThemedText variant="tab" color={fg} maxFontSizeMultiplier={1.3} style={styles.squareText}>
        {statusShort(mark.status)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm + 2,
    paddingRight: spacing.sm + 2,
    backgroundColor: colors.surface,
  },
  rowAbsent: { backgroundColor: colors.tone.critical.bg },
  rowChanged: { backgroundColor: colors.tone.caution.bg },
  rowPressed: { opacity: 0.85 },
  text: { flex: 1, gap: spacing.xs },
  recent: { flexDirection: "row", gap: 3 },
  square: {
    minWidth: 17,
    height: 17,
    paddingHorizontal: 2,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  squareEmpty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  squareText: { fontFamily: fontFamily.bold, fontSize: 10 },
  pillCol: { alignItems: "center", gap: spacing.xxs },
  pill: {
    width: 80,
    minHeight: 36,
    borderRadius: radius.md - 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  pillText: { fontSize: fontSize.fine },
});
