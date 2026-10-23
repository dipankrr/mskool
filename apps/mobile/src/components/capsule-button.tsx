import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";

import { colors } from "../theme/brand-admin";
import {
  fontSize,
  fontWeight,
  motion,
  radius,
  shadow,
  spacing,
} from "../theme/tokens";
import { AppIcon } from "./app-icon";
import type { AppIconName } from "./app-icon";
import { ThemedText } from "./themed-text";

/**
 * The capsule button (probe anatomy). Variants:
 * `primary` emerald CTA · `secondary` white pill with hairline ·
 * `destructive` red-tinted pill (colour = information — this app never wears
 * a solid red button) · `onAccent` white pill for use on an accent fill (the
 * saved bar's Edit).
 *
 * Sizes: `cta` (54, floating shadow — the one action per screen) ·
 * `compact` (38, bulk/inline actions) · `mini` (34, in-bar pills). Heights are
 * minimums: big Dynamic Type grows the capsule instead of clipping the label.
 * Press feedback is an instant scale + a light haptic — no animation that
 * delays the state change, so Reduce Motion needs no special case.
 */
export function CapsuleButton({
  title,
  onPress,
  icon,
  variant = "primary",
  size = "cta",
  loading = false,
  disabled = false,
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  /** Optional leading glyph; the label remains the control's name. */
  icon?: AppIconName;
  variant?: "primary" | "secondary" | "destructive" | "onAccent";
  size?: "cta" | "compact" | "mini";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const blocked = disabled || loading;
  const fg = variantText[variant];
  const hitSlop = size === "cta" ? undefined : { top: 5, bottom: 5 };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      hitSlop={hitSlop}
      onPressIn={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        { backgroundColor: variantBackground[variant] },
        variant === "secondary" ? styles.secondaryBorder : null,
        size === "cta" ? styles.floating : null,
        pressed ? styles.pressed : null,
        blocked ? styles.blocked : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <AppIcon name={icon} size={18} color={fg} /> : null}
          <ThemedText
            variant="bodyStrong"
            color={fg}
            numberOfLines={1}
            style={size === "cta" ? styles.ctaLabel : styles.smallLabel}
          >
            {title}
          </ThemedText>
        </>
      )}
    </Pressable>
  );
}

const variantText = {
  primary: colors.onAccent,
  secondary: colors.ink,
  destructive: colors.tone.critical.fg,
  onAccent: colors.accentDeep,
} as const;

const variantBackground = {
  primary: colors.accent,
  secondary: colors.surface,
  destructive: colors.tone.critical.bg,
  onAccent: colors.surface,
} as const;

const sizeStyles = StyleSheet.create({
  cta: {
    minHeight: 54,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
  },
  compact: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  mini: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
  },
});

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
  },
  secondaryBorder: {
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  floating: {
    boxShadow: shadow.floating,
  },
  pressed: {
    transform: [{ scale: motion.pressScale }],
  },
  blocked: {
    opacity: 0.5,
  },
  ctaLabel: {
    fontSize: fontSize.callout,
    fontWeight: fontWeight.semibold,
  },
  smallLabel: {
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
  },
});
