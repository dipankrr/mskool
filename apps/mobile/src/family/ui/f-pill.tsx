import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { useFamilyTheme } from "../theme";
import type { Tone } from "../theme";
import { FText } from "./f-text";

/** A small status label (Present, Overdue, Results out). Look from `components.pill`. */
export function FPill({
  label,
  tone = "neutral",
  icon,
  testID,
  style,
}: {
  label: string;
  tone?: Tone;
  icon?: AppIconName;
  testID?: string;
  /** Layout only. */
  style?: StyleProp<ViewStyle>;
}) {
  const { components } = useFamilyTheme();
  const p = components.pill;
  const colors = p.tone[tone];
  return (
    <View
      testID={testID}
      style={[
        styles.base,
        {
          minHeight: p.height,
          paddingHorizontal: p.paddingX,
          borderRadius: p.radius,
          backgroundColor: colors.bg,
          gap: p.gap,
        },
        style,
      ]}
    >
      {icon ? <AppIcon name={icon} size={14} color={colors.fg} /> : null}
      <FText variant="caption" tint={colors.fg} numberOfLines={1}>
        {label}
      </FText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
});
