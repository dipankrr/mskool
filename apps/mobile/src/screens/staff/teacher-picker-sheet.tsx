import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { StaffAvatar } from "./staff-photo";
import { orderPicker } from "./teacher-picker-logic";

/**
 * The teacher picker (ADR-068, frame 11): staff with "Teaches classes" on,
 * people who already teach this subject first, each with how much they
 * already hold, so the office can spread the work. A load well above the
 * rest is amber. One or several can be picked.
 */
export function TeacherPickerSheet({
  organizationId,
  schoolId,
  title,
  subtitle,
  preferStaffIds = [],
  excludeStaffIds = [],
  multiple = false,
  confirmLabel,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  title: string;
  subtitle?: string;
  /** People who already teach this subject (they come first). */
  preferStaffIds?: string[];
  /** People already in this slot (not offered again). */
  excludeStaffIds?: string[];
  multiple?: boolean;
  /** "Assign" by default; the picked name is added for one. */
  confirmLabel?: string;
  onClose: () => void;
  onDone: (staffIds: string[]) => void;
}) {
  const directory = trpc.assignment.teacherDirectory.useQuery({ organizationId, schoolId });
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const ordered = orderPicker(directory.data ?? [], {
    query: q,
    showAll: all,
    prefer: preferStaffIds,
    exclude: excludeStaffIds,
  });
  const firstPicked = (directory.data ?? []).find((p) => p.staffId === picked[0]);
  const label =
    picked.length === 0
      ? confirmLabel ?? "Assign"
      : picked.length === 1
        ? `${confirmLabel ?? "Assign"} ${firstPicked?.name ?? ""}`.trim()
        : `${confirmLabel ?? "Assign"} ${picked.length} teachers`;

  const toggle = (staffId: string) =>
    setPicked((current) =>
      current.includes(staffId)
        ? current.filter((id) => id !== staffId)
        : multiple
          ? [...current, staffId]
          : [staffId],
    );

  return (
    <FormSheet
      title={title}
      onClose={onClose}
      testIDPrefix="teacher-picker"
      footer={
        <CapsuleButton
          title={label}
          onPress={() => onDone(picked)}
          disabled={picked.length === 0}
          testID="teacher-picker-done"
        />
      }
    >
      {subtitle ? (
        <ThemedText variant="meta" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      ) : null}
      <View style={styles.search}>
        <AppIcon name="search" size={18} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search teachers"
          placeholderTextColor={colors.muted}
          style={styles.searchText}
          autoCorrect={false}
          accessibilityLabel="Search teachers"
        />
      </View>
      {directory.isPending ? (
        <View style={styles.loading}>
          <Skeleton height={56} />
          <Skeleton height={56} />
        </View>
      ) : (
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          {ordered.groups.map((group) =>
            group.people.length === 0 ? null : (
              <View key={group.title} style={styles.group}>
                <ThemedText variant="sectionLabel" style={styles.groupLabel}>
                  {group.title}
                </ThemedText>
                <View style={styles.card}>
                  {group.people.map((person, i) => {
                    const on = picked.includes(person.staffId);
                    return (
                      <Pressable
                        key={person.staffId}
                        accessibilityRole={multiple ? "checkbox" : "radio"}
                        accessibilityState={{ checked: on }}
                        onPress={() => toggle(person.staffId)}
                        style={[styles.row, i > 0 ? styles.line : null, on ? styles.rowOn : null]}
                        testID={`picker-${person.staffId}`}
                      >
                        <StaffAvatar name={person.name} />
                        <View style={styles.grow}>
                          <ThemedText variant="name" numberOfLines={1}>
                            {person.name}
                          </ThemedText>
                          <ThemedText variant="meta" numberOfLines={1}>
                            {[person.designation, `${person.slots} ${person.slots === 1 ? "class" : "classes"}`]
                              .filter(Boolean)
                              .join(" · ")}
                            {person.busiest ? (
                              <ThemedText variant="meta" style={styles.busy}>
                                {"  · busiest"}
                              </ThemedText>
                            ) : null}
                          </ThemedText>
                        </View>
                        <View style={[styles.mark, on ? styles.markOn : null]}>
                          {on ? <AppIcon name="check" size={14} color={colors.onAccent} /> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ),
          )}
          {ordered.total === 0 ? (
            <ThemedText variant="meta" style={styles.none}>
              {q ? "Nobody by that name." : "No teaching staff yet. Turn on \"Teaches classes\" on a staff record."}
            </ThemedText>
          ) : null}
          {!all ? (
            <Pressable accessibilityRole="button" onPress={() => setAll(true)} style={styles.showAll}>
              <ThemedText variant="bodyStrong" style={styles.link}>
                Show all staff
              </ThemedText>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginBottom: spacing.sm },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.inputLine,
    paddingHorizontal: spacing.md,
  },
  searchText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.body, color: colors.ink, paddingVertical: spacing.sm },
  loading: { gap: spacing.sm, marginTop: spacing.md },
  scroll: { maxHeight: 420, marginTop: spacing.sm },
  group: { marginTop: spacing.md },
  groupLabel: { marginLeft: spacing.xs, marginBottom: spacing.xs + 2 },
  card: { backgroundColor: colors.canvas, borderRadius: radius.lg, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.md },
  rowOn: { backgroundColor: colors.accentTint },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  grow: { flex: 1, minWidth: 0 },
  busy: { color: colors.tone.caution.fg },
  mark: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.grabber, alignItems: "center", justifyContent: "center" },
  markOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  none: { textAlign: "center", padding: spacing.lg },
  showAll: { alignItems: "center", paddingVertical: spacing.md },
  link: { color: colors.accentDeep },
});
