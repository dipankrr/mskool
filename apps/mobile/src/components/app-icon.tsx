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
  /** The overflow menu in a header: three dots, stacked. */
  moreVertical: { ios: "ellipsis", android: "more-vert" },
  school: { ios: "graduationcap.fill", android: "school" },
  students: { ios: "person.2.fill", android: "people" },
  person: { ios: "person.fill", android: "person" },
  /** A branch (a school under the trust). */
  branches: { ios: "building.2.fill", android: "business" },
  /** An academic session/year. */
  sessions: { ios: "calendar.badge.clock", android: "date-range" },
  /** Management surfaces as a group. */
  manage: { ios: "slider.horizontal.3", android: "tune" },
  /** The signed-in identity card / profile destination. */
  profileCard: { ios: "person.text.rectangle.fill", android: "badge" },
  shield: { ios: "checkmark.shield.fill", android: "verified-user" },
  key: { ios: "key.fill", android: "vpn-key" },
  logout: { ios: "rectangle.portrait.and.arrow.right", android: "logout" },
  add: { ios: "plus", android: "add" },
  warning: { ios: "exclamationmark.triangle.fill", android: "warning" },
  stack: { ios: "square.stack.3d.up.fill", android: "layers" },
  lock: { ios: "lock.fill", android: "lock" },
  chevronRight: { ios: "chevron.right", android: "chevron-right" },
  chevronLeft: { ios: "chevron.left", android: "chevron-left" },
  chevronDown: { ios: "chevron.down", android: "expand-more" },
  chevronUp: { ios: "chevron.up", android: "expand-less" },
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
  /** Homework / assignments — the diary domain. */
  homework: { ios: "book.closed.fill", android: "menu-book" },
  classwork: { ios: "person.3.fill", android: "groups" },
  project: { ios: "hammer.fill", android: "construction" },
  worksheet: { ios: "doc.text.fill", android: "description" },
  reading: { ios: "book.fill", android: "auto-stories" },
  practice: { ios: "arrow.triangle.2.circlepath", android: "repeat" },
  quiz: { ios: "questionmark.bubble.fill", android: "quiz" },
  /** A link a student handed in. */
  link: { ios: "link", android: "link" },
  /** The grade / verified mark. */
  grade: { ios: "checkmark.seal.fill", android: "verified" },
  /** The question bank. */
  bank: { ios: "tray.full.fill", android: "inventory" },
  comments: { ios: "bubble.left.and.bubble.right.fill", android: "forum" },
  resubmit: { ios: "arrow.uturn.backward", android: "undo" },
  extend: { ios: "calendar.badge.plus", android: "event-available" },
  rubric: { ios: "list.bullet.clipboard.fill", android: "fact-check" },
  /** A subject's book — used by the pair picker. */
  subject: { ios: "text.book.closed.fill", android: "library-books" },
  filter: { ios: "line.3.horizontal.decrease", android: "filter-list" },
  /** Fees — the money domain. */
  fees: { ios: "indianrupeesign.circle.fill", android: "currency-rupee" },
  collect: { ios: "creditcard.fill", android: "payments" },
  receipt: { ios: "doc.text.fill", android: "receipt-long" },
  ledger: { ios: "list.bullet.rectangle.fill", android: "receipt" },
  refund: { ios: "arrow.uturn.backward.circle.fill", android: "replay" },
  warningCircle: { ios: "exclamationmark.circle.fill", android: "error" },
  share: { ios: "square.and.arrow.up", android: "share" },
  /** Exams — the assessment domain. */
  exams: { ios: "list.clipboard.fill", android: "assignment" },
  marks: { ios: "square.and.pencil", android: "edit-note" },
  absent: { ios: "person.fill.xmark", android: "person-off" },
  refresh: { ios: "arrow.clockwise", android: "refresh" },
  /** A section's room, seats and shift. */
  room: { ios: "door.left.hand.closed", android: "meeting-room" },
  seat: { ios: "chair.fill", android: "chair-alt" },
  shiftMorning: { ios: "sunrise.fill", android: "wb-twilight" },
  shiftDay: { ios: "sun.max.fill", android: "wb-sunny" },
  shiftEvening: { ios: "moon.fill", android: "nightlight" },
  /** A list's two densities: names only, or full cards. */
  viewCompact: { ios: "list.bullet", android: "view-headline" },
  viewCards: { ios: "rectangle.grid.1x2.fill", android: "view-agenda" },
  /** Remove a row from a local draft (a band, a paper part). */
  trash: { ios: "trash", android: "delete" },
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
        // SF Symbols has no vertical ellipsis: the horizontal one, turned.
        style={
          [
            name === "moreVertical" ? { transform: [{ rotate: "90deg" }] } : null,
            style,
          ] as StyleProp<ViewStyle>
        }
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
