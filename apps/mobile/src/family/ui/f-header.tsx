import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { useFamilyTheme } from "../theme";
import { FText } from "./f-text";

/**
 * A screen's top: a small context line (the child, or the child switcher),
 * then the big title. `context` is usually `<FChildSwitcher />`.
 */
export function FHeader({
  title,
  context,
  onBack,
  backLabel,
  trailing,
  display = false,
}: {
  title: string;
  context?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  trailing?: ReactNode;
  /** The extra-large title (a detail screen's headline). */
  display?: boolean;
}) {
  const theme = useFamilyTheme();
  const h = theme.components.header;
  return (
    <View style={{ gap: h.gap, paddingTop: h.paddingTop }}>
      <View style={[styles.top, { gap: theme.space.sm, minHeight: theme.touch.min }]}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            hitSlop={12}
            onPress={onBack}
            style={styles.side}
          >
            <AppIcon name="chevronLeft" size={24} color={theme.color.ink} />
          </Pressable>
        ) : null}
        <View style={styles.context}>{context}</View>
        {trailing ? <View style={styles.side}>{trailing}</View> : null}
      </View>
      <FText variant={display ? "display" : "title"} accessibilityRole="header">
        {title}
      </FText>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
  },
  context: {
    flex: 1,
    minWidth: 0,
  },
  side: {
    minWidth: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
