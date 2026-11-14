import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { DateField } from "../../components/date-field";
import { FormSheet } from "../../components/form-sheet";
import { SegmentBar } from "../../components/segment-bar";
import { ThemedText } from "../../components/themed-text";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { StaffAvatar } from "../staff/staff-photo";
import { TeacherPickerSheet } from "../staff/teacher-picker-sheet";
import { todayIst } from "../staff/staff-logic";
import { exclusiveEnd } from "../staff/teaching-logic";

export type ChangeTarget = {
  assignmentId: string;
  staffId: string;
  name: string;
  photo?: { id: string; url: string } | null;
  role: "class_teacher" | "subject_teacher";
  subjectId: string | null;
  title: string;
};

type Mode = "replace" | "cover" | "remove";

/**
 * Change a teacher (ADR-068, frame 13). Never silent: who goes, who comes,
 * and from when.
 *
 * - Replace: the old row ends today and the new one starts, in one save.
 * - Cover: someone also teaches it until a date (a substitute); the grant
 *   ends by itself. The regular teacher keeps theirs.
 * - Remove: the row ends today and the slot shows as a gap.
 */
export function ChangeTeacherSheet({
  organizationId,
  schoolId,
  academicYearId,
  sectionId,
  target,
  onClose,
}: {
  organizationId: string;
  schoolId: string;
  academicYearId: string;
  sectionId: string;
  target: ChangeTarget;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const end = trpc.assignment.teacherAssignment.end.useMutation();
  const create = trpc.assignment.teacherAssignment.create.useMutation();
  const directory = trpc.assignment.teacherDirectory.useQuery({ organizationId, schoolId });
  const [mode, setMode] = useState<Mode>("replace");
  const [next, setNext] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [until, setUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nextPerson = directory.data?.find((p) => p.staffId === next);
  const nextName = nextPerson?.name ?? "";
  const today = todayIst();
  const coverOk = mode !== "cover" || (until !== null && until >= today);
  const ready = mode === "remove" || (Boolean(next) && coverOk);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const base = {
        sectionId,
        academicYearId,
        role: target.role,
        ...(target.subjectId ? { subjectId: target.subjectId } : {}),
      };
      if (mode === "remove") {
        await end.mutateAsync({ organizationId, id: target.assignmentId });
      } else if (mode === "replace" && next) {
        await end.mutateAsync({
          organizationId,
          id: target.assignmentId,
          successor: { ...base, staffId: next },
        });
      } else if (mode === "cover" && next && until) {
        await create.mutateAsync({
          organizationId,
          schoolId,
          ...base,
          staffId: next,
          effectiveTo: exclusiveEnd(until),
        });
      }
      await Promise.all([utils.assignment.overview.invalidate(), utils.assignment.teacherDirectory.invalidate()]);
      onClose();
    } catch (cause) {
      setError(thrownMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const summary =
    mode === "remove"
      ? `${target.name} stops seeing this from today. The slot shows as a gap until someone is assigned.`
      : mode === "replace"
        ? next
          ? `${nextName} can enter its marks and homework from today. ${target.name} stops today.`
          : "Pick who takes over."
        : next && until
          ? `${nextName} covers until ${until}, then their access ends by itself. ${target.name} keeps theirs.`
          : "Pick who covers, and their last day.";

  return (
    <>
      <FormSheet
        title={target.title}
        onClose={onClose}
        testIDPrefix="change-teacher"
        footer={
          <CapsuleButton
            title={mode === "remove" ? `Remove ${target.name.split(" ")[0]}` : mode === "cover" ? "Add cover" : "Change teacher"}
            variant={mode === "remove" ? "destructive" : "primary"}
            onPress={() => void save()}
            disabled={!ready || busy}
            loading={busy}
            testID="change-teacher-save"
          />
        }
      >
        <SegmentBar
          label="What to do"
          value={mode}
          onChange={setMode}
          options={[
            { value: "replace", label: "Replace", testID: "change-mode-replace" },
            { value: "cover", label: "Cover", testID: "change-mode-cover" },
            { value: "remove", label: "Remove", testID: "change-mode-remove" },
          ]}
        />
        <View style={styles.swap}>
          <View style={[styles.who, styles.whoOld]}>
            <StaffAvatar name={target.name} uri={target.photo?.url} cacheKey={target.photo?.id} size={36} />
            <ThemedText variant="bodyStrong" numberOfLines={1}>
              {target.name}
            </ThemedText>
            <ThemedText variant="caption" style={styles.muted}>
              {mode === "cover" ? "regular" : "now"}
            </ThemedText>
          </View>
          {mode !== "remove" ? (
            <>
              <AppIcon name={mode === "cover" ? "add" : "chevronRight"} size={20} color={colors.chevron} />
              <Pressable
                accessibilityRole="button"
                onPress={() => setPicking(true)}
                style={[styles.who, next ? styles.whoNew : styles.whoEmpty]}
                testID="change-pick"
              >
                {next ? <StaffAvatar name={nextName} uri={nextPerson?.photo?.url} cacheKey={nextPerson?.photo?.id} size={36} /> : <AppIcon name="personAdd" size={24} color={colors.tone.caution.fg} />}
                <ThemedText variant="bodyStrong" numberOfLines={1} style={next ? null : styles.gapText}>
                  {next ? nextName : "Choose"}
                </ThemedText>
                <ThemedText variant="caption" style={styles.muted}>
                  {mode === "cover" ? "covering" : "new"}
                </ThemedText>
              </Pressable>
            </>
          ) : null}
        </View>
        {mode === "cover" ? (
          <DateField
            label="Their last day"
            value={until}
            onChange={setUntil}
            minimumDate={today}
            testID="change-until"
          />
        ) : null}
        <View style={styles.info}>
          <AppIcon name={mode === "remove" ? "warning" : "swap"} size={18} color={mode === "remove" ? colors.tone.caution.fg : colors.accentDeep} />
          <ThemedText variant="meta" style={styles.infoText}>
            {summary}
          </ThemedText>
        </View>
        {error ? (
          <ThemedText variant="meta" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}
      </FormSheet>
      {picking ? (
        <TeacherPickerSheet
          organizationId={organizationId}
          schoolId={schoolId}
          title={target.title}
          excludeStaffIds={[target.staffId]}
          confirmLabel="Choose"
          onClose={() => setPicking(false)}
          onDone={(ids) => {
            setNext(ids[0] ?? null);
            setPicking(false);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  swap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  who: { flex: 1, alignItems: "center", gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderRadius: radius.lg },
  whoOld: { backgroundColor: colors.canvas },
  whoNew: { backgroundColor: colors.accentTint },
  whoEmpty: { backgroundColor: colors.tone.caution.bg, borderWidth: 1.5, borderStyle: "dashed", borderColor: "rgba(181,71,8,0.4)" },
  muted: { color: colors.muted },
  gapText: { color: colors.tone.caution.fg },
  info: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentTint, marginTop: spacing.md },
  infoText: { flex: 1, color: colors.ink },
  error: { color: colors.tone.critical.fg, marginTop: spacing.sm },
});
