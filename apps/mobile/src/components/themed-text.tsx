import { StyleSheet, Text } from "react-native";
import type { TextProps } from "react-native";

import { colors } from "../theme/brand-admin";
import { fontFamily, fontSize, tracking } from "../theme/tokens";

/**
 * The one way text renders in the app. Each variant is one line of the
 * approved probe's type anatomy (native.html v3) — screens pick a variant
 * and, rarely, a colour override; they never set sizes or weights themselves.
 *
 * Variants and where they come from (probe values in tokens.ts):
 * `hero` the one headline number of a block (year card; the fees hero
 * later) · `title` screen h1 · `subtitle` its sub line · `sectionLabel`
 * uppercase grouping · `name` row titles · `body` default prose ·
 * `bodyStrong` inline emphasis · `meta` secondary lines · `caption`
 * pills/small labels · `chip` small rounded chips (branch) · `numeric`
 * tabular numbers (stat tiles) · `tab` tab-bar labels.
 *
 * (The prop is `variant`, not `role`: RN's TextProps already owns `role` for
 * accessibility and the two unions would collide.)
 */
const variantStyles = StyleSheet.create({
  hero: {
    fontSize: fontSize.hero,
    fontFamily: fontFamily.bold,
    letterSpacing: tracking.tight,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
  },
  title: {
    fontSize: fontSize.large,
    fontFamily: fontFamily.bold,
    letterSpacing: tracking.tight,
    color: colors.ink,
  },
  subtitle: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.medium,
    color: colors.muted,
  },
  sectionLabel: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.semibold,
    letterSpacing: tracking.label,
    textTransform: "uppercase",
    color: colors.muted,
  },
  name: {
    fontSize: fontSize.callout,
    fontFamily: fontFamily.semibold,
    letterSpacing: tracking.snug,
    color: colors.ink,
  },
  body: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },
  bodyStrong: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  meta: {
    fontSize: fontSize.fine,
    fontFamily: fontFamily.regular,
    color: colors.muted,
  },
  caption: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  chip: {
    fontSize: fontSize.fine,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  numeric: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bold,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
  },
  tab: {
    fontSize: fontSize.micro,
    fontFamily: fontFamily.medium,
    color: colors.muted,
  },
});

export type TextVariant = keyof typeof variantStyles;

type ThemedTextProps = TextProps & {
  variant?: TextVariant;
  /** One-off colour override; prefer the variant's own colour. */
  color?: string;
};

export function ThemedText({
  variant = "body",
  color,
  style,
  ...rest
}: ThemedTextProps) {
  return (
    <Text
      {...rest}
      style={[variantStyles[variant], color ? { color } : null, style]}
    />
  );
}
