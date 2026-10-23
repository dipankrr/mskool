import {
  KeyboardAvoidingView,
  Platform,
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

type HeaderAction = {
  /** Already-localised label; it is also the accessibility label. */
  label: string;
  onPress: () => void;
  /** A leading glyph — `add` for the list's create action. */
  icon?: AppIconName;
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
  footer,
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
  /** Sticky bottom content; the body yields its bottom padding to it. */
  footer?: ReactNode;
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
  const showTopRow = Boolean(backAccessibilityLabel || action);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
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
              {action ? (
                <Pressable
                  testID={action.testID}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  accessibilityHint={action.accessibilityHint}
                  hitSlop={{ top: 5, bottom: 5 }}
                  onPress={action.onPress}
                  style={({ pressed }) => [
                    styles.action,
                    pressed ? styles.actionPressed : null,
                  ]}
                >
                  {action.icon ? (
                    <AppIcon
                      name={action.icon}
                      size={16}
                      color={colors.accentDeep}
                    />
                  ) : null}
                  <ThemedText
                    variant="caption"
                    color={colors.accentDeep}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.4}
                  >
                    {action.label}
                  </ThemedText>
                </Pressable>
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
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
});
