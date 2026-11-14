import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { filledPercent, teachingLine } from "../staff/teaching-logic";

/**
 * Home's teaching card (ADR-068, frame 16).
 *
 * - People who give classes see the gaps while there are any: how many, of
 *   what kind, how close the session is to full. Fill gaps opens Teaching.
 *   With nothing left to fill, the card goes away.
 * - Teachers see what they teach, the real line from their assignments
 *   ("Class teacher of 6-A · Maths in 6-A, 6-B") or that nothing is
 *   assigned yet.
 */
export function TeachingCard() {
  const { organizationId, schoolId, academicYear, currentYear } = useActiveContext();
  const { has } = usePermissions();
  const orgId = organizationId ?? "";
  const ready = Boolean(organizationId && schoolId && academicYear) && academicYear?.id === currentYear?.id;
  const canAssign = has("teacher_assignment:create");
  const overview = trpc.assignment.overview.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: ready && canAssign },
  );
  const mine = trpc.assignment.mine.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "" },
    { enabled: ready && !canAssign },
  );

  if (!ready) return null;

  if (canAssign) {
    const data = overview.data;
    if (!data || data.sections.length === 0) return null;
    const gaps = data.totals.noClassTeacher + data.totals.noTeacher;
    if (gaps === 0) return null;
    const pct = filledPercent(data.totals.filled, data.totals.slots);
    const kinds = [
      data.classTeachersEnabled && data.totals.noClassTeacher > 0
        ? `${data.totals.noClassTeacher} ${data.totals.noClassTeacher === 1 ? "section" : "sections"} without a class teacher`
        : null,
      data.totals.noTeacher > 0
        ? `${data.totals.noTeacher} ${data.totals.noTeacher === 1 ? "subject" : "subjects"} without a teacher`
        : null,
    ].filter(Boolean);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${gaps} teaching gaps. Fill gaps`}
        onPress={() => router.push("/teaching")}
        style={({ pressed }) => [styles.card, styles.gapCard, pressed ? styles.pressed : null]}
        testID="home-teaching-gaps"
      >
        <View style={styles.head}>
          <View style={[styles.icon, { backgroundColor: colors.tone.caution.bg }]}>
            <AppIcon name="school" size={20} color={colors.tone.caution.fg} />
          </View>
          <View style={styles.grow}>
            <ThemedText variant="name">
              {gaps} teaching {gaps === 1 ? "gap" : "gaps"}
            </ThemedText>
            <ThemedText variant="meta">{kinds.join(" · ")}</ThemedText>
          </View>
        </View>
        <View style={styles.bar}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <View style={styles.foot}>
          <ThemedText variant="meta">
            {data.totals.filled} of {data.totals.slots} filled
          </ThemedText>
          <ThemedText variant="bodyStrong" style={styles.link}>
            Fill gaps
          </ThemedText>
        </View>
      </Pressable>
    );
  }

  if (!mine.data) return null;
  const line = teachingLine(mine.data);
  return (
    <View style={styles.card} testID="home-my-teaching">
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: colors.accentTint }]}>
          <AppIcon name={line ? "star" : "clock"} size={20} color={colors.accentDeep} />
        </View>
        <View style={styles.grow}>
          <ThemedText variant="caption" style={styles.label}>
            {line ? "YOU TEACH" : "NO CLASSES YET"}
          </ThemedText>
          <ThemedText variant="body">
            {line ?? "The office hasn't given you any classes for this session. They'll appear here as soon as they do."}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.md },
  gapCard: { borderWidth: 1, borderColor: "rgba(181,71,8,0.2)" },
  pressed: { opacity: 0.9 },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0, gap: spacing.xxs },
  label: { color: colors.accentDeep, letterSpacing: 0.4 },
  bar: { height: 8, borderRadius: 99, backgroundColor: colors.chip, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 99, backgroundColor: colors.accent },
  foot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: colors.accentDeep },
});
