import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { fullName } from "../../lib/exams";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import type { Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ChipRow } from "./chip-row";
import type { Chip } from "./chip-row";
import { useClassSubjectNames, useExamScope } from "./use-exam-data";

const VERDICT_PILL: Record<string, { label: string; tone: Tone }> = {
  promoted: { label: copy.exams.final.verdicts.promoted, tone: "positive" },
  compartment: { label: copy.exams.final.verdicts.compartment, tone: "caution" },
  detained: { label: copy.exams.final.verdicts.detained, tone: "critical" },
};

/**
 * The year's final results (chunk 7C, D16) — one lean surface for a year-end
 * act: compute the annual verdicts, then read them per class. The endpoint is
 * the year-wide compute itself (no read exists), so the verdicts arrive as the
 * compute's answer and are held in state; the weightage refusal prints
 * verbatim because it is an instruction, not an error to soften. Read-only
 * roles have no door here at all — without `exam:update` there is no way to
 * see verdicts, and the header row that leads here hides accordingly.
 */
export function FinalResultsScreen() {
  const scope = useExamScope();
  const names = useClassSubjectNames();
  const [picked, setPicked] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const compute = trpc.exam.results.computeFinal.useMutation({
    onSuccess: (rows) => {
      setVerdicts(new Map(rows.map((row) => [row.studentId, row.promotionStatus])));
      setBanner(copy.exams.final.computed(rows.length));
      setError(null);
    },
    onError: (cause) => {
      setError(errorMessage(cause));
      setBanner(null);
    },
  });

  const classIds = useMemo(
    () =>
      [...names.classes.data ?? []]
        .sort((a, b) => a.numericOrder - b.numericOrder || a.name.localeCompare(b.name))
        .map((row) => row.id),
    [names.classes.data],
  );
  const activeClass = picked && classIds.includes(picked) ? picked : (classIds[0] ?? null);

  const roster = trpc.enrollment.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      academicYearId: scope.academicYear?.id ?? "",
      classId: activeClass ?? undefined,
    },
    {
      enabled: scope.addressable && Boolean(activeClass),
      staleTime: 60_000,
    },
  );

  const chips: readonly Chip<string>[] = classIds.map((id) => ({
    value: id,
    label: names.className(id) ?? copy.exams.hub.classChipsLabel,
    testID: `final-class-${id}`,
  }));

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <ScreenFrame
      title={copy.exams.final.title}
      meta={scope.academicYear?.name ?? undefined}
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-final-back"
      titleTestID="exam-final-title"
    >
      {children}
      {footer}
    </ScreenFrame>
  );

  if (!scope.canUpdate) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="exam-final-denied"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      {banner ? (
        <Notice tone="positive" title={banner} icon="checkCircle" testID="exam-final-banner" />
      ) : null}
      {error ? (
        <Notice
          tone="critical"
          title={copy.exams.final.computeFailed}
          message={error}
          icon="info"
          testID="exam-final-error"
        />
      ) : null}

      {chips.length > 1 ? (
        <ChipRow
          label={copy.exams.hub.classChipsLabel}
          value={activeClass ?? ""}
          options={chips}
          onChange={setPicked}
        />
      ) : null}

      {roster.isPending && activeClass ? (
        <View style={styles.body} testID="exam-final-loading">
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : roster.isError ? (
        <EmptyState
          icon="exams"
          title={copy.exams.final.loadError}
          message={errorMessage(roster.error)}
          testID="exam-final-roster-error"
        />
      ) : (roster.data ?? []).length === 0 ? (
        <EmptyState
          icon="exams"
          title={copy.exams.final.emptyTitle}
          message={copy.exams.final.emptyBody}
          testID="exam-final-empty"
        />
      ) : (
        <View style={styles.rows}>
          {(roster.data ?? []).map((row) => {
            const verdict = verdicts?.get(row.student.id) ?? null;
            const pill = verdict ? VERDICT_PILL[verdict] ?? null : null;
            return (
              <View key={row.student.id} style={styles.row} testID={`final-row-${row.student.id}`}>
                <ThemedText variant="bodyStrong" style={styles.name} numberOfLines={1}>
                  {fullName(row.student)}
                </ThemedText>
                {pill ? (
                  <StatusPill label={pill.label} tone={pill.tone} />
                ) : (
                  <ThemedText variant="meta" color={colors.muted}>
                    {copy.exams.final.notComputed}
                  </ThemedText>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>,
    <CapsuleButton
      key="compute-final"
      title={compute.isPending ? copy.exams.final.computing : copy.exams.final.compute}
      onPress={() =>
        scope.academicYear &&
        compute.mutate({
          organizationId: scope.organizationId ?? "",
          ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
          academicYearId: scope.academicYear.id,
        })
      }
      loading={compute.isPending}
      disabled={compute.isPending}
      testID="exam-final-compute"
      style={styles.cta}
    />,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  name: {
    flex: 1,
  },
  cta: {
    alignSelf: "stretch",
    marginTop: spacing.md,
  },
});
