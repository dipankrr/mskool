import { Pressable, StyleSheet, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { initials } from "../../../components/avatar";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { copy } from "../../../lib/copy";
import { profileCopy } from "../../../lib/profile-copy";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import type { Block, PortalLink } from "./use-profile-data";

export type Guardian = inferRouterOutputs<AppRouter>["guardian"]["list"][number];

const words = profileCopy.family;

export const guardianName = (g: Guardian) => [g.firstName, g.lastName].filter(Boolean).join(" ");

/**
 * The family: each parent with a call button, the family app line when the viewer
 * may manage it, and an Add when they may add. An empty family says why it matters.
 */
export function FamilyCard({
  guardians,
  loading,
  portal,
  onCall,
  onOpen,
  onAdd,
  onPortal,
}: {
  guardians: Guardian[];
  loading: boolean;
  portal: Block<PortalLink[]>;
  onCall: (phone: string) => void;
  /** Absent: the viewer can't edit parents, so rows only call. */
  onOpen?: (guardianId: string) => void;
  onAdd?: () => void;
  onPortal: () => void;
}) {
  return (
    <>
      <View style={styles.section}>
        <ThemedText variant="sectionLabel">{words.title}</ThemedText>
        {onAdd && guardians.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.addHint}
            hitSlop={8}
            onPress={onAdd}
            style={({ pressed }) => [styles.add, pressed ? styles.pressed : null]}
            testID="guardian-add"
          >
            <AppIcon name="add" size={16} color={colors.accentDeep} />
            <ThemedText variant="chip" color={colors.accentDeep}>
              {words.add}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.card}>
        {loading ? (
          <View style={styles.loading}>
            <Skeleton height={20} width="45%" />
          </View>
        ) : guardians.length === 0 ? (
          <View style={styles.empty} testID="student-family-empty">
            <View style={styles.emptyIcon}>
              <AppIcon name="personAdd" size={24} color={colors.accentDeep} />
            </View>
            <ThemedText variant="name">{words.empty}</ThemedText>
            <ThemedText variant="meta" style={styles.center}>
              {words.emptyBody}
            </ThemedText>
            {onAdd ? (
              <CapsuleButton
                title={profileCopy.actions.addParent}
                icon="add"
                size="compact"
                onPress={onAdd}
                testID="guardian-add"
                style={styles.emptyButton}
              />
            ) : null}
          </View>
        ) : (
          guardians.map((guardian, index) => (
            <GuardianRow
              key={guardian.id}
              guardian={guardian}
              first={index === 0}
              onCall={() => onCall(guardian.phone)}
              onOpen={onOpen ? () => onOpen(guardian.id) : undefined}
            />
          ))
        )}
        {portal.state === "ready" ? (
          <PortalRow links={portal.data} onPress={onPortal} />
        ) : null}
      </View>
    </>
  );
}

function GuardianRow({
  guardian,
  first,
  onCall,
  onOpen,
}: {
  guardian: Guardian;
  first: boolean;
  onCall: () => void;
  onOpen?: () => void;
}) {
  const name = guardianName(guardian);
  const relation = copy.students.relations[guardian.relation];
  const tag = guardian.isPrimary
    ? copy.students.guardianPrimary
    : guardian.isEmergencyContact
      ? copy.students.guardianEmergency
      : null;
  const body = (
    <>
      <View style={styles.avatar}>
        <ThemedText variant="chip" color={colors.tone.neutral.fg} allowFontScaling={false}>
          {initials(name)}
        </ThemedText>
      </View>
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <ThemedText variant="name" numberOfLines={1} style={styles.shrink}>
            {name}
          </ThemedText>
          {tag ? (
            <View style={[styles.tag, guardian.isPrimary ? null : styles.tagNeutral]}>
              <ThemedText
                variant="tab"
                color={guardian.isPrimary ? colors.accentDeep : colors.tone.neutral.fg}
              >
                {tag}
              </ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText variant="meta" numberOfLines={1}>
          {`${relation} · ${guardian.phone}`}
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.students.profile.callGuardian(name)}
        accessibilityHint={copy.students.profile.callHint}
        hitSlop={4}
        onPress={onCall}
        style={({ pressed }) => [styles.call, pressed ? styles.pressed : null]}
        testID={`student-guardian-call-${guardian.id}`}
      >
        <AppIcon name="call" size={18} color={colors.accentDeep} />
      </Pressable>
    </>
  );
  const style = [styles.row, first ? null : styles.divided];
  if (!onOpen) {
    return (
      <View style={style} testID={`student-guardian-${guardian.id}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${relation}`}
      accessibilityHint={copy.students.openHint}
      onPress={onOpen}
      style={({ pressed }) => [...style, pressed ? styles.rowPressed : null]}
      testID={`student-guardian-${guardian.id}`}
    >
      {body}
    </Pressable>
  );
}

function PortalRow({ links, onPress }: { links: PortalLink[]; onPress: () => void }) {
  const active = links.find((link) => link.isActive);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={words.app}
      accessibilityHint={words.appHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        styles.divided,
        pressed ? styles.rowPressed : null,
      ]}
      testID="student-portal-link"
    >
      <View style={styles.square}>
        <AppIcon name="key" size={20} color={colors.accentDeep} />
      </View>
      <View style={styles.text}>
        <ThemedText variant="name">{words.app}</ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {active ? words.appOn(active.username) : words.appOff}
        </ThemedText>
      </View>
      <AppIcon name="chevronRight" size={20} color={colors.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  add: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    minHeight: 32,
  },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  loading: {
    padding: spacing.lg,
  },
  empty: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
    marginBottom: spacing.sm,
  },
  emptyButton: {
    marginTop: spacing.md,
  },
  center: {
    textAlign: "center",
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    paddingVertical: spacing.sm + spacing.xxs,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.chip,
  },
  square: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  shrink: {
    flexShrink: 1,
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  tagNeutral: {
    backgroundColor: colors.tone.neutral.bg,
  },
  call: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  pressed: {
    opacity: 0.8,
  },
});
