import { StyleSheet, View } from "react-native";

import { Card } from "../../components/card";
import { StatusMeter } from "../../components/status-meter";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import type { ReviewSummary } from "../../lib/exam-draft";
import { spacing } from "../../theme/tokens";

/**
 * The review progress card: a three-state bar (verified solid, to verify
 * tinted, missing grey) and the same three numbers in words, so the bar is
 * never the only carrier of the meaning. Counts are cells (students ×
 * components) — the server's unit and the verify batch's — so a multi-component
 * paper says so.
 */
export function ReviewSummaryCard({
  summary,
  multi,
  paperLine,
}: {
  summary: ReviewSummary;
  multi: boolean;
  /** "Whole paper: 20 of 40 verified" when the screen shows one section. */
  paperLine?: string | null;
}) {
  return (
    <Card testID="review-summary">
      <StatusMeter
        segments={[
          { key: "verified", value: summary.verified, tone: "positive" },
          { key: "toVerify", value: summary.toVerify, tone: "positive", opacity: 0.35 },
          { key: "missing", value: summary.missing, tone: "neutral", opacity: 0.2 },
        ]}
        testID="review-meter"
      />
      <View style={styles.text}>
        <ThemedText
          variant="bodyStrong"
          accessibilityLabel={copy.exams.paper.review.meterA11y(
            summary.verified,
            summary.toVerify,
            summary.missing,
          )}
          testID="review-meter-line"
        >
          {copy.exams.paper.review.meterLine(
            summary.verified,
            summary.toVerify,
            summary.missing,
          )}
        </ThemedText>
        {multi ? (
          <ThemedText variant="meta">{copy.exams.paper.review.perMark}</ThemedText>
        ) : null}
        {paperLine ? <ThemedText variant="meta">{paperLine}</ThemedText> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  text: {
    marginTop: spacing.sm,
    gap: spacing.xxs,
  },
});
