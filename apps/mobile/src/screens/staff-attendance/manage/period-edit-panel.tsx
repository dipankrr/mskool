import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext } from "../../../hooks/use-active-context";
import { usePermissions } from "../../../hooks/use-permissions";
import { copy } from "../../../lib/copy";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { useAttendanceSection } from "../use-attendance-section";
import { Field } from "./field";
import { ManageFrame } from "./frame";
import {
  initialPeriodForm,
  nextSequence,
  toPeriodPayload,
  validatePeriodForm,
} from "./period-form";
import type { PeriodForm } from "./period-form";
import { TimeField } from "./time-field";

/**
 * Create or edit one period (chunk 3, a pushed screen — not a sheet: the form
 * carries a keyboard, a native time dialog and a switch, and a full screen
 * keeps all three usable). The row is re-read by id so a deep link or a
 * reload edits the truth; a new row starts at the next free sequence with no
 * times, because a slot may legitimately exist before the timetable does.
 */
export function PeriodEditor() {
  const { has } = usePermissions();
  const canManage = has("attendance:update");
  const params = useLocalSearchParams<{
    sectionId?: string;
    periodId?: string;
  }>();
  const periodId =
    typeof params.periodId === "string" && params.periodId.length > 0
      ? params.periodId
      : null;
  const { organizationId, academicYear } = useActiveContext();
  const { section, sectionLabel } = useAttendanceSection(params.sectionId);
  const ready = Boolean(organizationId && academicYear && section);

  const listQuery = trpc.attendance.period.list.useQuery(
    { organizationId: organizationId ?? "", sectionId: section?.id ?? "" },
    { enabled: ready && canManage && periodId === null, staleTime: 60_000 },
  );
  const periodQuery = trpc.attendance.period.byId.useQuery(
    { organizationId: organizationId ?? "", id: periodId ?? "" },
    { enabled: ready && canManage && periodId !== null, staleTime: 60_000 },
  );

  const title = periodId
    ? copy.attendance.manage.periods.editorEdit
    : copy.attendance.manage.periods.editorNew;
  const meta = sectionLabel ?? section?.name ?? null;

  if (!canManage) {
    return (
      <ManageFrame title={title} meta={meta}>
        <EmptyState
          icon="clock"
          title={copy.attendance.manage.noAccessTitle}
          message={copy.attendance.manage.noAccessBody}
          testID="period-editor-no-access"
        />
      </ManageFrame>
    );
  }

  return (
    <ManageFrame title={title} meta={meta}>
      {!ready ? (
        <Card>
          <ThemedText variant="bodyStrong">
            {copy.session.noYearTitle}
          </ThemedText>
          <ThemedText variant="meta" style={styles.cardBody}>
            {copy.session.noYearBody}
          </ThemedText>
        </Card>
      ) : periodId !== null && periodQuery.isPending ? (
        <View style={styles.skeletonBlock}>
          <Skeleton height={76} style={styles.skeletonField} />
          <Skeleton height={76} style={styles.skeletonField} />
          <Skeleton height={48} style={styles.skeletonField} />
        </View>
      ) : periodId !== null && periodQuery.isError ? (
        <ErrorCard
          cause={periodQuery.error}
          onRetry={() => void periodQuery.refetch()}
          testID="period-load-error"
        />
      ) : periodId === null && listQuery.isPending ? (
        <View style={styles.skeletonBlock}>
          <Skeleton height={76} style={styles.skeletonField} />
          <Skeleton height={76} style={styles.skeletonField} />
        </View>
      ) : (
        <PeriodBody
          key={periodId ?? "new"}
          initial={
            periodId !== null
              ? initialPeriodForm(periodQuery.data ?? null, 1)
              : initialPeriodForm(
                  null,
                  nextSequence(
                    (listQuery.data ?? []).map((row) => row.sequenceNumber),
                  ),
                )
          }
          periodId={periodId}
          organizationId={organizationId ?? ""}
          academicYearId={academicYear?.id ?? ""}
          sectionId={section?.id ?? ""}
        />
      )}
    </ManageFrame>
  );
}

function PeriodBody({
  initial,
  periodId,
  organizationId,
  academicYearId,
  sectionId,
}: {
  initial: PeriodForm;
  periodId: string | null;
  organizationId: string;
  academicYearId: string;
  sectionId: string;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<PeriodForm>(initial);

  const create = trpc.attendance.period.create.useMutation({
    onSuccess: () => {
      void utils.attendance.period.invalidate();
      router.back();
    },
  });
  const update = trpc.attendance.period.update.useMutation({
    onSuccess: () => {
      void utils.attendance.period.invalidate();
      router.back();
    },
  });

  const errors = validatePeriodForm(form);
  const hasErrors = Boolean(errors.name || errors.sequence || errors.timeOrder);
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const updateForm = (patch: Partial<PeriodForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const submit = () => {
    if (hasErrors) return;
    const payload = toPeriodPayload(form);
    if (periodId !== null) {
      update.mutate({ organizationId, id: periodId, data: payload });
    } else {
      create.mutate({
        organizationId,
        sectionId,
        data: { academicYearId, ...payload },
      });
    }
  };

  return (
    <>
      <Field
        label={copy.attendance.manage.periods.name}
        value={form.name}
        onChangeText={(name) => updateForm({ name })}
        placeholder={copy.attendance.manage.periods.namePlaceholder}
        maxLength={50}
        error={errors.name}
        testID="period-name"
      />
      <Field
        label={copy.attendance.manage.periods.sequence}
        value={form.sequence}
        onChangeText={(sequence) => updateForm({ sequence })}
        keyboardType="number-pad"
        maxLength={2}
        help={copy.attendance.manage.periods.sequenceHelp}
        error={errors.sequence}
        testID="period-sequence"
      />
      <View style={styles.timesRow}>
        <TimeField
          label={copy.attendance.manage.periods.starts}
          value={form.start}
          onChange={(start) => updateForm({ start })}
          testID="period-start"
        />
        <TimeField
          label={copy.attendance.manage.periods.ends}
          value={form.end}
          onChange={(end) => updateForm({ end })}
          testID="period-end"
        />
      </View>
      {errors.timeOrder ? (
        <ThemedText
          variant="meta"
          color={colors.tone.critical.fg}
          style={styles.timeError}
        >
          {errors.timeOrder}
        </ThemedText>
      ) : null}
      <Pressable
        testID="period-homeroom"
        accessibilityRole="switch"
        accessibilityState={{ checked: form.isHomeroom }}
        accessibilityLabel={copy.attendance.manage.periods.homeroomLabel}
        accessibilityHint={copy.attendance.manage.periods.homeroomHelp}
        onPress={() => updateForm({ isHomeroom: !form.isHomeroom })}
        style={({ pressed }) => [
          styles.toggle,
          pressed ? styles.togglePressed : null,
        ]}
      >
        <View style={styles.toggleText}>
          <ThemedText variant="bodyStrong">
            {copy.attendance.manage.periods.homeroomLabel}
          </ThemedText>
          <ThemedText variant="meta" style={styles.toggleHelp}>
            {copy.attendance.manage.periods.homeroomHelp}
          </ThemedText>
        </View>
        {form.isHomeroom ? (
          <AppIcon name="checkCircle" size={24} color={colors.accent} />
        ) : (
          <View style={styles.ring} />
        )}
      </Pressable>
      {error ? (
        <ErrorCard
          cause={error}
          style={styles.error}
          testID="period-save-error"
        />
      ) : null}
      <CapsuleButton
        title={
          pending ? copy.common.saving : copy.attendance.manage.periods.save
        }
        loading={pending}
        disabled={hasErrors}
        onPress={submit}
        testID="period-save"
        style={styles.save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  cardBody: {
    marginTop: spacing.xs,
  },
  timesRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  timeError: {
    marginTop: spacing.xs,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  togglePressed: {
    backgroundColor: colors.field,
  },
  toggleText: {
    flex: 1,
    gap: spacing.xxs,
  },
  toggleHelp: {
    lineHeight: 18,
  },
  ring: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.chevron,
  },
  error: {
    marginTop: spacing.lg,
  },
  save: {
    marginTop: spacing.lg,
    alignSelf: "stretch",
    marginBottom: spacing.lg,
  },
  skeletonBlock: {
    gap: spacing.md,
  },
  skeletonField: {
    borderRadius: radius.sm,
  },
});
