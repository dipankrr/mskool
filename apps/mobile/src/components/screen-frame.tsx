import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { useTabBarSpace } from "./tab-bar";
import { ThemedText } from "./themed-text";

/**
 * The pushed-screen frame: one back row, the title, an optional session line,
 * then a single scroll body. Attendance's manage screens use it with
 * `padForTabBar` because their stack floats the tab bar over pushed screens;
 * Profile sits above the tabs and needs no extra inset.
 *
 * Omit `backAccessibilityLabel` for a screen that must not be left from inside
 * (the forced password change) — the control disappears rather than rendering
 * a dead end.
 *
 * The back control is a 48 dp target that never sits at the screen edge
 * (negative margin pulls the glyph into the gutter's optical line).
 */
export function ScreenFrame({
  title,
  meta,
  titleTestID,
  backAccessibilityLabel,
  backTestID = "screen-back",
  padForTabBar = false,
  children,
}: {
  title: string;
  meta?: string | null;
  titleTestID?: string;
  /** Omit to hide the back control entirely. */
  backAccessibilityLabel?: string;
  backTestID?: string;
  padForTabBar?: boolean;
  children: ReactNode;
}) {
  const tabSpace = useTabBarSpace();
  const insets = useSafeAreaInsets();
  // Pushed screens that sit above the tabs (Profile) own their own bottom
  // inset: without it the last row of a long scroll ends flush with the
  // gesture bar. Under the tabs the bar's space already carries the inset.
  const bottom = padForTabBar ? tabSpace : insets.bottom + spacing.xl;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.head}>
            {backAccessibilityLabel ? (
              <Pressable
                testID={backTestID}
                accessibilityRole="button"
                accessibilityLabel={backAccessibilityLabel}
                hitSlop={8}
                onPress={() => router.back()}
                style={({ pressed }) => [
                  styles.back,
                  pressed ? styles.backPressed : null,
                ]}
              >
                <AppIcon name="chevronLeft" size={22} color={colors.ink} />
              </Pressable>
            ) : null}
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
  head: {
    marginBottom: spacing.md,
  },
  back: {
    width: 48,
    height: 48,
    marginLeft: -spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  backPressed: {
    backgroundColor: colors.field,
  },
  meta: {
    marginTop: spacing.xs,
  },
});
