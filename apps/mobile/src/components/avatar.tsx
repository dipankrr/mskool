import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors } from "../theme/brand-admin";
import { fontSize, fontWeight, radius } from "../theme/tokens";
import { ThemedText } from "./themed-text";

/**
 * Initials avatar — names only, never student photos (privacy rule from the
 * design gate). `md` (40) sits in roster rows, `lg` (44) heads the status
 * sheet. Decorative: the row/sheet announces the full name, so the avatar is
 * hidden from screen readers.
 */

/** "Aditi Sharma" → "AS"; a single word takes its first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const second =
    words.length > 1 ? words[words.length - 1]!.charAt(0) : words[0]!.charAt(1);
  return (first + second).toUpperCase();
}

export function Avatar({
  name,
  size = "md",
  style,
  testID,
}: {
  name: string;
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[styles.base, size === "lg" ? styles.lg : styles.md, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <ThemedText
        variant="body"
        style={[styles.text, size === "lg" ? styles.textLg : null]}
        allowFontScaling={false}
      >
        {initials(name)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.full,
    backgroundColor: colors.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  md: {
    width: 40,
    height: 40,
  },
  lg: {
    width: 44,
    height: 44,
  },
  // Initials are a graphic, not text to read: never scale them with Dynamic
  // Type (they would clip their circle), and never let them wrap.
  text: {
    color: colors.tone.neutral.fg,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.small,
  },
  textLg: {
    fontSize: fontSize.body,
  },
});
