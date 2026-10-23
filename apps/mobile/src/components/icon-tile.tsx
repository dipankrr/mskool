import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors } from "../theme/brand-admin";
import { radius } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import type { AppIconName } from "./app-icon";

/**
 * The tinted icon square used by every row and card in the app: 40 in an
 * `EntityCard`, 32 beside a row's text, 28 in a dense detail line.
 *
 * Accent means "this is a destination or the live choice"; neutral means
 * "this is information". The tile is decorative — the row's own label carries
 * the meaning — so it is hidden from screen readers.
 */
export function IconTile({
  name,
  size = 32,
  tone = "neutral",
  style,
  testID,
}: {
  name: AppIconName;
  size?: 28 | 32 | 40;
  tone?: "neutral" | "accent";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size >= 40 ? radius.md : radius.sm,
          backgroundColor:
            tone === "accent" ? colors.accentTint : colors.field,
        },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <AppIcon
        name={name}
        size={size >= 40 ? 20 : size >= 32 ? 18 : 16}
        color={tone === "accent" ? colors.accentDeep : colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
});
