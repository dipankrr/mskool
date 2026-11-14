import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { ScreenFrame } from "../../components/screen-frame";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ClassTeacherTile } from "../staff/subject-tile";

/**
 * Teaching settings (ADR-068, frame 17). "We have class teachers" is off by
 * default: many schools only use subject teachers. Turning it on adds the
 * class teacher slot to every section and counts empty ones as gaps.
 * Who can assign, and what each kind of teacher may do, are permissions the
 * school edits on the web permission editor.
 */
export function TeachingSettingsScreen() {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const orgId = organizationId ?? "";
  const utils = trpc.useUtils();
  const overview = trpc.assignment.overview.useQuery(
    { organizationId: orgId, schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: Boolean(organizationId && schoolId && academicYear) },
  );
  const set = trpc.assignment.setClassTeachers.useMutation({
    onSuccess: () => void utils.assignment.overview.invalidate(),
  });
  const [error, setError] = useState<string | null>(null);
  const on = set.isPending ? Boolean(set.variables?.enabled) : overview.data?.classTeachersEnabled ?? false;

  return (
    <ScreenFrame title="Teaching settings" backAccessibilityLabel="Back">
      <View style={styles.card}>
        <ClassTeacherTile size={36} />
        <View style={styles.grow}>
          <ThemedText variant="name">We have class teachers</ThemedText>
          <ThemedText variant="meta">
            Each section gets one, who looks after it as a whole. Off: the slot and its gap
            warnings disappear.
          </ThemedText>
        </View>
        <Switch
          value={on}
          disabled={!overview.data || set.isPending}
          onValueChange={(enabled) => {
            setError(null);
            set.mutate(
              { organizationId: orgId, schoolId: schoolId ?? "", enabled },
              { onError: (cause) => setError(thrownMessage(cause)) },
            );
          }}
          trackColor={{ true: colors.accent, false: colors.chip }}
          accessibilityLabel="We have class teachers"
          testID="settings-class-teachers"
        />
      </View>
      {error ? (
        <ThemedText variant="meta" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}

      <ThemedText variant="sectionLabel" style={styles.label}>
        Who can do what
      </ThemedText>
      <View style={styles.info}>
        <AppIcon name="shield" size={18} color={colors.tone.neutral.fg} />
        <ThemedText variant="meta" style={styles.infoText}>
          Anyone with the Teacher assignment permission can give classes. Today that is the org
          admin, principal and vice principal. What a teacher and a class teacher may do in their
          sections is set in Roles → permissions on the web.
        </ThemedText>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  label: { marginTop: spacing.xl, marginBottom: spacing.xs + 2, marginLeft: spacing.xs },
  info: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tone.neutral.bg },
  infoText: { flex: 1, color: colors.ink },
  error: { color: colors.tone.critical.fg, marginTop: spacing.sm },
});
