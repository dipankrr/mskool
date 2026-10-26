import { StyleSheet, View } from "react-native";

import { Card } from "../../components/card";
import { StatusMeter } from "../../components/status-meter";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { spacing } from "../../theme/tokens";

/**
 * A reviewer's class line on the hub: how much of the class's marks are in, and
 * how much of that is verified. One readiness read; counts are cells (students
 * × components), the server's unit. The bar repeats the words, never replaces
 * them.
 */
export function HubReviewCard({
  entered,
  expected,
  verified,
}: {
  entered: number;
  expected: number;
  verified: number;
}) {
  const toVerify = Math.max(0, entered - verified);
  const missing = Math.max(0, expected - entered);
  return (
    <Card testID="hub-review-card">
      <ThemedText variant="bodyStrong">
        {copy.exams.hub.review.classLine(entered, expected)}
      </ThemedText>
      <StatusMeter
        segments={[
          { key: "verified", value: verified, tone: "positive" },
          { key: "toVerify", value: toVerify, tone: "positive", opacity: 0.35 },
          { key: "missing", value: missing, tone: "neutral", opacity: 0.2 },
        ]}
        style={styles.meter}
        testID="hub-review-meter"
      />
      <View>
        <ThemedText variant="meta">
          {copy.exams.hub.review.classCounts(verified, toVerify)}
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  meter: {
    marginVertical: spacing.sm,
  },
});
