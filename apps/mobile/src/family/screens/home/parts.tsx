import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { AppIcon } from "../../../components/app-icon";
import { subjectSlot } from "../../lib/homework";
import { usePress } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FText } from "../../ui";

/** A Home section's heading, with a small count or date on the end. */
export function SectionHead({ title, aside }: { title: string; aside?: string | null }) {
  const theme = useFamilyTheme();
  return (
    <View style={[styles.head, { gap: theme.space.md }]}>
      <FText variant="heading" accessibilityRole="header" style={styles.flex}>
        {title}
      </FText>
      {aside ? (
        <FText variant="meta" color="muted">
          {aside}
        </FText>
      ) : null}
    </View>
  );
}

/** The round tick: an ink ring that fills green. Its own button inside a row. */
export function TickCircle({
  checked,
  onPress,
  disabled = false,
  label,
  size,
  testID,
}: {
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
  label: string;
  size?: number;
  testID?: string;
}) {
  const theme = useFamilyTheme();
  const k = theme.components.home.tick;
  const side = size ?? k.size;
  const press = usePress(0.86);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={12}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onPress}
    >
      <Animated.View
        style={[
          styles.center,
          press.style,
          {
            width: side,
            height: side,
            borderRadius: side / 2,
            backgroundColor: checked ? k.on : "transparent",
            borderWidth: checked ? 0 : 2,
            borderColor: k.border,
            opacity: disabled && !checked ? 0.35 : 1,
          },
        ]}
      >
        {checked ? <AppIcon name="check" size={Math.round(side * 0.6)} color={k.fg} /> : null}
      </Animated.View>
    </Pressable>
  );
}

const BLINK_EVERY_MS = 5200;
const BLINK_MS = 90;

/**
 * A subject as a small flat character: two eyes on the subject's colour,
 * blinking now and then. `index` staggers the blinks along a strip.
 */
export function SubjectFace({ name, index = 0 }: { name: string; index?: number }) {
  const theme = useFamilyTheme();
  const f = theme.components.home.tomorrow.face;
  const subjects = theme.components.homework.subjects;
  const colors = subjects[subjectSlot(name, subjects.length)]!;
  const reduced = useReducedMotion();
  const open = useSharedValue(1);

  useEffect(() => {
    if (reduced) return;
    open.value = withDelay(
      index * 900,
      withRepeat(
        withSequence(
          withDelay(BLINK_EVERY_MS, withTiming(0.15, { duration: BLINK_MS })),
          withTiming(1, { duration: BLINK_MS }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(open);
  }, [reduced, index, open]);

  const eye = useAnimatedStyle(() => ({ transform: [{ scaleY: open.value }] }));
  const eyeLook = { width: f.eyeWidth, height: f.eyeHeight, borderRadius: f.eyeWidth, backgroundColor: f.eye };
  return (
    <View style={[styles.flex, { gap: theme.space.xs }]}>
      <View
        style={[styles.center, styles.eyes, { height: f.height, borderRadius: f.radius, backgroundColor: colors.bg, gap: f.eyeGap }]}
      >
        <Animated.View style={[eyeLook, eye]} />
        <Animated.View style={[eyeLook, eye]} />
      </View>
      <FText variant="caption" color="muted" align="center" numberOfLines={1}>
        {name}
      </FText>
    </View>
  );
}

/** A dashed box for "nothing here", quieter than the full empty state. */
export function QuietBox({ children }: { children: ReactNode }) {
  const theme = useFamilyTheme();
  const e = theme.components.home.empty;
  return (
    <View
      style={[
        styles.center,
        {
          borderWidth: 1.5,
          borderStyle: "dashed",
          borderColor: e.border,
          borderRadius: e.radius,
          padding: theme.space.lg,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline" },
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: "center", justifyContent: "center" },
  eyes: { flexDirection: "row" },
});
