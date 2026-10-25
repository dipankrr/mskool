import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { errorMessage, toFriendlyError } from "../../lib/errors";
import { formatMarks } from "../../lib/homework";
import {
  answerKeySummary,
  draftFromSnapshot,
  isAuthorableQuestionType,
  isOptionType,
  isQuestionType,
  moveItem,
  optionLetter,
  snapshotFromBankItem,
  toSnapshotQuestion,
  totalQuestionMarks,
  trimDecimal,
} from "../../lib/homework-questions";
import type {
  QuestionDraft,
  QuestionType,
  SnapshotOptionInput,
  SnapshotQuestionInput,
} from "../../lib/homework-questions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { HomeworkBankPickerSheet } from "./bank-picker-sheet";
import { ConfirmSheet } from "./confirm-sheet";
import { questionTypeLabel } from "./meta";
import { QuestionComposerSheet } from "./question-composer";
import { sectionTargetOf } from "./types";
import type { AssignmentQuestionRow, BankItemRow } from "./types";

/**
 * One homework's question set — the teacher's authoring desk.
 *
 * The saved shape is a SNAPSHOT, not a live bank reference: `questions.set`
 * replaces the whole set, positions come from list order, and every bank row
 * attached here is a copy from that moment on. The screen therefore owns a
 * local list and saves it as a unit; nothing is written until Save runs.
 *
 * Three server facts are shown rather than hidden:
 * - a set that a student has started is locked forever (`isLocked`);
 * - closed, cancelled and scheduled homework is read-only;
 * - an empty save is refused in practice because the service leaves
 *   `submissionTypes` containing `questions` while attaching no set, so the
 *   save button never offers it.
 *
 * `match` and `file_upload` bank items can be attached and shown with their
 * key, but not authored or edited here: this build has no pair editor and no
 * homework file channel. They stay removable and reorderable.
 */

type SetRow = {
  /** Stable local identity across edits; never sent. */
  key: string;
  sourceQuestionId?: string;
  questionType: QuestionType;
  body: string;
  marks: string;
  explanation: string;
  options: SnapshotOptionInput[];
  correctAnswer?: unknown;
};

let rowSequence = 0;

function nextRowKey(): string {
  rowSequence += 1;
  return `set-row-${rowSequence}`;
}

function localFromSnapshot(
  snapshot: SnapshotQuestionInput,
  key: string,
): SetRow {
  return {
    key,
    ...(snapshot.sourceQuestionId
      ? { sourceQuestionId: snapshot.sourceQuestionId }
      : {}),
    questionType: snapshot.questionType,
    body: snapshot.body,
    marks: trimDecimal(snapshot.marks),
    explanation: snapshot.explanation ?? "",
    options: (snapshot.options ?? []).map((option, index) => ({
      optionText: option.optionText,
      isCorrect: option.isCorrect,
      sortOrder: index,
    })),
    ...(snapshot.correctAnswer !== null && snapshot.correctAnswer !== undefined
      ? { correctAnswer: snapshot.correctAnswer }
      : {}),
  };
}

function localFromServer(row: AssignmentQuestionRow): SetRow {
  return {
    key: row.id,
    ...(row.sourceQuestionId ? { sourceQuestionId: row.sourceQuestionId } : {}),
    questionType: isQuestionType(row.questionType)
      ? row.questionType
      : "short_answer",
    body: row.body,
    marks: trimDecimal(row.marks),
    explanation: row.explanation ?? "",
    options: (row.options ?? []).map((option, index) => ({
      optionText: option.text,
      isCorrect: option.isCorrect,
      sortOrder: index,
    })),
    ...(row.correctAnswer !== null && row.correctAnswer !== undefined
      ? { correctAnswer: row.correctAnswer }
      : {}),
  };
}

function wireOf(row: SetRow, position: number): SnapshotQuestionInput {
  const explanation = row.explanation.trim();
  return {
    ...(row.sourceQuestionId
      ? { sourceQuestionId: row.sourceQuestionId }
      : {}),
    position,
    questionType: row.questionType,
    body: row.body,
    marks: row.marks,
    ...(explanation.length > 0 ? { explanation } : {}),
    ...(row.options.length > 0
      ? {
          options: row.options.map((option, index) => ({
            optionText: option.optionText,
            isCorrect: option.isCorrect,
            sortOrder: index,
          })),
        }
      : {}),
    ...(row.correctAnswer !== null && row.correctAnswer !== undefined
      ? { correctAnswer: row.correctAnswer }
      : {}),
  };
}

export function HomeworkQuestionsScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const assignmentId = params.id ?? "";

  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("homework:read");
  const canUpdate = has("homework:update");
  const canReadBank = has("homework:read");
  const canReadSubjects = has("subject:read");

  const utils = trpc.useUtils();

  const detail = trpc.homework.byId.useQuery(
    { organizationId: organizationId ?? "", id: assignmentId },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(assignmentId),
    },
  );

  const questions = trpc.homework.questions.get.useQuery(
    { organizationId: organizationId ?? "", id: assignmentId },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(assignmentId),
    },
  );

  const assignment = detail.data ?? null;
  const section = sectionTargetOf(assignment);
  const sectionId = section?.sectionId ?? null;
  const subjectId = assignment?.subjectId ?? null;
  const pairReady = Boolean(sectionId && subjectId);

  // `byId` carries no subject name (only the id), and the bank picker names the
  // subject it searches. The clipped subject list is the same source the form's
  // pair picker uses, so the two surfaces cannot disagree.
  const subjects = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    {
      enabled:
        ready && Boolean(organizationId) && canReadSubjects && pairReady,
    },
  );
  const subjectName =
    subjects.data?.find((row) => row.id === subjectId)?.name ??
    copy.homework.bank.title;

  const [draftRows, setRows] = useState<SetRow[] | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [composer, setComposer] = useState<
    { mode: "add" } | { mode: "edit"; index: number } | null
  >(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  /**
   * The server set seeds the list; it is not copied into state on arrival. Until
   * the teacher touches something, a refetch may replace what they see. The
   * first edit pins `draftRows`, and from then on the local list is the source
   * of truth until Save returns the stored set. This avoids a hydration effect
   * that would race every background refetch.
   */
  const serverRows = useMemo(
    () => (questions.data ?? []).map(localFromServer),
    [questions.data],
  );
  const rows = draftRows ?? serverRows;

  const status = assignment?.status ?? null;
  const locked = assignment?.isLocked === true;
  const statusBlocked =
    status === "closed" || status === "cancelled" || status === "scheduled";
  const editable = canUpdate && !locked && !statusBlocked;

  const dirty = useMemo(
    () =>
      draftRows !== null &&
      JSON.stringify(draftRows) !==
        (baseline ?? JSON.stringify(serverRows)),
    [draftRows, baseline, serverRows],
  );
  useUnsavedChanges(editable && dirty);

  const text = copy.homework.questions;

  const save = trpc.homework.questions.set.useMutation({
    onSuccess: async (data) => {
      const next = data.map(localFromServer);
      setRows(next);
      setBaseline(JSON.stringify(next));
      setSaveError(null);
      setSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Promise.all([
        utils.homework.questions.get.invalidate(),
        utils.homework.byId.invalidate(),
        utils.homework.list.invalidate(),
      ]);
    },
    onError: (error) => {
      setSaveError(error);
      setSaved(false);
    },
  });

  const frame = (children: React.ReactNode, footer?: React.ReactNode) => (
    <ScreenFrame
      title={text.title}
      meta={
        assignment
          ? assignment.title
          : null
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-questions-back"
      titleTestID="homework-questions-title"
      action={
        canReadBank
          ? {
              label: text.bankAction,
              icon: "bank" as const,
              accessibilityHint: text.bankActionHint,
              onPress: () => router.push("/homework/bank"),
              testID: "homework-questions-bank",
            }
          : undefined
      }
      footer={footer}
      onRefresh={() => {
        void detail.refetch();
        void questions.refetch();
      }}
      refreshing={false}
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.homework.noAccessTitle}
        message={copy.homework.noAccessBody}
        testID="homework-questions-denied"
      />,
    );
  }

  if (!assignmentId) {
    return frame(
      <EmptyState
        icon="quiz"
        title={copy.homework.detail.notFoundTitle}
        message={copy.homework.detail.notFoundBody}
        testID="homework-questions-missing"
      />,
    );
  }

  if (detail.isPending || questions.isPending) {
    return frame(
      <View style={styles.skeleton}>
        <Skeleton height={110} />
        <Skeleton height={180} />
        <Skeleton height={180} />
      </View>,
    );
  }

  if (detail.isError) {
    const friendly = toFriendlyError(detail.error);
    if (friendly.kind === "notFound" || friendly.kind === "forbidden") {
      return frame(
        <EmptyState
          icon="shield"
          title={text.noAccessTitle}
          message={text.noAccessBody}
          testID="homework-questions-homework-denied"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={detail.error}
        onRetry={() => void detail.refetch()}
        testID="homework-questions-homework-error"
      />,
    );
  }

  if (questions.isError) {
    return frame(
      <ErrorCard
        cause={questions.error}
        onRetry={() => void questions.refetch()}
        testID="homework-questions-error"
      />,
    );
  }

  if (!assignment) {
    return frame(
      <EmptyState
        icon="quiz"
        title={copy.homework.detail.notFoundTitle}
        message={copy.homework.detail.notFoundBody}
        testID="homework-questions-not-found"
      />,
    );
  }

  const total = totalQuestionMarks(rows.map((row) => row.marks));

  const openAdd = () => {
    setSaved(false);
    setComposer({ mode: "add" });
  };

  const openEdit = (index: number) => {
    const row = rows[index];
    // The composer is only offered for authorable types; guard anyway so a
    // stray press cannot open a form that would rewrite a match question.
    if (!row || !isAuthorableQuestionType(row.questionType)) return;
    setSaved(false);
    setComposer({ mode: "edit", index });
  };

  const composerInitial =
    composer?.mode === "edit" ? draftOf(rows[composer.index]) : undefined;

  const submitComposer = (draft: QuestionDraft) => {
    if (!composer) return;
    if (composer.mode === "add") {
      const snapshot = toSnapshotQuestion(draft, rows.length + 1);
      setRows((current) => [
        ...(current ?? serverRows),
        localFromSnapshot(snapshot, nextRowKey()),
      ]);
    } else {
      const existing = rows[composer.index];
      if (!existing) return;
      const snapshot = toSnapshotQuestion(
        draft,
        composer.index + 1,
        existing.sourceQuestionId,
      );
      setRows((current) =>
        (current ?? serverRows).map((row, index) =>
          index === composer.index
            ? { ...localFromSnapshot(snapshot, row.key) }
            : row,
        ),
      );
    }
    setComposer(null);
    setSaveError(null);
  };

  const attachBank = (items: BankItemRow[]) => {
    setRows((current) => [
      ...(current ?? serverRows),
      ...items.map((item) =>
        localFromSnapshot(snapshotFromBankItem(item, 0), nextRowKey()),
      ),
    ]);
    setPickerOpen(false);
    setSaved(false);
  };

  const removeRow = () => {
    if (removeIndex === null) return;
    setRows((current) =>
      (current ?? serverRows).filter((_, index) => index !== removeIndex),
    );
    setRemoveIndex(null);
    setSaved(false);
  };

  const move = (index: number, delta: number) => {
    void Haptics.selectionAsync();
    setRows((current) => moveItem(current ?? serverRows, index, delta));
    setSaved(false);
  };

  const submitSave = () => {
    if (!pairReady || !sectionId || !subjectId) return;
    setSaveError(null);
    setSaved(false);
    save.mutate({
      organizationId: organizationId ?? "",
      id: assignment.id,
      sectionId,
      subjectId,
      questions: rows.map((row, index) => wireOf(row, index + 1)),
    });
  };

  const footer = editable ? (
    <>
      {saveError ? (
        <Notice
          tone="critical"
          title={text.saveError}
          message={errorMessage(saveError)}
          style={styles.footerNotice}
          testID="homework-questions-save-error"
        />
      ) : null}
      {rows.length === 0 ? (
        <ThemedText
          variant="meta"
          color={colors.tone.caution.fg}
          accessibilityLiveRegion="polite"
        >
          {text.emptySave}
        </ThemedText>
      ) : (
        <ThemedText variant="meta">{text.saveHint}</ThemedText>
      )}
      <CapsuleButton
        title={save.isPending ? text.saving : text.save}
        icon="check"
        onPress={submitSave}
        loading={save.isPending}
        disabled={
          !dirty ||
          save.isPending ||
          rows.length === 0 ||
          !pairReady
        }
        testID="homework-questions-save"
      />
    </>
  ) : undefined;

  const readOnlyBody = locked
    ? text.lockedBody
    : status === "scheduled"
      ? text.scheduledBody
      : status === "closed" || status === "cancelled"
        ? text.closedBody
        : text.readOnlyBody;

  return (
    <>
      {frame(
        <View style={styles.body}>
          {!editable ? (
            <Notice
              tone="neutral"
              title={
                locked
                  ? text.lockedTitle
                  : status === "closed" || status === "cancelled"
                    ? text.readOnly
                    : status === "scheduled"
                      ? text.readOnly
                      : text.readOnly
              }
              message={readOnlyBody}
              testID="homework-questions-read-only"
            />
          ) : null}

          {assignment.revisionCount > 0 && status === "published" && !locked ? (
            <Notice
              tone="caution"
              message={text.revisionNote}
              testID="homework-questions-revision-note"
            />
          ) : null}

          {!pairReady ? (
            <Notice
              tone="caution"
              title={copy.homework.detail.noTargetTitle}
              message={copy.homework.detail.noTargetBody}
              testID="homework-questions-no-target"
            />
          ) : null}

          {saved ? (
            <Notice
              tone="positive"
              title={text.savedTitle}
              message={text.savedBody}
              testID="homework-questions-saved"
            />
          ) : null}

          <Card style={styles.summary}>
            <View style={styles.summaryHead}>
              <ThemedText variant="sectionLabel">
                {text.summaryTitle}
              </ThemedText>
              {dirty ? (
                <StatusPill
                  label={text.dirtyNote}
                  tone="caution"
                  testID="homework-questions-dirty"
                />
              ) : null}
            </View>
            <ThemedText variant="hero">{String(rows.length)}</ThemedText>
            <ThemedText variant="meta">
              {rows.length === 0
                ? editable
                  ? text.noQuestionsHint
                  : text.noQuestionsReadOnly
                : `${text.questionCount(rows.length)} · ${text.marksTotal(total)}`}
            </ThemedText>
          </Card>

          {rows.length === 0 ? (
            <EmptyState
              icon="quiz"
              title={text.emptyTitle}
              message={editable ? text.emptyBody : text.emptyBodyReadOnly}
              testID="homework-questions-empty"
            />
          ) : (
            <View style={styles.cards}>
              {rows.map((row, index) => (
                <QuestionCard
                  key={row.key}
                  row={row}
                  position={index + 1}
                  first={index === 0}
                  last={index === rows.length - 1}
                  editable={editable}
                  onEdit={() => openEdit(index)}
                  onMoveUp={() => move(index, -1)}
                  onMoveDown={() => move(index, 1)}
                  onRemove={() => setRemoveIndex(index)}
                />
              ))}
            </View>
          )}

          {editable ? (
            <View style={styles.addBlock}>
              <CapsuleButton
                title={rows.length === 0 ? text.addFirst : text.newQuestion}
                icon="add"
                onPress={openAdd}
                testID="homework-questions-add"
              />
              <CapsuleButton
                title={text.fromBank}
                icon="bank"
                variant="secondary"
                onPress={() => setPickerOpen(true)}
                testID="homework-questions-from-bank"
              />
            </View>
          ) : null}
        </View>,
        footer,
      )}

      {composer ? (
        <QuestionComposerSheet
          initial={composerInitial}
          mode={composer.mode}
          submitting={false}
          error={null}
          onSubmit={submitComposer}
          onClose={() => setComposer(null)}
        />
      ) : null}

      {pickerOpen && sectionId && subjectId ? (
        <HomeworkBankPickerSheet
          subjectId={subjectId}
          subjectName={subjectName}
          attachedIds={rows
            .map((row) => row.sourceQuestionId)
            .filter((id): id is string => Boolean(id))}
          onAttach={attachBank}
          onClose={() => setPickerOpen(false)}
          onOpenBank={() => {
            setPickerOpen(false);
            router.push("/homework/bank");
          }}
        />
      ) : null}

      {removeIndex !== null ? (
        <ConfirmSheet
          title={text.removeConfirmTitle}
          body={text.removeConfirmBody(removeIndex + 1)}
          confirmLabel={text.removeConfirm}
          keepLabel={copy.homework.actions.keep}
          tone="destructive"
          submitting={false}
          error={null}
          onConfirm={removeRow}
          onClose={() => setRemoveIndex(null)}
          testIDPrefix="homework-questions-remove"
        />
      ) : null}
    </>
  );
}

function draftOf(row: SetRow | undefined): QuestionDraft | undefined {
  if (!row || !isAuthorableQuestionType(row.questionType)) return undefined;
  const draft = draftFromSnapshot({
    questionType: row.questionType,
    body: row.body,
    marks: row.marks,
    explanation: row.explanation.length > 0 ? row.explanation : null,
    options: isOptionType(row.questionType)
      ? row.options.map((option, index) => ({
          id: index + 1,
          text: option.optionText,
          isCorrect: option.isCorrect,
        }))
      : null,
    correctAnswer: row.correctAnswer ?? null,
  });
  return draft ?? undefined;
}

function QuestionCard({
  row,
  position,
  first,
  last,
  editable,
  onEdit,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  row: SetRow;
  position: number;
  first: boolean;
  last: boolean;
  editable: boolean;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const text = copy.homework.questions;
  const authorable = isAuthorableQuestionType(row.questionType);
  const optionType = isOptionType(row.questionType);
  const key = answerKeySummary({
    questionType: row.questionType,
    options: row.options.map((option, index) => ({
      id: index + 1,
      text: option.optionText,
      isCorrect: option.isCorrect,
    })),
    correctAnswer: row.correctAnswer ?? null,
  });

  return (
    <Card style={styles.card} testID={`homework-questions-row-${position}`}>
      <View style={styles.cardHead}>
        <View style={styles.position}>
          <ThemedText variant="bodyStrong" color={colors.accentDeep}>
            {position}
          </ThemedText>
        </View>
        <View style={styles.cardTitle}>
          <ThemedText variant="bodyStrong" numberOfLines={2}>
            {questionTypeLabel(row.questionType)}
          </ThemedText>
          <ThemedText variant="meta">
            {copy.homework.questions.marksOf(formatMarks(row.marks) ?? row.marks)}
          </ThemedText>
        </View>
        {!authorable ? (
          <StatusPill label={text.readOnly} tone="neutral" />
        ) : null}
      </View>

      <ThemedText variant="body" selectable style={styles.questionBody}>
        {row.body}
      </ThemedText>

      {optionType ? (
        <View style={styles.options}>
          <ThemedText variant="sectionLabel">{text.options}</ThemedText>
          {row.options.map((option, index) => (
            <View key={`${row.key}-option-${index}`} style={styles.optionRow}>
              <AppIcon
                name={option.isCorrect ? "checkCircle" : "closeCircle"}
                size={16}
                color={
                  option.isCorrect ? colors.accentDeep : colors.chevron
                }
              />
              <ThemedText
                variant="body"
                style={styles.optionText}
                color={option.isCorrect ? colors.ink : colors.muted}
              >
                {`${optionLetter(index)}. ${option.optionText}`}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.keyBlock}>
          <ThemedText variant="sectionLabel">{text.answerKey}</ThemedText>
          <ThemedText variant="body" selectable>
            {key ?? text.noKey}
          </ThemedText>
        </View>
      )}

      {row.explanation.trim().length > 0 ? (
        <View style={styles.explanation}>
          <ThemedText variant="sectionLabel">{text.explanation}</ThemedText>
          <ThemedText variant="meta" selectable>
            {row.explanation}
          </ThemedText>
        </View>
      ) : null}

      {editable ? (
        <View style={styles.actions}>
          <CardAction
            icon="edit"
            label={text.edit}
            disabled={!authorable}
            onPress={onEdit}
            testID={`homework-questions-edit-${position}`}
          />
          <CardAction
            icon="chevronDown"
            label={text.moveDown}
            disabled={last}
            onPress={onMoveDown}
            testID={`homework-questions-down-${position}`}
          />
          <CardAction
            icon="chevronDown"
            label={text.moveUp}
            disabled={first}
            onPress={onMoveUp}
            rotate
            testID={`homework-questions-up-${position}`}
          />
          <CardAction
            icon="close"
            label={text.remove}
            tone="critical"
            onPress={onRemove}
            testID={`homework-questions-remove-${position}`}
          />
        </View>
      ) : null}
    </Card>
  );
}

function CardAction({
  icon,
  label,
  onPress,
  disabled = false,
  tone = "neutral",
  rotate = false,
  testID,
}: {
  icon: "edit" | "chevronDown" | "close";
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "neutral" | "critical";
  rotate?: boolean;
  testID: string;
}) {
  const color =
    tone === "critical" ? colors.tone.critical.fg : colors.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.action,
        pressed ? styles.pressed : null,
        disabled ? styles.actionDisabled : null,
      ]}
      testID={testID}
    >
      <AppIcon
        name={icon}
        size={18}
        color={color}
        style={rotate ? styles.rotate : undefined}
      />
      <ThemedText variant="meta" color={color} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
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
  summary: {
    gap: spacing.xs,
  },
  summaryHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cards: {
    gap: spacing.md,
  },
  card: {
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  position: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  cardTitle: {
    flex: 1,
    gap: spacing.xxs,
  },
  questionBody: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  options: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  optionText: {
    flex: 1,
  },
  keyBlock: {
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  explanation: {
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  action: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    borderRadius: radius.sm,
  },
  actionDisabled: {
    opacity: 0.35,
  },
  rotate: {
    transform: [{ rotate: "180deg" }],
  },
  addBlock: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  footerNotice: {
    marginBottom: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
});
