import {
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { ReactNode } from "react";

import { colors } from "../theme/brand-admin";
import { gutter, radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import type { AppIconName } from "./app-icon";
import { useTabBarSpace } from "./tab-bar";
import { ThemedText } from "./themed-text";

export type HeaderAction = {
  /** Already-localised label; it is also the accessibility label. */
  label: string;
  onPress: () => void;
  /** A leading glyph — `add` for the list's create action. */
  icon?: AppIconName;
  /**
   * Renders the glyph without its printed label (the label stays as the
   * accessibility label). For a low-frequency utility action beside the
   * screen's one labelled action — the homework tab's settings gear.
   */
  iconOnly?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * The pushed-screen frame: one top row (back on the left, an optional screen
 * action on the right), the title, an optional session line, then a single
 * scroll body and an optional sticky footer.
 *
 * Attendance's manage screens use it with `padForTabBar` because their stack
 * floats the tab bar over pushed screens; Profile and the management routes
 * sit above the tabs and need no extra inset.
 *
 * Omit `backAccessibilityLabel` for a screen that must not be left from inside
 * (the forced password change) — the control disappears rather than rendering
 * a dead end.
 *
 * The back control is a 48 dp target that never sits at the screen edge
 * (negative margin pulls the glyph into the gutter's optical line). The action
 * is a compact tinted pill with the same 48 dp floor; its label is part of the
 * control so it never becomes an unlabelled glyph.
 *
 * `footer` is the form's one action: it rides above the keyboard, owns the
 * bottom safe area, and leaves the scroll body its own padding. `onRefresh`
 * turns a list body into a pull-to-refresh surface.
 */
export function ScreenFrame({
  title,
  meta,
  titleTestID,
  backAccessibilityLabel,
  backTestID = "screen-back",
  padForTabBar = false,
  action,
  secondaryAction,
  footer,
  footerVariant = "bar",
  onRefresh,
  refreshing = false,
  children,
}: {
  title: string;
  meta?: string | null;
  titleTestID?: string;
  /** Omit to hide the back control entirely. */
  backAccessibilityLabel?: string;
  backTestID?: string;
  padForTabBar?: boolean;
  action?: HeaderAction;
  /** A quieter utility action to the left of `action` (settings gear). */
  secondaryAction?: HeaderAction;
  /** Sticky bottom content; the body yields its bottom padding to it. */
  footer?: ReactNode;
  /**
   * The footer is one primary button, not a form's action bar: it sits on the
   * canvas with no white strip or rule, so the button reads as floating.
   */
  footerVariant?: "bar" | "floating";
  /** Passing this enables pull-to-refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
}) {
  const tabSpace = useTabBarSpace();
  const insets = useSafeAreaInsets();
  // Pushed screens that sit above the tabs (Profile) own their own bottom
  // inset: without it the last row of a long scroll ends flush with the
  // gesture bar. Under the tabs the bar's space already carries the inset.
  const bottom = padForTabBar ? tabSpace : insets.bottom + spacing.xl;
  const showTopRow = Boolean(
    backAccessibilityLabel || action || secondaryAction,
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        /**
         * Android is edge-to-edge on the pinned SDK, so `adjustResize` no
         * longer shrinks the window: the IME floats over the footer and over
         * any field low in the scroll. Padding the frame by the keyboard
         * height is what keeps the save bar and the focused field reachable
         * on both platforms.
         */
        behavior="padding"
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: footer ? spacing.xl : bottom },
          ]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
                colors={[colors.accent]}
              />
            ) : undefined
          }
        >
          {showTopRow ? (
            <View style={styles.topRow}>
              {backAccessibilityLabel ? (
                <Pressable
                  testID={backTestID}
                  accessibilityRole="button"
                  accessibilityLabel={backAccessibilityLabel}
                  hitSlop={8}
                  onPress={() => router.back()}
                  style={({ pressed }) => [
                    styles.back,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <AppIcon name="chevronLeft" size={22} color={colors.ink} />
                </Pressable>
              ) : (
                <View style={styles.topSpacer} />
              )}
              {action || secondaryAction ? (
                <View style={styles.actions}>
                  {secondaryAction ? (
                    <HeaderActionButton action={secondaryAction} />
                  ) : null}
                  {action ? <HeaderActionButton action={action} /> : null}
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.head}>
            <ThemedText variant="title" testID={titleTestID}>
              {title}
            </ThemedText>
            {meta ? (
              <ThemedText variant="meta" style={styles.meta}>
                {meta}
              </ThemedText>
            ) : null}
          </View>
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={[
              styles.footer,
              footerVariant === "floating" ? styles.footerFloating : null,
              { paddingBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * One header action. A labelled pill is the default; `iconOnly` keeps the same
 * tinted circle for a utility action whose glyph is unambiguous (a gear). The
 * label is always the accessibility label, so the glyph never stands alone for
 * a screen reader.
 */
export function HeaderActionButton({ action }: { action: HeaderAction }) {
  return (
    <Pressable
      testID={action.testID}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityHint={action.accessibilityHint}
      hitSlop={{ top: 5, bottom: 5 }}
      onPress={action.onPress}
      style={({ pressed }) => [
        styles.action,
        action.iconOnly ? styles.actionIconOnly : null,
        pressed ? styles.actionPressed : null,
      ]}
    >
      {action.icon ? (
        <AppIcon name={action.icon} size={16} color={colors.accentDeep} />
      ) : null}
      {action.iconOnly ? null : (
        <ThemedText
          variant="caption"
          color={colors.accentDeep}
          numberOfLines={1}
          maxFontSizeMultiplier={1.4}
        >
          {action.label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  /**
   * The scroll body must take the space the keyboard leaves and no more:
   * without `flex: 1` a short form keeps its intrinsic height, pushes the
   * footer past the padded frame and the one action disappears behind the IME.
   */
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
  },
  topRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  topSpacer: {
    width: 0,
  },
  back: {
    width: 48,
    height: 48,
    marginLeft: -spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  action: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  actionIconOnly: {
    width: 38,
    justifyContent: "center",
    paddingHorizontal: 0,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  actionPressed: {
    backgroundColor: colors.accentStrong,
  },
  head: {
    marginBottom: spacing.md,
  },
  meta: {
    marginTop: spacing.xs,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface,
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  footerFloating: {
    borderTopWidth: 0,
    backgroundColor: colors.canvas,
    paddingTop: spacing.xs,
  },
});
