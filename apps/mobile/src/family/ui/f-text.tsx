import { Text } from "react-native";
import type { StyleProp, TextProps, TextStyle } from "react-native";

import { useFamilyTheme } from "../theme";
import type { Tone, TypeVariant } from "../theme";

export type TextColor = "ink" | "inkSoft" | "muted" | "faint" | "onAccent" | "highlight" | Tone;

const NUMERIC: TypeVariant[] = ["number", "numberHero"];

/**
 * The one way family text renders. Screens pick a `variant` and a `color`
 * role; size, weight, font file, line height and tracking all come from the
 * theme for the current language's script.
 */
export function FText({
  variant = "body",
  color = "ink",
  align,
  tint,
  style,
  children,
  ...rest
}: Omit<TextProps, "style"> & {
  variant?: TypeVariant;
  color?: TextColor;
  align?: "auto" | "left" | "center" | "right";
  /** For kit components only: a colour taken from their own theme block. */
  tint?: string;
  /** Layout only (margins, flex). Never colours or sizes. */
  style?: StyleProp<TextStyle>;
}) {
  const theme = useFamilyTheme();
  const fg =
    tint ??
    (color in theme.tone
      ? theme.tone[color as Tone].fg
      : theme.color[color as Exclude<TextColor, Tone>]);
  return (
    <Text
      {...rest}
      style={[
        theme.text(variant),
        { color: fg, textAlign: align },
        NUMERIC.includes(variant) ? { fontVariant: ["tabular-nums"] } : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}
