import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import type { ListRenderItem } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { ReactNode, RefObject } from "react";

import { colors } from "../theme/brand-admin";
import { gutter, radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import { HeaderActionButton } from "./screen-frame";
import type { HeaderAction } from "./screen-frame";
import { ThemedText } from "./themed-text";

/**
 * `ScreenFrame` for a screen whose body is a long, windowed list — the marks
 * entry roster. Same top row (a 48 dp back control and one optional action),
 * same title block and gutters, but the body is a `FlatList` instead of a
 * `ScrollView` so sixty rows each holding a text input stay cheap, and the
 * footer rides above the keyboard.
 *
 * Everything that is not a row (notices, progress, filters) goes in `header`
 * and scrolls with the list: with the keyboard up the rows are the point, and
 * a pinned header would leave a 360×640 phone with a sliver of list.
 *
 * `keyboardShouldPersistTaps="handled"` lets a tap on another row's field or
 * a chip register while a field holds focus, instead of the first tap only
 * dismissing the keyboard.
 */
export function ListScreenFrame<T>({
  title,
  meta,
  titleTestID,
  backAccessibilityLabel,
  backTestID = "screen-back",
  action,
  header,
  data,
  renderItem,
  keyExtractor,
  extraData,
  empty,
  footer,
  listRef,
  onScrollToIndexFailed,
  onRefresh,
  refreshing = false,
  windowSize = 11,
  testID,
}: {
  title: string;
  meta?: string | null;
  titleTestID?: string;
  backAccessibilityLabel: string;
  backTestID?: string;
  action?: HeaderAction;
  /** Rendered under the title, scrolls with the rows. */
  header?: ReactNode;
  data: readonly T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T) => string;
  /** Anything `renderItem` reads that is not in `data` (FlatList is Pure). */
  extraData?: unknown;
  /** Shown instead of rows when `data` is empty. */
  empty?: ReactNode;
  /** Pinned above the keyboard and the gesture bar. */
  footer?: ReactNode;
  listRef?: RefObject<FlatList<T> | null>;
  onScrollToIndexFailed?: (info: {
    index: number;
    averageItemLength: number;
  }) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  windowSize?: number;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();

  const head = (
    <View>
      <View style={styles.topRow}>
        <Pressable
          testID={backTestID}
          accessibilityRole="button"
          accessibilityLabel={backAccessibilityLabel}
          hitSlop={8}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}
        >
          <AppIcon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
        {action ? (
          <View style={styles.actions}>
            <HeaderActionButton action={action} />
          </View>
        ) : null}
      </View>
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
      {header}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]} testID={testID}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          ref={listRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          extraData={extraData}
          ListHeaderComponent={head}
          ListEmptyComponent={empty ? <View>{empty}</View> : null}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: footer ? spacing.xl : insets.bottom + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          // Rows hold focus and typed state outside themselves (the draft
          // store), so a generous window keeps the NEXT rows mounted — the
          // Next key focuses a row that must already exist.
          windowSize={windowSize}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          removeClippedSubviews={false}
          onScrollToIndexFailed={onScrollToIndexFailed}
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
        />
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
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
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
