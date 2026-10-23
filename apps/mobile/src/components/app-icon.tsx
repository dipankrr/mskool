import { Platform } from "react-native";
import type { ColorValue, StyleProp, TextStyle, ViewStyle } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "expo-symbols";

import { colors } from "../theme/brand-admin";

/**
 * The app's icon set — one semantic name per concept, mapped to the platform
 * package verified against the pinned SDK: SF Symbols on iOS
 * (`expo-symbols`), Material icons on Android (`@expo/vector-icons`). One
 * platform never wears the other's uniform; screens import `AppIcon` and
 * semantic names, never an icon library directly.
 *
 * Both name sets are compile-checked against the installed packages
 * (`satisfies`), so a typo or a badly named add-on is a type error, not a
 * blank square at runtime. Icons are decorative here: the control around
 * them carries the accessibility label.
 */
const iconMap = {
  home: { ios: "house.fill", android: "home" },
  attendance: { ios: "checklist", android: "checklist" },
  more: { ios: "ellipsis", android: "more-horiz" },
  school: { ios: "graduationcap.fill", android: "school" },
  students: { ios: "person.2.fill", android: "people" },
  person: { ios: "person.fill", android: "person" },
  chevronRight: { ios: "chevron.right", android: "chevron-right" },
  chevronLeft: { ios: "chevron.left", android: "chevron-left" },
  chevronDown: { ios: "chevron.down", android: "expand-more" },
  calendar: { ios: "calendar", android: "today" },
  calendarOff: { ios: "calendar.badge.exclamationmark", android: "event-busy" },
  check: { ios: "checkmark", android: "check" },
  checkCircle: { ios: "checkmark.circle.fill", android: "check-circle" },
  close: { ios: "xmark", android: "close" },
  closeCircle: { ios: "xmark.circle.fill", android: "cancel" },
  clock: { ios: "clock.fill", android: "schedule" },
  halfDay: { ios: "circle.lefthalf.filled", android: "contrast" },
  history: { ios: "clock.arrow.circlepath", android: "history" },
  info: { ios: "info.circle", android: "info-outline" },
  sort: { ios: "arrow.up.arrow.down", android: "sort" },
  settings: { ios: "gearshape", android: "settings" },
  edit: { ios: "pencil", android: "edit" },
  search: { ios: "magnifyingglass", android: "search" },
} as const satisfies Record<
  string,
  { ios: SFSymbol; android: keyof typeof MaterialIcons.glyphMap }
>;

export type AppIconName = keyof typeof iconMap;

export function AppIcon({
  name,
  size = 20,
  color = colors.ink,
  style,
}: {
  name: AppIconName;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<TextStyle>;
}) {
  const icon = iconMap[name];
  // RN 0.86's TextStyle and ViewStyle are mutually non-assignable (the
  // `cursor` prop differs), so the cross-platform wrapper owns one cast per
  // branch instead of leaking two style types into every call site.
  if (Platform.OS === "ios") {
    return (
      <SymbolView
        name={icon.ios}
        size={size}
        tintColor={color}
        style={style as StyleProp<ViewStyle>}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }
  return (
    <MaterialIcons
      name={icon.android}
      size={size}
      color={color}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
