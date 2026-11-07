import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useFamilyTheme } from "../theme";

/**
 * The frame of every family screen: background (and the soft wash when the
 * theme has one), safe area, side gutter, pull to refresh, and room at the
 * bottom for the floating tab bar.
 */
export function FScreen({
  children,
  header,
  onRefresh,
  refreshing = false,
  bottomSpace = 0,
  scroll = true,
  testID,
  contentStyle,
}: {
  children: ReactNode;
  /** Sits above the scrolling content and scrolls with it. */
  header?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Extra bottom room, e.g. `useFamilyTabBarSpace()`. */
  bottomSpace?: number;
  scroll?: boolean;
  testID?: string;
  /** Layout only. */
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useFamilyTheme();
  const s = theme.components.screen;
  const insets = useSafeAreaInsets();
  const frame = [
    styles.fill,
    { backgroundColor: s.bg },
    s.wash ? { experimental_backgroundImage: s.wash } : null,
  ];
  const padding = {
    paddingTop: insets.top + theme.space.sm,
    paddingHorizontal: s.gutter,
    paddingBottom: insets.bottom + bottomSpace + theme.space.xxl,
    gap: s.sectionGap,
  };

  if (!scroll) {
    return (
      <View testID={testID} style={[frame, padding, contentStyle]}>
        {header}
        {children}
      </View>
    );
  }
  return (
    <View testID={testID} style={frame}>
      <ScrollView
        contentContainerStyle={[padding, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.color.ink}
              colors={[theme.color.ink]}
              progressViewOffset={insets.top}
            />
          ) : undefined
        }
      >
        {header}
        {children}
      </ScrollView>
      {/* Content scrolls under the clock; this band keeps the status bar readable. */}
      <View pointerEvents="none" style={[styles.statusBar, { height: insets.top, backgroundColor: s.statusBarBg }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  statusBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
});
