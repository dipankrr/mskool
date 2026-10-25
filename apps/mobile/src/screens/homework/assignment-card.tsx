import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { IconTile } from "../../components/icon-tile";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { todayIso } from "../../lib/format";
import {
  clockOf,
  dayLabel,
  dayKeyOf,
  formatMinutes,
  isPastDue,
} from "../../lib/homework";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { kindGlyph, kindLabel, statusLabel, statusNeedsPill, statusTone } from "./meta";
import type { HomeworkRow } from "./types";

/**
 * One assignment in the agenda or the All list.
 *
 * The card answers the three questions a teacher has in a corridor — *what*,
 * *which class/subject*, *when* — in that order. The due time is the only
 * right-aligned fact: it is what the eye scans down the agenda for. A status
 * capsule appears only when the status is not the norm (draft, scheduled,
 * closed, cancelled); a published row says nothing and means "this is live".
 *
 * Overdue is stated in words, never only in red: "Was due 8:00 am" carries the
 * meaning for a colour-blind reader. The whole card is one target.
 */
export function AssignmentCard({
  row,
  onPress,
  showDay = false,
  dense = false,
}: {
  row: HomeworkRow;
  onPress: () => void;
  /** Print the date above the time — the All view's cross-day list. */
  showDay?: boolean;
  dense?: boolean;
}) {
  const today = todayIso();
  const dueDay = dayKeyOf(row.dueAt);
  const overdue = isPastDue(row);
  const time = clockOf(row.dueAt) ?? "—";
  const dueLine = overdue
    ? copy.homework.card.wasDue(time)
    : copy.homework.card.due(time);
  const dateLine = showDay && dueDay && dueDay !== today
    ? `${dayLabel(dueDay, today)} · `
    : "";
  const minutes = formatMinutes(row.estimatedMinutes);
  const live = row.status === "published" || row.status === "scheduled";

  const a11y = [
    row.title,
    row.subjectName,
    kindLabel(row.kind),
    statusLabel(row.status),
    `${dateLine}${dueLine}`,
    minutes !== "—" ? minutes : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      testID={`homework-card-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={copy.homework.card.openHint}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        dense ? styles.cardDense : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <IconTile
        name={kindGlyph(row.kind)}
        size={40}
        tone={live ? "accent" : "neutral"}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <ThemedText
            variant="name"
            numberOfLines={2}
            style={styles.title}
          >
            {row.title}
          </ThemedText>
          {statusNeedsPill(row.status) ? (
            <StatusPill
              label={statusLabel(row.status)}
              tone={statusTone[row.status] ?? "neutral"}
            />
          ) : (
            <AppIcon name="chevronRight" size={18} color={colors.chevron} />
          )}
        </View>
        <ThemedText variant="meta" numberOfLines={1}>
          {row.subjectName} · {kindLabel(row.kind)}
        </ThemedText>
        <View style={styles.metaRow}>
          <AppIcon
            name="clock"
            size={13}
            color={overdue ? colors.tone.critical.fg : colors.muted}
          />
          <ThemedText
            variant="meta"
            color={overdue ? colors.tone.critical.fg : colors.muted}
            numberOfLines={1}
            style={styles.metaText}
          >
            {dateLine}
            {dueLine}
          </ThemedText>
          {minutes !== "—" ? (
            <ThemedText variant="meta" numberOfLines={1}>
              · {minutes}
            </ThemedText>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  cardDense: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  body: {
    flex: 1,
    gap: spacing.xxs,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  title: {
    flex: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  metaText: {
    flexShrink: 1,
  },
});
