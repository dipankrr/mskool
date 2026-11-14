import { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { PhotoSourceSheet } from "../students/student-photo";
import { InviteSheet } from "./invite-sheet";
import { JoinPill } from "./join-pill";
import { StaffAvatar, useStaffPhotoUploader } from "./staff-photo";
import { ClassTeacherTile, SubjectTile } from "./subject-tile";
import { sectionLabel } from "./teaching-logic";

/**
 * A staff member (ADR-068, frame 08): photo (tap to add or replace), contact,
 * what they teach this session, office roles, the login, and leaving. "New
 * code" is also the forgot-password path.
 */
export function StaffProfileScreen({ id }: { id: string }) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const { has } = usePermissions();
  const orgId = organizationId ?? "";
  const row = trpc.staff.byId.useQuery({ organizationId: orgId, id }, { enabled: Boolean(organizationId) });
  const overview = trpc.assignment.overview.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: Boolean(organizationId && schoolId && academicYear) && has("teacher_assignment:read") },
  );
  const uploader = useStaffPhotoUploader();
  const [sheet, setSheet] = useState(false);
  const [invite, setInvite] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const canEdit = has("staff:update");

  if (row.isPending) {
    return (
      <ScreenFrame title="" backAccessibilityLabel="Back">
        <Skeleton height={80} />
        <Skeleton height={160} />
      </ScreenFrame>
    );
  }
  if (row.isError || !row.data) {
    return (
      <ScreenFrame title="Staff" backAccessibilityLabel="Back">
        <ErrorCard cause={row.error} onRetry={() => void row.refetch()} />
      </ScreenFrame>
    );
  }

  const data = row.data;
  const name = `${data.firstName} ${data.lastName}`.trim();
  const current = ["active", "on_leave", "suspended"].includes(data.status);
  const teaching = (overview.data?.sections ?? []).flatMap((section) => {
    const label = sectionLabel(section.className, section.sectionName);
    const out: { kind: "ct" | "subject"; subject: string; label: string }[] = [];
    if (section.classTeacher?.staffId === id) out.push({ kind: "ct", subject: "", label });
    for (const subject of section.subjects) {
      if (subject.teachers.some((t) => t.staffId === id)) {
        out.push({ kind: "subject", subject: subject.subjectName, label });
      }
    }
    return out;
  });
  const classTeacherOf = teaching.filter((t) => t.kind === "ct").map((t) => t.label);
  const bySubject = new Map<string, string[]>();
  for (const t of teaching.filter((t) => t.kind === "subject")) {
    bySubject.set(t.subject, [...(bySubject.get(t.subject) ?? []), t.label]);
  }

  return (
    <ScreenFrame
      title=""
      backAccessibilityLabel="Back"
      action={
        canEdit ? { label: "Edit", icon: "edit", onPress: () => router.push({ pathname: "/staff-form", params: { id } }) } : undefined
      }
    >
      <View style={styles.hero}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={data.photo ? "Change photo" : "Add photo"}
          onPress={() => (canEdit ? setSheet(true) : undefined)}
          disabled={!canEdit}
        >
          <StaffAvatar
            name={name}
            uri={data.photo?.url}
            cacheKey={data.photo?.id}
            size={68}
            badge={canEdit ? "camera" : undefined}
            busy={uploader.busy}
          />
        </Pressable>
        <View style={styles.grow}>
          <ThemedText variant="title" numberOfLines={2}>
            {name}
          </ThemedText>
          <ThemedText variant="meta">
            {[data.designation, data.employeeCode].filter(Boolean).join(" · ")}
          </ThemedText>
          <View style={styles.pillRow}>
            {current ? <JoinPill state={data.joinState} /> : (
              <View style={styles.leftPill}>
                <ThemedText variant="caption" style={{ color: colors.tone.neutral.fg }}>
                  Left {data.dateOfLeaving ?? ""}
                </ThemedText>
              </View>
            )}
          </View>
        </View>
      </View>
      {photoError ? (
        <ThemedText variant="meta" style={styles.errorText}>
          {photoError}
        </ThemedText>
      ) : null}

      <View style={styles.actions}>
        <Action icon="call" label="Call" onPress={() => data.phone && void Linking.openURL(`tel:+91${data.phone}`)} disabled={!data.phone} />
        <Action
          icon="whatsapp"
          label="WhatsApp"
          tint="#E3F7EA"
          fg="#1DA851"
          onPress={() => data.phone && void Linking.openURL(`whatsapp://send?phone=91${data.phone}`)}
          disabled={!data.phone}
        />
        <Action
          icon="school"
          label="Classes"
          onPress={() => router.push({ pathname: "/teaching-teacher", params: { staffId: id } })}
          disabled={!data.teachesClasses || !current}
        />
        <Action
          icon="key"
          label={data.joinState === "joined" ? "New code" : "Invite"}
          onPress={() => setInvite(true)}
          disabled={!canEdit || !current || data.status !== "active"}
        />
      </View>

      <View style={styles.labelRow}>
        <ThemedText variant="sectionLabel">
          This session{academicYear ? ` · ${academicYear.name}` : ""}
        </ThemedText>
        {has("teacher_assignment:create") && data.teachesClasses && current ? (
          <Pressable onPress={() => router.push({ pathname: "/teaching-teacher", params: { staffId: id } })} hitSlop={8}>
            <ThemedText variant="bodyStrong" style={styles.link}>
              Edit
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.card}>
        {overview.isPending && has("teacher_assignment:read") ? (
          <View style={styles.pad}>
            <Skeleton height={44} />
          </View>
        ) : teaching.length === 0 ? (
          <View style={styles.emptyRow}>
            <ThemedText variant="meta">
              {data.teachesClasses ? "No classes this session yet." : "Doesn't teach classes."}
            </ThemedText>
          </View>
        ) : (
          <>
            {classTeacherOf.length > 0 ? (
              <View style={styles.row}>
                <ClassTeacherTile />
                <View style={styles.grow}>
                  <ThemedText variant="name">Class teacher</ThemedText>
                  <ThemedText variant="meta">{classTeacherOf.join(" · ")}</ThemedText>
                </View>
              </View>
            ) : null}
            {[...bySubject.entries()].map(([subject, labels], i) => (
              <View key={subject} style={[styles.row, i > 0 || classTeacherOf.length > 0 ? styles.line : null]}>
                <SubjectTile name={subject} />
                <View style={styles.grow}>
                  <ThemedText variant="name">{subject}</ThemedText>
                  <ThemedText variant="meta">{labels.join(" · ")}</ThemedText>
                </View>
              </View>
            ))}
          </>
        )}
      </View>

      {has("staff:delete") && current ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: "/staff-leave", params: { id } })}
          style={styles.leave}
          testID="profile-mark-left"
        >
          <AppIcon name="leave" size={18} color={colors.tone.critical.fg} />
          <ThemedText variant="bodyStrong" style={{ color: colors.tone.critical.fg }}>
            Mark as left
          </ThemedText>
        </Pressable>
      ) : null}

      <PhotoSourceSheet
        visible={sheet}
        hasPhoto={Boolean(data.photo)}
        onDismiss={() => setSheet(false)}
        onPicked={(picked) => {
          setPhotoError(null);
          void uploader
            .upload(orgId, id, picked)
            .catch((cause) => setPhotoError(thrownMessage(cause)));
        }}
        onRemove={() => undefined}
        onError={(cause) => setPhotoError(thrownMessage(cause))}
      />
      {invite && organizationId ? (
        <InviteSheet organizationId={organizationId} staffId={id} name={data.firstName} onClose={() => setInvite(false)} />
      ) : null}
    </ScreenFrame>
  );
}

function Action({
  icon,
  label,
  onPress,
  disabled,
  tint = colors.accentTint,
  fg = colors.accentDeep,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
  fg?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
    >
      <View style={[styles.actionIcon, { backgroundColor: tint }]}>
        <AppIcon name={icon} size={20} color={fg} />
      </View>
      <ThemedText variant="caption" style={styles.actionLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  grow: { flex: 1, minWidth: 0, gap: spacing.xxs },
  pillRow: { flexDirection: "row", marginTop: spacing.xs },
  leftPill: { height: 24, paddingHorizontal: spacing.sm + 1, borderRadius: 999, justifyContent: "center", backgroundColor: colors.tone.neutral.bg },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  action: { flex: 1, alignItems: "center", gap: spacing.xs + 2, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  actionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  actionLabel: { color: colors.ink },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.xl, marginBottom: spacing.xs + 2, paddingHorizontal: spacing.xs },
  link: { color: colors.accentDeep },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  pad: { padding: spacing.md },
  emptyRow: { padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  leave: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 50,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginTop: spacing.lg,
  },
  errorText: { color: colors.tone.critical.fg, marginTop: spacing.sm },
});
