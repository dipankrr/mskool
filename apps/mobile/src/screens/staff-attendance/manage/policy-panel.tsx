import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { SectionLabel } from "../../../components/section-label";
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
  initialPolicyForm,
  toPolicyPayload,
  validatePolicyForm,
} from "./policy-form";
import type {
  DailyStatusRule,
  MarkingMode,
  PolicyForm,
} from "./policy-form";

/**
 * The marking policy (chunk 3): mode, the period-wise day rule and threshold,
 * and the late window — the school's one row, defaults named honestly when it
 * does not exist yet. Switching to period-wise surfaces the real consequence:
 * a section with no periods cannot mark period-wise, so the screen offers the
 * fix instead of letting the first morning discover it.
 */
export function ManagePolicy() {
  const { has } = usePermissions();
  const canManage = has("attendance:update");
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const { section, sectionLabel } = useAttendanceSection(params.sectionId);
  const ready = Boolean(organizationId && schoolId && academicYear);
  const meta = academicYear ? academicYear.name : null;
  const contextKey = `${organizationId ?? ""}:${schoolId ?? ""}:${section?.id ?? ""}`;
  // Survives the policy query invalidation that follows a save. The body is
  // keyed by updatedAt, so its local success state would otherwise be lost
  // when the refetched row remounts it.
  const [savedContext, setSavedContext] = useState<string | null>(null);
  const saved = savedContext === contextKey;

  const policyQuery = trpc.attendance.policy.get.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: ready && canManage, staleTime: 60_000 },
  );

  if (!canManage) {
    return (
      <ManageFrame title={copy.attendance.manage.rows.policy} meta={meta}>
        <EmptyState
          icon="students"
          title={copy.attendance.manage.noAccessTitle}
          message={copy.attendance.manage.noAccessBody}
          testID="policy-no-access"
        />
      </ManageFrame>
    );
  }

  return (
    <ManageFrame title={copy.attendance.manage.rows.policy} meta={meta}>
      {!ready ? (
        <Card>
          <ThemedText variant="bodyStrong">
            {copy.session.noYearTitle}
          </ThemedText>
          <ThemedText variant="meta" style={styles.cardBody}>
            {copy.session.noYearBody}
          </ThemedText>
        </Card>
      ) : policyQuery.isPending ? (
        <View style={styles.skeletonBlock}>
          <Skeleton height={116} style={styles.skeletonCard} />
          <Skeleton height={52} style={styles.skeletonField} />
          <Skeleton height={52} style={styles.skeletonField} />
        </View>
      ) : policyQuery.isError ? (
        <ErrorCard
          cause={policyQuery.error}
          onRetry={() => void policyQuery.refetch()}
          testID="policy-load-error"
        />
      ) : (
        <PolicyBody
          key={`${policyQuery.data?.updatedAt ?? "unset"}`}
          initial={policyQuery.data ?? null}
          organizationId={organizationId ?? ""}
          schoolId={schoolId ?? ""}
          sectionId={section?.id ?? null}
          sectionName={sectionLabel ?? section?.name ?? null}
          saved={saved}
          onSaved={() => setSavedContext(contextKey)}
          onEdited={() => setSavedContext(null)}
        />
      )}
    </ManageFrame>
  );
}

function PolicyBody({
  initial,
  organizationId,
  schoolId,
  sectionId,
  sectionName,
  saved,
  onSaved,
  onEdited,
}: {
  initial: {
    markingMode: string;
    dailyStatusRule: string;
    thresholdPercentage: number | null;
    lateArrivalMinutes: number;
  } | null;
  organizationId: string;
  schoolId: string;
  sectionId: string | null;
  sectionName: string | null;
  saved: boolean;
  onSaved: () => void;
  onEdited: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<PolicyForm>(() => initialPolicyForm(initial));

  const periodsQuery = trpc.attendance.period.list.useQuery(
    { organizationId, sectionId: sectionId ?? "" },
    {
      enabled: sectionId !== null && form.mode === "period_wise",
      staleTime: 60_000,
    },
  );

  const upsert = trpc.attendance.policy.upsert.useMutation({
    onSuccess: () => {
      onSaved();
      void utils.attendance.policy.get.invalidate();
    },
  });

  const errors = validatePolicyForm(form);
  const hasErrors = Boolean(errors.threshold || errors.late);

  const update = (patch: Partial<PolicyForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    onEdited();
  };

  const submit = () => {
    if (hasErrors) return;
    upsert.mutate({
      organizationId,
      schoolId,
      data: toPolicyPayload(form),
    });
  };

  const showCaution =
    form.mode === "period_wise" &&
    sectionId !== null &&
    periodsQuery.data !== undefined &&
    periodsQuery.data.length === 0;

  return (
    <>
      {initial === null ? (
        <Card>
          <ThemedText variant="bodyStrong">
            {copy.attendance.manage.policy.unsetTitle}
          </ThemedText>
          <ThemedText variant="meta" style={styles.noticeBody}>
            {copy.attendance.manage.policy.unsetBody}
          </ThemedText>
        </Card>
      ) : null}

      <View style={styles.group}>
        <SectionLabel>{copy.attendance.manage.policy.modeLabel}</SectionLabel>
        <Segments<MarkingMode>
          value={form.mode}
          options={[
            { value: "daily", label: copy.attendance.manage.policy.modeDaily },
            {
              value: "period_wise",
              label: copy.attendance.manage.policy.modePeriod,
            },
          ]}
          onChange={(mode) => update({ mode })}
          testPrefix="policy-mode"
        />
        <ThemedText variant="meta" style={styles.help}>
          {copy.attendance.manage.policy.modeHelp}
        </ThemedText>
      </View>

      {form.mode === "period_wise" ? (
        <View style={styles.group}>
          <SectionLabel>{copy.attendance.manage.policy.ruleLabel}</SectionLabel>
          <Segments<DailyStatusRule>
            value={form.rule}
            options={[
              {
                value: "homeroom_authoritative",
                label: copy.attendance.manage.policy.ruleHomeroom,
              },
              {
                value: "threshold_percentage",
                label: copy.attendance.manage.policy.ruleThreshold,
              },
            ]}
            onChange={(rule) => update({ rule })}
            testPrefix="policy-rule"
          />
          <ThemedText variant="meta" style={styles.help}>
            {copy.attendance.manage.policy.ruleHelp}
          </ThemedText>
          {form.rule === "threshold_percentage" ? (
            <Field
              label={copy.attendance.manage.policy.thresholdLabel}
              value={form.threshold}
              onChangeText={(threshold) => update({ threshold })}
              keyboardType="number-pad"
              maxLength={3}
              suffix="%"
              help={copy.attendance.manage.policy.thresholdHelp}
              error={errors.threshold}
              testID="policy-threshold"
            />
          ) : null}
          {showCaution ? (
            <Card style={styles.caution}>
              <View style={styles.cautionRow}>
                <AppIcon
                  name="calendarOff"
                  size={18}
                  color={colors.tone.caution.fg}
                />
                <ThemedText variant="meta" style={styles.cautionText}>
                  {copy.attendance.manage.policy.caution(sectionName ?? "")}
                </ThemedText>
              </View>
              <CapsuleButton
                title={copy.attendance.manage.policy.cautionAction}
                variant="secondary"
                size="compact"
                onPress={() =>
                  sectionId
                    ? router.push({
                        pathname: "/attendance/manage/periods",
                        params: { sectionId },
                      })
                    : undefined
                }
                testID="policy-caution-action"
                style={styles.cautionAction}
              />
            </Card>
          ) : null}
        </View>
      ) : null}

      <View style={styles.group}>
        <Field
          label={copy.attendance.manage.policy.lateLabel}
          value={form.late}
          onChangeText={(late) => update({ late })}
          keyboardType="number-pad"
          maxLength={3}
          suffix={copy.attendance.manage.policy.minutesSuffix}
          help={copy.attendance.manage.policy.lateHelp}
          error={errors.late}
          testID="policy-late"
        />
      </View>

      {upsert.error ? (
        <ErrorCard
          cause={upsert.error}
          style={styles.error}
          testID="policy-save-error"
        />
      ) : null}

      {saved && !upsert.isPending ? (
        <View
          testID="policy-saved"
          accessibilityLiveRegion="polite"
          style={styles.savedBar}
        >
          <AppIcon name="check" size={18} color={colors.onAccent} />
          <ThemedText variant="bodyStrong" color={colors.onAccent}>
            {copy.attendance.manage.policy.saved}
          </ThemedText>
        </View>
      ) : (
        <CapsuleButton
          title={
            upsert.isPending
              ? copy.common.saving
              : copy.attendance.manage.policy.save
          }
          loading={upsert.isPending}
          disabled={hasErrors}
          onPress={submit}
          testID="policy-save"
          style={styles.save}
        />
      )}
    </>
  );
}

/** The two-option segmented control (chunk 2's ViewToggle anatomy, reused). */
function Segments<T extends string>({
  value,
  options,
  onChange,
  testPrefix,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  testPrefix: string;
}) {
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={`${testPrefix}-${option.value}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected ? styles.segmentOn : null]}
          >
            <ThemedText
              variant="bodyStrong"
              color={selected ? colors.accentDeep : colors.muted}
            >
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  cardBody: {
    marginTop: spacing.xs,
  },
  noticeBody: {
    marginTop: spacing.xs,
  },
  group: {
    marginTop: spacing.lg,
  },
  help: {
    marginTop: spacing.xs,
  },
  bar: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  segmentOn: {
    backgroundColor: colors.surface,
  },
  caution: {
    marginTop: spacing.md,
    backgroundColor: colors.tone.caution.bg,
  },
  cautionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  cautionText: {
    flex: 1,
  },
  cautionAction: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
  },
  error: {
    marginTop: spacing.lg,
  },
  save: {
    marginTop: spacing.lg,
    alignSelf: "stretch",
  },
  savedBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 54,
    marginTop: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  skeletonBlock: {
    gap: spacing.md,
  },
  skeletonCard: {
    borderRadius: radius.lg,
  },
  skeletonField: {
    borderRadius: radius.sm,
  },
});
