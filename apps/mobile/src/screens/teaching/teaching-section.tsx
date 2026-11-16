import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
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
import { TeacherPickerSheet } from "../staff/teacher-picker-sheet";
import { lastDayOf, sectionLabel } from "../staff/teaching-logic";
import { ChangeTeacherSheet } from "./change-teacher-sheet";
import type { ChangeTarget } from "./change-teacher-sheet";

type Picking =
  | { kind: "classTeacher" }
  | { kind: "subject"; subjectId: string; subjectName: string; existing: string[] }
  | { kind: "allSubjects" };

/**
 * One section (ADR-068, frame 10): the class teacher on top (when the
 * school uses them), then every subject mapped to the class with its
 * teachers. Empty slots are amber with Assign; two teachers can share a
 * subject. Tapping a teacher opens change / cover / remove (frame 13).
 */
export function TeachingSectionScreen({ sectionId }: { sectionId: string }) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const { has } = usePermissions();
  const canAssign = has("teacher_assignment:create");
  const canEnd = has("teacher_assignment:update");
  const orgId = organizationId ?? "";
  const utils = trpc.useUtils();
  const overview = trpc.assignment.overview.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: Boolean(organizationId && schoolId && academicYear) },
  );
  const create = trpc.assignment.teacherAssignment.create.useMutation();
  const [picking, setPicking] = useState<Picking | null>(null);
  const [changing, setChanging] = useState<ChangeTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const section = overview.data?.sections.find((s) => s.sectionId === sectionId);
  const enabled = overview.data?.classTeachersEnabled ?? false;
  const label = section ? sectionLabel(section.className, section.sectionName) : "";
  const subjectTeachers = new Map<string, string[]>();
  for (const s of overview.data?.sections ?? []) {
    for (const subject of s.subjects) {
      for (const t of subject.teachers) {
        subjectTeachers.set(subject.subjectId, [...(subjectTeachers.get(subject.subjectId) ?? []), t.staffId]);
      }
    }
  }

  async function assign(rows: { staffId: string; role: "class_teacher" | "subject_teacher"; subjectId?: string }[]) {
    if (!organizationId || !schoolId || !academicYear) return;
    setBusy(true);
    setError(null);
    try {
      for (const row of rows) {
        await create.mutateAsync({
          organizationId,
          schoolId,
          sectionId,
          academicYearId: academicYear.id,
          staffId: row.staffId,
          role: row.role,
          ...(row.subjectId ? { subjectId: row.subjectId } : {}),
        });
      }
    } catch (cause) {
      setError(thrownMessage(cause));
    } finally {
      await Promise.all([utils.assignment.overview.invalidate(), utils.assignment.teacherDirectory.invalidate(), utils.assignment.mine.invalidate(), utils.home.myPapers.invalidate()]);
      setBusy(false);
    }
  }

  return (
    <ScreenFrame
      title={label || "Section"}
      meta={section ? `${section.className}${section.gaps ? ` · ${section.gaps} ${section.gaps === 1 ? "gap" : "gaps"}` : ""}` : null}
      backAccessibilityLabel="Teaching"
      onRefresh={() => void overview.refetch()}
      refreshing={overview.isRefetching}
    >
      {overview.isPending ? (
        <View style={styles.gap}>
          <Skeleton height={64} />
          <Skeleton height={240} />
        </View>
      ) : overview.isError || !section ? (
        <ErrorCard cause={overview.error ?? new Error("Section not found.")} onRetry={() => void overview.refetch()} />
      ) : (
        <>
          {enabled ? (
            section.classTeacher ? (
              <Pressable
                accessibilityRole="button"
                disabled={!canEnd}
                onPress={() =>
                  setChanging({
                    assignmentId: section.classTeacher!.assignmentId,
                    staffId: section.classTeacher!.staffId,
                    name: section.classTeacher!.name,
                    photo: section.classTeacher!.photo,
                    role: "class_teacher",
                    subjectId: null,
                    title: `Class teacher, ${label}`,
                  })
                }
                style={styles.ct}
              >
                <ClassTeacherTile />
                <View style={styles.grow}>
                  <ThemedText variant="caption" style={styles.ctLabel}>
                    CLASS TEACHER
                  </ThemedText>
                  <ThemedText variant="name">{section.classTeacher.name}</ThemedText>
                </View>
                <StaffAvatar name={section.classTeacher.name} uri={section.classTeacher.photo?.url} cacheKey={section.classTeacher.photo?.id} size={30} />
              </Pressable>
            ) : (
              <View style={[styles.ct, styles.ctEmpty]}>
                <ClassTeacherTile empty />
                <View style={styles.grow}>
                  <ThemedText variant="caption" style={styles.gapText}>
                    CLASS TEACHER
                  </ThemedText>
                  <ThemedText variant="name">Nobody yet</ThemedText>
                </View>
                {canAssign ? (
                  <CapsuleButton
                    title="Assign"
                    icon="add"
                    size="compact"
                    onPress={() => setPicking({ kind: "classTeacher" })}
                    testID="section-assign-ct"
                  />
                ) : null}
              </View>
            )
          ) : null}

          <View style={styles.labelRow}>
            <ThemedText variant="sectionLabel">Subjects · {section.subjects.length}</ThemedText>
            {canAssign && section.subjects.some((s) => s.teachers.length === 0) ? (
              <Pressable onPress={() => setPicking({ kind: "allSubjects" })} hitSlop={8}>
                <ThemedText variant="bodyStrong" style={styles.link}>
                  {enabled && !section.classTeacher ? "One teacher for all" : "Fill empty with one teacher"}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
          {section.subjects.length === 0 ? (
            <View style={styles.card}>
              <ThemedText variant="meta" style={styles.pad}>
                No subjects are mapped to {section.className} yet. Add them in Academic setup.
              </ThemedText>
            </View>
          ) : (
            <View style={styles.card}>
              {section.subjects.map((subject, i) => (
                <View key={subject.subjectId} style={[styles.row, i > 0 ? styles.line : null]}>
                  <SubjectTile name={subject.subjectName} />
                  <View style={styles.grow}>
                    <ThemedText variant="name">{subject.subjectName}</ThemedText>
                    {subject.teachers.length === 0 ? (
                      <ThemedText variant="meta" style={styles.gapText}>
                        No teacher
                      </ThemedText>
                    ) : (
                      <View style={styles.teachers}>
                        {subject.teachers.map((t) => (
                          <Pressable
                            key={t.assignmentId}
                            accessibilityRole="button"
                            accessibilityLabel={`${t.name}, change`}
                            disabled={!canEnd}
                            onPress={() =>
                              setChanging({
                                assignmentId: t.assignmentId,
                                staffId: t.staffId,
                                name: t.name,
                                photo: t.photo,
                                role: "subject_teacher",
                                subjectId: subject.subjectId,
                                title: `${subject.subjectName}, ${label}`,
                              })
                            }
                            style={styles.teacher}
                          >
                            <StaffAvatar name={t.name} uri={t.photo?.url} cacheKey={t.photo?.id} size={22} />
                            <ThemedText variant="meta" style={styles.teacherName} numberOfLines={1}>
                              {t.name}
                              {t.effectiveTo ? ` · till ${lastDayOf(t.effectiveTo).slice(5)}` : ""}
                            </ThemedText>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                  {canAssign ? (
                    subject.teachers.length === 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          setPicking({ kind: "subject", subjectId: subject.subjectId, subjectName: subject.subjectName, existing: [] })
                        }
                        style={styles.assign}
                        testID={`section-assign-${subject.subjectId}`}
                      >
                        <AppIcon name="add" size={14} color={colors.tone.caution.fg} />
                        <ThemedText variant="chip" style={styles.gapText}>
                          Assign
                        </ThemedText>
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Add another ${subject.subjectName} teacher`}
                        hitSlop={8}
                        onPress={() =>
                          setPicking({
                            kind: "subject",
                            subjectId: subject.subjectId,
                            subjectName: subject.subjectName,
                            existing: subject.teachers.map((t) => t.staffId),
                          })
                        }
                        style={styles.plus}
                      >
                        <AppIcon name="add" size={16} color={colors.accentDeep} />
                      </Pressable>
                    )
                  ) : null}
                </View>
              ))}
            </View>
          )}
          {error ? (
            <ThemedText variant="meta" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}
          {busy ? <ThemedText variant="meta" style={styles.saving}>Saving…</ThemedText> : null}
        </>
      )}

      {picking && organizationId && schoolId && section ? (
        <TeacherPickerSheet
          organizationId={organizationId}
          schoolId={schoolId}
          title={
            picking.kind === "classTeacher"
              ? `Class teacher, ${label}`
              : picking.kind === "allSubjects"
                ? `Every empty subject, ${label}`
                : `${picking.subjectName}, ${label}`
          }
          subtitle={picking.kind === "subject" ? "Pick one or more teachers" : undefined}
          multiple={picking.kind === "subject"}
          preferStaffIds={picking.kind === "subject" ? subjectTeachers.get(picking.subjectId) ?? [] : []}
          excludeStaffIds={picking.kind === "subject" ? picking.existing : []}
          onClose={() => setPicking(null)}
          onDone={(ids) => {
            const current = picking;
            setPicking(null);
            if (current.kind === "classTeacher") {
              void assign([{ staffId: ids[0]!, role: "class_teacher" }]);
            } else if (current.kind === "subject") {
              void assign(ids.map((staffId) => ({ staffId, role: "subject_teacher" as const, subjectId: current.subjectId })));
            } else {
              const staffId = ids[0]!;
              const rows: { staffId: string; role: "class_teacher" | "subject_teacher"; subjectId?: string }[] = [];
              if (enabled && !section.classTeacher) rows.push({ staffId, role: "class_teacher" });
              for (const subject of section.subjects) {
                if (subject.teachers.length === 0) rows.push({ staffId, role: "subject_teacher", subjectId: subject.subjectId });
              }
              void assign(rows);
            }
          }}
        />
      ) : null}
      {changing && organizationId && schoolId && academicYear ? (
        <ChangeTeacherSheet
          organizationId={organizationId}
          schoolId={schoolId}
          academicYearId={academicYear.id}
          sectionId={sectionId}
          target={changing}
          onClose={() => setChanging(null)}
        />
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  ct: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  ctEmpty: { backgroundColor: colors.tone.caution.bg, borderWidth: 1.5, borderColor: "rgba(181,71,8,0.3)" },
  ctLabel: { color: colors.accentDeep, letterSpacing: 0.4 },
  grow: { flex: 1, minWidth: 0 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.lg, marginBottom: spacing.xs + 2, paddingHorizontal: spacing.xs },
  link: { color: colors.accentDeep },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  pad: { padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  teachers: { gap: spacing.xs, marginTop: spacing.xxs },
  teacher: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, minHeight: 26 },
  teacherName: { flexShrink: 1, color: colors.ink },
  assign: {
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
  plus: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accentTint, alignItems: "center", justifyContent: "center" },
  gapText: { color: colors.tone.caution.fg },
  error: { color: colors.tone.critical.fg, marginTop: spacing.sm },
  saving: { marginTop: spacing.sm },
});
