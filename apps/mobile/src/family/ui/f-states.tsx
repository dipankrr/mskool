import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../components/app-icon";
import { Enter } from "../motion";
import { useFamilyTheme } from "../theme";
import { FButton } from "./f-button";
import { FMascot } from "./f-mascot";
import { FText } from "./f-text";

/** Nothing to show yet: Bookie, a title, a friendly line, maybe an action. */
export function FEmptyState({
  title,
  body,
  actionLabel,
  onAction,
  mood = "calm",
  testID,
  style,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  mood?: "calm" | "happy";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { components } = useFamilyTheme();
  const k = components.state;
  return (
    <Enter style={[styles.center, { gap: k.gap, paddingVertical: k.paddingY }, style]}>
      <View testID={testID} style={[styles.center, { gap: k.gap }]}>
        <FMascot size={k.mascotSize} mood={mood} />
        <FText variant="heading" align="center">
          {title}
        </FText>
        {body ? (
          <FText variant="body" color="muted" align="center">
            {body}
          </FText>
        ) : null}
        {actionLabel && onAction ? (
          <FButton label={actionLabel} onPress={onAction} variant="secondary" size="md" style={styles.action} />
        ) : null}
      </View>
    </Enter>
  );
}

/** A load failed: one line and Try again. */
export function FErrorState({
  title,
  body,
  onRetry,
  testID,
  style,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { components } = useFamilyTheme();
  const k = components.state;
  return (
    <Enter style={[styles.center, { gap: k.gap, paddingVertical: k.paddingY }, style]}>
      <View testID={testID} accessibilityRole="alert" style={[styles.center, { gap: k.gap }]}>
        <FMascot size={k.mascotSize} look="left" animate={false} />
        <FText variant="heading" align="center">
          {title ?? t("error.title")}
        </FText>
        <FText variant="body" color="muted" align="center">
          {body ?? t("error.body")}
        </FText>
        {onRetry ? (
          <FButton label={t("retry")} onPress={onRetry} variant="primary" size="md" style={styles.action} />
        ) : null}
      </View>
    </Enter>
  );
}

/** A quiet line above content that came from the cache while offline. */
export function FOfflineNote({ testID, style }: { testID?: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const theme = useFamilyTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      style={[styles.note, { gap: theme.space.sm, paddingVertical: theme.space.sm }, style]}
    >
      <AppIcon name="warningCircle" size={16} color={theme.color.muted} />
      <FText variant="meta" color="muted" style={styles.noteText}>
        {t("offline")}
      </FText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
  },
  action: {
    alignSelf: "center",
    marginTop: 4,
  },
  note: {
    flexDirection: "row",
    alignItems: "center",
  },
  noteText: {
    flex: 1,
  },
});
