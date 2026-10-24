import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import { ThemedText } from "./themed-text";

/**
 * The form bottom sheet — a short form's home (Step 2 rework). A two- or
 * three-field edit never earns a pushed screen: this slides a surface over
 * the lower half, scrolls the fields, and pins the save action above the
 * keyboard. Pan-down is disabled on purpose — a sheet holding typed work
 * leaves only through Cancel, Save, or Android back, all of which route
 * through `onRequestClose` so the caller can guard.
 *
 * The caller renders this while its form is open and unmounts it on close:
 * a fresh mount per open is what makes a body's `useState` initialisers run
 * against the row's current truth (the pushed-form gcTime rule, in sheet
 * form). `scroll` and `footer` are the two slots.
 */
export function FormSheet({
  visible = true,
  title,
  onClose,
  children,
  scroll,
  footer,
  testIDPrefix,
}: {
  /**
   * Defaults to true: the recommended pattern is conditional mounting at the
   * call site (`{open ? <XSheet/> : null}`), which re-runs a body's
   * initialisers against the row's current truth on every open. A caller may
   * instead keep the sheet mounted and drive `visible`.
   */
  visible?: boolean;
  title: string;
  /** Called for Cancel, the backdrop, and Android back. */
  onClose: () => void;
  /** Fields (the scroll body) — the classic slot. */
  children?: ReactNode;
  /** Fields as an explicit slot; wins over `children` when given. */
  scroll?: ReactNode;
  /** The save action row; rendered pinned at the sheet's bottom. */
  footer: ReactNode;
  testIDPrefix: string;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet} testID={testIDPrefix}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <ThemedText
              variant="title"
              numberOfLines={1}
              testID={`${testIDPrefix}-title`}
            >
              {title}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.cancel, pressed ? styles.pressed : null]}
              testID={`${testIDPrefix}-cancel`}
            >
              <AppIcon name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {scroll ?? children}
          </ScrollView>
          <View style={styles.footer}>{footer}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
    paddingBottom: spacing.xl,
  },
  grabber: {
    alignSelf: "center",
    marginTop: spacing.sm,
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.grabber,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  cancel: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  body: {
    paddingHorizontal: spacing.lg,
  },
  bodyContent: {
    paddingBottom: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});
