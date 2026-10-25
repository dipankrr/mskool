import { Pressable, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

import { colors } from "../theme/brand-admin";
import { fontFamily, fontSize, motion, radius, spacing } from "../theme/tokens";
import { ThemedText } from "./themed-text";

/**
 * The bulk-action pill ("All present" / "All absent") — the probe's tinted
 * pair under the stat tiles. Its tone states the outcome the action produces,
 * so the two can never be confused at arm's length. 38 pt visual height with
 * hitSlop to the 44 pt floor.
 */
export function BulkPill({
  title,
  tone,
  onPress,
  disabled = false,
  testID,
  style,
}: {
  title: string;
  tone: "positive" | "critical";
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { fg, bg } = colors.tone[tone];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={{ top: 5, bottom: 5 }}
      onPressIn={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: bg },
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <ThemedText
        variant="bodyStrong"
        color={fg}
        numberOfLines={1}
        style={styles.label}
      >
        {title}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  pressed: {
    transform: [{ scale: motion.pressScale }],
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: fontSize.small,
    fontFamily: fontFamily.semibold,
  },
});
