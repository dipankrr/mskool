import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

import { Avatar } from "../../components/avatar";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import type { Status } from "./draft";
import { statusLabel, statusTone } from "./status-meta";

export type RosterRowData = {
  studentId: string;
  name: string;
  roll: string | null;
  status: Status;
};

/**
 * One roster line (probe anatomy): initials avatar, name, roll, status pill —
 * 56 pt tall with the whole row as the target. Tap toggles present ⇄ absent;
 * long-press opens the five-status sheet; screen readers get the same second
 * choice as a labelled action ("Change status"), never a hidden gesture.
 * Read-only callers get a plain view: nothing looks tappable that is not.
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
  const label = statusLabel(row.status);

  const content = (
    <>
      <Avatar name={row.name} />
      <View style={styles.text}>
        <ThemedText variant="name" numberOfLines={1}>
          {row.name}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {row.roll
            ? copy.attendance.marking.roll(row.roll)
            : copy.attendance.marking.noRoll}
        </ThemedText>
      </View>
      <StatusPill
        label={label}
        tone={statusTone[row.status]}
        testID={`roster-pill-${row.studentId}`}
      />
    </>
  );

  if (!canMark) {
    return (
      <View
        testID={`roster-row-${row.studentId}`}
        accessible
        accessibilityLabel={copy.attendance.marking.a11y.row(
          row.name,
          row.roll,
          label,
        )}
        style={[styles.row, style]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={`roster-row-${row.studentId}`}
      accessibilityRole="button"
      accessibilityLabel={copy.attendance.marking.a11y.row(
        row.name,
        row.roll,
        label,
      )}
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
        pressed ? styles.rowPressed : null,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    transform: [{ scale: 0.98 }],
  },
  text: {
    flex: 1,
  },
});
