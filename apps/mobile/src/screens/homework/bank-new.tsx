import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import {
  useBranchMeta,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import {
  checkQuestionDraft,
  emptyQuestionDraft,
  toSnapshotQuestion,
} from "../../lib/homework-questions";
import type { QuestionDraft } from "../../lib/homework-questions";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import { QuestionFields } from "./question-fields";
import { SegmentBar } from "../../components/segment-bar";
import type { SegmentOption } from "../../components/segment-bar";
import { useTeachingPairs } from "./use-teaching-pairs";
import type { Difficulty } from "./meta";

const DIFFICULTY_OPTIONS: readonly SegmentOption<Difficulty>[] = [
  { value: "easy", label: copy.homework.bank.difficultyLevels.easy, testID: "homework-bank-difficulty-easy" },
  { value: "medium", label: copy.homework.bank.difficultyLevels.medium, testID: "homework-bank-difficulty-medium" },
  { value: "hard", label: copy.homework.bank.difficultyLevels.hard, testID: "homework-bank-difficulty-hard" },
];

const MAX_TOPIC = 250;

/**
 * Write one question into the bank.
 *
 * The bank is school-wide, but writing still needs a real (section, subject)
 * pair: that pair is the server's subject gate, and the section supplies the
 * optional `classId` that says which class the question was written for. The
 * pair picker is the same component tree as the homework form, so a subject
 * teacher sees exactly the subjects they can write for.
 *
 * The question fields are `QuestionFields`, shared with the assignment set's
 * composer — a bank question and a homework question cannot validate
 * differently. Saving is one deliberate action; the new row opens on its detail
 * screen so the teacher can read it back in full.
 */
export function HomeworkBankNewScreen() {
  const { organizationId, ready } = useActiveContext();
  const { has } = usePermissions();
  const branchName = useBranchMeta();

  const canCreate = has("homework:create");

  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [shared, setShared] = useState(false);
  const [draft, setDraft] = useState<QuestionDraft>(() =>
    emptyQuestionDraft("mcq_single"),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const pairs = useTeachingPairs({ enabled: canCreate, sectionId });
  const section = pairs.sectionOptions.find((row) => row.id === sectionId);
  const classId = section?.classId ?? null;
  const subjectLabel =
    pairs.subjects.find((row) => row.id === subjectId)?.name ?? null;

  const check = checkQuestionDraft(draft);
  const topicTooLong = topic.trim().length > MAX_TOPIC;
  const pairReady = Boolean(sectionId && subjectId);
  const canSave = pairReady && check.valid && !topicTooLong;

  const initial = useMemo(
    () =>
      JSON.stringify({
        sectionId: null,
        subjectId: null,
        topic: "",
        difficulty: "medium",
        shared: false,
        draft: emptyQuestionDraft("mcq_single"),
      }),
    [],
  );
  const current = useMemo(
    () =>
      JSON.stringify({
        sectionId,
        subjectId,
        topic,
        difficulty,
        shared,
        draft,
      }),
    [sectionId, subjectId, topic, difficulty, shared, draft],
  );
  useUnsavedChanges(canCreate && !createdId && current !== initial);

  const utils = trpc.useUtils();
  const create = trpc.homework.bank.create.useMutation({
    onSuccess: (data) => {
      setSaveError(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void utils.homework.bank.list.invalidate();
      setCreatedId(data.id);
    },
    onError: (error) => setSaveError(error),
  });

  useEffect(() => {
    if (!createdId) return;
    router.replace({
      pathname: "/homework/bank/[itemId]",
      params: { itemId: createdId },
    });
  }, [createdId]);

  const noSections =
    pairs.sectionsQuery.isSuccess && pairs.sectionOptions.length === 0;

  const frame = (children: React.ReactNode, footer?: React.ReactNode) => (
    <ScreenFrame
      title={copy.homework.bank.newTitle}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-bank-new-back"
      titleTestID="homework-bank-new-title"
      footer={footer}
    >
      {children}
    </ScreenFrame>
  );

  if (!canCreate) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.homework.bank.deniedTitle}
        message={copy.homework.bank.deniedBody}
        testID="homework-bank-new-denied"
      />,
    );
  }

  if (!ready) {
    return frame(
      <View style={styles.skeleton}>
        <Skeleton height={120} />
        <Skeleton height={180} />
      </View>,
    );
  }

  const submit = () => {
    setSubmitted(true);
    if (!canSave || !sectionId || !subjectId) return;
    setSaveError(null);
    const snapshot = toSnapshotQuestion(draft, 1);
    const explanation = snapshot.explanation;
    const trimmedTopic = topic.trim();
    create.mutate({
      organizationId: organizationId ?? "",
      sectionId,
      subjectId,
      ...(classId ? { classId } : {}),
      ...(trimmedTopic.length > 0 ? { topic: trimmedTopic } : {}),
      questionType: snapshot.questionType,
      body: snapshot.body,
      ...(explanation ? { explanation } : {}),
      ...(snapshot.options ? { options: snapshot.options } : {}),
      ...(snapshot.correctAnswer !== null &&
      snapshot.correctAnswer !== undefined
        ? { correctAnswer: snapshot.correctAnswer }
        : {}),
      difficulty,
      defaultMarks: snapshot.marks,
      visibility: shared ? "school" : "private",
    });
  };

  const footer = noSections ? undefined : (
    <>
      {saveError ? (
        <Notice
          tone="critical"
          title={copy.homework.bank.saveError}
          message={errorMessage(saveError)}
          style={styles.footerNotice}
          testID="homework-bank-new-error"
        />
      ) : null}
      {submitted && !canSave ? (
        <Notice
          tone="caution"
          title={copy.homework.questions.composerErrorTitle}
          message={
            !pairReady
              ? copy.homework.bank.noPairBody
              : topicTooLong
                ? copy.homework.bank.topicTooLong
                : copy.homework.questions.composerTypeLocked
          }
          style={styles.footerNotice}
          testID="homework-bank-new-check"
        />
      ) : null}
      <CapsuleButton
        title={create.isPending ? copy.homework.bank.saving : copy.homework.bank.save}
        icon="check"
        onPress={submit}
        loading={create.isPending}
        disabled={create.isPending}
        testID="homework-bank-new-save"
      />
    </>
  );

  if (noSections) {
    return frame(
      <EmptyState
        icon="bank"
        title={copy.homework.bank.noPairTitle}
        message={copy.homework.bank.noPairBody}
        testID="homework-bank-new-no-pair"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      <Notice
        tone="neutral"
        message={copy.homework.bank.newBody}
        testID="homework-bank-new-note"
      />

      <SectionLabel>{copy.homework.bank.where}</SectionLabel>
      <Card>
        {pairs.sectionsQuery.isError ? (
          <>
            <Notice
              tone="critical"
              message={errorMessage(pairs.sectionsQuery.error)}
              testID="homework-bank-new-sections-error"
            />
            <CapsuleButton
              title={copy.common.retry}
              variant="secondary"
              size="compact"
              onPress={() => pairs.refetchSections()}
              testID="homework-bank-new-sections-retry"
              style={styles.retry}
            />
          </>
        ) : null}
        <SelectField
          label={copy.homework.form.section}
          valueLabel={section?.label ?? null}
          placeholder={copy.homework.form.sectionPlaceholder}
          options={pairs.sectionOptions.map((row) => ({
            id: row.id,
            label: row.label,
          }))}
          currentId={sectionId ?? ""}
          onSelect={(id) => {
            setSectionId(id);
            // A subject from the previous class never carries over.
            setSubjectId(null);
            setSaveError(null);
          }}
          help={
            pairs.sectionsQuery.isPending
              ? copy.homework.form.loadingSections
              : copy.homework.bank.whereHelp
          }
          disabled={pairs.sectionsQuery.isPending}
          testID="homework-bank-new-section"
        />
        <SelectField
          label={copy.homework.form.subject}
          valueLabel={subjectLabel}
          placeholder={
            sectionId
              ? pairs.subjectsPending
                ? copy.homework.form.loadingSubjects
                : copy.homework.form.subjectPlaceholder
              : copy.homework.form.subjectFirst
          }
          options={pairs.subjects.map((row) => ({
            id: row.id,
            label: row.name,
          }))}
          currentId={subjectId ?? ""}
          onSelect={(id) => {
            setSubjectId(id);
            setSaveError(null);
          }}
          help={
            pairs.subjectsError
              ? errorMessage(pairs.subjectsError)
              : sectionId && !pairs.subjectsPending && pairs.subjects.length === 0
                ? copy.homework.bank.noPairBody
                : undefined
          }
          disabled={!sectionId || pairs.subjectsPending}
          testID="homework-bank-new-subject"
        />
        {pairs.subjectsError ? (
          <CapsuleButton
            title={copy.common.retry}
            variant="secondary"
            size="compact"
            onPress={() => pairs.refetchSubjects()}
            testID="homework-bank-new-subjects-retry"
            style={styles.retry}
          />
        ) : null}
      </Card>

      <SectionLabel>{copy.homework.bank.details}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.homework.bank.topic}
          value={topic}
          onChangeText={setTopic}
          placeholder={copy.homework.bank.topicPlaceholder}
          error={submitted && topicTooLong ? copy.homework.bank.topicTooLong : undefined}
          maxLength={MAX_TOPIC}
          testID="homework-bank-new-topic"
        />
        <View style={styles.difficulty}>
          <ThemedText variant="caption" style={styles.label}>
            {copy.homework.bank.difficulty}
          </ThemedText>
          <SegmentBar
            label={copy.homework.bank.difficulty}
            value={difficulty}
            options={DIFFICULTY_OPTIONS}
            onChange={setDifficulty}
          />
        </View>
        <SwitchRow
          label={copy.homework.bank.share}
          value={shared}
          onChange={setShared}
          help={copy.homework.bank.shareHelp}
          testID="homework-bank-new-share"
        />
      </Card>

      <SectionLabel>{copy.homework.questions.body}</SectionLabel>
      <Card style={styles.card}>
        <QuestionFields
          draft={draft}
          onChange={setDraft}
          submitting={create.isPending}
          touched={submitted}
        />
      </Card>
    </View>,
    footer,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.xs,
  },
  difficulty: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  label: {
    marginBottom: 0,
  },
  retry: {
    marginTop: spacing.sm,
  },
  footerNotice: {
    marginBottom: spacing.sm,
  },
});
