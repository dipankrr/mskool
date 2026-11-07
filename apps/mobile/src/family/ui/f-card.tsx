import { useState } from "react";
import { Pressable, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import type { ReactNode } from "react";

import { usePress } from "../motion";
import { useFamilyTheme } from "../theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A soft rounded block. Look from `components.card`. Pass `onPress` to make
 * the whole card a button; then `label` names it for screen readers.
 */
export function FCard({
  children,
  onPress,
  label,
  highlighted = false,
  testID,
  style,
}: {
  children: ReactNode;
  /** Draws the theme’s attention border. */
  highlighted?: boolean;
  onPress?: () => void;
  label?: string;
  testID?: string;
  /** Layout only. */
  style?: StyleProp<ViewStyle>;
}) {
  const { components } = useFamilyTheme();
  const c = components.card;
  const press = usePress();
  const [pressed, setPressed] = useState(false);
  const base = {
    borderRadius: c.radius,
    backgroundColor: c.bg,
    padding: c.padding,
    gap: c.gap,
    borderWidth: highlighted ? c.highlightBorder.width : c.border.width,
    borderColor: highlighted ? c.highlightBorder.color : c.border.color,
  };

  if (!onPress) {
    return (
      <View testID={testID} style={[base, style]}>
        {children}
      </View>
    );
  }
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
        press.onPressIn();
      }}
      onPressOut={() => {
        setPressed(false);
        press.onPressOut();
      }}
      style={[base, pressed ? { backgroundColor: c.pressedBg } : null, press.style, style]}
    >
      {children}
    </AnimatedPressable>
  );
}
