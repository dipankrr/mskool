import { useEffect } from "react";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useFamilyTheme } from "../theme";

/**
 * A placeholder block with a slow pulse (still under Reduce Motion). Give it
 * the size of what will replace it so nothing jumps. Hidden from screen
 * readers: the screen announces loading.
 */
export function FSkeleton({
  width = "100%",
  height = 16,
  radius,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  /** A theme radius name; defaults to the skeleton block's. */
  radius?: "sm" | "md" | "lg" | "xl" | "full";
  /** Layout only. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useFamilyTheme();
  const k = theme.components.skeleton;
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: k.pulseMs, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduced, pulse, k.pulseMs]);

  const animated = useAnimatedStyle(() => ({ opacity: 1 - pulse.value * 0.45 }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          backgroundColor: k.bg,
          borderRadius: radius ? theme.radius[radius] : k.radius,
        },
        animated,
        style,
      ]}
    />
  );
}
