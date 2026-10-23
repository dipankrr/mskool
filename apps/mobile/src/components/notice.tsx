import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { colors } from "../theme/brand-admin";
import type { Tone } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import type { AppIconName } from "./app-icon";
import { ThemedText } from "./themed-text";

/**
 * The one inline explanation block: a neutral note, an amber caution, or a red
 * statement that something is wrong. Tinted background, one icon, a short
 * title, and prose that states the consequence rather than "Are you sure?".
 *
 * A critical notice is announced politely when it appears; caution and neutral
 * are read when the user reaches them.
 */
export function Notice({
  tone = "neutral",
  title,
  message,
  icon,
  children,
  style,
  testID,
}: {
  tone?: Tone;
  title?: string;
  message?: string;
  icon?: AppIconName;
  /** An action or extra line rendered under the prose. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { fg, bg } = colors.tone[tone];
  const glyph =
    icon ?? (tone === "critical" || tone === "caution" ? "warning" : "shield");

  return (
    <View
      testID={testID}
      style={[styles.wrap, { backgroundColor: bg }, style]}
    >
      <View
        style={styles.row}
        accessible={Boolean(title || message)}
        accessibilityLabel={[title, message].filter(Boolean).join(". ")}
        accessibilityLiveRegion={tone === "critical" ? "polite" : undefined}
      >
        <AppIcon name={glyph} size={18} color={fg} style={styles.icon} />
        <View style={styles.text}>
          {title ? (
            <ThemedText variant="bodyStrong" color={fg}>
              {title}
            </ThemedText>
          ) : null}
          {message ? (
            <ThemedText variant="meta" color={colors.ink} style={styles.message}>
              {message}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {children ? <View style={styles.extra}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    padding: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  message: {
    lineHeight: 19,
  },
  extra: {
    marginTop: spacing.md,
  },
});
