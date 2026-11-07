import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { usePress } from "../motion";
import { useFamilyTheme } from "../theme";
import type { Tone, TypeVariant } from "../theme";
import { FText } from "./f-text";
import type { TextColor } from "./f-text";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The reference's grey row: a title, an optional second line, and a value or
 * any trailing element on the end. Look from `components.row`.
 */
export function FRow({
  title,
  subtitle,
  subtitleTone,
  value,
  valueVariant = "number",
  valueColor = "ink",
  leading,
  trailing,
  onPress,
  chevron,
  accessibilityLabel,
  testID,
  style,
}: {
  title: string;
  subtitle?: string | null;
  /** Colours the second line (an up/down change, an overdue note). */
  subtitleTone?: Tone;
  value?: string | null;
  valueVariant?: TypeVariant;
  valueColor?: TextColor;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Defaults to on when the row is pressable. */
  chevron?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  /** Layout only. */
  style?: StyleProp<ViewStyle>;
}) {
  const { components } = useFamilyTheme();
  const r = components.row;
  const press = usePress(0.985);
  const [pressed, setPressed] = useState(false);
  const showChevron = chevron ?? onPress !== undefined;
  const base = {
    borderRadius: r.radius,
    backgroundColor: r.bg,
    paddingHorizontal: r.paddingX,
    paddingVertical: r.paddingY,
    minHeight: r.minHeight,
    gap: r.gap,
    borderWidth: r.border.width,
    borderColor: r.border.color,
  };

  const content = (
    <>
      {leading}
      <View style={styles.text}>
        <FText variant="heading" numberOfLines={2}>
          {title}
        </FText>
        {subtitle ? (
          <FText variant="meta" color={subtitleTone ?? "muted"} numberOfLines={2}>
            {subtitle}
          </FText>
        ) : null}
      </View>
      {value != null ? (
        <FText variant={valueVariant} color={valueColor} numberOfLines={1}>
          {value}
        </FText>
      ) : null}
      {trailing}
      {showChevron ? <AppIcon name="chevronRight" size={18} color={r.chevronColor} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={accessibilityLabel}
        style={[styles.row, base, style]}
      >
        {content}
      </View>
    );
  }
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(", ")}
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
        press.onPressIn();
      }}
      onPressOut={() => {
        setPressed(false);
        press.onPressOut();
      }}
      style={[
        styles.row,
        base,
        pressed ? { backgroundColor: r.pressedBg } : null,
        press.style,
        style,
      ]}
    >
      {content}
    </AnimatedPressable>
  );
}

/** Rows stacked with the theme's gap. */
export function FRowStack({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { components } = useFamilyTheme();
  return <View style={[{ gap: components.row.stackGap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
});
