import { useEffect, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import { colors } from "../theme/brand-admin";
import { radius } from "../theme/tokens";

/**
 * A slider built from plain RN views and a PanResponder — no native module,
 * so no dev-client rebuild rides on it (ADR-048's spirit for the app's own
 * controls). Range 0..max in whole steps: the only use so far is a percentage
 * weight, where a fraction of a percent is not a decision anyone makes.
 *
 * The gesture claims the touch on start, so a tap on the track jumps and a
 * drag follows the finger immediately; the control is short enough that
 * costing the parent scroll a 44 dp strip is the normal slider trade. Every
 * value change is quantised before it reaches `onChange`, and the caller's
 * value wins on re-render — this component owns the geometry, not the state.
 * The responder is rebuilt from the current props on each render (the same
 * trade the homework week-rail makes), so its closures never go stale.
 */
export function Slider({
  value,
  max,
  onChange,
  disabled = false,
  a11yStep = 5,
  accessibilityLabel,
  testID,
}: {
  /** Current value, 0..max; the caller owns it. */
  value: number;
  /** Inclusive upper bound — may be 0, which pins the thumb and disables input. */
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  /** How far one accessibility increment/decrement moves (TalkBack et al). */
  a11yStep?: number;
  accessibilityLabel: string;
  testID?: string;
}) {
  const [width, setWidth] = useState(0);

  const valueAt = (locationX: number): number => {
    if (width <= 0 || max <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, locationX / width));
    return Math.min(max, Math.round(ratio * max));
  };

  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: (event) => {
      const next = valueAt(event.nativeEvent.locationX);
      if (next !== value) onChange(next);
    },
    onPanResponderMove: (event) => {
      const next = valueAt(event.nativeEvent.locationX);
      if (next !== value) onChange(next);
    },
  });

  const step = (delta: number) => {
    if (disabled || max <= 0) return;
    const next = Math.min(max, Math.max(0, value + delta));
    if (next !== value) onChange(next);
  };

  // Keep the visible value honest if the caller clamps it from outside
  // (e.g. the max shrank under it).
  useEffect(() => {
    if (value > max) onChange(max);
  }, [value, max, onChange]);

  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const pinned = disabled || max <= 0;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max, now: value, text: `${value}%` }}
      accessibilityActions={[
        { name: "increment", label: "Increase" },
        { name: "decrement", label: "Decrease" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") step(a11yStep);
        if (event.nativeEvent.actionName === "decrement") step(-a11yStep);
      }}
      accessibilityState={{ disabled: pinned }}
      testID={testID}
    >
      <View
        {...pan.panHandlers}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={[styles.track, pinned ? styles.trackOff : null]}
      >
        <View style={styles.rail}>
          <View style={[styles.fill, { flex: ratio }]} />
          <View style={[styles.rest, { flex: 1 - ratio }]} />
        </View>
        <View
          style={[styles.thumb, { left: `${ratio * 100}%` }, pinned ? styles.thumbOff : null]}
          testID={testID ? `${testID}-thumb` : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 44,
    justifyContent: "center",
  },
  trackOff: {
    opacity: 0.5,
  },
  rail: {
    flexDirection: "row",
    height: 8,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: colors.field,
  },
  fill: {
    backgroundColor: colors.accent,
  },
  rest: {
    backgroundColor: "transparent",
  },
  thumb: {
    position: "absolute",
    top: "50%",
    // The thumb's centre rides the fill's edge: translate up half its height
    // and back half its width, so `left: ratio%` is the centre point.
    marginLeft: -14,
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  thumbOff: {
    borderColor: colors.chevron,
  },
});
