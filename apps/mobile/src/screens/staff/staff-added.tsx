import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ScreenFrame } from "../../components/screen-frame";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useActiveBranchName } from "../../hooks/use-active-context";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { InviteSheet } from "./invite-sheet";
import { StaffAvatar } from "./staff-photo";

/**
 * Added (ADR-068, frame 06b): instead of two save buttons up front, the next
 * steps come after saving — invite, give classes, or add the next person.
 * Adding thirty staff on day one is a loop of Add staff → here → Add another.
 */
export function StaffAddedScreen({ id }: { id: string }) {
  const { organizationId } = useActiveContext();
  const branchName = useActiveBranchName();
  const row = trpc.staff.byId.useQuery(
    { organizationId: organizationId ?? "", id },
    { enabled: Boolean(organizationId) },
  );
  const [invite, setInvite] = useState(false);
  const data = row.data;
  const name = data ? `${data.firstName} ${data.lastName}`.trim() : "";

  return (
    <ScreenFrame
      title=""
      action={{ label: "Done", onPress: () => router.back() }}
    >
      <View style={styles.hero}>
        <StaffAvatar
          name={name || "?"}
          uri={data?.photo?.url}
          cacheKey={data?.photo?.id}
          size={80}
          badge="check"
        />
        <ThemedText variant="title" style={styles.title}>
          {data ? `${data.firstName} is added` : "Added"}
        </ThemedText>
        <ThemedText variant="meta">
          {[data?.designation, branchName, data?.employeeCode].filter(Boolean).join(" · ")}
        </ThemedText>
      </View>

      <ThemedText variant="sectionLabel" style={styles.label}>
        Next
      </ThemedText>
      <View style={styles.card}>
        <Step
          first
          icon="whatsapp"
          bg="#E3F7EA"
          fg="#1DA851"
          title={data?.firstName ? `Invite ${data.firstName} to the app` : "Invite to the app"}
          sub="Send their joining code on WhatsApp"
          onPress={() => setInvite(true)}
          testID="added-invite"
        />
        {data?.teachesClasses ? (
          <Step
            icon="school"
            bg={colors.accentTint}
            fg={colors.accentDeep}
            title="Give classes"
            sub="Pick the subjects and sections they teach"
            onPress={() =>
              router.push({ pathname: "/teaching-teacher", params: { staffId: id } })
            }
            testID="added-classes"
          />
        ) : null}
        <Step
          icon="personAdd"
          bg={colors.tone.neutral.bg}
          fg={colors.tone.neutral.fg}
          title="Add another person"
          sub="The next one starts from a blank form"
          onPress={() => router.replace("/staff-form")}
          testID="added-another"
        />
      </View>
      <ThemedText variant="meta" style={styles.later}>
        You can do these later from their profile.
      </ThemedText>

      {invite && organizationId ? (
        <InviteSheet
          organizationId={organizationId}
          staffId={id}
          name={data?.firstName ?? ""}
          onClose={() => setInvite(false)}
        />
      ) : null}
    </ScreenFrame>
  );
}

function Step({
  icon,
  bg,
  fg,
  title,
  sub,
  onPress,
  first,
  testID,
}: {
  icon: AppIconName;
  bg: string;
  fg: string;
  title: string;
  sub: string;
  onPress: () => void;
  first?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.step, first ? null : styles.line, pressed ? styles.pressed : null]}
    >
      <View style={[styles.stepIcon, { backgroundColor: bg }]}>
        <AppIcon name={icon} size={20} color={fg} />
      </View>
      <View style={styles.grow}>
        <ThemedText variant="name">{title}</ThemedText>
        <ThemedText variant="meta">{sub}</ThemedText>
      </View>
      <AppIcon name="chevronRight" size={18} color={colors.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: spacing.xs, marginTop: spacing.lg },
  title: { marginTop: spacing.md },
  label: { marginTop: spacing.xxl, marginLeft: spacing.xs, marginBottom: spacing.xs + 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 72, paddingHorizontal: spacing.md },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  pressed: { backgroundColor: colors.canvas },
  stepIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0 },
  later: { textAlign: "center", marginTop: spacing.md },
});
