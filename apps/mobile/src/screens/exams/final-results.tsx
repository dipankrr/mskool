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
import { isoOf } from "../../lib/exam-results";
import { formatTimestampDate } from "../../lib/format";
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
 * The compute endpoint has no read (gap 28) — its response is the only place
 * the verdicts exist. This module-level cache keeps the last compute alive
 * across navigation, so coming back shows the verdicts instead of a roster of
 * "Not computed". Keyed by organization and year and always labelled with the
 * date it was taken; the real fix is a read endpoint.
 */
let lastCompute: {
  key: string;
  verdicts: ReadonlyMap<string, string>;
  computedAt: Date;
} | null = null;

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
      const map = new Map(rows.map((row) => [row.studentId, row.promotionStatus]));
      setVerdicts(map);
      if (scope.organizationId && scope.academicYear) {
        lastCompute = {
          key: `${scope.organizationId}:${scope.academicYear.id}`,
          verdicts: map,
          computedAt: new Date(),
        };
      }
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

  // Fresh verdicts win; otherwise the session's last compute for THIS
  // organization and year, shown with its date so it never reads as current.
  const cacheKey =
    scope.organizationId && scope.academicYear
      ? `${scope.organizationId}:${scope.academicYear.id}`
      : null;
  const cached = cacheKey && lastCompute?.key === cacheKey ? lastCompute : null;
  const shown = verdicts ?? cached?.verdicts ?? null;
  const showingCache = verdicts === null && cached !== null;

  // The year at a glance, counted for the CLASS ON SCREEN — the verdicts map
  // is year-wide, and a year total over a class list would read as a lie.
  const verdictCounts = useMemo(() => {
    if (!shown || !activeClass) return null;
    const rosterRows = roster.data ?? [];
    if (rosterRows.length === 0) return null;
    let promoted = 0;
    let compartment = 0;
    let detained = 0;
    for (const row of rosterRows) {
      const verdict = shown.get(row.student.id);
      if (verdict === "promoted") promoted += 1;
      else if (verdict === "compartment") compartment += 1;
      else if (verdict === "detained") detained += 1;
    }
    return { promoted, compartment, detained };
  }, [shown, activeClass, roster.data]);

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

      {showingCache && cached ? (
        <Notice
          tone="neutral"
          title={copy.exams.final.cachedOn(formatTimestampDate(isoOf(cached.computedAt)))}
          message={copy.exams.final.cachedBody}
          icon="info"
          testID="exam-final-cached"
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

      {verdictCounts &&
      verdictCounts.promoted + verdictCounts.compartment + verdictCounts.detained > 0 ? (
        <ThemedText variant="meta" color={colors.muted} testID="exam-final-counts">
          {[
            copy.exams.final.countPromoted(verdictCounts.promoted),
            verdictCounts.compartment > 0
              ? copy.exams.final.countCompartment(verdictCounts.compartment)
              : null,
            verdictCounts.detained > 0
              ? copy.exams.final.countDetained(verdictCounts.detained)
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </ThemedText>
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
            const verdict = shown?.get(row.student.id) ?? null;
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
      title={
        compute.isPending
          ? copy.exams.final.computing
          : shown
            ? copy.exams.final.recompute
            : copy.exams.final.compute
      }
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
