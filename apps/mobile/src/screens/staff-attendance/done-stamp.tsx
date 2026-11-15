import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { AnimatedStyle } from "react-native-reanimated";

import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { fontFamily, radius, spacing } from "../../theme/tokens";

const TILT = "-8deg";
const INK = colors.accent;
/** The stamp's own box; the panel centres it over the visible rows with these. */
export const STAMP_WIDTH = 220;
export const STAMP_HEIGHT = 96;

/**
 * The register's rubber stamp: once every student is marked and saved, a big
 * green-ink "MARKED" stamp floats over the student list (owner, 2026-11-15),
 * which dims slightly beneath it. Right after a save it presses in (big and
 * faint → slight overshoot → rest, an ink flash, a heavy haptic); a day that
 * was already marked shows it at rest. Reduced motion skips the press.
 * Decorative: the saved card above says the same thing in words.
 */
export function DoneStamp({
  detail,
  animate,
  positionStyle,
}: {
  detail: string;
  animate: boolean;
  /** Where the panel places it (absolute, follows the visible rows). */
  positionStyle?: StyleProp<AnimatedStyle<StyleProp<ViewStyle>>>;
}) {
  const reduced = useReducedMotion();
  const play = animate && !reduced;
  const scale = useSharedValue(play ? 1.9 : 1);
  const opacity = useSharedValue(play ? 0 : 1);
  const bleed = useSharedValue(0);

  useEffect(() => {
    if (!play) return;
    opacity.value = withTiming(1, { duration: 160 });
    scale.value = withSequence(
      withTiming(0.9, { duration: 200, easing: Easing.in(Easing.quad) }),
      withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }),
    );
    bleed.value = withDelay(
      190,
      withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 460 })),
    );
    const thud = setTimeout(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }, 190);
    return () => clearTimeout(thud);
  }, [play, opacity, scale, bleed]);

  const pressStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ rotate: TILT }, { scale: scale.value }],
  }));
  const bleedStyle = useAnimatedStyle(() => ({ opacity: bleed.value * 0.3 }));

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.position, positionStyle]}
      testID="attendance-done-stamp"
    >
      <Animated.View style={[styles.stamp, pressStyle]}>
        <Animated.View style={[styles.bleed, bleedStyle]} />
        <View style={styles.outer}>
          <View style={styles.inner}>
            <ThemedText
              variant="hero"
              color={colors.accentDeep}
              style={styles.word}
              maxFontSizeMultiplier={1}
              numberOfLines={1}
            >
              {copy.attendance.marking.stampWord}
            </ThemedText>
            <View style={styles.rule} />
            <ThemedText
              variant="caption"
              color={colors.accentDeep}
              style={styles.detail}
              maxFontSizeMultiplier={1}
              numberOfLines={1}
            >
              {detail}
            </ThemedText>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  position: { position: "absolute", width: STAMP_WIDTH, height: STAMP_HEIGHT },
  stamp: { flex: 1 },
  bleed: {
    position: "absolute",
    top: -8,
    bottom: -8,
    left: -8,
    right: -8,
    borderRadius: radius.lg,
    backgroundColor: INK,
  },
  outer: {
    flex: 1,
    borderWidth: 4,
    borderColor: INK,
    borderRadius: radius.md,
    padding: 3,
    backgroundColor: "rgba(255, 255, 255, 0.82)",
  },
  inner: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: INK,
    borderRadius: radius.sm - 4,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  word: { fontFamily: fontFamily.bold, fontSize: 34, lineHeight: 38, letterSpacing: 5 },
  rule: { width: "70%", height: 1.5, backgroundColor: INK, marginVertical: 3 },
  detail: { fontFamily: fontFamily.semibold, fontSize: 12, letterSpacing: 1.2 },
});
