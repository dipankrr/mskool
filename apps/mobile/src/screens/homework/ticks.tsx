import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { formatDue, sectionLabel, type RegisterRow } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { InfoChip, ProgressBar } from "./ui";

const text = copy.homework.ticks;

/**
 * Work the student ticks off (frame 24): who ticked and who hasn't yet. The
 * teacher can mark a child done (they read in class) or undo it. Nobody is
 * marked missed for reading.
 */
export function TicksScreen() {
  const { id, sectionId, subjectId } = useLocalSearchParams<{ id: string; sectionId: string; subjectId: string }>();
  const { organizationId } = useActiveContext();
  const utils = trpc.useUtils();
  const input = { organizationId: organizationId ?? "", id, sectionId, subjectId };
  const register = trpc.homework.register.get.useQuery(input, { enabled: Boolean(organizationId && id) });
  const mark = trpc.homework.students.markTick.useMutation({
    onSuccess: () => {
      void register.refetch();
      void utils.homework.home.invalidate();
      void utils.homework.byId.invalidate();
    },
  });

  const rows = register.data?.rows ?? [];
  const ticked = rows.filter((r) => r.status === "submitted");
  const notYet = rows.filter((r) => r.status !== "submitted");
  const hw = register.data?.homework;

  const row = (r: RegisterRow, i: number, done: boolean) => (
    <View key={r.studentAssignmentId} style={[styles.row, i > 0 ? styles.divider : null]}>
      <Avatar name={r.name} />
      <View style={styles.grow}>
        <ThemedText variant="name" numberOfLines={1}>
          {r.name}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {[r.rollNumber ? copy.homework.check.roll(r.rollNumber) : null, r.submittedAt ? formatDue(r.submittedAt) : null]
            .filter(Boolean)
            .join(" · ")}
        </ThemedText>
      </View>
      <CapsuleButton
        title={done ? text.unmark : text.markRead}
        size="compact"
        variant={done ? "secondary" : "primary"}
        onPress={() => mark.mutate({ ...input, id: r.studentAssignmentId, ticked: !done })}
        disabled={mark.isPending}
        testID={`ticks-${done ? "undo" : "mark"}-${r.studentAssignmentId}`}
      />
    </View>
  );

  return (
    <ScreenFrame
      title={register.data ? sectionLabel(register.data.className, register.data.sectionName) : text.title}
      meta={hw ? `${hw.book ? `${hw.book} · ` : ""}${hw.title}` : undefined}
      backAccessibilityLabel={copy.common.back}
      onRefresh={() => void register.refetch()}
      refreshing={register.isRefetching}
    >
      {register.isPending ? (
        <View style={styles.stack}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : register.isError ? (
        <ErrorCard cause={register.error} onRetry={() => void register.refetch()} />
      ) : (
        <>
          <Card style={styles.summary}>
            <View style={styles.counts}>
              <InfoChip label={`${ticked.length} ${text.ticked}`} tone="positive" icon="check" />
              <InfoChip label={`${notYet.length} ${text.notYet}`} tone="neutral" />
            </View>
            <ProgressBar value={ticked.length} total={rows.length} />
            <ThemedText variant="caption">{text.neverLate}</ThemedText>
          </Card>
          {mark.isError ? <Notice tone="critical" message={toFriendlyError(mark.error).message} style={styles.notice} /> : null}
          {notYet.length ? (
            <>
              <SectionLabel style={styles.label}>{text.notYet}</SectionLabel>
              <Card padless>{notYet.map((r, i) => row(r, i, false))}</Card>
            </>
          ) : null}
          {ticked.length ? (
            <>
              <SectionLabel style={styles.label}>{text.ticked}</SectionLabel>
              <Card padless>{ticked.map((r, i) => row(r, i, true))}</Card>
            </>
          ) : null}
        </>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, marginTop: spacing.md },
  grow: { flex: 1, gap: spacing.xxs },
  summary: { marginTop: spacing.md, gap: spacing.sm },
  counts: { flexDirection: "row", gap: spacing.xs },
  notice: { marginTop: spacing.md },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
});
