import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { EmptyState } from "../../components/empty-state";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import {
  createExamPayload,
  editFrozenFields,
  effectiveCountsTowardTerm,
  requiresLinkedExam,
} from "../../lib/exam-setup";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { useExamDetail, useExamScope } from "./use-exam-data";
import {
  useExamFormActions,
  useExamTerms,
  useLinkedExamOptions,
} from "./use-setup";

const EXAM_TYPES = ["regular", "mock", "test", "supplementary", "improvement"] as const;

/**
 * The exam form (chunk 7D) — create and edit in one screen. Create is a
 * short form: name, term, type, and the two policy switches; the year is
 * derived from the term server-side and mocks/tests are forced out of the
 * term aggregate, so the form shows that truth instead of a toggle the
 * save will override. Edit freezes what the server freezes — weight,
 * counting and negative marking go disabled with the reason printed where
 * they sit — and term/type are facts, never controls.
 */
export function ExamFormScreen() {
  const { examId } = useLocalSearchParams<{ examId?: string }>();
  const editing = Boolean(examId);
  const scope = useExamScope();
  const detail = useExamDetail(editing ? (examId ?? "") : "");
  const terms = useExamTerms();
  const linked = useLinkedExamOptions(editing ? (examId ?? "") : null);
  const actions = useExamFormActions(examId ?? null);

  const exam = detail.data?.exam ?? null;
  const frozen = useMemo(
    () => (exam ? editFrozenFields(exam) : null),
    [exam],
  );

  const [name, setName] = useState("");
  const [termId, setTermId] = useState<string | null>(null);
  const [examType, setExamType] = useState<string>("regular");
  const [weight, setWeight] = useState("");
  const [counted, setCounted] = useState(true);
  const [negative, setNegative] = useState(false);
  const [linkedExamId, setLinkedExamId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Edit mode seeds the fields once, from the fetched row.
  if (editing && exam && !seeded) {
    setSeeded(true);
    setName(exam.name);
    setExamType(exam.examType);
    setWeight(String(Number(exam.weightageInTerm)));
    setCounted(exam.countsTowardTermResult);
    setNegative(exam.allowsNegativeMarking);
  }

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={editing ? copy.exams.form.editTitle : copy.exams.form.createTitle}
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-form-back"
      titleTestID="exam-form-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!editing && !scope.canCreate) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="exam-form-denied"
      />,
    );
  }

  if (editing && (!scope.ready || detail.isPending)) {
    return frame(
      <View style={styles.body} testID="exam-form-loading">
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </View>,
    );
  }

  if (editing && detail.isError) {
    return frame(
      <Notice
        tone="critical"
        title={copy.exams.results.loadError}
        message={errorMessage(detail.error)}
        icon="info"
        testID="exam-form-error"
      />,
    );
  }

  if (editing && !exam) {
    return frame(
      <EmptyState
        icon="exams"
        title={copy.exams.gone}
        message={copy.exams.goneBody}
        testID="exam-form-gone"
      />,
    );
  }

  const termOptions = (terms.data ?? []).map((term) => ({
    id: term.id,
    label: term.name,
  }));
  const linkedOptions = linked.rows.map((row) => ({
    id: row.id,
    label: row.name,
  }));
  const countedValue = effectiveCountsTowardTerm(examType, counted);
  const needsLinked = requiresLinkedExam(examType);

  const save = () => {
    setProblem(null);
    if (name.trim() === "") return setProblem(copy.exams.form.needName);
    if (!editing && !termId) return setProblem(copy.exams.form.needTerm);
    if (needsLinked && !linkedExamId && !editing) {
      return setProblem(copy.exams.form.needLinked);
    }
    const payload = createExamPayload({
      name,
      termId: termId ?? "",
      examType,
      weightageInTerm: weight,
      countsTowardTermResult: counted,
      allowsNegativeMarking: negative,
      linkedExamId: linkedExamId,
    });
    const run = editing
      ? actions.update({
          name: payload.name as string,
          ...(frozen?.weightage
            ? {}
            : { weightageInTerm: payload.weightageInTerm }),
          ...(frozen?.countsTowardTerm
            ? {}
            : { countsTowardTermResult: payload.countsTowardTermResult }),
          ...(frozen?.negativeMarking
            ? {}
            : { allowsNegativeMarking: payload.allowsNegativeMarking }),
        })
      : actions.create(payload);
    void run
      .then((row) => {
        if (editing) {
          router.back();
        } else if (row && typeof row === "object" && "id" in row) {
          router.replace({
            pathname: "/exams/[examId]",
            params: { examId: (row as { id: string }).id },
          });
        } else {
          router.back();
        }
      })
      .catch(() => {
        // The server's wording prints below; the form keeps every field.
      });
  };

  return frame(
    <View style={styles.body}>
      {frozen?.weightage ? (
        <Notice
          tone="caution"
          title={copy.exams.form.frozenNote}
          icon="info"
          testID="exam-form-frozen"
        />
      ) : null}
      {problem ? (
        <Notice
          tone="critical"
          title={problem}
          icon="info"
          testID="exam-form-problem"
        />
      ) : null}

      <FormField
        label={copy.exams.form.nameLabel}
        value={name}
        onChangeText={setName}
        placeholder={copy.exams.form.namePlaceholder}
        testID="exam-form-name"
      />

      {!editing ? (
        <SelectField
          label={copy.exams.form.termLabel}
          valueLabel={termOptions.find((option) => option.id === termId)?.label ?? null}
          placeholder={copy.exams.form.termPlaceholder}
          options={termOptions}
          currentId={termId ?? ""}
          onSelect={setTermId}
          testID="exam-form-term"
        />
      ) : null}

      {!editing ? (
        <ChoicePills<string>
          label={copy.exams.form.typeLabel}
          value={examType}
          options={EXAM_TYPES.map((type) => ({
            value: type,
            label: (copy.exams.type as Record<string, string | undefined>)[type] ?? type,
          }))}
          onChange={setExamType}
          testIDPrefix="exam-form-type"
        />
      ) : (
        <FormField
          label={copy.exams.form.typeLabel}
          value={(copy.exams.type as Record<string, string | undefined>)[examType] ?? examType}
          onChangeText={() => {}}
          editable={false}
          testID="exam-form-type-fact"
        />
      )}

      <FormField
        label={copy.exams.form.weightLabel}
        value={weight}
        onChangeText={setWeight}
        placeholder={copy.exams.form.weightPlaceholder}
        help={frozen?.weightage ? undefined : copy.exams.form.weightHelp}
        keyboardType="numbers-and-punctuation"
        editable={!frozen?.weightage}
        suffix="%"
        testID="exam-form-weight"
      />

      <SwitchRow
        label={copy.exams.form.countedLabel}
        value={countedValue}
        onChange={setCounted}
        disabled={Boolean(frozen?.countsTowardTerm) || examType === "mock" || examType === "test"}
        testID="exam-form-counted"
      />
      {examType === "mock" || examType === "test" ? (
        <ThemedText variant="meta" color={colors.muted}>
          {copy.exams.form.countedAutoNote}
        </ThemedText>
      ) : null}

      <SwitchRow
        label={copy.exams.form.negativeLabel}
        value={negative}
        onChange={setNegative}
        disabled={Boolean(frozen?.negativeMarking)}
        testID="exam-form-negative"
      />

      {needsLinked && !editing ? (
        <>
          <SelectField
            label={copy.exams.form.linkedLabel}
            valueLabel={
              linkedOptions.find((option) => option.id === linkedExamId)?.label ?? null
            }
            placeholder={copy.exams.form.linkedPlaceholder}
            options={linkedOptions}
            currentId={linkedExamId ?? ""}
            onSelect={setLinkedExamId}
            help={copy.exams.form.linkedHelp}
            testID="exam-form-linked"
          />
        </>
      ) : null}

      <CapsuleButton
        title={actions.pending ? copy.exams.form.saving : editing ? copy.exams.form.saveEdit : copy.exams.form.save}
        onPress={save}
        loading={actions.pending}
        disabled={actions.pending}
        testID="exam-form-save"
        style={styles.cta}
      />
    </View>,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  cta: {
    alignSelf: "stretch",
    marginTop: spacing.sm,
  },
});
