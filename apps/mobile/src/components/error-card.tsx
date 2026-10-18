import { StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { copy } from "../lib/copy";
import { toFriendlyError } from "../lib/errors";
import { spacing } from "../theme/tokens";
import { CapsuleButton } from "./capsule-button";
import { Card } from "./card";
import { ThemedText } from "./themed-text";

/**
 * The one way a failed fetch renders: the friendly sentence from
 * `lib/errors` (never a raw server string) and, when the failure could
 * plausibly succeed on retry, a Retry control. Screens decide placement;
 * this card owns the wording and the retry semantics.
 */
export function ErrorCard({
  cause,
  onRetry,
  testID,
  style,
}: {
  cause: unknown;
  onRetry?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const friendly = toFriendlyError(cause);
  return (
    <Card testID={testID} style={style}>
      <ThemedText variant="body">{friendly.message}</ThemedText>
      {friendly.retryable && onRetry ? (
        <CapsuleButton
          title={copy.common.retry}
          variant="secondary"
          size="compact"
          onPress={onRetry}
          testID={testID ? `${testID}-retry` : undefined}
          style={styles.retry}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  retry: {
    marginTop: spacing.md,
  },
});
