import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { useFamilyTheme } from "../theme";

/**
 * The family side's shared motion. Every animated thing in a family screen
 * comes from here, so the feel is tuned in one place (`theme.motion`). All of
 * it follows the phone's Reduce Motion setting: animations become instant.
 */

/** Press feedback: a quick scale and a light haptic, never delaying the action. */
export function usePress(scaleTo?: number) {
  const { motion } = useFamilyTheme();
  const scale = useSharedValue(1);
  const target = scaleTo ?? motion.pressScale;
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    onPressIn: () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      scale.set(withTiming(target, { duration: motion.quick, reduceMotion: ReduceMotion.System }));
    },
    onPressOut: () => {
      scale.set(withTiming(1, { duration: motion.base, reduceMotion: ReduceMotion.System }));
    },
  };
}

/**
 * Fades (and optionally rises) in once, on mount, with a plain animated
 * style. Deliberately NOT a Reanimated layout animation (`entering` /
 * `exiting`): those crashed Android Fabric with "child already has a
 * parent" when many mounted and unmounted at once (sign-out clears every
 * query while the screen is replaced).
 */
function useAppear(delay: number, rise: number) {
  const { motion } = useFamilyTheme();
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    progress.set(withDelay(delay, withTiming(1, { duration: motion.base, easing: Easing.out(Easing.cubic) })));
  }, [reduced, delay, motion.base, progress]);
  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * rise }],
  }));
}

/**
 * An item that fades and rises in on first mount. Pass `index` in a list for
 * a short stagger; items past `motion.staggerMax` arrive with the last one.
 */
export function Enter({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { motion } = useFamilyTheme();
  const appear = useAppear(Math.min(index, motion.staggerMax) * motion.stagger, motion.rise);
  return <Animated.View style={[style, appear]}>{children}</Animated.View>;
}

function FadeInView({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const appear = useAppear(0, 0);
  return <Animated.View style={[style, appear]}>{children}</Animated.View>;
}

/**
 * Loading to content without a jump: the content fades in where the
 * placeholder was. The placeholder should have the content’s shape.
 */
export function Reveal({
  loading,
  placeholder,
  children,
  style,
}: {
  loading: boolean;
  placeholder: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return loading ? (
    <View key="placeholder" style={style}>
      {placeholder}
    </View>
  ) : (
    <FadeInView key="content" style={style}>
      {children}
    </FadeInView>
  );
}

/**
 * A number that counts up to `target` once, the first time it is shown, and
 * jumps straight to later values. `replayKey` restarts the count (the kit's
 * replay button; a child switch).
 */
export function useCountUp(target: number, { enabled = true, replayKey }: { enabled?: boolean; replayKey?: unknown } = {}) {
  const { motion } = useFamilyTheme();
  const reduced = useReducedMotion();
  const [value, setValue] = useState(enabled && !reduced ? 0 : target);
  const lastKey = useRef<unknown>(Symbol("first"));
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const restart = lastKey.current !== replayKey;
    lastKey.current = replayKey;
    if (!enabled || reduced || !restart) {
      setValue(target);
      return;
    }
    const start = Date.now();
    const ease = Easing.out(Easing.cubic);
    const tick = () => {
      const progress = Math.min(1, (Date.now() - start) / motion.countUp);
      setValue(target * ease(progress));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    setValue(0);
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, enabled, reduced, replayKey, motion.countUp]);

  return value;
}
