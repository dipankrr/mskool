import { StyleSheet, View } from "react-native";
import type { ViewProps } from "react-native";

import { colors } from "../theme/brand-admin";
import { radius, shadow, spacing } from "../theme/tokens";

/**
 * The white surface everything sits on (probe anatomy: tinted canvas, white
 * cards, 16 radius, 16 padding). `padless` is for cards whose children own
 * their padding (grouped lists); `floating` is the one elevation reserved for
 * cards that hover above content — never both decorations at once.
 */
type CardProps = ViewProps & {
  padless?: boolean;
  floating?: boolean;
};

export function Card({ padless, floating, style, children, ...rest }: CardProps) {
  return (
    <View
      {...rest}
      style={[
        styles.card,
        padless ? styles.padless : null,
        floating ? styles.floating : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  padless: {
    padding: 0,
    overflow: "hidden",
  },
  floating: {
    boxShadow: shadow.floating,
  },
});
