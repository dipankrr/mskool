import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useFamilyTheme } from "../theme";
import { FText } from "./f-text";

export type FStampTone = "coral" | "green" | "blue";

/**
 * The result stamp, the same one Results uses: a punched edge around a solid
 * face, tilted a little. `kicker` is the small line on top ("Maths / checked"),
 * `value` the big result, the two foot words run along the bottom.
 */
export function FStamp({
  kicker,
  value,
  unit,
  sub,
  footLeft,
  footRight,
  tone = "coral",
  width = 210,
  testID,
  style,
}: {
  kicker: string;
  value: string;
  /** Smaller text right after the value ("/10"). */
  unit?: string;
  sub?: string;
  footLeft?: string;
  footRight?: string;
  tone?: FStampTone;
  width?: number;
  testID?: string;
  /** Layout only. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useFamilyTheme();
  const s = theme.components.stamp;
  const colors = s.tone[tone];
  const [height, setHeight] = useState(0);
  const dots = height > 0 ? edgeDots(width, height, s.dotGap, s.dot + 2) : [];
  const ink = s.face;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={[kicker, value + (unit ?? ""), sub].filter(Boolean).join(", ")}
      onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}
      style={[{ width, padding: s.padding, backgroundColor: colors.edge, transform: [{ rotate: s.tilt }] }, style]}
    >
      {height > 0 ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {dots.map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={s.dot} fill={s.face} />
          ))}
        </Svg>
      ) : null}
      <View style={{ backgroundColor: colors.face, padding: theme.space.lg, gap: theme.space.xs }}>
        <FText variant="caption" tint={ink}>
          {kicker.toUpperCase()}
        </FText>
        <View style={[styles.valueRow, { marginTop: theme.space.sm }]}>
          <FText variant="numberHero" tint={ink} numberOfLines={1} adjustsFontSizeToFit style={styles.shrink}>
            {value}
          </FText>
          {unit ? (
            <FText variant="number" tint={ink}>
              {unit}
            </FText>
          ) : null}
        </View>
        {sub ? (
          <FText variant="bodyStrong" tint={ink}>
            {sub}
          </FText>
        ) : null}
        {footLeft || footRight ? (
          <View style={[styles.foot, { marginTop: theme.space.md }]}>
            <FText variant="caption" tint={ink}>
              {(footLeft ?? "").toUpperCase()}
            </FText>
            <FText variant="caption" tint={ink}>
              {(footRight ?? "").toUpperCase()}
            </FText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Dot centres along a rectangle's edge, `inset` in from it, about `gap` apart. */
export function edgeDots(w: number, h: number, gap: number, inset: number): [number, number][] {
  const out: [number, number][] = [];
  const across = Math.max(2, Math.round((w - inset * 2) / gap));
  const down = Math.max(2, Math.round((h - inset * 2) / gap));
  for (let i = 0; i <= across; i++) {
    const x = inset + ((w - inset * 2) * i) / across;
    out.push([x, inset], [x, h - inset]);
  }
  for (let j = 1; j < down; j++) {
    const y = inset + ((h - inset * 2) * j) / down;
    out.push([inset, y], [w - inset, y]);
  }
  return out;
}

const styles = StyleSheet.create({
  valueRow: { flexDirection: "row", alignItems: "baseline" },
  shrink: { flexShrink: 1 },
  foot: { flexDirection: "row", justifyContent: "space-between" },
});
