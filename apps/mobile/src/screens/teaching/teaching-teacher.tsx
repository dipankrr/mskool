import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoiceSheet } from "../../components/choice-sheet";
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
import { StaffAvatar } from "../staff/staff-photo";
import { ClassTeacherTile, SubjectTile } from "../staff/subject-tile";
import { sectionLabel } from "../staff/teaching-logic";
import { planTeacherChanges, teacherGrid } from "./teacher-grid";

/**
 * By teacher (ADR-068, frame 12): for "she teaches Maths in four sections".
 * Tap sections under each subject to tick or untick them; a section someone
 * else teaches shows their name, and ticking it adds this teacher alongside
 * (never replaces). Changes collect into one Save.
 */
export function TeachingTeacherScreen({ staffId }: { staffId: string }) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const { has } = usePermissions();
  const canEdit = has("teacher_assignment:create") && has("teacher_assignment:update");
  const orgId = organizationId ?? "";
  const utils = trpc.useUtils();
  const overview = trpc.assignment.overview.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: Boolean(organizationId && schoolId && academicYear) },
  );
  const person = trpc.staff.byId.useQuery({ organizationId: orgId, id: staffId }, { enabled: Boolean(organizationId) && has("staff:read") });
  const directory = trpc.assignment.teacherDirectory.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "" },
    { enabled: Boolean(organizationId && schoolId) },
  );
  const create = trpc.assignment.teacherAssignment.create.useMutation();
  const end = trpc.assignment.teacherAssignment.end.useMutation();

  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [extraSubjects, setExtraSubjects] = useState<string[]>([]);
  const [ctChoice, setCtChoice] = useState<string | null | undefined>(undefined);
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [ctSheet, setCtSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const grid = useMemo(
    () => (overview.data ? teacherGrid(overview.data, staffId, extraSubjects) : null),
    [overview.data, staffId, extraSubjects],
  );
  const name =
    (person.data ? `${person.data.firstName} ${person.data.lastName}`.trim() : null) ??
    directory.data?.find((p) => p.staffId === staffId)?.name ??
    "";
  const plan = grid ? planTeacherChanges(grid, toggled, ctChoice) : null;
  const changes = plan ? plan.add.length + plan.end.length : 0;

  async function save() {
    if (!plan || !organizationId || !schoolId || !academicYear) return;
    setSaving(true);
    setError(null);
    try {
      for (const id of plan.end) await end.mutateAsync({ organizationId, id });
      for (const row of plan.add) {
        await create.mutateAsync({
          organizationId,
          schoolId,
          academicYearId: academicYear.id,
          sectionId: row.sectionId,
          staffId,
          role: row.role,
          ...(row.subjectId ? { subjectId: row.subjectId } : {}),
        });
      }
      await Promise.all([utils.assignment.overview.invalidate(), utils.assignment.teacherDirectory.invalidate()]);
      setToggled(new Set());
      setCtChoice(undefined);
      router.back();
    } catch (cause) {
      setError(thrownMessage(cause));
      await utils.assignment.overview.invalidate();
    } finally {
      setSaving(false);
    }
  }

  const toggle = (key: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const ctSection = grid
    ? ctChoice === undefined
      ? grid.classTeacherOf
      : ctChoice === null
        ? null
        : grid.sections.find((s) => s.sectionId === ctChoice) ?? null
    : null;

  return (
    <ScreenFrame
      title={name || "Teacher"}
      meta={grid ? `${grid.slotCount} ${grid.slotCount === 1 ? "class" : "classes"} · ${grid.sectionCount} ${grid.sectionCount === 1 ? "section" : "sections"}` : null}
      backAccessibilityLabel="Back"
      footer={
        canEdit ? (
          <CapsuleButton
            title={changes === 0 ? "Save" : `Save · ${changes} ${changes === 1 ? "change" : "changes"}`}
            onPress={() => void save()}
            disabled={changes === 0 || saving}
            loading={saving}
            testID="teacher-save"
          />
        ) : undefined
      }
    >
      {overview.isPending ? (
        <View style={styles.gap}>
          <Skeleton height={56} />
          <Skeleton height={180} />
        </View>
      ) : overview.isError || !grid ? (
        <ErrorCard cause={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <>
          <View style={styles.person}>
            <StaffAvatar name={name || "?"} uri={person.data?.photo?.url} cacheKey={person.data?.photo?.id} size={52} />
            <View style={styles.grow}>
              <ThemedText variant="name">{name}</ThemedText>
              <ThemedText variant="meta">{person.data?.designation ?? "Teacher"}</ThemedText>
            </View>
          </View>

          {overview.data?.classTeachersEnabled ? (
            <View style={styles.ctCard}>
              <ClassTeacherTile size={32} />
              <ThemedText variant="bodyStrong" style={styles.grow}>
                Class teacher
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                disabled={!canEdit}
                onPress={() => setCtSheet(true)}
                style={ctSection ? styles.secOn : styles.secFree}
                testID="teacher-ct"
              >
                <ThemedText variant="bodyStrong" style={ctSection ? styles.onAccent : styles.muted}>
                  {ctSection ? sectionLabel(ctSection.className, ctSection.sectionName) : "None"}
                </ThemedText>
              </Pressable>
              <AppIcon name="chevronDown" size={16} color={colors.chevron} />
            </View>
          ) : null}

          {grid.subjects.map((subject) => (
            <View key={subject.subjectId} style={styles.subjectCard}>
              <View style={styles.subjectHead}>
                <SubjectTile name={subject.subjectName} size={32} />
                <ThemedText variant="name" style={styles.grow}>
                  {subject.subjectName}
                </ThemedText>
                <ThemedText variant="meta">
                  {plural(
                    subject.classes.reduce(
                      (n, c) => n + c.sections.filter((s) => (s.mine ? !toggled.has(s.key) : toggled.has(s.key))).length,
                      0,
                    ),
                    "section",
                  )}
                </ThemedText>
              </View>
              {subject.classes.map((cls) => (
                <View key={cls.className} style={styles.classRow}>
                  <ThemedText variant="caption" style={styles.classLabel}>
                    {cls.className}
                  </ThemedText>
                  <View style={styles.chips}>
                    {cls.sections.map((s) => {
                      const on = s.mine ? !toggled.has(s.key) : toggled.has(s.key);
                      const changed = toggled.has(s.key);
                      return (
                        <Pressable
                          key={s.key}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on, disabled: !canEdit }}
                          accessibilityLabel={`${subject.subjectName} ${s.label}${s.others.length ? `, also ${s.others.join(", ")}` : ""}`}
                          disabled={!canEdit}
                          onPress={() => toggle(s.key)}
                          style={[
                            styles.chip,
                            on ? styles.chipOn : null,
                            changed && on ? styles.chipNew : null,
                            changed && !on ? styles.chipRemoved : null,
                          ]}
                          testID={`teacher-chip-${s.key}`}
                        >
                          <View style={styles.chipTop}>
                            {changed && on ? (
                              <View style={styles.tick}>
                                <AppIcon name="check" size={14} color={colors.onAccent} />
                              </View>
                            ) : null}
                            <ThemedText variant="bodyStrong" style={on ? styles.onAccent : null}>
                              {s.label}
                            </ThemedText>
                          </View>
                          {s.others.length > 0 && !on ? (
                            <ThemedText variant="caption" style={styles.other} numberOfLines={1}>
                              {s.others[0]!.split(" ")[0]}
                            </ThemedText>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ))}

          {canEdit ? (
            <Pressable accessibilityRole="button" onPress={() => setSubjectSheet(true)} style={styles.addSubject} testID="teacher-add-subject">
              <AppIcon name="add" size={18} color={colors.accentDeep} />
              <ThemedText variant="bodyStrong" style={styles.link}>
                Add a subject
              </ThemedText>
            </Pressable>
          ) : null}
          {error ? (
            <ThemedText variant="meta" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}
        </>
      )}

      {grid ? (
        <ChoiceSheet
          visible={subjectSheet}
          currentId=""
          testIDPrefix="teacher-subject"
          title="Add a subject"
          options={grid.otherSubjects.map((s) => ({ id: s.subjectId, label: s.subjectName }))}
          onSelect={(id) => {
            setExtraSubjects((current) => [...current, id]);
            setSubjectSheet(false);
          }}
          onDismiss={() => setSubjectSheet(false)}
        />
      ) : null}
      {grid ? (
        <ChoiceSheet
          visible={ctSheet}
          currentId={grid.classTeacherOf?.sectionId ?? "__none"}
          testIDPrefix="teacher-ct"
          title="Class teacher of"
          options={[
            { id: "__none", label: "No section" },
            ...grid.sections
              .filter((s) => !s.classTeacherName || s.sectionId === grid.classTeacherOf?.sectionId)
              .map((s) => ({ id: s.sectionId, label: sectionLabel(s.className, s.sectionName) })),
          ]}
          onSelect={(id) => {
            setCtChoice(id === "__none" ? null : id);
            setCtSheet(false);
          }}
          onDismiss={() => setCtSheet(false)}
        />
      ) : null}
    </ScreenFrame>
  );
}

function plural(n: number, word: string) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  person: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  ctCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, marginTop: spacing.lg },
  secOn: { minWidth: 54, height: 34, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  secFree: { minWidth: 54, height: 34, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" },
  subjectCard: { paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, marginTop: spacing.sm },
  subjectHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.xs + 2 },
  classRow: { flexDirection: "row", gap: spacing.xs + 2, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  classLabel: { width: 62, paddingTop: spacing.md, color: colors.muted },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minWidth: 64, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.hairline, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipNew: { borderWidth: 3, borderColor: "#BDE6CD" },
  chipRemoved: { borderStyle: "dashed", borderColor: colors.tone.critical.fg },
  chipTop: { flexDirection: "row", alignItems: "center", gap: 4 },
  tick: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  onAccent: { color: colors.onAccent },
  muted: { color: colors.muted },
  other: { color: colors.muted, fontSize: 10 },
  addSubject: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs + 2, minHeight: 48, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.inputLine, marginTop: spacing.sm },
  link: { color: colors.accentDeep },
  error: { color: colors.tone.critical.fg, marginTop: spacing.sm },
});
