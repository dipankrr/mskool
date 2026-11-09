import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { ThemedText } from "../../../components/themed-text";
import { profileCopy } from "../../../lib/profile-copy";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { ProfileSheet } from "./profile-sheet";

const words = profileCopy.details;

export type Fact = { key: string; label: string; value: string };
export type FactGroup = { key: string; title: string; facts: Fact[]; note?: string | null };

/**
 * The four facts staff reach for, two to a row, and a way into the rest. Facts never
 * recorded stay out; the parent picks which four.
 */
export function DetailsCard({ facts, onAll }: { facts: Fact[]; onAll: () => void }) {
  return (
    <>
      <View style={styles.section}>
        <ThemedText variant="sectionLabel">{words.title}</ThemedText>
      </View>
      <View style={styles.card} testID="student-details">
        {facts.length > 0 ? (
          <View style={styles.grid}>
            {facts.map((fact, index) => (
              <View
                key={fact.key}
                style={[
                  styles.fact,
                  index % 2 === 1 ? styles.factRight : null,
                  index >= 2 ? styles.factLower : null,
                ]}
                accessible
                accessibilityLabel={`${fact.label}, ${fact.value}`}
                testID={`student-fact-${fact.key}`}
              >
                <ThemedText variant="meta">{fact.label}</ThemedText>
                <ThemedText variant="bodyStrong" numberOfLines={2}>
                  {fact.value}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={words.all}
          accessibilityHint={words.allHint}
          onPress={onAll}
          style={({ pressed }) => [
            styles.allRow,
            facts.length > 0 ? styles.divided : null,
            pressed ? styles.pressed : null,
          ]}
          testID="student-all-details"
        >
          <View style={styles.flex}>
            <ThemedText variant="chip" color={colors.accentDeep}>
              {words.all}
            </ThemedText>
            <ThemedText variant="meta">{words.allDetail}</ThemedText>
          </View>
          <AppIcon name="chevronRight" size={18} color={colors.accentDeep} />
        </Pressable>
      </View>
    </>
  );
}

/** Every recorded detail, grouped, with Edit for those who may change them. */
export function AllDetailsSheet({
  visible,
  groups,
  onDismiss,
  onEdit,
  emptyNote,
}: {
  visible: boolean;
  groups: FactGroup[];
  onDismiss: () => void;
  onEdit?: () => void;
  emptyNote?: string | null;
}) {
  const shown = groups.filter((group) => group.facts.length > 0);
  return (
    <ProfileSheet visible={visible} onDismiss={onDismiss} testID="student-all-details-sheet">
      <ThemedText variant="title" style={styles.sheetTitle}>
        {words.sheetTitle}
      </ThemedText>
      {shown.length === 0 ? (
        <ThemedText variant="meta" style={styles.sheetPad}>
          {words.nothing}
        </ThemedText>
      ) : null}
      {shown.map((group) => (
        <View key={group.key} style={styles.group}>
          <ThemedText variant="sectionLabel" style={styles.sheetPad}>
            {group.title}
          </ThemedText>
          {group.facts.map((fact) => (
            <View key={fact.key} style={styles.sheetFact} testID={`student-detail-${fact.key}`}>
              <ThemedText variant="meta">{fact.label}</ThemedText>
              <ThemedText variant="body">{fact.value}</ThemedText>
            </View>
          ))}
        </View>
      ))}
      {onEdit ? (
        <View style={styles.sheetPad}>
          {emptyNote ? (
            <ThemedText variant="meta" style={styles.note}>
              {emptyNote}
            </ThemedText>
          ) : null}
          <CapsuleButton
            title={words.edit}
            icon="edit"
            variant="secondary"
            onPress={onEdit}
            testID="student-details-edit"
            style={styles.editButton}
          />
        </View>
      ) : null}
    </ProfileSheet>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  section: {
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xs,
  },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  fact: {
    width: "50%",
    minHeight: 60,
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  factRight: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.hairline,
  },
  factLower: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  allRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  sheetTitle: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  sheetPad: {
    paddingHorizontal: spacing.xl,
  },
  group: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  sheetFact: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    gap: spacing.xxs,
  },
  note: {
    marginTop: spacing.xl,
  },
  editButton: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },
});
