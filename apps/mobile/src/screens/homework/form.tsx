import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { DateField } from "../../components/date-field";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { TimeField } from "../../components/time-field";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  dayLabel,
  SELECTABLE_GRADING_MODES,
  SELECTABLE_SUBMISSION_TYPES,
  clockOf,
  dayKeyOf,
} from "../../lib/homework";
import type {
  GradingMode,
  SubmissionType,
} from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { CheckPills } from "./check-pills";
import {
  blankHomeworkForm,
  checkHomeworkForm,
  createPayload,
  formFromDetail,
  homeworkFormHasErrors,
  isHomeworkFormDirty,
  updatePayload,
  updatePayloadIsEmpty,
} from "./form-logic";
import type {
  HomeworkFormField,
  HomeworkFormState,
  LateChoice,
} from "./form-logic";
import { KindPicker } from "./kind-picker";
import { gradingLabel, kindGlyph, kindLabel } from "./meta";
import { sectionTargetOf } from "./types";
import type { HomeworkDetail } from "./types";
import { useTeachingPairs } from "./use-teaching-pairs";

const LATE_OPTIONS: { id: LateChoice; label: string }[] = [
  { id: "default", label: copy.homework.form.lateDefault },
  { id: "allowed", label: copy.homework.form.lateAllowedOption },
  { id: "not_allowed", label: copy.homework.form.lateBlockedOption },
];

const LATE_HELP: Record<LateChoice, string> = {
  default: copy.homework.form.lateDefaultHelp,
  allowed: copy.homework.form.lateAllowedHelp,
  not_allowed: copy.homework.form.lateBlockedHelp,
};

/**
 * Create and edit, one form.
 *
 * The screen sits behind a small state machine: permission → branch → session
 * → (edit only) the assignment read → the form itself. Each refusal is its own
 * honest screen; a teacher never lands on a form that cannot save.
 *
 * The form body is keyed by the row id so its initial state is computed once
 * from real data, and a background refetch never overwrites what is being
 * typed. Save is the only footer action: create replaces the stack with the
 * new draft's detail, edit returns to it.
 */
export function HomeworkFormScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? "";
  const editing = id.length > 0;
  const { organizationId, academicYear, yearPending, ready } =
    useActiveContext();
  const { has } = usePermissions();
  const canCreate = has("homework:create");
  const canUpdate = has("homework:update");

  const detail = trpc.homework.byId.useQuery(
    { organizationId: organizationId ?? "", id },
    { enabled: editing && ready && canUpdate && Boolean(organizationId) },
  );

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={
        editing ? copy.homework.form.editTitle : copy.homework.form.createTitle
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-form-back"
    >
      {children}
    </ScreenFrame>
  );

  if (!editing && !canCreate) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.homework.form.createDeniedTitle}
        message={copy.homework.form.createDeniedBody}
        testID="homework-form-denied"
      />,
    );
  }

  if (editing && !canUpdate) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.homework.form.noAccessTitle}
        message={copy.homework.form.noAccessBody}
        testID="homework-form-denied"
      />,
    );
  }

  if (!ready || (yearPending && !academicYear)) {
    return frame(
      <View style={styles.skeleton} accessibilityLiveRegion="polite">
        <Skeleton height={88} />
        <Skeleton height={240} />
        <Skeleton height={160} />
      </View>,
    );
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.homework.noBranchTitle}
        message={copy.homework.noBranchBody}
        testID="homework-form-no-branch"
      />,
    );
  }

  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.homework.noYearTitle}
        message={copy.homework.noYearBody}
        testID="homework-form-no-year"
      />,
    );
  }

  if (!editing) {
    return (
      <HomeworkFormBody
        key="create"
        detail={null}
        organizationId={organizationId}
        academicYearId={academicYear.id}
      />
    );
  }

  if (!id || detail.isPending) {
    return frame(
      <View style={styles.skeleton} accessibilityLiveRegion="polite">
        <Skeleton height={88} />
        <Skeleton height={240} />
        <Skeleton height={160} />
      </View>,
    );
  }

  if (detail.isError) {
    const friendly = toFriendlyError(detail.error);
    if (friendly.kind === "notFound" || friendly.kind === "forbidden") {
      return frame(
        <EmptyState
          icon="shield"
          title={copy.homework.form.noAccessTitle}
          message={copy.homework.form.noAccessBody}
          testID="homework-form-no-access"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={detail.error}
        onRetry={() => void detail.refetch()}
        testID="homework-form-error"
      />,
    );
  }

  const assignment = detail.data ?? null;
  if (!assignment) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.form.missingTitle}
        message={copy.homework.form.missingBody}
        testID="homework-form-missing"
      />,
    );
  }

  if (
    assignment.status === "closed" ||
    assignment.status === "cancelled"
  ) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.homework.actions.editClosedTitle}
        message={copy.homework.actions.editClosedBody}
        testID="homework-form-locked"
      />,
    );
  }

  if (assignment.status === "scheduled") {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.homework.detail.scheduledTitle}
        message={copy.homework.detail.scheduledBody}
        testID="homework-form-scheduled"
      />,
    );
  }

  if (!sectionTargetOf(assignment)) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.detail.noTargetTitle}
        message={copy.homework.detail.noTargetBody}
        testID="homework-form-no-target"
      />,
    );
  }

  return (
    <HomeworkFormBody
      key={assignment.id}
      detail={assignment}
      organizationId={organizationId}
      academicYearId={academicYear.id}
    />
  );
}

function HomeworkFormBody({
  detail,
  organizationId,
  academicYearId,
}: {
  detail: HomeworkDetail | null;
  organizationId: string;
  academicYearId: string;
}) {
  const editing = detail !== null;
  const branchName = useActiveBranchName();

  const [initial] = useState<HomeworkFormState>(() =>
    detail ? formFromDetail(detail) : blankHomeworkForm(),
  );
  const [form, setForm] = useState<HomeworkFormState>(initial);
  const [touched, setTouched] = useState<Set<HomeworkFormField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const check = useMemo(() => checkHomeworkForm(form, editing ? "edit" : "create"), [
    form,
    editing,
  ]);
  const hasErrors = homeworkFormHasErrors(check.errors);
  const dirty = isHomeworkFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved && !createdId);

  const pairs = useTeachingPairs({ enabled: true, sectionId: form.sectionId });

  const utils = trpc.useUtils();
  const create = trpc.homework.create.useMutation();
  const update = trpc.homework.update.useMutation();
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (createdId) {
      router.replace({ pathname: "/homework/[id]", params: { id: createdId } });
    }
  }, [createdId]);

  useEffect(() => {
    if (!saved) return;
    if (router.canGoBack()) router.back();
    else if (detail) {
      router.replace({ pathname: "/homework/[id]", params: { id: detail.id } });
    }
  }, [saved, detail]);

  const set = <K extends keyof HomeworkFormState>(
    key: K,
    value: HomeworkFormState[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveError(null);
  };

  const touch = (field: HomeworkFormField) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: HomeworkFormField) =>
    touched.has(field) || submitted ? check.errors[field] : undefined;

  const chooseSection = (sectionId: string) => {
    // The pair is per assignment: a subject from the previous class never
    // carries over.
    setForm((current) => ({
      ...current,
      sectionId,
      subjectId: null,
    }));
    setSaveError(null);
  };

  const chooseSubject = (subjectId: string) => {
    set("subjectId", subjectId);
  };

  const toggleSubmission = (value: SubmissionType) => {
    setForm((current) => {
      const has = current.submissions.includes(value);
      let next: SubmissionType[];
      if (value === "none") {
        next = has ? [] : ["none"];
      } else if (has) {
        next = current.submissions.filter((item) => item !== value);
      } else {
        next = [...current.submissions.filter((item) => item !== "none"), value];
      }
      return { ...current, submissions: next };
    });
    setSaveError(null);
  };

  const setResubmission = (next: boolean) => {
    setForm((current) => ({
      ...current,
      allowResubmission: next,
      maxSubmissions: next ? current.maxSubmissions : "",
    }));
    setSaveError(null);
  };

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors) return;

    try {
      if (detail) {
        const payload = updatePayload(form, check, detail);
        if (!payload) return;
        if (!updatePayloadIsEmpty(payload)) {
          await update.mutateAsync({ organizationId, ...payload });
        }
        await Promise.all([
          utils.homework.byId.invalidate(),
          utils.homework.list.invalidate(),
        ]);
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        setSaved(true);
      } else {
        const payload = createPayload(form, check, academicYearId);
        if (!payload) return;
        const created = await create.mutateAsync({
          organizationId,
          ...payload,
        });
        await Promise.all([
          utils.homework.list.invalidate(),
          utils.homework.byId.invalidate(),
        ]);
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        setCreatedId(created.id);
      }
    } catch (error) {
      setSaveError(error);
    }
  };

  const sectionLabel =
    pairs.sectionOptions.find((row) => row.id === form.sectionId)?.label ?? null;
  const subjectLabel =
    pairs.subjects.find((row) => row.id === form.subjectId)?.name ??
    pairs.subjectNameOf(form.subjectId);

  const lateWindowMs =
    detail && form.late === "allowed"
      ? new Date(detail.closeAt).getTime() - new Date(detail.dueAt).getTime()
      : 0;

  const submissionOptions = useMemo(() => {
    const seen = new Set<string>();
    const options = [] as {
      value: SubmissionType;
      label: string;
      note?: string;
      disabled?: boolean;
    }[];
    for (const value of SELECTABLE_SUBMISSION_TYPES) {
      seen.add(value);
      const selected = form.submissions.includes(value);
      const unavailable = value === "questions" && !selected;
      options.push({
        value,
        label: copy.homework.submissions[value],
        note: unavailable ? copy.homework.form.questionsFirst : undefined,
        disabled: unavailable,
      });
    }
    // A row authored elsewhere may carry a type this build cannot author.
    // Keep it visible and removable rather than silently dropping it on save.
    for (const value of form.submissions) {
      if (seen.has(value)) continue;
      options.push({
        value,
        label: copy.homework.submissions[value],
        note: copy.homework.form.legacyFile,
      });
    }
    return options;
  }, [form.submissions]);

  const noSections =
    pairs.sectionsQuery.isSuccess && pairs.sectionOptions.length === 0;
  const noSubjects =
    !pairs.subjectsPending &&
    !pairs.subjectsError &&
    Boolean(form.sectionId) &&
    pairs.subjects.length === 0;

  const footer = (
    <>
      {saveError ? (
        <Notice
          tone="critical"
          message={toFriendlyError(saveError).message}
          testID="homework-save-error"
        />
      ) : submitted && hasErrors ? (
        <Notice
          tone="critical"
          message={copy.forms.invalidSummary}
          testID="homework-invalid"
        />
      ) : editing && !dirty ? (
        <ThemedText variant="meta" style={styles.noChanges}>
          {copy.homework.form.noChanges}
        </ThemedText>
      ) : null}
      <CapsuleButton
        title={editing ? copy.homework.form.saveChanges : copy.homework.form.saveDraft}
        icon="check"
        onPress={() => void submit()}
        loading={saving}
        disabled={saving || (editing && !dirty) || noSections}
        testID="homework-save"
      />
    </>
  );

  return (
    <ScreenFrame
      title={editing ? copy.homework.form.editTitle : copy.homework.form.createTitle}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-form-back"
      footer={footer}
    >
      {noSections ? (
        <EmptyState
          icon="homework"
          title={copy.homework.form.noPairTitle}
          message={copy.homework.form.noPairBody}
          testID="homework-form-no-pair"
        />
      ) : (
        <>
          <Notice
            tone={editing && detail?.status === "published" ? "caution" : "neutral"}
            message={
              editing && detail?.status === "published"
                ? copy.homework.form.publishedNote
                : copy.homework.form.draftNote
            }
            testID="homework-form-note"
          />

          <SectionLabel>{copy.homework.form.where}</SectionLabel>
          <Card>
            {pairs.sectionsQuery.isError ? (
              <>
                <Notice
                  tone="critical"
                  message={toFriendlyError(pairs.sectionsQuery.error).message}
                  testID="homework-sections-error"
                />
                <CapsuleButton
                  title={copy.common.retry}
                  variant="secondary"
                  size="compact"
                  onPress={() => pairs.refetchSections()}
                  testID="homework-sections-retry"
                  style={styles.retry}
                />
              </>
            ) : null}
            <SelectField
              label={copy.homework.form.section}
              valueLabel={sectionLabel}
              placeholder={copy.homework.form.sectionPlaceholder}
              options={pairs.sectionOptions.map((row) => ({
                id: row.id,
                label: row.label,
              }))}
              currentId={form.sectionId ?? ""}
              onSelect={chooseSection}
              help={
                pairs.sectionsQuery.isPending
                  ? copy.homework.form.loadingSections
                  : editing
                    ? copy.homework.form.fixedPair
                    : undefined
              }
              error={fieldError("sectionId")}
              disabled={editing || pairs.sectionsQuery.isPending}
              testID="homework-section"
            />
            <SelectField
              label={copy.homework.form.subject}
              valueLabel={subjectLabel}
              placeholder={
                form.sectionId
                  ? pairs.subjectsPending
                    ? copy.homework.form.loadingSubjects
                    : copy.homework.form.subjectPlaceholder
                  : copy.homework.form.subjectFirst
              }
              options={pairs.subjects.map((row) => ({
                id: row.id,
                label: row.name,
              }))}
              currentId={form.subjectId ?? ""}
              onSelect={chooseSubject}
              help={editing ? copy.homework.form.fixedPair : undefined}
              error={fieldError("subjectId")}
              disabled={
                editing ||
                !form.sectionId ||
                pairs.subjectsPending ||
                noSubjects
              }
              testID="homework-subject"
            />
            {pairs.subjectsError ? (
              <>
                <Notice
                  tone="critical"
                  message={toFriendlyError(pairs.subjectsError).message}
                  testID="homework-subjects-error"
                />
                <CapsuleButton
                  title={copy.common.retry}
                  variant="secondary"
                  size="compact"
                  onPress={() => pairs.refetchSubjects()}
                  testID="homework-subjects-retry"
                  style={styles.retry}
                />
              </>
            ) : null}
            {noSubjects ? (
              <Notice
                tone="caution"
                title={copy.homework.form.noSubjectsTitle}
                message={copy.homework.form.noSubjectsBody}
                testID="homework-form-no-subjects"
                style={styles.cardNotice}
              />
            ) : null}
          </Card>

          <SectionLabel>{copy.homework.form.what}</SectionLabel>
          <Card>
            {editing && detail ? (
              <ReadOnlyLine
                icon={kindGlyph(detail.kind)}
                label={copy.homework.form.kind}
                value={kindLabel(detail.kind)}
                note={copy.homework.form.fixedKind}
              />
            ) : (
              <KindPicker
                value={form.kind}
                onChange={(kind) => set("kind", kind)}
              />
            )}
            <FormField
              label={copy.homework.form.titleLabel}
              value={form.title}
              onChangeText={(title) => set("title", title)}
              onBlur={() => touch("title")}
              placeholder={copy.homework.form.titlePlaceholder}
              help={copy.homework.form.titleHelp}
              error={fieldError("title")}
              maxLength={250}
              autoCapitalize="sentences"
              testID="homework-title-input"
            />
            <FormField
              label={copy.homework.form.instructions}
              value={form.description}
              onChangeText={(description) => set("description", description)}
              placeholder={copy.homework.form.instructionsPlaceholder}
              help={copy.homework.form.instructionsHelp}
              maxLength={20_000}
              multiline
              numberOfLines={5}
              autoCapitalize="sentences"
              testID="homework-instructions"
            />
            <FormField
              label={copy.homework.form.topic}
              value={form.topic}
              onChangeText={(topic) => set("topic", topic)}
              onBlur={() => touch("topic")}
              placeholder={copy.homework.form.topicPlaceholder}
              error={fieldError("topic")}
              maxLength={250}
              autoCapitalize="sentences"
              testID="homework-topic"
            />
            <FormField
              label={copy.homework.form.estimated}
              value={form.estimated}
              onChangeText={(estimated) => set("estimated", estimated)}
              onBlur={() => touch("estimated")}
              placeholder={copy.homework.form.estimatedPlaceholder}
              error={fieldError("estimated")}
              help={
                editing &&
                detail?.estimatedMinutes !== null &&
                form.estimated.trim().length === 0
                  ? copy.homework.form.estimatedLocked
                  : undefined
              }
              keyboardType="number-pad"
              maxLength={3}
              suffix="min"
              testID="homework-estimated"
            />
          </Card>

          <SectionLabel>{copy.homework.form.when}</SectionLabel>
          <Card>
            <DateField
              label={copy.homework.form.dueDate}
              value={form.dueDay}
              onChange={(dueDay) => set("dueDay", dueDay)}
              error={fieldError("due")}
              testID="homework-due-date"
            />
            <TimeField
              label={copy.homework.form.dueTime}
              value={form.dueTime}
              onChange={(dueTime) => set("dueTime", dueTime)}
              testID="homework-due-time"
            />
            {check.pastDue && !check.errors.due ? (
              <Notice
                tone="caution"
                message={copy.homework.form.pastDue}
                testID="homework-past-due-warning"
                style={styles.cardNotice}
              />
            ) : null}
            {editing && detail ? (
              <ReadOnlyLine
                label={copy.homework.form.latePolicy}
                value={
                  form.late === "not_allowed" || lateWindowMs <= 0
                    ? copy.homework.detail.lateBlocked
                    : copy.homework.form.lateWindow(
                        `${dayLabel(dayKeyOf(detail.closeAt))} · ${
                          clockOf(detail.closeAt) ?? "—"
                        }`,
                      )
                }
                note={LATE_HELP[form.late]}
              />
            ) : (
              <SelectField
                label={copy.homework.form.latePolicy}
                valueLabel={
                  LATE_OPTIONS.find((option) => option.id === form.late)?.label ??
                  null
                }
                placeholder={copy.homework.form.lateDefault}
                options={LATE_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                }))}
                currentId={form.late}
                onSelect={(next) => set("late", next as LateChoice)}
                help={LATE_HELP[form.late]}
                testID="homework-late"
              />
            )}
          </Card>

          <SectionLabel>{copy.homework.form.how}</SectionLabel>
          <Card>
            <CheckPills
              label={copy.homework.form.submissionTypes}
              values={form.submissions}
              options={submissionOptions}
              onToggle={toggleSubmission}
              help={copy.homework.form.submissionTypesHelp}
              error={fieldError("submissions")}
              testIDPrefix="homework-submission"
            />
            <SwitchRow
              label={copy.homework.form.resubmitLabel}
              value={form.allowResubmission}
              onChange={setResubmission}
              help={copy.homework.form.resubmitHelp}
              testID="homework-resubmit"
            />
            {form.allowResubmission ? (
              <FormField
                label={copy.homework.form.maxSubmissions}
                value={form.maxSubmissions}
                onChangeText={(value) => set("maxSubmissions", value)}
                onBlur={() => touch("maxSubmissions")}
                placeholder={copy.homework.form.maxSubmissionsPlaceholder}
                error={fieldError("maxSubmissions")}
                keyboardType="number-pad"
                maxLength={2}
                testID="homework-max-submissions"
              />
            ) : null}
          </Card>

          <SectionLabel>{copy.homework.form.gradingSection}</SectionLabel>
          <Card>
            {editing && detail ? (
              <ReadOnlyLine
                icon="grade"
                label={copy.homework.form.gradingMode}
                value={
                  detail.gradingMode === "marks" && detail.maxMarks
                    ? `${gradingLabel(detail.gradingMode)} · ${copy.homework.detail.outOf(
                        detail.maxMarks,
                      )}`
                    : gradingLabel(detail.gradingMode)
                }
                note={copy.homework.form.fixedGrading}
              />
            ) : (
              <>
                <ChoicePills<GradingMode>
                  label={copy.homework.form.gradingMode}
                  value={form.gradingMode}
                  options={SELECTABLE_GRADING_MODES.map((mode) => ({
                    value: mode,
                    label: copy.homework.grading[mode],
                  }))}
                  onChange={(gradingMode) => set("gradingMode", gradingMode)}
                  testIDPrefix="homework-grading"
                />
                {form.gradingMode === "marks" ? (
                  <FormField
                    label={copy.homework.form.maxMarksLabel}
                    value={form.maxMarks}
                    onChangeText={(maxMarks) => set("maxMarks", maxMarks)}
                    onBlur={() => touch("maxMarks")}
                    placeholder={copy.homework.form.maxMarksPlaceholder}
                    help={copy.homework.form.maxMarksHelp}
                    error={fieldError("maxMarks")}
                    keyboardType="decimal-pad"
                    maxLength={8}
                    testID="homework-max-marks"
                  />
                ) : null}
              </>
            )}
          </Card>
        </>
      )}
    </ScreenFrame>
  );
}

function ReadOnlyLine({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: string;
  icon?: AppIconName;
  note?: string;
}) {
  return (
    <View style={styles.readOnly}>
      <ThemedText variant="caption" style={styles.readOnlyLabel}>
        {label}
      </ThemedText>
      <View style={styles.readOnlyValue}>
        {icon ? (
          <AppIcon name={icon} size={18} color={colors.muted} />
        ) : null}
        <ThemedText variant="bodyStrong" style={styles.readOnlyText}>
          {value}
        </ThemedText>
      </View>
      {note ? <ThemedText variant="meta">{note}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  retry: {
    marginTop: spacing.sm,
  },
  cardNotice: {
    marginTop: spacing.md,
  },
  noChanges: {
    marginBottom: spacing.xs,
  },
  readOnly: {
    marginTop: spacing.lg,
    gap: spacing.xxs,
  },
  readOnlyLabel: {
    marginBottom: spacing.xs,
  },
  readOnlyValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  readOnlyText: {
    flexShrink: 1,
  },
});
