import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { StaffAvatar } from "./staff-photo";
import { ClassTeacherTile, SubjectTile } from "./subject-tile";
import { TeacherPickerSheet } from "./teacher-picker-sheet";
import { sectionLabel } from "./teaching-logic";

type Slot = {
  key: string;
  sectionId: string;
  role: "class_teacher" | "subject_teacher";
  subjectId: string | null;
  label: string;
  subjectName: string | null;
};

const REASONS = [
  { id: "resigned", label: "Resigned" },
  { id: "retired", label: "Retired" },
  { id: "terminated", label: "Let go" },
] as const;

/**
 * Mark as left (ADR-068, frame 14): why, then everything they teach with a
 * picker for who takes it over. Lines can stay empty and then show up as
 * gaps. Leaving ends their classes today, switches their sign-in off and
 * frees their number; marks and homework they entered keep their name.
 */
export function StaffLeaveScreen({ id }: { id: string }) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const orgId = organizationId ?? "";
  const utils = trpc.useUtils();
  const row = trpc.staff.byId.useQuery({ organizationId: orgId, id }, { enabled: Boolean(organizationId) });
  const overview = trpc.assignment.overview.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: Boolean(organizationId && schoolId && academicYear) },
  );
  const deactivate = trpc.staff.deactivate.useMutation();
  const assign = trpc.assignment.teacherAssignment.create.useMutation();
  const [reason, setReason] = useState<(typeof REASONS)[number]["id"]>("resigned");
  const [handover, setHandover] = useState<Record<string, { staffId: string; name: string; photo?: { id: string; url: string } | null }>>({});
  const [picking, setPicking] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const name = row.data ? `${row.data.firstName} ${row.data.lastName}`.trim() : "";
  const slots: Slot[] = (overview.data?.sections ?? []).flatMap((section) => {
    const label = sectionLabel(section.className, section.sectionName);
    const out: Slot[] = [];
    if (section.classTeacher?.staffId === id) {
      out.push({ key: `ct:${section.sectionId}`, sectionId: section.sectionId, role: "class_teacher", subjectId: null, label, subjectName: null });
    }
    for (const subject of section.subjects) {
      if (subject.teachers.some((t) => t.staffId === id)) {
        out.push({
          key: `${subject.subjectId}:${section.sectionId}`,
          sectionId: section.sectionId,
          role: "subject_teacher",
          subjectId: subject.subjectId,
          label,
          subjectName: subject.subjectName,
        });
      }
    }
    return out;
  });

  async function confirm() {
    if (!organizationId || !schoolId || !academicYear) return;
    setSaving(true);
    setError(null);
    try {
      await deactivate.mutateAsync({ organizationId, id, data: { status: reason } });
      for (const slot of slots) {
        const next = handover[slot.key];
        if (!next) continue;
        await assign.mutateAsync({
          organizationId,
          schoolId,
          sectionId: slot.sectionId,
          academicYearId: academicYear.id,
          staffId: next.staffId,
          role: slot.role,
          ...(slot.subjectId ? { subjectId: slot.subjectId } : {}),
        });
      }
      await Promise.all([
        utils.staff.list.invalidate(),
        utils.staff.byId.invalidate(),
        utils.assignment.overview.invalidate(),
      ]);
      router.back();
    } catch (cause) {
      setError(thrownMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenFrame
      title="Mark as left"
      backAccessibilityLabel="Cancel"
      footer={
        <CapsuleButton
          title={row.data ? `Mark ${row.data.firstName} as left` : "Mark as left"}
          variant="destructive"
          onPress={() => void confirm()}
          loading={saving}
          disabled={saving || !row.data}
          testID="leave-confirm"
        />
      }
    >
      {row.data ? (
        <View style={styles.person}>
          <StaffAvatar name={name} uri={row.data.photo?.url} cacheKey={row.data.photo?.id} />
          <View style={styles.grow}>
            <ThemedText variant="name">{name}</ThemedText>
            <ThemedText variant="meta">{row.data.designation ?? row.data.employeeCode}</ThemedText>
          </View>
        </View>
      ) : (
        <Skeleton height={64} />
      )}

      <ThemedText variant="sectionLabel" style={styles.label}>
        Why
      </ThemedText>
      <ChoicePills
        options={REASONS.map((r) => ({ value: r.id, label: r.label }))}
        value={reason}
        onChange={(next) => setReason(next)}
        testIDPrefix="leave-reason"
      />

      <View style={styles.labelRow}>
        <ThemedText variant="sectionLabel">Who takes over</ThemedText>
        <ThemedText variant="meta">from today</ThemedText>
      </View>
      {overview.isPending ? (
        <Skeleton height={120} />
      ) : slots.length === 0 ? (
        <View style={styles.card}>
          <ThemedText variant="meta" style={styles.pad}>
            {"They don't teach anything this session."}
          </ThemedText>
        </View>
      ) : (
        <View style={styles.card}>
          {slots.map((slot, i) => {
            const next = handover[slot.key];
            return (
              <View key={slot.key} style={[styles.row, i > 0 ? styles.line : null]}>
                {slot.role === "class_teacher" ? <ClassTeacherTile size={32} /> : <SubjectTile name={slot.subjectName ?? ""} size={32} />}
                <ThemedText variant="bodyStrong" style={styles.grow} numberOfLines={1}>
                  {slot.role === "class_teacher" ? `Class teacher ${slot.label}` : `${slot.subjectName} ${slot.label}`}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPicking(slot)}
                  style={next ? styles.chosen : styles.choose}
                >
                  {next ? (
                    <>
                      <StaffAvatar name={next.name} uri={next.photo?.url} cacheKey={next.photo?.id} size={22} />
                      <ThemedText variant="chip" numberOfLines={1}>
                        {next.name}
                      </ThemedText>
                    </>
                  ) : (
                    <>
                      <AppIcon name="add" size={14} color={colors.tone.caution.fg} />
                      <ThemedText variant="chip" style={{ color: colors.tone.caution.fg }}>
                        Choose
                      </ThemedText>
                    </>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.info}>
        <AppIcon name="info" size={18} color={colors.tone.neutral.fg} />
        <ThemedText variant="meta" style={styles.infoText}>
          Their sign-in stops today and their number is freed. Work they entered keeps their name.
          Anything left on Choose shows up as a gap.
        </ThemedText>
      </View>
      {error ? (
        <ThemedText variant="meta" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}

      {picking && organizationId && schoolId ? (
        <TeacherPickerSheet
          organizationId={organizationId}
          schoolId={schoolId}
          title={picking.role === "class_teacher" ? `Class teacher, ${picking.label}` : `${picking.subjectName}, ${picking.label}`}
          excludeStaffIds={[id]}
          confirmLabel="Hand to"
          onClose={() => setPicking(null)}
          onDone={(ids) => {
            const staffId = ids[0];
            if (!staffId) return;
            void utils.assignment.teacherDirectory
              .fetch({ organizationId, schoolId })
              .then((people) => {
                const person = people.find((p) => p.staffId === staffId);
                const chosen = { staffId, name: person?.name ?? "", photo: person?.photo ?? null };
                setHandover((current) => {
                  const next = { ...current, [picking.key]: chosen };
                  // Offer the same person the rest of this subject's lines.
                  for (const slot of slots) {
                    if (slot.subjectName === picking.subjectName && slot.role === picking.role && !next[slot.key]) {
                      next[slot.key] = chosen;
                    }
                  }
                  return next;
                });
                setPicking(null);
              });
          }}
        />
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  person: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  grow: { flex: 1, minWidth: 0 },
  label: { marginTop: spacing.lg, marginBottom: spacing.xs + 2, marginLeft: spacing.xs },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.lg, marginBottom: spacing.xs + 2, paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  pad: { padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.md },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  choose: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.tone.caution.bg,
    borderWidth: 1,
    borderColor: "rgba(181,71,8,0.25)",
  },
  chosen: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 150 },
  info: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tone.neutral.bg, marginTop: spacing.md },
  infoText: { flex: 1, color: colors.ink },
  error: { color: colors.tone.critical.fg, marginTop: spacing.sm },
});
