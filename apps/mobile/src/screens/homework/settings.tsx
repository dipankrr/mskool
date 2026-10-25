import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { LinkRow } from "../../components/link-row";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { errorMessage, toFriendlyError } from "../../lib/errors";
import { SELECTABLE_SUBMISSION_TYPES } from "../../lib/homework";
import type { SubmissionType } from "../../lib/homework";
import {
  checkSettingsDraft,
  effectiveFromRow,
  settingsDraftFrom,
  settingsFingerprint,
  settingsPayload,
} from "../../lib/homework-settings";
import type { SettingsDraft } from "../../lib/homework-settings";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import { CheckPills } from "./check-pills";
import type { CheckPillOption } from "./check-pills";
import { ConfirmSheet } from "./confirm-sheet";
import { SegmentBar } from "./segments";
import type { SegmentOption } from "./segments";
import type { EffectiveSettings } from "./types";

const LATE_POLICY_OPTIONS: readonly SegmentOption<"allowed" | "not_allowed">[] = [
  {
    value: "allowed",
    label: copy.homework.settings.lateAllowed,
    testID: "homework-settings-late-allowed",
  },
  {
    value: "not_allowed",
    label: copy.homework.settings.lateBlocked,
    testID: "homework-settings-late-blocked",
  },
];

/**
 * The homework rules the branch lives by.
 *
 * A class override is a WHOLE row on the server, not a field patch: the class
 * row wins entirely over the school default. The form therefore always carries
 * every editable field, and Save writes the complete row even when the teacher
 * changed one switch. Sending only the changed fields would leave the untouched
 * ones at platform defaults instead of the school's values.
 *
 * File limits are shown as a fact, not a control: this build has no upload
 * path, so those columns ride along unchanged. The same honesty applies to a
 * legacy `file` submission type — it stays visible (and removable) rather than
 * disappearing from a policy the school already saved.
 *
 * A reader without `school_settings:update` sees the same screen with inert
 * controls and a "Viewing only" note; the gear on the homework tab is gated on
 * the read permission, so the two stay consistent.
 */
export function HomeworkSettingsScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("school_settings:read");
  const canWrite = has("school_settings:update");
  const canReadClasses = has("class:read");
  const canReadHomework = has("homework:read");

  const [target, setTarget] = useState<string | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [pendingTarget, setPendingTarget] = useState<
    { id: string | null } | null
  >(null);

  /**
   * The school default is readable but not writable through this build's API:
   * the upsert endpoint requires a class id, while the transport's scope parser
   * rejects a null one. The screen tells that truth instead of offering a Save
   * that can only fail. Class overrides are fully editable.
   */
  const isSchoolDefault = target === null;
  const editable = canWrite && !isSchoolDefault;

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    {
      enabled:
        ready && canRead && canReadClasses && Boolean(organizationId && schoolId),
    },
  );

  const scopeInput = useMemo(
    () => ({
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      ...(target ? { classId: target } : {}),
    }),
    [organizationId, schoolId, target],
  );

  const query = trpc.homework.settings.get.useQuery(scopeInput, {
    enabled: ready && canRead && Boolean(organizationId && schoolId),
  });

  const utils = trpc.useUtils();
  const save = trpc.homework.settings.upsert.useMutation({
    onSuccess: (row, variables) => {
      const next = effectiveFromRow(row);
      // The saved row belongs to the class named in the call, not to whichever
      // target the screen happens to show when the response lands.
      utils.homework.settings.get.setData(
        {
          organizationId: variables.organizationId,
          ...(variables.schoolId ? { schoolId: variables.schoolId } : {}),
          classId: variables.classId,
        },
        next,
      );
      setDraft(null);
      setTouched(false);
      setSaveError(null);
      setSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => {
      setSaved(false);
      setSaveError(error);
    },
  });

  const server: EffectiveSettings | null = query.data ?? null;
  const effective = draft ?? (server ? settingsDraftFrom(server) : null);
  const check = effective ? checkSettingsDraft(effective) : null;

  const dirty = Boolean(
    server &&
      draft &&
      settingsFingerprint(draft) !== settingsFingerprint(settingsDraftFrom(server)),
  );

  useUnsavedChanges(editable && dirty);

  const update = (patch: Partial<SettingsDraft>) => {
    if (!effective || !editable) return;
    setDraft({ ...effective, ...patch });
    setTouched(false);
    setSaved(false);
    setSaveError(null);
  };

  const applyTarget = (next: string | null) => {
    setTarget(next);
    setDraft(null);
    setTouched(false);
    setSaved(false);
    setSaveError(null);
    setPendingTarget(null);
    save.reset();
  };

  const chooseTarget = (next: string | null) => {
    if (next === target) return;
    if (dirty && editable) {
      setPendingTarget({ id: next });
      return;
    }
    applyTarget(next);
  };

  const targetOptions = useMemo(
    () => [
      { id: "", label: copy.homework.settings.targetSchool },
      ...(classes.data ?? []).map((row) => ({ id: row.id, label: row.name })),
    ],
    [classes.data],
  );

  const classLabel =
    targetOptions.find((option) => option.id === (target ?? ""))?.label ?? null;

  const typeOptions = useMemo<CheckPillOption<SubmissionType>[]>(() => {
    const selected = effective?.allowedSubmissionTypes ?? [];
    const legacy = selected.filter(
      (type) => !(SELECTABLE_SUBMISSION_TYPES as readonly string[]).includes(type),
    );
    const types = [...SELECTABLE_SUBMISSION_TYPES, ...legacy];
    return types.map((type) => ({
      value: type,
      label: copy.homework.submissions[type],
      note:
        type === "file"
          ? copy.homework.settings.legacyFileNote
          : copy.homework.submissionHelp[type],
      disabled: !editable,
    }));
  }, [effective?.allowedSubmissionTypes, editable]);

  const toggleType = (next: SubmissionType) => {
    if (!effective) return;
    const selected = effective.allowedSubmissionTypes;
    update({
      allowedSubmissionTypes: selected.includes(next)
        ? selected.filter((type) => type !== next)
        : [...selected, next],
    });
  };

  const firstError = check
    ? (check.errors.submissionTypes ??
      check.errors.lateWindow ??
      check.errors.maxPerDay ??
      null)
    : null;

  const submit = () => {
    if (!effective || !server || !target) return;
    setTouched(true);
    setSaved(false);
    if (!checkSettingsDraft(effective).valid) return;
    setSaveError(null);
    save.mutate({
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      classId: target,
      ...settingsPayload(effective, server),
    });
  };

  const frame = (children: React.ReactNode, footer?: React.ReactNode) => (
    <ScreenFrame
      title={copy.homework.settings.title}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-settings-back"
      titleTestID="homework-settings-title"
      footer={footer}
      onRefresh={canRead ? () => void query.refetch() : undefined}
      refreshing={query.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.homework.settings.noAccessTitle}
        message={copy.homework.settings.noAccessBody}
        testID="homework-settings-denied"
      />,
    );
  }

  if (!ready || !organizationId || !schoolId) {
    return ready ? (
      frame(
        <EmptyState
          icon="school"
          title={copy.homework.settings.noBranchTitle}
          message={copy.homework.settings.noBranchBody}
          testID="homework-settings-no-branch"
        />,
      )
    ) : (
      frame(
        <View style={styles.skeleton}>
          <Skeleton height={96} />
          <Skeleton height={240} />
        </View>,
      )
    );
  }

  if (query.isPending) {
    return frame(
      <View
        style={styles.skeleton}
        accessibilityLabel={copy.homework.settings.title}
        accessibilityLiveRegion="polite"
      >
        <Skeleton height={96} />
        <Skeleton height={240} />
        <Skeleton height={160} />
      </View>,
    );
  }

  if (query.isError) {
    const friendly = toFriendlyError(query.error);
    if (friendly.kind === "forbidden" || friendly.kind === "notFound") {
      return frame(
        <EmptyState
          icon="shield"
          title={copy.homework.settings.noAccessTitle}
          message={copy.homework.settings.noAccessBody}
          testID="homework-settings-forbidden"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={query.error}
        onRetry={() => void query.refetch()}
        testID="homework-settings-error"
      />,
    );
  }

  if (!effective || !server) {
    return frame(
      <EmptyState
        icon="settings"
        title={copy.homework.settings.loadError}
        message={copy.errors.server}
        testID="homework-settings-empty"
      >
        <CapsuleButton
          title={copy.common.retry}
          variant="secondary"
          size="compact"
          onPress={() => void query.refetch()}
          testID="homework-settings-retry"
        />
      </EmptyState>,
    );
  }

  const footer = editable ? (
    <>
      {saveError ? (
        <Notice
          tone="critical"
          title={copy.homework.settings.saveError}
          message={errorMessage(saveError)}
          style={styles.footerNotice}
          testID="homework-settings-save-error"
        />
      ) : null}
      {touched && firstError ? (
        <Notice
          tone="caution"
          title={copy.homework.settings.checkTitle}
          message={firstError}
          style={styles.footerNotice}
          testID="homework-settings-check"
        />
      ) : null}
      <CapsuleButton
        title={
          save.isPending
            ? copy.homework.settings.saving
            : copy.homework.settings.save
        }
        icon="check"
        onPress={submit}
        loading={save.isPending}
        disabled={save.isPending}
        testID="homework-settings-save"
      />
    </>
  ) : undefined;

  return (
    <>
      {frame(
        <View style={styles.body}>
          {saved ? (
            <Notice
              tone="positive"
              title={copy.homework.settings.savedTitle}
              message={copy.homework.settings.savedBody}
              testID="homework-settings-saved"
            />
          ) : null}

          {!canWrite ? (
            <Notice
              tone="neutral"
              title={copy.homework.settings.viewerTitle}
              message={copy.homework.settings.viewerBody}
              testID="homework-settings-viewer"
            />
          ) : null}

          <Notice
            tone="neutral"
            message={copy.homework.settings.intro}
            testID="homework-settings-intro"
          />

          <SectionLabel>{copy.homework.settings.target}</SectionLabel>
          <Card>
            <SelectField
              label={copy.homework.settings.target}
              valueLabel={classLabel}
              placeholder={copy.homework.settings.targetSchool}
              options={targetOptions}
              currentId={target ?? ""}
              onSelect={(id) => chooseTarget(id.length > 0 ? id : null)}
              help={
                !canReadClasses
                  ? copy.homework.settings.noClasses
                  : target
                    ? copy.homework.settings.targetHelpClass
                    : copy.homework.settings.targetHelp
              }
              disabled={!canReadClasses || save.isPending}
              testID="homework-settings-target"
            />
            {classes.isError && canReadClasses ? (
              <>
                <Notice
                  tone="critical"
                  message={copy.homework.settings.classesError}
                  style={styles.retryNotice}
                  testID="homework-settings-classes-error"
                />
                <CapsuleButton
                  title={copy.common.retry}
                  variant="secondary"
                  size="compact"
                  onPress={() => void classes.refetch()}
                  testID="homework-settings-classes-retry"
                />
              </>
            ) : null}
          </Card>

          {isSchoolDefault && canWrite ? (
            <Notice
              tone="neutral"
              title={copy.homework.settings.schoolDefaultTitle}
              message={copy.homework.settings.schoolDefaultBody}
              testID="homework-settings-school-default"
            />
          ) : null}

          <SectionLabel>{copy.homework.settings.submissionSection}</SectionLabel>
          <Card>
            <CheckPills<SubmissionType>
              label={copy.homework.settings.submissionTypes}
              values={effective.allowedSubmissionTypes}
              options={typeOptions}
              onToggle={toggleType}
              help={copy.homework.settings.submissionTypesHelp}
              error={
                touched ? check?.errors.submissionTypes : undefined
              }
              testIDPrefix="homework-settings-type"
            />
            <ThemedText variant="meta" style={styles.fileNote}>
              {copy.homework.settings.fileNote}
            </ThemedText>
            <View style={styles.switches}>
              <SwitchRow
                label={copy.homework.settings.studentsCanSubmit}
                value={effective.studentsCanSubmit}
                onChange={(next) => update({ studentsCanSubmit: next })}
                help={copy.homework.settings.studentsCanSubmitHelp}
                disabled={!editable}
                testID="homework-settings-students-submit"
              />
              <SwitchRow
                label={copy.homework.settings.parentsCanSubmit}
                value={effective.parentsCanSubmit}
                onChange={(next) => update({ parentsCanSubmit: next })}
                help={copy.homework.settings.parentsCanSubmitHelp}
                disabled={!editable}
                testID="homework-settings-parents-submit"
              />
            </View>
          </Card>

          <SectionLabel>{copy.homework.settings.lateSection}</SectionLabel>
          <Card>
            <ThemedText variant="caption" style={styles.label}>
              {copy.homework.settings.latePolicy}
            </ThemedText>
            <SegmentBar
              label={copy.homework.settings.latePolicy}
              value={effective.defaultLatePolicy}
              options={LATE_POLICY_OPTIONS}
              onChange={(next) => update({ defaultLatePolicy: next })}
              disabled={!editable}
            />
            <FormField
              label={copy.homework.settings.lateWindow}
              value={effective.defaultLateWindowHours}
              onChangeText={(next) => update({ defaultLateWindowHours: next })}
              keyboardType="number-pad"
              suffix={copy.homework.settings.lateWindowSuffix}
              help={
                effective.defaultLatePolicy === "allowed"
                  ? copy.homework.settings.lateWindowHelp
                  : copy.homework.settings.lateWindowOffHelp
              }
              error={touched ? check?.errors.lateWindow : undefined}
              editable={editable}
              testID="homework-settings-late-window"
            />
          </Card>

          <SectionLabel>{copy.homework.settings.limitsSection}</SectionLabel>
          <Card>
            <FormField
              label={copy.homework.settings.maxPerDay}
              value={effective.maxAssignmentsPerDay}
              onChangeText={(next) => update({ maxAssignmentsPerDay: next })}
              keyboardType="number-pad"
              placeholder={copy.homework.settings.maxPerDayPlaceholder}
              help={copy.homework.settings.maxPerDayHelp}
              error={touched ? check?.errors.maxPerDay : undefined}
              editable={editable}
              testID="homework-settings-max-per-day"
            />
            <View style={styles.switches}>
              <SwitchRow
                label={copy.homework.settings.allowWeekend}
                value={effective.allowWeekendAssignments}
                onChange={(next) => update({ allowWeekendAssignments: next })}
                help={copy.homework.settings.allowWeekendHelp}
                disabled={!editable}
                testID="homework-settings-weekend"
              />
            </View>
          </Card>

          <SectionLabel>{copy.homework.settings.questionsSection}</SectionLabel>
          <Card>
            <SwitchRow
              label={copy.homework.settings.questionsEnabled}
              value={effective.questionsEnabled}
              onChange={(next) => update({ questionsEnabled: next })}
              help={copy.homework.settings.questionsEnabledHelp}
              disabled={!editable}
              testID="homework-settings-questions"
            />
          </Card>

          <SectionLabel>{copy.homework.settings.tools}</SectionLabel>
          <Card padless>
            {canReadHomework ? (
              <LinkRow
                title={copy.homework.settings.bank}
                detail={copy.homework.settings.bankBody}
                icon="bank"
                onPress={() => router.push("/homework/bank")}
                first
                testID="homework-settings-bank"
              />
            ) : null}
            <LinkRow
              title={copy.homework.settings.rubrics}
              detail={copy.homework.settings.rubricsBody}
              icon="rubric"
              onPress={() => router.push("/homework/rubrics")}
              first={!canReadHomework}
              testID="homework-settings-rubrics"
            />
          </Card>

          {!canWrite ? (
            <ThemedText variant="meta" style={styles.note}>
              {copy.homework.settings.viewerBody}
            </ThemedText>
          ) : null}
        </View>,
        footer,
      )}

      {pendingTarget ? (
        <ConfirmSheet
          title={copy.homework.settings.discardTitle}
          body={copy.homework.settings.discardBody}
          confirmLabel={copy.homework.settings.discardConfirm}
          keepLabel={copy.homework.settings.keepEditing}
          tone="destructive"
          submitting={false}
          error={null}
          onConfirm={() => applyTarget(pendingTarget.id)}
          onClose={() => setPendingTarget(null)}
          testIDPrefix="homework-settings-discard"
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  label: {
    marginBottom: spacing.xs,
  },
  fileNote: {
    marginTop: spacing.sm,
  },
  switches: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  retryNotice: {
    marginTop: spacing.sm,
  },
  footerNotice: {
    marginBottom: spacing.sm,
  },
  note: {
    paddingHorizontal: spacing.xs,
  },
});
