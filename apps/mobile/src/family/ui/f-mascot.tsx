import type { StyleProp, ViewStyle } from "react-native";

import { Bookie } from "../../components/bookie";
import type { BookieLook, BookieMood } from "../../components/bookie";
import { useFamilyTheme } from "../theme";

/**
 * Bookie in the family theme's colours (`components.mascot`). Decorative:
 * pass `label` only where the mascot itself means something.
 */
export function FMascot({
  size = 96,
  mood = "calm",
  look = "ahead",
  animate = true,
  label,
  style,
}: {
  size?: number;
  mood?: BookieMood;
  look?: BookieLook;
  animate?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { components } = useFamilyTheme();
  return (
    <Bookie
      size={size}
      mood={mood}
      look={look}
      animate={animate}
      label={label}
      colors={components.mascot}
      style={style}
    />
  );
}
