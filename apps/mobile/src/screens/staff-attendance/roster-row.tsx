import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

import { Avatar } from "../../components/avatar";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { formatShortWeekday } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import type { Status } from "./draft";
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
};

/**
 * One roster line (probe anatomy): initials avatar, name, roll, a large
 * single-letter status tile, and — when history exists — the last five marked
 * days as labelled status squares under the name. The tile spans both text
 * rows so the status reads at a glance instead of floating beside the name.
 * Tap marks a blank row present, then toggles present ⇄ absent; long-press
 * opens the five-status sheet. Screen readers get the same second choice as a
 * labelled action ("Change status") and the recent strip in words, never as a
 * colour-only gesture.
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
  const a11yLabel = copy.attendance.marking.a11y.row(row.name, row.roll, label);
  const fullA11yLabel = recentText
    ? copy.attendance.marking.a11y.recent(a11yLabel, recentText)
    : a11yLabel;

  const content = (
    <>
      <Avatar name={row.name} />
      <View style={styles.text}>
        <ThemedText variant="name" numberOfLines={1}>
          {row.name}
        </ThemedText>
        {row.roll ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {copy.attendance.marking.roll(row.roll)}
          </ThemedText>
        ) : null}
        {row.recent.length > 0 ? (
          <View style={styles.recent} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {row.recent.map((mark) => (
              <RecentSquare key={mark.date} mark={mark} />
            ))}
          </View>
        ) : null}
      </View>
      <View
        testID={`roster-pill-${row.studentId}`}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.statusTile,
          { backgroundColor: row.status ? colors.tone[statusTone[row.status]].bg : colors.field },
          row.status ? null : styles.statusTileEmpty,
        ]}
      >
        <ThemedText
          variant="numeric"
          color={row.status ? colors.tone[statusTone[row.status]].fg : colors.muted}
          numberOfLines={1}
          maxFontSizeMultiplier={1.25}
          style={styles.statusLetter}
        >
          {row.status ? statusShort(row.status) : copy.attendance.marking.unmarkedShort}
        </ThemedText>
      </View>
    </>
  );

  if (!canMark) {
    return (
      <View
        testID={`roster-row-${row.studentId}`}
        accessible
        accessibilityLabel={fullA11yLabel}
        style={[styles.row, row.recent.length > 0 ? styles.rowWithRecent : null, style]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={`roster-row-${row.studentId}`}
      accessibilityRole="button"
      accessibilityLabel={fullA11yLabel}
      accessibilityHint={copy.attendance.marking.a11y.rowHint}
      accessibilityActions={[
        { name: "longpress", label: copy.attendance.marking.a11y.changeAction },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") {
          onOpenSheet(row.studentId);
        }
      }}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggle(row.studentId);
      }}
      delayLongPress={400}
      onLongPress={() => onOpenSheet(row.studentId)}
      style={({ pressed }) => [
        styles.row,
        row.recent.length > 0 ? styles.rowWithRecent : null,
        pressed ? styles.rowPressed : null,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
});

function RecentSquare({ mark }: { mark: RecentMark }) {
  if (!mark.status) {
    return (
      <View style={[styles.recentSquare, styles.recentEmpty]}>
        <ThemedText variant="tab" color={colors.muted}>
          ·
        </ThemedText>
      </View>
    );
  }
  const { fg, bg } = colors.tone[statusTone[mark.status]];
  return (
    <View style={[styles.recentSquare, { backgroundColor: bg }]}>
      <ThemedText variant="tab" color={fg} style={styles.recentLetter}>
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
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  rowWithRecent: {
    minHeight: 80,
  },
  rowPressed: {
    transform: [{ scale: 0.98 }],
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  statusTile: {
    width: 48,
    minHeight: 48,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  statusTileEmpty: {
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  statusLetter: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bold,
    letterSpacing: 0,
  },
  recent: {
    flexDirection: "row",
    gap: 3,
    marginTop: spacing.xxs,
  },
  recentSquare: {
    width: 19,
    height: 19,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  recentEmpty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  recentLetter: {
    fontFamily: fontFamily.bold,
  },
});
