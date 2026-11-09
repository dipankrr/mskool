import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../../components/app-icon";
import type { AppIconName } from "../../../components/app-icon";
import { ThemedText } from "../../../components/themed-text";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { ProfileSheet } from "./profile-sheet";

export type MoreItem = {
  key: string;
  icon: AppIconName;
  title: string;
  detail?: string | null;
  onPress: () => void;
  /** The one-way act: drawn alone at the bottom, in red. */
  destructive?: boolean;
};

/**
 * Jobs people need now and then, each behind its own permission. The parent never
 * opens this with nothing in it: the ⋯ button isn't drawn then.
 */
export function MoreSheet({
  visible,
  name,
  line,
  items,
  onDismiss,
}: {
  visible: boolean;
  name: string;
  line: string;
  items: MoreItem[];
  onDismiss: () => void;
}) {
  const everyday = items.filter((item) => !item.destructive);
  const oneWay = items.filter((item) => item.destructive);
  return (
    <ProfileSheet visible={visible} onDismiss={onDismiss} testID="student-more-sheet">
      <View style={styles.head}>
        <ThemedText variant="name" numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {line}
        </ThemedText>
      </View>
      {everyday.map((item, index) => (
        <Row key={item.key} item={item} first={index === 0} />
      ))}
      {oneWay.length > 0 ? <View style={styles.gap} /> : null}
      {oneWay.map((item, index) => (
        <Row key={item.key} item={item} first={index === 0} />
      ))}
    </ProfileSheet>
  );
}

function Row({ item, first }: { item: MoreItem; first: boolean }) {
  const red = item.destructive;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.detail ? `${item.title}, ${item.detail}` : item.title}
      onPress={item.onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divided,
        pressed ? styles.pressed : null,
      ]}
      testID={`student-more-${item.key}`}
    >
      <View style={[styles.icon, red ? styles.iconRed : null]}>
        <AppIcon
          name={item.icon}
          size={20}
          color={red ? colors.tone.critical.fg : colors.accentDeep}
        />
      </View>
      <View style={styles.text}>
        <ThemedText variant="name" color={red ? colors.tone.critical.fg : undefined}>
          {item.title}
        </ThemedText>
        {item.detail ? <ThemedText variant="meta">{item.detail}</ThemedText> : null}
      </View>
      <AppIcon name="chevronRight" size={20} color={colors.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  iconRed: {
    backgroundColor: colors.tone.critical.bg,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  gap: {
    height: spacing.sm,
    backgroundColor: colors.canvas,
    marginVertical: spacing.xs,
  },
});
