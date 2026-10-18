import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import type { AppIconName } from "./app-icon";
import { ThemedText } from "./themed-text";

/**
 * The honest nothing: an empty roster, no results, a not-yet-configured
 * section. Icon in a neutral chip, one title, one line of why, optional
 * action(s) as children. Never an error and never a spinner — those have
 * their own surfaces.
 */
export function EmptyState({
  icon = "students",
  title,
  message,
  testID,
  style,
  children,
}: {
  icon?: AppIconName;
  title: string;
  message?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <View testID={testID} style={[styles.wrap, style]}>
      <View style={styles.iconChip}>
        <AppIcon name={icon} size={26} color={colors.tone.neutral.fg} />
      </View>
      <ThemedText variant="name" style={styles.title}>
        {title}
      </ThemedText>
      {message ? (
        <ThemedText variant="meta" style={styles.message}>
          {message}
        </ThemedText>
      ) : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  iconChip: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: spacing.md,
    textAlign: "center",
  },
  message: {
    marginTop: spacing.xs,
    textAlign: "center",
  },
  actions: {
    marginTop: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
  },
});
