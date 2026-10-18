import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { deriveRoleWord } from "./role-word";

/**
 * One of "your classes": the section, its role word and today's attendance
 * state, resolved live. The card is the doorway into marking — tapping it
 * pushes the attendance screen with this section chosen; the chevron shows
 * only when that door is real (an attendance grant in the hint set).
 *
 * Status lines render only when the caller can read them: a hint-set miss
 * means no query (never a failing one), and a failed query shows nothing
 * rather than a false "not marked".
 */
export function ClassCard({
  sectionId,
  sectionName,
  className,
  roleTypes,
  sectionCount,
}: {
  sectionId: string;
  sectionName: string;
  className: string | null;
  roleTypes: readonly string[];
  sectionCount: number;
}) {
  const { me } = useMe();
  const { organizationId } = useActiveContext();
  const { has, hasAny } = usePermissions();

  const canReadAttendance = has("attendance:read");
  const canOpenAttendance = hasAny("attendance:read", "attendance:create");
  const canReadAssignments = has("teacher_assignment:read");
  const ready = Boolean(organizationId);

  const statusQuery = trpc.attendance.status.useQuery(
    { organizationId: organizationId ?? "", sectionId, date: todayIso() },
    {
      enabled: ready && canReadAttendance,
      staleTime: 30_000,
    },
  );
  const assignmentsQuery = trpc.assignment.teacherAssignment.list.useQuery(
    { organizationId: organizationId ?? "", sectionId },
    {
      enabled: ready && canReadAssignments,
      staleTime: 300_000,
    },
  );

  const roleWord = deriveRoleWord({
    assignmentRows:
      canReadAssignments && assignmentsQuery.isSuccess
        ? assignmentsQuery.data
        : undefined,
    userId: me?.user.id ?? "",
    roleTypes,
    sectionCount,
  });

  const statuses = statusQuery.data ?? [];
  const marked = statuses.length > 0;
  const present = statuses.filter((row) => row.status === "present").length;
  const statusText =
    !canReadAttendance || statusQuery.isPending || statusQuery.isError
      ? null
      : marked
        ? copy.home.markedPresent(present)
        : copy.home.notMarked;

  const title = className ? `${className} · ${sectionName}` : sectionName;

  const content = (
    <>
      <View style={styles.tile}>
        <AppIcon name="attendance" size={22} color={colors.accentDeep} />
      </View>
      <View style={styles.text}>
        <ThemedText variant="name" numberOfLines={1}>
          {title}
        </ThemedText>
        {roleWord || statusText ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {roleWord ? copy.home.classTeacher : null}
            {roleWord && statusText ? " · " : null}
            {statusText ? (
              <ThemedText
                variant="meta"
                color={marked ? colors.accentDeep : colors.tone.caution.fg}
              >
                {statusText}
              </ThemedText>
            ) : null}
          </ThemedText>
        ) : null}
      </View>
      {canOpenAttendance ? (
        <AppIcon name="chevronRight" size={18} color={colors.chevron} />
      ) : null}
    </>
  );

  if (!canOpenAttendance) {
    return (
      <Card style={styles.card} testID={`class-card-${sectionId}`}>
        {content}
      </Card>
    );
  }

  return (
    <Pressable
      testID={`class-card-${sectionId}`}
      accessibilityRole="button"
      accessibilityLabel={statusText ? `${title}, ${statusText}` : title}
      accessibilityHint={copy.home.openHint}
      onPress={() =>
        router.push({ pathname: "/attendance", params: { sectionId } })
      }
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      <Card style={styles.card}>{content}</Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  pressed: {
    transform: [{ scale: 0.99 }],
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
  },
});
