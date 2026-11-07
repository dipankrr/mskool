import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { usePress } from "../motion";
import { useFamilyTheme } from "../theme";
import { FText } from "./f-text";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type FButtonVariant = "primary" | "secondary" | "quiet";
export type FButtonSize = "lg" | "md" | "sm";

/**
 * Family button. Look from `components.button`; to restyle every button,
 * change that block or this file only.
 */
export function FButton({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  icon,
  loading = false,
  disabled = false,
  block = false,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: FButtonVariant;
  size?: FButtonSize;
  icon?: AppIconName;
  loading?: boolean;
  disabled?: boolean;
  /** Full width. */
  block?: boolean;
  testID?: string;
  /** Layout only. */
  style?: StyleProp<ViewStyle>;
}) {
  const { components } = useFamilyTheme();
  const b = components.button;
  const look = b.variant[variant];
  const press = usePress(b.pressedScale);
  const blocked = disabled || loading;

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        styles.base,
        {
          minHeight: b.height[size],
          paddingHorizontal: b.paddingX[size],
          borderRadius: b.radius,
          backgroundColor: look.bg,
          gap: b.gap,
          opacity: blocked && !loading ? b.disabledOpacity : 1,
        },
        block ? styles.block : null,
        press.style,
        style,
      ]}
    >
      {/* The label stays (invisible) while loading, so the button keeps its width. */}
      <View style={[styles.content, { gap: b.gap }, loading ? styles.hidden : null]}>
        {icon ? <AppIcon name={icon} size={b.iconSize} color={look.fg} /> : null}
        <FText variant="label" numberOfLines={1} tint={look.fg}>
          {label}
        </FText>
      </View>
      {loading ? <ActivityIndicator color={look.fg} style={StyleSheet.absoluteFill} /> : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  block: {
    alignSelf: "stretch",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
  },
  hidden: {
    opacity: 0,
  },
});
