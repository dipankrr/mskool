import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { EXAM_STATUSES, stageIndex } from "../../lib/exams";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { stageLabel, stageTone } from "./meta";

/**
 * Where the exam is in its seven-stage life, said three ways at once: the
 * stage's name, "Stage 4 of 7", and a seven-piece bar. The web owner called the
 * lifecycle track "the good part"; on a phone it is one quiet card rather than
 * a seven-label stepper that would not fit. The bar is decorative — the words
 * carry the meaning, so it is hidden from screen readers.
 *
 * The card also owns the stage's own acts: "Back to X" (the step back, when
 * the stage allows one) sits beside the "Next" line.
 */
export function StageTrack({
  status,
  back,
}: {
  status: string;
  /** The step back this stage allows, already worded ("Back to draft"). */
  back?: { label: string; onPress: () => void };
}) {
  const index = stageIndex(status);
  const total = EXAM_STATUSES.length;
  const nextStatus = index >= 0 && index < total - 1 ? EXAM_STATUSES[index + 1] : null;
  const position = copy.exams.hub.stageOf(index + 1, total);
  const next = nextStatus ? copy.exams.hub.next(stageLabel(nextStatus)) : null;

  return (
    <Card testID="exam-stage-track">
      <View style={styles.top}>
        <View
          style={styles.stageInfo}
          accessible
          accessibilityLabel={[stageLabel(status), position, next]
            .filter(Boolean)
            .join(". ")}
        >
          <StatusPill label={stageLabel(status)} tone={stageTone(status)} />
          <ThemedText variant="meta" style={styles.position}>
            {position}
          </ThemedText>
        </View>
      </View>
      <View
        style={styles.bar}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {EXAM_STATUSES.map((stage, position) => (
          <View
            key={stage}
            style={[
              styles.piece,
              position <= index ? styles.pieceDone : null,
              position === index ? styles.pieceNow : null,
            ]}
          />
        ))}
      </View>
      {next || back ? (
        <View style={styles.bottom}>
          {next ? (
            <ThemedText variant="meta" style={styles.next}>
              {next}
            </ThemedText>
          ) : (
            <View style={styles.next} />
          )}
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={back.label}
              hitSlop={8}
              onPress={back.onPress}
              style={({ pressed }) => [styles.back, pressed ? styles.backPressed : null]}
              testID="exam-hub-back-step"
            >
              <AppIcon name="chevronLeft" size={14} color={colors.accentDeep} />
              <ThemedText variant="caption" color={colors.accentDeep} numberOfLines={1}>
                {back.label}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  stageInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  position: {
    textAlign: "right",
  },
  backPressed: {
    backgroundColor: colors.field,
  },
  bar: {
    flexDirection: "row",
    gap: spacing.xs,
    marginVertical: spacing.md,
  },
  piece: {
    flex: 1,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  pieceDone: {
    backgroundColor: colors.accentStrong,
  },
  pieceNow: {
    backgroundColor: colors.accent,
  },
  bottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  next: {
    flex: 1,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    flexShrink: 1,
  },
});
