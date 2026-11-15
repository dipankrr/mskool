import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { usePathname } from "expo-router";
import type { Href } from "expo-router";
import Animated, { SlideInLeft } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { IconTile } from "../../components/icon-tile";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
  useActiveOrganizationName,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, motion, radius, spacing, touch } from "../../theme/tokens";
import { buildNav, itemForPath, searchNav } from "./nav";
import type { NavItem } from "./nav";

const MAX_WIDTH = 320;

type GoTo = (href: Href, tab: boolean) => void;

/**
 * The sidebar: the web sidebar on a phone. Every screen that opens without a
 * record, in web's three groups, with fold-open items. It opens from the menu
 * button only, never an edge swipe, so the system back gesture and sideways
 * grids keep working. Back closes it.
 *
 * Choosing a line closes the panel and goes there: a bottom tab is switched
 * to, anything else is pushed over the tabs.
 *
 * The modal fades; the panel slides in over it. The panel lives only while
 * the modal is up, so every opening starts clean: no search text, and the
 * item you are in folded open.
 */
export function Sidebar({
  visible,
  onClose,
  onGo,
}: {
  visible: boolean;
  onClose: () => void;
  onGo: GoTo;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Panel onClose={onClose} onGo={onGo} />
    </Modal>
  );
}

function Panel({ onClose, onGo }: { onClose: () => void; onGo: GoTo }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(MAX_WIDTH, Math.round(screenWidth * 0.86));
  const pathname = usePathname();
  const { has } = usePermissions();
  const { academicYear } = useActiveContext();
  const organizationName = useActiveOrganizationName();
  const branchName = useActiveBranchName();

  const groups = useMemo(() => buildNav(has), [has]);
  const here = itemForPath(groups, pathname);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(here ? [here] : []));
  const [query, setQuery] = useState("");
  const matches = useMemo(() => searchNav(groups, query), [groups, query]);
  const searching = query.trim().length > 0;

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const meta = [branchName, academicYear?.name].filter(Boolean).join(" · ");

  return (
    <View style={styles.root}>
      <View style={styles.scrim}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={copy.shell.closeMenu}
          onPress={onClose}
          testID="sidebar-scrim"
        />
      </View>
      <Animated.View
        entering={SlideInLeft.duration(motion.base)}
        accessibilityViewIsModal
        testID="sidebar"
        style={[styles.panel, { width, paddingTop: insets.top + spacing.md }]}
      >
        <View style={styles.head}>
          <IconTile name="school" size={40} tone="accent" />
          <View style={styles.headText}>
            <ThemedText variant="bodyStrong" numberOfLines={1}>
              {organizationName ?? copy.nav.more}
            </ThemedText>
            {meta ? (
              <ThemedText variant="meta" numberOfLines={1}>
                {meta}
              </ThemedText>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.shell.closeMenu}
            hitSlop={8}
            onPress={onClose}
            style={styles.close}
            testID="sidebar-close"
          >
            <AppIcon name="close" size={20} color={colors.muted} />
          </Pressable>
        </View>

        <View style={styles.find}>
          <AppIcon name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={copy.shell.find}
            placeholderTextColor={colors.muted}
            accessibilityLabel={copy.shell.find}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={styles.findInput}
            testID="sidebar-find"
          />
          {searching ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.shell.clearFind}
              hitSlop={10}
              onPress={() => setQuery("")}
              testID="sidebar-find-clear"
            >
              <AppIcon name="closeCircle" size={18} color={colors.chevron} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xxl }]}
        >
          {searching ? (
            matches.length === 0 ? (
              <ThemedText variant="meta" style={styles.noMatch} testID="sidebar-no-match">
                {copy.shell.noMatch}
              </ThemedText>
            ) : (
              matches.map((match) => (
                <Pressable
                  key={match.key}
                  accessibilityRole="button"
                  accessibilityLabel={
                    match.parent ? `${match.label}, ${match.parent}` : match.label
                  }
                  onPress={() => onGo(match.href, Boolean(match.tab))}
                  style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
                  testID={`sidebar-match-${match.key}`}
                >
                  <AppIcon name={match.icon} size={20} color={colors.muted} />
                  <View style={styles.matchText}>
                    <ThemedText
                      variant="bodyStrong"
                      color={match.action ? colors.accentDeep : undefined}
                      numberOfLines={1}
                    >
                      {match.label}
                    </ThemedText>
                    {match.parent ? (
                      <ThemedText variant="meta" numberOfLines={1}>
                        {match.parent}
                      </ThemedText>
                    ) : null}
                  </View>
                </Pressable>
              ))
            )
          ) : (
            groups.map((group) => (
              <View key={group.key}>
                {group.label ? (
                  <ThemedText variant="sectionLabel" style={styles.groupLabel}>
                    {group.label}
                  </ThemedText>
                ) : null}
                {group.items.map((item) => (
                  <Item
                    key={item.key}
                    item={item}
                    open={open.has(item.key)}
                    here={item.key === here}
                    pathname={pathname}
                    onToggle={() => toggle(item.key)}
                    onGo={onGo}
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function Item({
  item,
  open,
  here,
  pathname,
  onToggle,
  onGo,
}: {
  item: NavItem;
  open: boolean;
  here: boolean;
  pathname: string;
  onToggle: () => void;
  onGo: (href: Href, tab: boolean) => void;
}) {
  const folds = item.subs.length > 0;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.soon ? `${item.label}, ${copy.more.soon}` : item.label}
        accessibilityState={folds ? { expanded: open } : { disabled: Boolean(item.soon) }}
        disabled={item.soon}
        onPress={() => {
          if (folds) onToggle();
          else if (item.href) onGo(item.href, Boolean(item.tab));
        }}
        style={({ pressed }) => [
          styles.item,
          open ? styles.itemOpen : null,
          pressed ? styles.pressed : null,
        ]}
        testID={`sidebar-item-${item.key}`}
      >
        <AppIcon name={item.icon} size={20} color={here ? colors.accentDeep : colors.muted} />
        <ThemedText
          variant="bodyStrong"
          color={item.soon ? colors.muted : undefined}
          numberOfLines={1}
          style={styles.itemLabel}
        >
          {item.label}
        </ThemedText>
        {item.soon ? (
          <StatusPill label={copy.more.soon} tone="neutral" style={styles.pill} />
        ) : folds ? (
          <AppIcon name={open ? "chevronUp" : "chevronDown"} size={18} color={colors.chevron} />
        ) : null}
      </Pressable>
      {folds && open ? (
        <View style={styles.subs}>
          {item.subs.map((sub) => {
            const current =
              typeof sub.href === "string" && sub.href.replace(/\/\([^)]+\)/g, "") === pathname;
            return (
              <Pressable
                key={sub.key}
                accessibilityRole="button"
                accessibilityLabel={sub.label}
                accessibilityState={{ selected: current }}
                onPress={() => onGo(sub.href, Boolean(sub.tab))}
                style={({ pressed }) => [
                  styles.sub,
                  current ? styles.subCurrent : null,
                  pressed ? styles.pressed : null,
                ]}
                testID={`sidebar-sub-${sub.key}`}
              >
                {sub.action ? <AppIcon name="add" size={16} color={colors.accentDeep} /> : null}
                <ThemedText
                  variant={sub.action || current ? "bodyStrong" : "body"}
                  color={sub.action || current ? colors.accentDeep : undefined}
                  numberOfLines={1}
                  style={styles.itemLabel}
                >
                  {sub.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
  },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.scrim,
  },
  // Pinned to the window's top and bottom: a height taken from the row left a
  // strip of the tab bar showing under the panel on Android.
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.surface,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headText: {
    flex: 1,
    gap: spacing.xxs,
  },
  close: {
    width: touch.min,
    height: touch.min,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -spacing.sm,
  },
  find: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: touch.min,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  findInput: {
    flex: 1,
    height: touch.min,
    padding: 0,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.body,
    color: colors.ink,
  },
  list: {
    paddingHorizontal: spacing.sm,
  },
  groupLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.md,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: touch.comfortable,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  itemOpen: {
    backgroundColor: colors.canvas,
  },
  itemLabel: {
    flex: 1,
  },
  pill: {
    alignSelf: "center",
  },
  pressed: {
    backgroundColor: colors.field,
  },
  subs: {
    marginLeft: spacing.xl + spacing.xxs,
    marginTop: spacing.xxs,
    marginBottom: spacing.xs,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.hairline,
  },
  sub: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  subCurrent: {
    backgroundColor: colors.accentTint,
  },
  matchText: {
    flex: 1,
    gap: spacing.xxs,
  },
  noMatch: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
  },
});
