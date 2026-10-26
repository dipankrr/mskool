import { StyleSheet, View } from "react-native";

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
 */
export function StageTrack({ status }: { status: string }) {
  const index = stageIndex(status);
  const total = EXAM_STATUSES.length;
  const nextStatus = index >= 0 && index < total - 1 ? EXAM_STATUSES[index + 1] : null;
  const position = copy.exams.hub.stageOf(index + 1, total);
  const next = nextStatus ? copy.exams.hub.next(stageLabel(nextStatus)) : null;

  return (
    <Card
      accessible
      accessibilityLabel={[stageLabel(status), position, next]
        .filter(Boolean)
        .join(". ")}
      testID="exam-stage-track"
    >
      <View style={styles.top}>
        <StatusPill label={stageLabel(status)} tone={stageTone(status)} />
        <ThemedText variant="meta">{position}</ThemedText>
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
      {next ? <ThemedText variant="meta">{next}</ThemedText> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
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
});
