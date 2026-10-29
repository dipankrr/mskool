import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { displayMarks } from "../../lib/exams";
import { checkComponents, weightSum, DEFAULT_COMPONENT } from "../../lib/exam-setup";
import type { ComponentDraft } from "../../lib/exam-setup";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { useSetupActions } from "./use-setup";
import { useClassSubjectNames, useExamDetail, useExamScope } from "./use-exam-data";

const EMPTY_DRAFT: ComponentDraft = {
  name: "",
  maxMarks: "",
  passMarks: "",
  weightagePercentage: "",
  isMandatoryPass: false,
};

/**
 * The parts editor (chunk 7D, D3): one row per component of one paper —
 * name, maximum, pass marks, weight, mandatory-pass — with the running
 * weight sum shown live so the exactly-100 rule is met before the save,
 * not discovered by it. The save replaces the paper's parts; frozen papers
 * (locked, or marks already entered) render read-only with the server's
 * reason, because a late restructure would restate marks that exist.
 */
export function ComponentsEditorScreen() {
  const { examId = "", scheduleId = "" } = useLocalSearchParams<{
    examId: string;
    scheduleId: string;
  }>();
  const scope = useExamScope();
  const detail = useExamDetail(examId);
  const names = useClassSubjectNames();
  const actions = useSetupActions(examId);

  const schedule = useMemo(
    () => detail.data?.schedules.find((row) => row.id === scheduleId) ?? null,
    [detail.data, scheduleId],
  );
  const frozen = schedule ? schedule.isLocked : false;
  const subjectName = schedule
    ? (names.subjectName(schedule.subjectId) ?? copy.exams.hub.classChipsLabel)
    : copy.exams.hub.classChipsLabel;

  const [rows, setRows] = useState<ComponentDraft[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const drafts: ComponentDraft[] =
    rows ??
    (schedule?.components.length
      ? schedule.components.map((component) => ({
          name: component.name,
          maxMarks: displayMarks(component.maxMarks),
          passMarks: displayMarks(component.passMarks),
          weightagePercentage: String(Number(component.weightagePercentage)),
          isMandatoryPass: component.isMandatoryPass,
        }))
      : // D19: a fresh paper carries the CBSE default part, so scheduling
        // never trips the empty-paper refusal by surprise.
        [{ ...DEFAULT_COMPONENT, sequenceNumber: undefined } as ComponentDraft]);

  const dirty = rows !== null;
  useUnsavedChanges(dirty && !frozen, {
    title: copy.exams.components.unsavedTitle,
    body: copy.exams.components.unsavedBody,
    keepEditing: copy.exams.components.keepEditing,
    discard: copy.exams.setup.leave,
  });

  const sum = weightSum(drafts);

  const patch = (index: number, next: Partial<ComponentDraft>) => {
    setRows(
      drafts.map((row, i) => (i === index ? { ...row, ...next } : row)),
    );
    setProblem(null);
  };

  const save = () => {
    setProblem(null);
    setError(null);
    const verdict = checkComponents(drafts);
    if (!verdict.ok) {
      setProblem(copy.exams.components.errors[verdict.reason]);
      return;
    }
    void actions
      .saveComponents({
        scheduleId,
        components: drafts.map((component, index) => ({
          name: component.name.trim(),
          maxMarks: component.maxMarks,
          passMarks: component.passMarks,
          weightagePercentage: component.weightagePercentage,
          isMandatoryPass: component.isMandatoryPass,
          sequenceNumber: index,
        })),
      })
      .then(() => {
        setRows(null);
        setProblem(null);
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <ScreenFrame
      title={copy.exams.components.title(subjectName)}
      meta={
        schedule
          ? `${copy.exams.hub.outOf(schedule.passMarks)} · ${copy.exams.setup.dateLabel} ${schedule.examDate.slice(0, 10)}`
          : undefined
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-parts-back"
      titleTestID="exam-parts-title"
      footer={footer}
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
        testID="exam-parts-denied"
      />,
    );
  }

  if (!scope.ready || detail.isPending) {
    return frame(
      <View style={styles.body} testID="exam-parts-loading">
        <ThemedText variant="body">{copy.exams.hub.review.loading}</ThemedText>
      </View>,
    );
  }

  if (detail.isError) {
    return frame(
      <Notice
        tone="critical"
        title={copy.exams.setup.loadError}
        message={errorMessage(detail.error)}
        icon="info"
        testID="exam-parts-error"
      />,
    );
  }

  if (!schedule) {
    return frame(
      <EmptyState
        icon="exams"
        title={copy.exams.gone}
        message={copy.exams.goneBody}
        testID="exam-parts-gone"
      />,
    );
  }

  const sumLine = (
    <ThemedText
      variant="bodyStrong"
      color={sum === 100 ? colors.accentDeep : colors.tone.caution.fg}
      testID="exam-parts-sum"
    >
      {sum === 100 ? copy.exams.components.weightOk : copy.exams.components.weightLine(sum)}
    </ThemedText>
  );

  // The save bar owns the feedback: Save sits at the bottom of a list that can
  // grow past the fold, so a problem at the top of the body would be off-screen
  // exactly when the office taps it.
  const footer = frozen ? undefined : (
    <View style={styles.footer}>
      {problem ? (
        <Notice tone="critical" title={problem} icon="info" testID="exam-parts-problem" />
      ) : null}
      {error ? (
        <Notice
          tone="critical"
          title={copy.exams.components.failed}
          message={error}
          icon="info"
          testID="exam-parts-error"
        />
      ) : null}
      <View style={styles.sumRow}>{sumLine}</View>
      <CapsuleButton
        title={actions.componentsPending ? copy.exams.components.saving : copy.exams.components.save}
        onPress={save}
        loading={actions.componentsPending}
        disabled={actions.componentsPending}
        testID="exam-parts-save"
        style={styles.cta}
      />
    </View>
  );

  return frame(
    <View style={styles.body}>
      {frozen ? (
        <Notice
          tone="caution"
          title={copy.exams.components.frozen}
          icon="lock"
          testID="exam-parts-frozen"
        />
      ) : null}

      {frozen ? <View style={styles.sumRow}>{sumLine}</View> : null}

      {drafts.map((component, index) => (
        <View key={index} style={styles.part}>
          <View style={styles.partHead}>
            <ThemedText variant="meta" color={colors.muted}>
              {`${index + 1}`}
            </ThemedText>
            {!frozen && drafts.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.exams.components.addPart.replace("Add", "Remove")}
                onPress={() =>
                  setRows(drafts.filter((_, i) => i !== index))
                }
                style={styles.remove}
                testID={`exam-parts-remove-${index}`}
              >
                <AppIcon name="close" size={18} color={colors.tone.critical.fg} />
              </Pressable>
            ) : null}
          </View>
          <FormField
            label={copy.exams.components.nameLabel}
            value={component.name}
            onChangeText={(next) => patch(index, { name: next })}
            editable={!frozen}
            testID={`exam-parts-name-${index}`}
          />
          <View style={styles.grid}>
            <FormField
              label={copy.exams.components.maxLabel}
              value={component.maxMarks}
              onChangeText={(next) => patch(index, { maxMarks: next })}
              keyboardType="numbers-and-punctuation"
              editable={!frozen}
              testID={`exam-parts-max-${index}`}
            />
            <FormField
              label={copy.exams.components.passLabel}
              value={component.passMarks}
              onChangeText={(next) => patch(index, { passMarks: next })}
              keyboardType="numbers-and-punctuation"
              editable={!frozen}
              testID={`exam-parts-pass-${index}`}
            />
            <FormField
              label={copy.exams.components.weightLabel}
              value={component.weightagePercentage}
              onChangeText={(next) => patch(index, { weightagePercentage: next })}
              keyboardType="numbers-and-punctuation"
              editable={!frozen}
              suffix="%"
              testID={`exam-parts-weight-${index}`}
            />
          </View>
          <SwitchRow
            label={copy.exams.components.mandatoryLabel}
            value={component.isMandatoryPass}
            onChange={(next) => patch(index, { isMandatoryPass: next })}
            disabled={frozen}
            testID={`exam-parts-mandatory-${index}`}
          />
        </View>
      ))}

      {frozen ? (
        <ThemedText variant="meta" color={colors.muted}>
          {copy.exams.components.frozenMarks}
        </ThemedText>
      ) : (
        <>
          <CapsuleButton
            title={copy.exams.components.addPart}
            variant="secondary"
            onPress={() => {
              const last = drafts[drafts.length - 1];
              setRows([
                ...drafts,
                {
                  ...EMPTY_DRAFT,
                  maxMarks: last?.maxMarks ?? "",
                  passMarks: last?.passMarks ?? "",
                },
              ]);
            }}
            testID="exam-parts-add"
          />
        </>
      )}
    </View>,
    footer,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  footer: {
    gap: spacing.sm,
  },
  sumRow: {
    alignItems: "flex-end",
  },
  part: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  partHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  remove: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  grid: {
    gap: spacing.sm,
  },
  cta: {
    alignSelf: "stretch",
    marginTop: spacing.sm,
  },
});
