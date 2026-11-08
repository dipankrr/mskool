import { Text } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useFamilyTheme } from "../theme";
import type { Tone } from "../theme";

/**
 * Bookie's handwritten note: a few words, tilted, in one tone. Never for
 * anything longer than a short line (handwriting reads slowly); a teacher's
 * note uses `FNote` instead. Look from `components.hand`.
 */
export function FHand({
  children,
  tone = "highlight",
  size,
  align,
  style,
}: {
  children: string;
  tone?: Tone | "highlight";
  /** Points; defaults to the block's size. */
  size?: number;
  align?: "left" | "center" | "right";
  /** Layout only. */
  style?: StyleProp<TextStyle>;
}) {
  const theme = useFamilyTheme();
  const h = theme.components.hand;
  const fg = tone === "highlight" ? theme.color.highlight : theme.tone[tone].fg;
  const fontSize = size ?? h.size;
  return (
    <Text
      style={[
        {
          fontFamily: h.font,
          fontSize,
          lineHeight: Math.round(fontSize * (h.lineHeight / h.size)),
          color: fg,
          textAlign: align,
          transform: [{ rotate: h.tilt }],
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** The hand-drawn arrow that points from a note to what it is about. */
export function FArrow({
  tone = "highlight",
  width = 60,
  flip = false,
  rotate = "0deg",
  style,
}: {
  tone?: Tone | "highlight";
  width?: number;
  /** Points right instead of left. */
  flip?: boolean;
  rotate?: string;
  /** Layout only. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useFamilyTheme();
  const fg = tone === "highlight" ? theme.color.highlight : theme.tone[tone].fg;
  return (
    <Svg
      width={width}
      height={width * 0.625}
      viewBox="0 0 80 50"
      style={[{ transform: [{ scaleX: flip ? -1 : 1 }, { rotate }] }, style]}
    >
      <Path
        d="M74 4 C70 30 46 44 10 40 M10 40 L20 30 M10 40 L22 47"
        fill="none"
        stroke={fg}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
