import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useActiveBranchName } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { PhotoSourceSheet } from "../students/student-photo";
import { StaffAvatar, useMyPhoto } from "./staff-photo";
import { SubjectTile } from "./subject-tile";
import { groupMyTeaching } from "./teaching-logic";

/**
 * Welcome (ADR-068, frames 04 and 18): the first screen after someone joins.
 * What the office assigned shows up at once — class teacher first, then each
 * subject with its sections — with an optional photo and a three-card tour.
 * With nothing assigned it says so plainly instead of empty tabs.
 */
export function StaffWelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { me } = useMe();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const branchName = useActiveBranchName();
  const mine = trpc.assignment.mine.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: Boolean(organizationId && schoolId) },
  );
  const photo = useMyPhoto(organizationId);
  const [sheet, setSheet] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const name = me?.user.name ?? "";
  const firstName = name.split(" ")[0] ?? name;
  const groups = groupMyTeaching(mine.data ?? []);
  const nothing = mine.isSuccess && groups.subjects.length === 0 && !groups.classTeacher;

  return (
    <View style={styles.flex}>
      <View style={[styles.wash, { height: 300 + insets.top }]} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + 120 },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={photo.uri ? "Change your photo" : "Add your photo"}
          onPress={() => setSheet(true)}
          style={styles.photoRow}
          testID="welcome-photo"
        >
          <StaffAvatar
            name={name}
            uri={photo.uri}
            cacheKey={photo.cacheKey}
            size={80}
            badge="camera"
            busy={photo.busy}
            style={styles.bigAvatar}
          />
          <View style={styles.photoText}>
            <ThemedText variant="bodyStrong">
              {photo.uri ? "Looking good" : "Add your photo"}
            </ThemedText>
            <ThemedText variant="meta">For your ID card and staff lists</ThemedText>
          </View>
        </Pressable>
        {photoError ? (
          <ThemedText variant="meta" style={styles.error}>
            {photoError}
          </ThemedText>
        ) : null}

        <ThemedText variant="hero" style={styles.hello}>
          {`Hi ${firstName}, you're in`}
        </ThemedText>
        <ThemedText variant="body" style={styles.muted}>
          {[branchName, academicYear ? `Session ${academicYear.name}` : null]
            .filter(Boolean)
            .join(" · ")}
        </ThemedText>

        {mine.isPending ? (
          <View style={styles.loading}>
            <Skeleton height={72} />
            <Skeleton height={120} />
          </View>
        ) : nothing ? (
          <View style={styles.nothing} testID="welcome-nothing">
            <View style={styles.nothingIcon}>
              <AppIcon name="clock" size={28} color={colors.accentDeep} />
            </View>
            <ThemedText variant="title">No classes yet</ThemedText>
            <ThemedText variant="body" style={styles.centerMuted}>
              {"The office hasn't given you any classes for this session. They'll appear here as soon as they do."}
            </ThemedText>
          </View>
        ) : (
          <>
            <View style={styles.labelRow}>
              <ThemedText variant="sectionLabel">Your classes</ThemedText>
              <ThemedText variant="meta">
                {groups.count} {groups.count === 1 ? "class" : "classes"}
              </ThemedText>
            </View>
            {groups.classTeacher ? (
              <View style={styles.ctCard} testID="welcome-class-teacher">
                <View style={styles.ctIcon}>
                  <AppIcon name="star" size={20} color={colors.onAccent} />
                </View>
                <View style={styles.grow}>
                  <ThemedText variant="caption" style={styles.ctLabel}>
                    CLASS TEACHER
                  </ThemedText>
                  <ThemedText variant="title" style={styles.onAccent}>
                    {groups.classTeacher}
                  </ThemedText>
                </View>
              </View>
            ) : null}
            {groups.subjects.length > 0 ? (
              <View style={styles.card}>
                {groups.subjects.map((subject, i) => (
                  <View key={subject.name} style={[styles.row, i > 0 ? styles.rowLine : null]}>
                    <SubjectTile name={subject.name} />
                    <View style={styles.grow}>
                      <ThemedText variant="name">{subject.name}</ThemedText>
                      <ThemedText variant="meta">{subject.sections.join(" · ")}</ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            {mine.isError ? (
              <ThemedText variant="meta" style={styles.error}>
                {thrownMessage(mine.error)}
              </ThemedText>
            ) : null}
          </>
        )}

        <View style={styles.tour}>
          <TourCard icon="attendance" label="Take attendance" bg={colors.accentTint} fg={colors.accentDeep} />
          <TourCard icon="homework" label="Give homework" bg="#EFEAFE" fg="#6440D8" />
          <TourCard icon="marks" label="Enter marks" bg="#E6EEFF" fg="#2556D9" />
        </View>
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: insets.bottom + spacing.lg }]}>
        <CapsuleButton
          testID="welcome-start"
          style={{ alignSelf: "stretch" }}
          title="Get started"
          icon="chevronRight"
          onPress={() => router.replace("/")}
        />
      </View>

      <PhotoSourceSheet
        visible={sheet}
        hasPhoto={Boolean(photo.uri)}
        onDismiss={() => setSheet(false)}
        onPicked={(picked) => {
          setPhotoError(null);
          void photo.upload(picked).catch((cause) => setPhotoError(thrownMessage(cause)));
        }}
        onRemove={() => undefined}
        onError={(cause) => setPhotoError(thrownMessage(cause))}
      />
    </View>
  );
}

function TourCard({
  icon,
  label,
  bg,
  fg,
}: {
  icon: AppIconName;
  label: string;
  bg: string;
  fg: string;
}) {
  return (
    <View style={styles.tourCard}>
      <View style={[styles.tourIcon, { backgroundColor: bg }]}>
        <AppIcon name={icon} size={18} color={fg} />
      </View>
      <ThemedText variant="bodyStrong" style={styles.tourLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  wash: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: colors.accentTint,
    opacity: 0.7,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  body: { paddingHorizontal: spacing.xl, gap: spacing.md },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  bigAvatar: { borderWidth: 4, borderColor: colors.surface },
  photoText: { flex: 1, gap: spacing.xxs },
  hello: { marginTop: spacing.lg },
  muted: { color: colors.muted, marginTop: -spacing.sm },
  centerMuted: { color: colors.muted, textAlign: "center" },
  loading: { gap: spacing.sm, marginTop: spacing.lg },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  ctCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
  },
  ctIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  ctLabel: { color: colors.onAccent, opacity: 0.8, letterSpacing: 0.4 },
  onAccent: { color: colors.onAccent },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.hairline },
  grow: { flex: 1, minWidth: 0 },
  nothing: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xl,
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  nothingIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  tour: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  tourCard: {
    flex: 1,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  tourIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tourLabel: { fontSize: 13 },
  error: { color: colors.tone.critical.fg },
  foot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.canvas,
  },
});
