import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { trpc } from "../../lib/trpc";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { isoOf } from "../../lib/exam-results";
import { fullName } from "../../lib/exams";
import { colors } from "../../theme/brand-admin";
import type { Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { formatTimestampDate } from "../../lib/format";
import { useEligibilityActions } from "./use-setup";
import { useExamDetail, useExamScope } from "./use-exam-data";

type EligibilityRow = {
  studentId: string;
  isEligible: boolean;
  isOverridden: boolean;
  overrideEligible: boolean | null;
  overrideReason: string | null;
  overriddenAt: string | Date | null;
};

/**
 * The advisory attendance bar (chunk 7D, D5/D20): one screen where the
 * office rechecks the cohort and records its exceptions. Nothing here
 * blocks a student from sitting the exam — the screen's only power is a
 * recorded decision with a name on it, which is why the override demands a
 * reason and "Allow all" stamps one reason across the list.
 */
export function EligibilityScreen() {
  const { examId = "" } = useLocalSearchParams<{ examId: string }>();
  const scope = useExamScope();
  const detail = useExamDetail(examId);
  const actions = useEligibilityActions(examId);

  const list = trpc.exam.eligibility.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      examId,
    },
    {
      enabled: scope.ready && Boolean(scope.organizationId) && Boolean(examId),
      staleTime: 30_000,
    },
  );

  const classIds = useMemo(
    () =>
      [
        ...new Set(
          (detail.data?.schedules ?? []).map((schedule) => schedule.classId),
        ),
      ],
    [detail.data],
  );
  const rosters = trpc.useQueries((t) =>
    classIds.map((classId) =>
      t.enrollment.list({
        organizationId: scope.organizationId ?? "",
        ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
        academicYearId: scope.academicYear?.id ?? "",
        classId,
      }),
    ),
  );
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    classIds.forEach((classId, index) => {
      for (const row of rosters[index]?.data ?? []) {
        map.set(row.student.id, fullName(row.student));
      }
    });
    return map;
  }, [classIds, rosters]);

  const [overrideSheet, setOverrideSheet] = useState<{
    studentId: string;
    name: string;
    allow: boolean;
  } | null>(null);
  const [allowAll, setAllowAll] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => (list.data ?? []) as EligibilityRow[],
    [list.data],
  );
  const below = rows.filter((row) => !row.isEligible);

  const grouped = useMemo(
    () => ({
      allowed: rows.filter(
        (row) => row.isEligible || (row.isOverridden && row.overrideEligible),
      ),
      below: below.filter(
        (row) => !(row.isOverridden && row.overrideEligible),
      ),
    }),
    [rows, below],
  );

  const openOverride = (row: EligibilityRow, allow: boolean) => {
    setBanner(null);
    setProblem(null);
    setReason("");
    setOverrideSheet({
      studentId: row.studentId,
      name: nameOf.get(row.studentId) ?? copy.exams.hub.classChipsLabel,
      allow,
    });
  };

  const applyOverride = (studentIds: readonly string[], allow: boolean) => {
    if (reason.trim().length < 3) {
      setProblem(copy.exams.eligibility.reasonShort);
      return;
    }
    setProblem(null);
    void Promise.all(
      studentIds.map((studentId) =>
        actions.override({
          studentId,
          overrideEligible: allow,
          reason: reason.trim(),
        }),
      ),
    )
      .then(() => {
        setOverrideSheet(null);
        setAllowAll(false);
        setBanner(copy.exams.eligibility.allowed(studentIds.length));
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.eligibility.title}
      meta={detail.data?.exam.name ?? undefined}
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-eligibility-back"
      titleTestID="exam-eligibility-title"
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canUpdate) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="exam-eligibility-denied"
      />,
    );
  }

  if (!scope.ready || list.isPending) {
    return frame(
      <View style={styles.body} testID="exam-eligibility-loading">
        <Skeleton height={64} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>,
    );
  }

  if (list.isError) {
    return frame(
      <Notice
        tone="critical"
        title={copy.exams.eligibility.loadError}
        message={errorMessage(list.error)}
        icon="info"
        testID="exam-eligibility-error"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      {banner ? (
        <Notice tone="positive" title={banner} icon="checkCircle" testID="exam-eligibility-banner" />
      ) : null}
      {error ? (
        <Notice
          tone="critical"
          title={copy.exams.eligibility.failed}
          message={error}
          icon="info"
          testID="exam-eligibility-error"
        />
      ) : null}

      <CapsuleButton
        title={actions.pending ? copy.exams.eligibility.recomputing : copy.exams.eligibility.recompute}
        variant="secondary"
        onPress={() => {
          setBanner(null);
          setError(null);
          void actions
            .recompute()
            .then((result) => {
              setBanner(
                copy.exams.eligibility.recomputed(result?.length ?? 0),
              );
            })
            .catch((cause: unknown) => setError(errorMessage(cause)));
        }}
        loading={actions.pending}
        disabled={actions.pending}
        testID="exam-eligibility-recompute"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="exams"
          title={copy.exams.eligibility.emptyTitle}
          message={copy.exams.eligibility.emptyBody}
          testID="exam-eligibility-empty"
        />
      ) : (
        <>
          {grouped.below.length > 0 ? (
            <EligibilityGroup
              label={`${copy.exams.eligibility.belowBar} · ${grouped.below.length}`}
              rows={grouped.below}
              nameOf={nameOf}
              onAllow={(row) => openOverride(row, true)}
              testPrefix="below"
            />
          ) : null}
          {grouped.allowed.length > 0 ? (
            <EligibilityGroup
              label={`${copy.exams.eligibility.eligible} · ${grouped.allowed.length}`}
              rows={grouped.allowed}
              nameOf={nameOf}
              onAllow={(row) =>
                row.isOverridden && row.overrideEligible
                  ? openOverride(row, false)
                  : undefined
              }
              testPrefix="allowed"
            />
          ) : null}
          {grouped.below.length > 0 ? (
            <CapsuleButton
              title={copy.exams.eligibility.allowAll}
              variant="secondary"
              onPress={() => {
                setReason("");
                setProblem(null);
                setAllowAll(true);
              }}
              testID="exam-eligibility-allow-all"
            />
          ) : null}
        </>
      )}

      {overrideSheet || allowAll ? (
        <FormSheetOverride
          title={
            allowAll
              ? copy.exams.eligibility.allowAllTitle
              : copy.exams.eligibility.allowTitle(overrideSheet!.name)
          }
          body={
            allowAll
              ? copy.exams.eligibility.allowAllBody(grouped.below.length)
              : copy.exams.eligibility.allowBody
          }
          reason={reason}
          onReason={setReason}
          problem={problem}
          pending={actions.pending}
          confirmLabel={
            overrideSheet && !overrideSheet.allow
              ? copy.exams.eligibility.rescind
              : copy.exams.eligibility.allow
          }
          onConfirm={() =>
            applyOverride(
              allowAll ? grouped.below.map((row) => row.studentId) : [overrideSheet!.studentId],
              overrideSheet ? overrideSheet.allow : true,
            )
          }
          onClose={() => {
            setOverrideSheet(null);
            setAllowAll(false);
          }}
        />
      ) : null}
    </View>,
  );
}

function EligibilityGroup({
  label,
  rows,
  nameOf,
  onAllow,
  testPrefix,
}: {
  label: string;
  rows: readonly EligibilityRow[];
  nameOf: ReadonlyMap<string, string>;
  onAllow: (row: EligibilityRow) => void;
  testPrefix: string;
}) {
  return (
    <View>
      <ThemedText variant="meta" color={colors.muted} style={styles.groupLabel}>
        {label}
      </ThemedText>
      <Card padless>
        {rows.map((row, index) => {
          const name = nameOf.get(row.studentId) ?? row.studentId;
          const overridden = row.isOverridden && row.overrideEligible;
          const pill: { label: string; tone: Tone } = overridden
            ? { label: copy.exams.eligibility.allowedPill, tone: "positive" }
            : row.isEligible
              ? { label: copy.exams.eligibility.eligible, tone: "positive" }
              : { label: copy.exams.eligibility.belowBar, tone: "caution" };
          return (
            <Pressable
              key={row.studentId}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${pill.label}`}
              accessibilityHint={overridden ? copy.exams.eligibility.rescind : copy.exams.eligibility.allow}
              onPress={() => onAllow(row)}
              style={({ pressed }) => [
                styles.row,
                index === 0 ? styles.rowFirst : null,
                pressed ? styles.rowPressed : null,
              ]}
              testID={`exam-eligibility-${testPrefix}-${row.studentId}`}
            >
              <View style={styles.nameBlock}>
                <ThemedText variant="bodyStrong" numberOfLines={1}>
                  {name}
                </ThemedText>
                {row.isOverridden && row.overrideReason ? (
                  <ThemedText variant="meta" color={colors.muted} numberOfLines={1}>
                    {`${row.overrideReason} · ${formatTimestampDate(isoOf(row.overriddenAt))}`}
                  </ThemedText>
                ) : null}
              </View>
              {overridden ? (
                <StatusPill label={pill.label} tone={pill.tone} />
              ) : (
                <ThemedText variant="meta" color={colors.accentDeep}>
                  {row.isEligible ? "" : copy.exams.eligibility.allow}
                </ThemedText>
              )}
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}

function FormSheetOverride({
  title,
  body,
  reason,
  onReason,
  problem,
  pending,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  reason: string;
  onReason: (next: string) => void;
  problem: string | null;
  pending: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <FormSheet
      title={title}
      onClose={onClose}
      testIDPrefix="exam-eligibility"
      footer={
        <>
          <CapsuleButton
            title={pending ? copy.exams.eligibility.recomputing : confirmLabel}
            onPress={onConfirm}
            loading={pending}
            disabled={pending}
            testID="exam-eligibility-confirm"
          />
          <CapsuleButton
            title={copy.exams.publication.publishKeep}
            variant="secondary"
            size="compact"
            onPress={onClose}
            disabled={pending}
            testID="exam-eligibility-keep"
          />
        </>
      }
    >
      <ThemedText variant="body">{body}</ThemedText>
      <FormField
        label={copy.exams.eligibility.reasonLabel}
        value={reason}
        onChangeText={onReason}
        placeholder={copy.exams.eligibility.reasonPlaceholder}
        multiline
        numberOfLines={2}
        testID="exam-eligibility-reason"
      />
      {problem ? (
        <ThemedText variant="meta" color={colors.tone.critical.fg}>
          {problem}
        </ThemedText>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  groupLabel: {
    marginBottom: spacing.xs,
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowFirst: {
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  nameBlock: {
    flex: 1,
    gap: spacing.xxs,
  },
});
