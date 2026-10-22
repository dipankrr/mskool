import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { ReactNode } from "react";

import { AppIcon } from "../../../components/app-icon";
import { useTabBarSpace } from "../../../components/tab-bar";
import { ThemedText } from "../../../components/themed-text";
import { copy } from "../../../lib/copy";
import { colors } from "../../../theme/brand-admin";
import { gutter, radius, spacing } from "../../../theme/tokens";

/**
 * The manage screens' frame (chunk 3): a back row, the screen title, an
 * optional session line, then one scroll body. The attendance tab's stack
 * keeps the floating tab bar visible over these screens, so the frame pads
 * its body by the bar's height.
 */
export function ManageFrame({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string | null;
  children: ReactNode;
}) {
  const tabSpace = useTabBarSpace();
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.head}>
            <Pressable
              testID="manage-back"
              accessibilityRole="button"
              accessibilityLabel={copy.attendance.manage.back}
              hitSlop={8}
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.back,
                pressed ? styles.backPressed : null,
              ]}
            >
              <AppIcon name="chevronLeft" size={22} color={colors.ink} />
            </Pressable>
            <ThemedText variant="title">{title}</ThemedText>
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
    width: 44,
    height: 44,
    marginLeft: -spacing.md,
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
