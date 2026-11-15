import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
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

import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { fontFamily, radius, spacing } from "../../theme/tokens";

const TILT = "-7deg";

/**
 * The register's rubber stamp: once every student is marked and saved, a
 * green-ink "MARKED" stamp sits beside the list heading. Right after a save it
 * presses in (big and faint → slight overshoot → rest, with a firm haptic);
 * opening a day that was already marked shows it at rest. Reduced motion skips
 * the press. Decorative: the saved card above says the same thing in words.
 */
export function DoneStamp({ detail, animate }: { detail: string; animate: boolean }) {
  const reduced = useReducedMotion();
  const play = animate && !reduced;
  const scale = useSharedValue(play ? 1.8 : 1);
  const opacity = useSharedValue(play ? 0 : 1);

  useEffect(() => {
    if (!play) return;
    opacity.value = withTiming(1, { duration: 140 });
    scale.value = withSequence(
      withTiming(0.92, { duration: 180, easing: Easing.in(Easing.quad) }),
      withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }),
    );
    const thud = setTimeout(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }, 170);
    return () => clearTimeout(thud);
  }, [play, opacity, scale]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ rotate: TILT }, { scale: scale.value }],
  }));
  // A faint ink "bleed" ring that fades after the press, only when animating.
  const bleed = useSharedValue(0);
  useEffect(() => {
    if (!play) return;
    bleed.value = withDelay(170, withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 420 })));
  }, [play, bleed]);
  const bleedStyle = useAnimatedStyle(() => ({ opacity: bleed.value * 0.35 }));

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.wrap, style]}
      testID="attendance-done-stamp"
    >
      <Animated.View style={[styles.bleed, bleedStyle]} />
      <View style={styles.outer}>
        <View style={styles.inner}>
          <ThemedText variant="caption" color={colors.accentDeep} style={styles.word} maxFontSizeMultiplier={1.2}>
            {copy.attendance.marking.stampWord}
          </ThemedText>
          <ThemedText variant="tab" color={colors.accentDeep} style={styles.detail} maxFontSizeMultiplier={1.2}>
            {detail}
          </ThemedText>
        </View>
      </View>
    </Animated.View>
  );
}

const INK = colors.accent;

const styles = StyleSheet.create({
  wrap: { marginHorizontal: spacing.sm },
  bleed: {
    position: "absolute",
    top: -6,
    bottom: -6,
    left: -6,
    right: -6,
    borderRadius: radius.md,
    backgroundColor: INK,
  },
  outer: {
    borderWidth: 2,
    borderColor: INK,
    borderRadius: radius.sm - 4,
    padding: 2,
  },
  inner: {
    borderWidth: 1,
    borderColor: INK,
    borderRadius: radius.sm - 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    alignItems: "center",
  },
  word: { fontFamily: fontFamily.bold, letterSpacing: 2, lineHeight: 15 },
  detail: { fontFamily: fontFamily.semibold, fontSize: 9, letterSpacing: 0.6, lineHeight: 11 },
});
