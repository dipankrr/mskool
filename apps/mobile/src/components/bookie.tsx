import { useEffect } from "react";
import { StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, G, Path } from "react-native-svg";

import { bookie } from "../theme/brand-bookie";

/**
 * Bookie, the mskool mascot: a blue book shaped like an "m". The shapes are a
 * flat version of `brand/bookie/mascot.svg` (no blurs or shading), drawn as a
 * sticker with a white outline so Bookie reads on any background. Redraw the
 * brand file first, then copy the paths here.
 *
 * Motion is a slow sway and a blink every few seconds. Both stop under Reduce
 * Motion and when `animate` is false. Bookie is decorative by default: pass
 * `label` only where the mascot itself carries meaning.
 */

export type BookieMood = "calm" | "happy";
export type BookieLook = "ahead" | "left" | "right" | "up";
export type BookieColors = { body: string; depth: string; ink: string; white: string };

const VIEW_BOX = "160 300 704 560";
const ASPECT = 560 / 704;

const BODY =
  "M512 744 C560 800 690 818 806 818 C822 818 828 808 828 792 V500 C828 400 754 330 664 330 C584 330 529 390 516 450 Q512 468 508 450 C495 390 440 330 360 330 C270 330 196 400 196 500 V792 C196 808 202 818 218 818 C334 818 464 800 512 744 Z";
const DEPTH =
  "M512 774 C560 830 690 848 806 848 C822 848 828 838 828 822 V530 C828 430 754 360 664 360 C584 360 529 420 516 480 Q512 498 508 480 C495 420 440 360 360 360 C270 360 196 430 196 530 V822 C196 838 202 848 218 848 C334 848 464 830 512 774 Z";
const SMILE = "M460 690 Q512 740 564 690";

const EYE_LEFT = 341;
const EYE_RIGHT = 683;
const EYE_Y = 574;
/** Eye line as a share of the drawing's height: the blink squeezes toward it. */
const EYE_ORIGIN = `50% ${(((EYE_Y - 300) / 560) * 100).toFixed(1)}%`;

/** Where the pupils sit inside the eye whites, in drawing units. */
const GAZE: Record<BookieLook, { dx: number; dy: number }> = {
  ahead: { dx: 12, dy: -6 },
  left: { dx: -18, dy: -6 },
  right: { dx: 22, dy: -6 },
  up: { dx: 12, dy: -22 },
};

const SWAY_DEGREES = 4;
const SWAY_MS = 2000;
const BLINK_EVERY_MS = 4300;
const BLINK_MS = 90;

export function Bookie({
  size = 96,
  mood = "calm",
  look = "ahead",
  animate = true,
  outline = true,
  label,
  colors = bookie,
  style,
  testID,
}: {
  /** Width in points; the height follows Bookie's shape. */
  size?: number;
  mood?: BookieMood;
  look?: BookieLook;
  /** Sway and blink. Off for lists and anywhere motion would distract. */
  animate?: boolean;
  /** The white sticker outline. Turn off only on a white background. */
  outline?: boolean;
  /** Screen-reader label. Leave unset when Bookie is decoration. */
  label?: string;
  /** Override the brand colours (the family theme passes its own block). */
  colors?: BookieColors;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const reducedMotion = useReducedMotion();
  const moving = animate && !reducedMotion;
  const sway = useSharedValue(0);
  const blink = useSharedValue(1);

  useEffect(() => {
    if (!moving) {
      sway.value = 0;
      blink.value = 1;
      return;
    }
    sway.value = withRepeat(
      withSequence(
        withTiming(SWAY_DEGREES, { duration: SWAY_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(-SWAY_DEGREES, { duration: SWAY_MS, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    blink.value = withRepeat(
      withSequence(
        withDelay(BLINK_EVERY_MS, withTiming(0.1, { duration: BLINK_MS })),
        withTiming(1, { duration: BLINK_MS }),
      ),
      -1,
    );
    return () => {
      cancelAnimation(sway);
      cancelAnimation(blink);
    };
  }, [moving, sway, blink]);

  const swayStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sway.value}deg` }],
  }));
  const blinkStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: blink.value }],
  }));

  const height = Math.round(size * ASPECT);
  const gaze = GAZE[mood === "happy" ? "up" : look];
  const box = { width: size, height };

  return (
    <Animated.View
      testID={testID}
      style={[box, styles.swayOrigin, swayStyle, style]}
      accessible={label !== undefined}
      accessibilityRole={label !== undefined ? "image" : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? "no-hide-descendants" : "yes"}
    >
      <Svg width={size} height={height} viewBox={VIEW_BOX}>
        {outline ? (
          <Path
            d={BODY}
            fill={colors.white}
            stroke={colors.white}
            strokeWidth={44}
            strokeLinejoin="round"
          />
        ) : null}
        <Path d={DEPTH} fill={colors.depth} />
        <Path d={BODY} fill={colors.body} />
        <Path d="M512 476 V728" stroke={colors.depth} strokeWidth={12} strokeLinecap="round" />
        {mood === "happy" ? (
          <Path d={SMILE} fill="none" stroke={colors.ink} strokeWidth={16} strokeLinecap="round" />
        ) : null}
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: EYE_ORIGIN }, blinkStyle]}>
        <Svg width={size} height={height} viewBox={VIEW_BOX}>
          {[EYE_LEFT, EYE_RIGHT].map((x) => (
            <G key={x}>
              <Circle cx={x} cy={EYE_Y} r={80} fill={colors.white} />
              <Circle cx={x + gaze.dx} cy={EYE_Y + gaze.dy} r={46} fill={colors.ink} />
              <Circle cx={x + gaze.dx + 18} cy={EYE_Y + gaze.dy - 20} r={16} fill={colors.white} />
            </G>
          ))}
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Sway pivots near Bookie's base, so it rocks rather than spins.
  swayOrigin: {
    transformOrigin: "50% 90%",
  },
});
