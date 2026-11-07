import type { StyleProp, TextStyle } from "react-native";

import { useCountUp } from "../motion";
import { FText } from "./f-text";
import type { TextColor } from "./f-text";

/**
 * A big number that counts up once when first shown. The caller formats it
 * (`format.percent`, `format.money` from `useFormat()`), so the language
 * rules stay in one place. The screen reader hears the final value only.
 */
export function FNumber({
  value,
  format,
  size = "number",
  color = "ink",
  countUp = true,
  replayKey,
  testID,
  style,
}: {
  value: number;
  format: (value: number) => string;
  size?: "number" | "numberHero";
  color?: TextColor;
  countUp?: boolean;
  /** Change it to count again (a child switch). */
  replayKey?: unknown;
  testID?: string;
  /** Layout only. */
  style?: StyleProp<TextStyle>;
}) {
  const shown = useCountUp(value, { enabled: countUp, replayKey });
  return (
    <FText
      testID={testID}
      variant={size}
      color={color}
      numberOfLines={1}
      accessibilityLabel={format(value)}
      style={style}
    >
      {format(shown)}
    </FText>
  );
}
