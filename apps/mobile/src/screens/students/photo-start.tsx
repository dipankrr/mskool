import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Svg, { Circle } from "react-native-svg";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useBranchMeta } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { sectionsByNeed, type SectionCoverage } from "./photo-matching";

/**
 * The photo workbench's front door (revamp 2026-11-09, prototype A1): it
 * leads with what is missing, school-wide and per section, instead of a
 * settings form. A section opens a two-way choice — photos already taken
 * (the grid) or take them now (photo day). Photos named with admission
 * numbers skip the section and match across the school.
 */
export function PhotoStartScreen() {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const branchName = useBranchMeta();
  const [chosen, setChosen] = useState<SectionCoverage | null>(null);

  const enabled = ready && Boolean(organizationId) && Boolean(academicYear?.id);
  const base = {
    organizationId: organizationId ?? "",
    schoolId: schoolId ?? undefined,
    academicYearId: academicYear?.id ?? "",
  };
  const coverage = trpc.student.photoCoverage.useQuery(base, { enabled });
  const sections = trpc.academic.section.list.useQuery(base, { enabled });
  const classes = trpc.academic.class.list.useQuery(
    { organizationId: base.organizationId, schoolId: base.schoolId },
    { enabled },
  );

  const rows = useMemo(() => {
    const byId = new Map((coverage.data ?? []).map((row) => [row.sectionId, row]));
    const className = new Map((classes.data ?? []).map((row) => [row.id, row.name]));
    return sectionsByNeed(
      (sections.data ?? []).map((section) => {
        const count = byId.get(section.id);
        return {
          sectionId: section.id,
          label: [className.get(section.classId), section.name].filter(Boolean).join(" · "),
          total: count?.total ?? 0,
          withPhoto: count?.withPhoto ?? 0,
        };
      }),
    ).filter((row) => row.total > 0);
  }, [coverage.data, sections.data, classes.data]);

  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const withPhoto = rows.reduce((sum, row) => sum + row.withPhoto, 0);
  const missing = total - withPhoto;

  const frame = (body: React.ReactNode) => (
    <ScreenFrame
      title={copy.photoFlow.startTitle}
      meta={[academicYear?.name, branchName].filter(Boolean).join(" · ")}
      backAccessibilityLabel={copy.common.back}
      titleTestID="photos-title"
      onRefresh={() => void coverage.refetch()}
      refreshing={coverage.isRefetching}
    >
      {body}
    </ScreenFrame>
  );

  if (!enabled || coverage.isPending || sections.isPending) {
    return frame(
      <View style={styles.body}>
        <Skeleton height={112} />
        <Skeleton height={200} />
      </View>,
    );
  }
  if (coverage.isError || sections.isError) {
    return frame(
      <ErrorCard
        cause={coverage.error ?? sections.error}
        onRetry={() => {
          void coverage.refetch();
          void sections.refetch();
        }}
        testID="photos-start-error"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      <Card>
        <View style={styles.hero}>
          <Ring share={total === 0 ? 0 : withPhoto / total} />
          <View style={styles.heroText}>
            <ThemedText variant="subtitle" testID="photos-missing">
              {copy.photoFlow.missingHeadline(missing)}
            </ThemedText>
            <ThemedText variant="meta">{copy.photoFlow.doneOf(withPhoto, total)}</ThemedText>
          </View>
        </View>
      </Card>

      <SectionLabel>{copy.photoFlow.pickSection}</SectionLabel>
      {rows.length === 0 ? (
        <EmptyState
          icon="students"
          title={copy.photoFlow.noSections}
          message={copy.photos.rosterEmptyBody}
          testID="photos-no-sections"
        />
      ) : (
        <Card padless>
          {rows.map((row) => {
            const gap = row.total - row.withPhoto;
            return (
              <Pressable
                key={row.sectionId}
                accessibilityRole="button"
                accessibilityLabel={`${row.label}, ${copy.photoFlow.sectionMissing(gap, row.total)}`}
                onPress={() => setChosen(row)}
                style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
                testID={`photos-section-${row.sectionId}`}
              >
                <View style={styles.rowText}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {row.label}
                  </ThemedText>
                  <ThemedText variant="meta">
                    {copy.photoFlow.sectionMissing(gap, row.total)}
                  </ThemedText>
                </View>
                <StatusPill
                  label={gap === 0 ? copy.photoFlow.completePill : copy.photoFlow.missingPill(gap)}
                  tone={gap === 0 ? "positive" : "caution"}
                />
                <AppIcon name="chevronRight" size={18} color={colors.chevron} />
              </Pressable>
            );
          })}
        </Card>
      )}

      <Card padless>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.photoFlow.byNameTitle}
          onPress={() => router.push({ pathname: "/students/photos", params: { mode: "register" } })}
          style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
          testID="photos-by-name"
        >
          <View style={styles.icon}>
            <AppIcon name="edit" size={18} color={colors.ink} />
          </View>
          <View style={styles.rowText}>
            <ThemedText variant="bodyStrong">{copy.photoFlow.byNameTitle}</ThemedText>
            <ThemedText variant="meta">{copy.photoFlow.byNameBody}</ThemedText>
          </View>
          <AppIcon name="chevronRight" size={18} color={colors.chevron} />
        </Pressable>
      </Card>

      <ChoiceSheet
        visible={chosen !== null}
        title={chosen?.label ?? copy.photoFlow.sectionSheet}
        options={[
          { id: "gallery", label: copy.photoFlow.fromGallery, detail: copy.photoFlow.fromGalleryDetail },
          { id: "day", label: copy.photoFlow.photoDay, detail: copy.photoFlow.photoDayDetail },
        ]}
        currentId=""
        onSelect={(id) => {
          const sectionId = chosen?.sectionId;
          setChosen(null);
          if (!sectionId) return;
          router.push(
            id === "day"
              ? { pathname: "/students/photo-day", params: { sectionId } }
              : { pathname: "/students/photos", params: { sectionId } },
          );
        }}
        onDismiss={() => setChosen(null)}
        testIDPrefix="photos-way"
      />
    </View>,
  );
}

function Ring({ share }: { share: number }) {
  const r = 27;
  const length = 2 * Math.PI * r;
  return (
    <View style={styles.ring}>
      <Svg width={64} height={64} viewBox="0 0 64 64">
        <Circle cx={32} cy={32} r={r} stroke={colors.field} strokeWidth={8} fill="none" />
        <Circle
          cx={32}
          cy={32}
          r={r}
          stroke={colors.accent}
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, share) * length} ${length}`}
          transform="rotate(-90 32 32)"
        />
      </Svg>
      <ThemedText variant="bodyStrong" style={styles.ringText}>
        {`${Math.round(share * 100)}%`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  heroText: { flex: 1, gap: spacing.xxs },
  ring: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  ringText: { position: "absolute", fontSize: 14 },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, gap: spacing.xxs },
  pressed: { backgroundColor: colors.field },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    alignItems: "center",
    justifyContent: "center",
  },
});
