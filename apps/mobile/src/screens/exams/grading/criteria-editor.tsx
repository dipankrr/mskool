import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { FactRow } from "../../../components/fact-row";
import { FormField } from "../../../components/form-field";
import { FormSheet } from "../../../components/form-sheet";
import { Notice } from "../../../components/notice";
import { ScreenFrame } from "../../../components/screen-frame";
import { SelectField } from "../../../components/select-field";
import { Skeleton } from "../../../components/skeleton";
import { SwitchRow } from "../../../components/switch-row";
import { ThemedText } from "../../../components/themed-text";
import { useBranchMeta } from "../../../hooks/use-active-context";
import { usePermissions } from "../../../hooks/use-permissions";
import { useUnsavedChanges } from "../../../hooks/use-unsaved-changes";
import { copy } from "../../../lib/copy";
import { errorMessage } from "../../../lib/errors";
import {
  criteriaDraft,
  criteriaDraftFromDefault,
  criteriaErrors,
  criteriaPayload,
  criteriaSummary,
  criteriaUpdatePayload,
  criteriaDirty,
  firstCriteriaError,
  hasCriteriaErrors,
  uncoveredScopes,
} from "../../../lib/pass-criteria";
import type {
  CriteriaDraft,
  CriteriaRowLike,
  ScopeOption,
} from "../../../lib/pass-criteria";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { useExamScope } from "../use-exam-data";
import { SummaryCard } from "./ui";
import {
  useCriteriaClasses,
  useCriteriaSubjects,
  usePassCriteriaAdmin,
  usePassCriteriaActions,
} from "./use-grading";

type CriteriaRow = inferRouterOutputs<AppRouter>["exam"]["passCriteria"]["list"][number];
type SubjectRow = inferRouterOutputs<AppRouter>["subject"]["list"][number];

/**
 * PASS RULE EDITOR (chunk 7F) — one screen for "new" and "edit".
 *
 * The "In short" card is the point of the screen: four plain lines rewritten
 * from the draft, so the policy can be read before the switches are touched.
 * The scope is the one thing that cannot move after a save (the unique indexes
 * name each rule), so create picks it once and edit prints it.
 */
export function PassCriteriaEditorScreen() {
  const { criteriaId } = useLocalSearchParams<{ criteriaId?: string }>();
  const scope = useExamScope();
  const branchName = useBranchMeta();
  const criteria = usePassCriteriaAdmin();
  const classes = useCriteriaClasses();
  const subjects = useCriteriaSubjects();

  const year = scope.academicYear;
  const isNew = !criteriaId;
  const rows = criteria.data ?? [];
  const row = criteriaId ? (rows.find((entry) => entry.id === criteriaId) ?? null) : null;
  const defaultRow = rows.find((entry) => entry.classId === null) ?? null;

  const classRows = [...(classes.data ?? [])].sort(
    (a, b) => a.numericOrder - b.numericOrder || a.name.localeCompare(b.name),
  );
  const options = uncoveredScopes(
    classRows.map((entry) => ({ id: entry.id, name: entry.name })),
    rows,
  );
  const subjectRows = [...(subjects.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const allowed = isNew ? scope.canCreate : scope.canUpdate;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.grading.criteria.title}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      backTestID="criteria-editor-back"
      titleTestID="criteria-editor-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead || !allowed) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="criteria-editor-denied"
      />,
    );
  }

  if (!scope.ready) {
    return frame(<EditorSkeleton />);
  }

  if (!year) {
    return frame(
      <EmptyState
        icon="calendarOff"
        title={copy.exams.grading.criteria.noSessionTitle}
        message={copy.exams.grading.criteria.noSessionBody}
        testID="criteria-editor-no-session"
      />,
    );
  }

  if (!scope.organizationId || !scope.schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.exams.grading.noBranchTitle}
        message={copy.exams.grading.noBranchBody}
        testID="criteria-editor-no-branch"
      />,
    );
  }

  if (criteria.isPending || classes.isPending || subjects.isPending) {
    return frame(<EditorSkeleton />);
  }

  const failure = criteria.error ?? classes.error ?? subjects.error;
  if (failure) {
    return frame(
      <ErrorCard
        cause={failure}
        onRetry={() => {
          void criteria.refetch();
          void classes.refetch();
          void subjects.refetch();
        }}
        testID="criteria-editor-error"
      />,
    );
  }

  if (!isNew && !row) {
    return frame(
      <EmptyState
        icon="exams"
        title={copy.exams.grading.criteria.gone}
        message={copy.exams.grading.criteria.goneBody}
        testID="criteria-editor-gone"
      />,
    );
  }

  if (isNew && options.length === 0) {
    return frame(
      <EmptyState
        icon="checkCircle"
        title={copy.exams.grading.criteria.allScopesTitle}
        message={copy.exams.grading.criteria.allScopesBody}
        testID="criteria-editor-no-scope"
      />,
    );
  }

  return (
    <CriteriaForm
      key={row?.id ?? "new"}
      row={row}
      defaultRow={defaultRow}
      options={options}
      classRows={classRows}
      subjects={subjectRows}
      yearId={year.id}
      yearName={year.name}
    />
  );
}

function EditorSkeleton() {
  return (
    <View style={styles.skeletons} testID="criteria-editor-loading">
      <Skeleton height={136} />
      <Skeleton height={84} />
      <Skeleton height={84} />
    </View>
  );
}

function CriteriaForm({
  row,
  defaultRow,
  options,
  classRows,
  subjects,
  yearId,
  yearName,
}: {
  row: CriteriaRow | null;
  defaultRow: CriteriaRow | null;
  options: ScopeOption[];
  classRows: { id: string; name: string }[];
  subjects: SubjectRow[];
  yearId: string;
  yearName: string;
}) {
  const { has } = usePermissions();
  const canWrite = has(row ? "exam:update" : "exam:create");
  const actions = usePassCriteriaActions();

  const [scopeId, setScopeId] = useState<string | null>(() => {
    if (row) return row.classId ?? "";
    if (options.length === 1) return options[0]!.id;
    return null;
  });
  const [draft, setDraft] = useState<CriteriaDraft>(() =>
    row
      ? criteriaDraft(row as CriteriaRowLike)
      : defaultRow
        ? criteriaDraftFromDefault(defaultRow as CriteriaRowLike)
        : criteriaDraft(null),
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [mandatoryOpen, setMandatoryOpen] = useState(false);
  /**
   * A new rule starts as a copy of the default (or a blank policy) and the
   * scope may already be pre-selected, so the screen must not claim unsaved
   * work before the admin has touched anything.
   */
  const [touched, setTouched] = useState(false);

  const dirty = row ? criteriaDirty(draft, row as CriteriaRowLike) : touched;
  const errors = criteriaErrors(draft);
  const scopeMissing = !row && scopeId === null;
  const problem = scopeMissing
    ? copy.exams.grading.criteria.appliesRequired
    : firstCriteriaError(errors);
  /**
   * Nothing red before the first press. A new rule opens as a copy of the
   * school default, so the only thing missing is the scope — and the empty
   * picker above the footer already says so. The caption repeats the reason
   * after a failed save, exactly like the scale editor.
   */
  const caption = submitted ? problem : null;
  const canSave = canWrite && (!row || dirty);

  const subjectName = (id: string) =>
    subjects.find((subject) => subject.id === id)?.name ?? null;
  const mandatoryNames = draft.mandatoryPassSubjectIds
    .map((id) => subjectName(id))
    .filter((name): name is string => Boolean(name));
  const mandatoryValue =
    mandatoryNames.length > 0
      ? mandatoryNames.join(", ")
      : copy.exams.grading.criteria.mandatoryNone;

  const scopeLabel = (() => {
    if (row) {
      return row.classId === null
        ? copy.exams.grading.criteria.defaultRule
        : (classRows.find((entry) => entry.id === row.classId)?.name ??
            copy.exams.grading.criteria.classFallback);
    }
    if (scopeId === null) return null;
    return options.find((option) => option.id === scopeId)?.label ?? null;
  })();

  useUnsavedChanges(dirty && !saved, {
    title: copy.exams.grading.criteria.unsavedTitle,
    body: copy.exams.grading.criteria.unsavedBody,
    keepEditing: copy.exams.grading.criteria.keepEditing,
    discard: copy.exams.grading.criteria.leave,
  });

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  const set = <K extends keyof CriteriaDraft>(
    key: K,
    value: CriteriaDraft[K],
  ) => {
    setTouched(true);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = () => {
    setSubmitted(true);
    setError(null);
    if (scopeMissing || hasCriteriaErrors(criteriaErrors(draft))) return;
    if (row && !dirty) {
      setSaved(true);
      return;
    }

    void (async () => {
      try {
        if (!row) {
          await actions.create(
            yearId,
            criteriaPayload(draft, scopeId === "" ? null : (scopeId ?? null)),
          );
          setSaved(true);
          return;
        }
        const payload = criteriaUpdatePayload(draft, row as CriteriaRowLike);
        if (Object.keys(payload).length > 0) {
          await actions.update(row.id, payload);
        }
        setSaved(true);
      } catch (cause) {
        setError(cause);
      }
    })();
  };

  return (
    <ScreenFrame
      title={
        row
          ? copy.exams.grading.criteria.editTitle
          : copy.exams.grading.criteria.createTitle
      }
      meta={[yearName, scopeLabel].filter(Boolean).join(" · ")}
      backAccessibilityLabel={copy.common.back}
      backTestID="criteria-editor-back"
      titleTestID="criteria-editor-title"
      footer={
        <View style={styles.footer}>
          {error ? (
            <Notice
              tone="critical"
              message={errorMessage(error)}
              testID="criteria-editor-save-error"
            />
          ) : null}
          {caption ? (
            <ThemedText
              variant="meta"
              color={colors.tone.critical.fg}
              accessibilityLiveRegion="polite"
              testID="criteria-editor-caption"
            >
              {caption}
            </ThemedText>
          ) : null}
          <CapsuleButton
            title={copy.exams.grading.criteria.save}
            icon="check"
            loading={actions.pending}
            disabled={!canSave}
            onPress={save}
            testID="criteria-editor-save"
          />
        </View>
      }
    >
      <View style={styles.body}>
        <SummaryCard
          title={copy.exams.grading.criteria.summaryTitle}
          lines={criteriaSummary(draft, subjectName)}
          testID="criteria-summary"
        />

        {row ? (
          <View style={styles.scope}>
            <Card padless>
              <FactRow
                label={copy.exams.grading.criteria.appliesLabel}
                value={
                  scopeLabel ?? copy.exams.grading.criteria.defaultRule
                }
                first
                testID="criteria-scope-readonly"
              />
            </Card>
            <ThemedText variant="meta" style={styles.scopeHint}>
              {copy.exams.grading.criteria.scopeLocked}
            </ThemedText>
          </View>
        ) : (
          <SelectField
            label={copy.exams.grading.criteria.appliesLabel}
            valueLabel={scopeLabel}
            placeholder={copy.exams.grading.criteria.appliesPlaceholder}
            options={options.map((option) => ({
              id: option.id,
              label: option.label,
              detail: option.detail,
            }))}
            currentId={scopeId ?? ""}
            onSelect={(next) => {
              setScopeId(next);
              setTouched(true);
            }}
            help={copy.exams.grading.criteria.appliesHelp}
            error={submitted && scopeMissing ? copy.exams.grading.criteria.appliesRequired : undefined}
            testID="criteria-scope"
          />
        )}

        <SectionHeadLocal title={copy.exams.grading.criteria.promotionTitle} />

        <FormField
          label={copy.exams.grading.criteria.minSubjectsLabel}
          value={draft.minSubjectsToPass}
          onChangeText={(next) =>
            set("minSubjectsToPass", next.replace(/[^0-9]/g, ""))
          }
          placeholder={copy.exams.grading.criteria.minSubjectsPlaceholder}
          help={copy.exams.grading.criteria.minSubjectsHelp}
          error={errors.minSubjects}
          keyboardType="number-pad"
          maxLength={2}
          testID="criteria-min-subjects"
        />

        {subjects.length > 0 ? (
          <PickerField
            label={copy.exams.grading.criteria.mandatoryLabel}
            value={mandatoryValue}
            help={copy.exams.grading.criteria.mandatoryHelp}
            onPress={() => setMandatoryOpen(true)}
            testID="criteria-mandatory"
          />
        ) : draft.mandatoryPassSubjectIds.length > 0 ? (
          <ThemedText variant="meta" style={styles.scopeHint}>
            {copy.exams.grading.criteria.mandatoryCount(
              draft.mandatoryPassSubjectIds.length,
            )}
          </ThemedText>
        ) : null}

        <SectionHeadLocal title={copy.exams.grading.criteria.graceTitle} />
        <SwitchRow
          label={copy.exams.grading.criteria.graceLabel}
          value={draft.graceMarksAllowed}
          onChange={(next) => set("graceMarksAllowed", next)}
          help={copy.exams.grading.criteria.graceHelp}
          testID="criteria-grace"
        />
        {draft.graceMarksAllowed ? (
          <>
            <FormField
              label={copy.exams.grading.criteria.gracePerSubjectLabel}
              value={draft.maxGracePerSubject}
              onChangeText={(next) =>
                set("maxGracePerSubject", next.replace(/[^0-9.]/g, ""))
              }
              keyboardType="decimal-pad"
              suffix="%"
              maxLength={6}
              error={errors.gracePerSubject}
              testID="criteria-grace-per-subject"
            />
            <FormField
              label={copy.exams.grading.criteria.graceTotalLabel}
              value={draft.maxGraceTotal}
              onChangeText={(next) =>
                set("maxGraceTotal", next.replace(/[^0-9.]/g, ""))
              }
              keyboardType="decimal-pad"
              suffix="%"
              maxLength={6}
              error={errors.graceTotal}
              testID="criteria-grace-total"
            />
          </>
        ) : null}

        <SectionHeadLocal title={copy.exams.grading.criteria.compartmentTitle} />
        <SwitchRow
          label={copy.exams.grading.criteria.compartmentLabel}
          value={draft.compartmentAllowed}
          onChange={(next) => set("compartmentAllowed", next)}
          help={copy.exams.grading.criteria.compartmentHelp}
          testID="criteria-compartment"
        />
        {draft.compartmentAllowed ? (
          <FormField
            label={copy.exams.grading.criteria.compartmentCapLabel}
            value={draft.maxSubjectsForCompartment}
            onChangeText={(next) =>
              set("maxSubjectsForCompartment", next.replace(/[^0-9]/g, ""))
            }
            keyboardType="number-pad"
            maxLength={2}
            error={errors.compartmentCap}
            testID="criteria-compartment-cap"
          />
        ) : null}

        <SectionHeadLocal title={copy.exams.grading.criteria.attendanceTitle} />
        <FormField
          label={copy.exams.grading.criteria.attendanceLabel}
          value={draft.minAttendancePct}
          onChangeText={(next) =>
            set("minAttendancePct", next.replace(/[^0-9.]/g, ""))
          }
          help={copy.exams.grading.criteria.attendanceHelp}
          error={errors.attendance}
          keyboardType="decimal-pad"
          suffix="%"
          maxLength={6}
          testID="criteria-attendance"
        />

        <SectionHeadLocal title={copy.exams.grading.criteria.behaviourTitle} />
        <SwitchRow
          label={copy.exams.grading.criteria.absentLabel}
          value={draft.absentMandatoryFails}
          onChange={(next) => set("absentMandatoryFails", next)}
          help={copy.exams.grading.criteria.absentHelp}
          testID="criteria-absent"
        />
        <SwitchRow
          label={copy.exams.grading.criteria.exemptLabel}
          value={draft.exemptRenormalizes}
          onChange={(next) => set("exemptRenormalizes", next)}
          help={copy.exams.grading.criteria.exemptHelp}
          testID="criteria-exempt"
        />
      </View>

      {mandatoryOpen ? (
        <MustPassSheet
          subjects={subjects}
          initialIds={draft.mandatoryPassSubjectIds}
          onClose={() => setMandatoryOpen(false)}
          onApply={(ids) => {
            set("mandatoryPassSubjectIds", ids);
            setMandatoryOpen(false);
          }}
        />
      ) : null}
    </ScreenFrame>
  );
}

function SectionHeadLocal({ title }: { title: string }) {
  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel">{title}</ThemedText>
    </View>
  );
}

/** A read-only-looking field that opens a sheet; used for must-pass subjects. */
function PickerField({
  label,
  value,
  help,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  help?: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.picker}>
      <ThemedText variant="caption" style={styles.pickerLabel}>
        {label}
      </ThemedText>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}`}
        accessibilityHint={help}
        onPress={onPress}
        style={({ pressed }) => [
          styles.pickerBox,
          pressed ? styles.pickerPressed : null,
        ]}
      >
        <ThemedText variant="bodyStrong" style={styles.pickerValue} numberOfLines={2}>
          {value}
        </ThemedText>
        <AppIcon name="chevronDown" size={18} color={colors.muted} />
      </Pressable>
      {help ? (
        <ThemedText variant="meta" style={styles.pickerHint}>
          {help}
        </ThemedText>
      ) : null}
    </View>
  );
}

function MustPassSheet({
  subjects,
  initialIds,
  onClose,
  onApply,
}: {
  subjects: SubjectRow[];
  initialIds: string[];
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(initialIds);

  const toggle = (id: string) => {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  };

  return (
    <FormSheet
      title={copy.exams.grading.criteria.mandatoryTitle}
      onClose={onClose}
      testIDPrefix="criteria-mandatory-sheet"
      footer={
        <View style={styles.sheetFooter}>
          <CapsuleButton
            title={copy.exams.grading.criteria.mandatoryDone}
            icon="check"
            size="compact"
            onPress={() => onApply(picked)}
            testID="criteria-mandatory-done"
          />
        </View>
      }
    >
      <ThemedText variant="meta" style={styles.sheetBody}>
        {copy.exams.grading.criteria.mandatoryBody}
      </ThemedText>
      {subjects.map((subject) => {
        const checked = picked.includes(subject.id);
        return (
          <Pressable
            key={subject.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={subject.name}
            onPress={() => toggle(subject.id)}
            style={({ pressed }) => [
              styles.checkRow,
              pressed ? styles.checkPressed : null,
            ]}
            testID={`criteria-subject-${subject.id}`}
          >
            <View style={[styles.checkBox, checked ? styles.checkBoxOn : null]}>
              {checked ? (
                <AppIcon name="check" size={14} color={colors.onAccent} />
              ) : null}
            </View>
            <ThemedText variant="body" style={styles.checkName} numberOfLines={2}>
              {subject.name}
            </ThemedText>
          </Pressable>
        );
      })}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  skeletons: {
    gap: spacing.md,
  },
  footer: {
    gap: spacing.sm,
  },
  scope: {
    gap: spacing.xs,
  },
  scopeHint: {
    paddingHorizontal: spacing.xs,
  },
  section: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  picker: {
    marginTop: spacing.md,
  },
  pickerLabel: {
    marginBottom: spacing.xs,
  },
  pickerBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  pickerPressed: {
    backgroundColor: colors.chip,
  },
  pickerValue: {
    flex: 1,
  },
  pickerHint: {
    marginTop: spacing.xs,
  },
  sheetFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  sheetBody: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  checkPressed: {
    backgroundColor: colors.field,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  checkBoxOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  checkName: {
    flex: 1,
  },
});
