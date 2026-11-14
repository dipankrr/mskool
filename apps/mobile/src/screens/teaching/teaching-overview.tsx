import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { SegmentBar } from "../../components/segment-bar";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useActiveBranchName } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { StaffAvatar } from "../staff/staff-photo";
import { filledPercent, sectionLabel } from "../staff/teaching-logic";

type View_ = "section" | "teacher";

/**
 * Teaching (ADR-068, frame 09): how full the session is, the gaps by kind,
 * then every section (or every teacher) of the branch. Read-only for
 * teachers; people who can assign tap through to change it.
 */
export function TeachingOverviewScreen() {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();
  const [mode, setMode] = useState<View_>("section");
  const orgId = organizationId ?? "";
  const overview = trpc.assignment.overview.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: Boolean(organizationId && schoolId && academicYear) },
  );
  const directory = trpc.assignment.teacherDirectory.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "" },
    { enabled: Boolean(organizationId && schoolId) && mode === "teacher" },
  );
  const data = overview.data;
  const pct = data ? filledPercent(data.totals.filled, data.totals.slots) : 0;

  const byClass = new Map<string, NonNullable<typeof data>["sections"]>();
  for (const section of data?.sections ?? []) {
    byClass.set(section.className, [...(byClass.get(section.className) ?? []), section]);
  }

  return (
    <ScreenFrame
      title="Teaching"
      meta={[branchName, academicYear?.name].filter(Boolean).join(" · ")}
      backAccessibilityLabel="Back"
      utilityActions={
        has("school_settings:update")
          ? [{ label: "Teaching settings", icon: "settings", iconOnly: true, onPress: () => router.push("/teaching-settings") }]
          : undefined
      }
      onRefresh={() => void overview.refetch()}
      refreshing={overview.isRefetching}
    >
      {overview.isPending ? (
        <View style={styles.gap}>
          <Skeleton height={104} />
          <Skeleton height={60} />
          <Skeleton height={60} />
        </View>
      ) : overview.isError || !data ? (
        <ErrorCard cause={overview.error} onRetry={() => void overview.refetch()} />
      ) : data.sections.length === 0 ? (
        <EmptyState
          icon="school"
          title="No sections this session"
          message="Add classes and sections in Academic setup first, then come back to give them teachers."
        />
      ) : (
        <>
          <View style={styles.summary} testID="teaching-summary">
            <Ring pct={pct} />
            <View style={styles.summaryText}>
              <ThemedText variant="meta">
                {data.totals.filled} of {data.totals.slots} filled
              </ThemedText>
              {data.classTeachersEnabled ? (
                <GapLine count={data.totals.noClassTeacher} label="No class teacher" />
              ) : null}
              <GapLine count={data.totals.noTeacher} label="Subjects with no teacher" />
            </View>
          </View>

          <View style={styles.segment}>
            <SegmentBar
              label="Show by"
              value={mode}
              onChange={setMode}
              options={[
                { value: "section", label: "By section", testID: "teaching-by-section" },
                { value: "teacher", label: "By teacher", testID: "teaching-by-teacher" },
              ]}
            />
          </View>

          {mode === "section"
            ? [...byClass.entries()].map(([className, sections]) => (
                <View key={className} style={styles.group}>
                  <ThemedText variant="sectionLabel" style={styles.groupLabel}>
                    {className}
                  </ThemedText>
                  <View style={styles.card}>
                    {sections.map((section, i) => {
                      const label = sectionLabel(section.className, section.sectionName);
                      const filled = section.subjects.filter((s) => s.teachers.length > 0).length;
                      return (
                        <Pressable
                          key={section.sectionId}
                          accessibilityRole="button"
                          accessibilityLabel={`${label}, ${section.gaps} gaps`}
                          onPress={() =>
                            router.push({ pathname: "/teaching-section", params: { sectionId: section.sectionId } })
                          }
                          style={({ pressed }) => [styles.row, i > 0 ? styles.line : null, pressed ? styles.pressed : null]}
                          testID={`teaching-section-${section.sectionId}`}
                        >
                          <View style={[styles.badge, section.gaps > 0 ? styles.badgeGap : null]}>
                            <ThemedText variant="bodyStrong" style={section.gaps > 0 ? styles.gapText : styles.okText}>
                              {label}
                            </ThemedText>
                          </View>
                          <View style={styles.grow}>
                            <ThemedText
                              variant="name"
                              numberOfLines={1}
                              style={data.classTeachersEnabled && !section.classTeacher ? styles.gapText : null}
                            >
                              {data.classTeachersEnabled
                                ? section.classTeacher?.name ?? "No class teacher"
                                : `${filled} of ${section.subjects.length} subjects`}
                            </ThemedText>
                            {data.classTeachersEnabled ? (
                              <ThemedText variant="meta">
                                {filled} of {section.subjects.length} subjects
                              </ThemedText>
                            ) : null}
                          </View>
                          {section.gaps > 0 ? (
                            <View style={styles.gapPill}>
                              <ThemedText variant="caption" style={styles.gapText}>
                                {section.gaps} {section.gaps === 1 ? "gap" : "gaps"}
                              </ThemedText>
                            </View>
                          ) : (
                            <View style={styles.tick}>
                              <AppIcon name="check" size={13} color={colors.onAccent} />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))
            : (
              <View style={styles.group}>
                <View style={styles.card}>
                  {(directory.data ?? [])
                    .filter((p) => p.teachesClasses || p.slots > 0)
                    .map((person, i) => (
                      <Pressable
                        key={person.staffId}
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({ pathname: "/teaching-teacher", params: { staffId: person.staffId } })
                        }
                        style={({ pressed }) => [styles.row, i > 0 ? styles.line : null, pressed ? styles.pressed : null]}
                      >
                        <StaffAvatar name={person.name} uri={person.photo?.url} cacheKey={person.photo?.id} />
                        <View style={styles.grow}>
                          <ThemedText variant="name" numberOfLines={1}>
                            {person.name}
                          </ThemedText>
                          <ThemedText variant="meta">
                            {[person.designation, `${person.slots} ${person.slots === 1 ? "class" : "classes"} · ${person.sections} ${person.sections === 1 ? "section" : "sections"}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </ThemedText>
                        </View>
                        <AppIcon name="chevronRight" size={18} color={colors.chevron} />
                      </Pressable>
                    ))}
                </View>
              </View>
            )}
        </>
      )}
    </ScreenFrame>
  );
}

function GapLine({ count, label }: { count: number; label: string }) {
  return (
    <View style={styles.gapLine}>
      <View style={[styles.count, count === 0 ? styles.countOk : null]}>
        <ThemedText variant="caption" style={count === 0 ? styles.okText : styles.gapText}>
          {count}
        </ThemedText>
      </View>
      <ThemedText variant="body">{label}</ThemedText>
    </View>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 31;
  const c = 2 * Math.PI * r;
  return (
    <View style={styles.ring} accessibilityLabel={`${pct} percent filled`}>
      <Svg width={76} height={76} viewBox="0 0 76 76">
        <Circle cx={38} cy={38} r={r} stroke={colors.chip} strokeWidth={9} fill="none" />
        <Circle
          cx={38}
          cy={38}
          r={r}
          stroke={colors.accent}
          strokeWidth={9}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          transform="rotate(-90 38 38)"
        />
      </Svg>
      <View style={styles.ringLabel}>
        <ThemedText variant="name" style={styles.ringText} maxFontSizeMultiplier={1.2}>{pct}%</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  summaryText: { flex: 1, gap: spacing.sm },
  ring: { width: 76, height: 76 },
  ringLabel: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  ringText: { fontSize: 19, lineHeight: 24 },
  gapLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  count: { minWidth: 30, height: 24, borderRadius: 999, paddingHorizontal: spacing.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.tone.caution.bg },
  countOk: { backgroundColor: colors.tone.positive.bg },
  segment: { marginTop: spacing.lg },
  group: { marginTop: spacing.lg },
  groupLabel: { marginLeft: spacing.xs, marginBottom: spacing.xs + 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  pressed: { backgroundColor: colors.canvas },
  badge: { minWidth: 44, height: 40, borderRadius: 12, paddingHorizontal: spacing.xs + 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentTint },
  badgeGap: { backgroundColor: colors.tone.caution.bg },
  grow: { flex: 1, minWidth: 0 },
  gapPill: { height: 24, paddingHorizontal: spacing.sm + 1, borderRadius: 999, justifyContent: "center", backgroundColor: colors.tone.caution.bg },
  gapText: { color: colors.tone.caution.fg },
  okText: { color: colors.accentDeep },
  tick: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
});
