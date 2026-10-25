import { useEffect, useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { LinkRow } from "../../components/link-row";
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
import {
  clockOf,
  dayKeyOf,
  dayLabel,
  formatMarks,
  isPastClose,
  isPastDue,
} from "../../lib/homework";
import {
  answerKeySummary,
  answerSummary,
} from "../../lib/homework-questions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { AnswerGradeSheet } from "./answer-grade-sheet";
import { ExcuseSheet } from "./excuse-sheet";
import { ExtendSheet } from "./extend-sheet";
import { GradeActionsSheet } from "./grade-actions-sheet";
import { checkGradeDraft, MAX_FEEDBACK } from "./grade-logic";
import {
  attemptStatusLabel,
  attemptStatusTone,
  isAttemptStatus,
  isStudentWorkStatus,
  outcomeLabel,
  questionTypeLabel,
  studentStatusLabel,
  studentStatusTone,
} from "./meta";
import { ResubmitSheet } from "./resubmit-sheet";
import type {
  AssignmentQuestionRow,
  AttemptAnswerRow,
  AttemptRow,
  EvaluationRow,
  HomeworkDetail,
  StudentAssignmentDetail,
} from "./types";

/**
 * One student's work and review. The screen is the teacher's desk for that
 * child: what came in, what was said last time, one score field, one comment,
 * and the three occasional acts behind a deliberate tap.
 *
 * The form is keyed by the student-assignment id and initialised from the
 * current evaluation, so a background refetch never overwrites typed work.
 * Save returns to the grid only after the server confirms — the app never
 * shows a saved state the server has not accepted.
 *
 * Two server rules are surfaced rather than hidden: a marks review needs an
 * online submission, and grade/rubric scoring is read-only in this build. The
 * resubmit, extend and excuse paths still work in both cases, so the screen
 * stays useful instead of offering a dead field.
 */
export function HomeworkGradeStudentScreen() {
  const params = useLocalSearchParams<{
    saId?: string;
    name?: string;
    roll?: string;
  }>();
  const saId = params.saId ?? "";
  const displayName =
    params.name?.trim() || copy.homework.grade.studentFallback;
  const roll = params.roll?.trim() ?? "";

  const { organizationId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("homework:read");
  const canGrade = has("homework:grade");
  const canUpdate = has("homework:update");

  const studentAssignment = trpc.homework.students.get.useQuery(
    { organizationId: organizationId ?? "", id: saId },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(saId),
    },
  );

  const student = studentAssignment.data ?? null;
  const assignmentId = student?.assignmentId ?? "";

  const detail = trpc.homework.byId.useQuery(
    { organizationId: organizationId ?? "", id: assignmentId },
    {
      enabled:
        ready &&
        canRead &&
        Boolean(organizationId) &&
        Boolean(assignmentId),
    },
  );

  const assignment = detail.data ?? null;

  const frame = (children: React.ReactNode, footer?: React.ReactNode) => (
    <ScreenFrame
      title={displayName}
      meta={
        assignment
          ? [
              assignment.title,
              `${copy.homework.grade.due} ${
                dayLabel(dayKeyOf(student?.effectiveDueAt ?? assignment.dueAt))
              }`,
            ].join(" · ")
          : null
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-grade-student-back"
      titleTestID="homework-grade-student-title"
      footer={footer}
      onRefresh={
        student
          ? () => {
              void studentAssignment.refetch();
              if (assignmentId) void detail.refetch();
            }
          : undefined
      }
      refreshing={studentAssignment.isRefetching || detail.isRefetching}
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
        testID="homework-grade-student-denied"
      />,
    );
  }

  if (!saId) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.grade.loadStudentsError}
        message={copy.homework.detail.notFoundBody}
        testID="homework-grade-student-missing"
      />,
    );
  }

  if (studentAssignment.isPending) {
    return frame(
      <View style={styles.skeleton}>
        <Skeleton height={128} />
        <Skeleton height={140} />
        <Skeleton height={220} />
      </View>,
    );
  }

  if (studentAssignment.isError) {
    const friendly = toFriendlyError(studentAssignment.error);
    if (friendly.kind === "notFound" || friendly.kind === "forbidden") {
      return frame(
        <EmptyState
          icon="shield"
          title={copy.homework.grade.noAccessTitle}
          message={copy.homework.grade.noAccessBody}
          testID="homework-grade-student-no-access"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={studentAssignment.error}
        onRetry={() => void studentAssignment.refetch()}
        testID="homework-grade-student-error"
      />,
    );
  }

  if (!student) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.detail.notFoundTitle}
        message={copy.homework.detail.notFoundBody}
        testID="homework-grade-student-not-found"
      />,
    );
  }

  if (detail.isPending) {
    return frame(
      <View style={styles.skeleton}>
        <Skeleton height={128} />
        <Skeleton height={140} />
        <Skeleton height={220} />
      </View>,
    );
  }

  if (detail.isError) {
    const friendly = toFriendlyError(detail.error);
    if (friendly.kind === "notFound" || friendly.kind === "forbidden") {
      return frame(
        <EmptyState
          icon="shield"
          title={copy.homework.grade.noAccessTitle}
          message={copy.homework.grade.noAccessBody}
          testID="homework-grade-student-homework-denied"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={detail.error}
        onRetry={() => void detail.refetch()}
        testID="homework-grade-student-homework-error"
      />,
    );
  }

  if (!assignment) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.detail.notFoundTitle}
        message={copy.homework.detail.notFoundBody}
        testID="homework-grade-student-homework-missing"
      />,
    );
  }

  if (assignment.status !== "published" && assignment.status !== "closed") {
    return frame(
      <EmptyState
        icon={assignment.status === "cancelled" ? "closeCircle" : "clock"}
        title={copy.homework.grade.notLiveTitle}
        message={
          assignment.status === "cancelled"
            ? copy.homework.grade.cancelledBody
            : copy.homework.grade.notLiveBody
        }
        testID="homework-grade-student-not-live"
      />,
    );
  }

  return (
    <GradeStudentBody
      key={student.id}
      student={student}
      assignment={assignment}
      displayName={displayName}
      roll={roll}
      organizationId={organizationId ?? ""}
      canGrade={canGrade}
      canUpdate={canUpdate}
    />
  );
}

function GradeStudentBody({
  student,
  assignment,
  displayName,
  roll,
  organizationId,
  canGrade,
  canUpdate,
}: {
  student: StudentAssignmentDetail;
  assignment: HomeworkDetail;
  displayName: string;
  roll: string;
  organizationId: string;
  canGrade: boolean;
  canUpdate: boolean;
}) {
  const utils = trpc.useUtils();

  /**
   * A question submission is the only thing that produces attempts. Asking for
   * attempts on a notebook-only homework would query an empty table and show
   * a "no attempts" card that can never fill.
   */
  const hasQuestions = assignment.submissionTypes.includes("questions");

  const attempts = trpc.homework.students.attempts.list.useQuery(
    { organizationId, id: student.id },
    { enabled: hasQuestions },
  );

  const questionSet = trpc.homework.questions.get.useQuery(
    { organizationId, id: assignment.id },
    { enabled: hasQuestions },
  );

  const questionById = useMemo(
    () => new Map((questionSet.data ?? []).map((row) => [row.id, row])),
    [questionSet.data],
  );

  /** Newest effort first: that is the one a teacher usually marks. */
  const attemptRows = useMemo(
    () => [...(attempts.data ?? [])].sort((a, b) => b.attemptNo - a.attemptNo),
    [attempts.data],
  );

  const current =
    student.evaluations.find((evaluation) => evaluation.isCurrent) ?? null;
  const currentMarks = formatMarks(student.currentMarks) ?? "";
  const currentFeedback = current?.feedback ?? "";

  const [marks, setMarks] = useState(currentMarks);
  const [feedback, setFeedback] = useState(currentFeedback);
  const [touched, setTouched] = useState(false);
  const [sheet, setSheet] = useState<
    "none" | "resubmit" | "extend" | "excuse" | "more"
  >("none");
  const [answerTarget, setAnswerTarget] = useState<{
    attemptId: string;
    answer: AttemptAnswerRow;
  } | null>(null);
  const [openAttempts, setOpenAttempts] = useState<Record<string, boolean>>({});
  const [attemptSaved, setAttemptSaved] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [answerError, setAnswerError] = useState<unknown>(null);

  const status = isStudentWorkStatus(student.status) ? student.status : null;
  const tone = status ? studentStatusTone[status] : "neutral";
  const statusText = status ? studentStatusLabel[status] : student.status;
  const readOnlyMode =
    assignment.gradingMode === "grade" || assignment.gradingMode === "rubric";
  const excused = student.status === "excused";
  const hasSubmission = student.submissions.length > 0;

  const check = checkGradeDraft({
    mode: assignment.gradingMode,
    marks,
    feedback,
    maxMarks: assignment.maxMarks,
    hasSubmission,
  });

  const dirty =
    marks !== currentMarks || feedback.trim() !== currentFeedback.trim();
  useUnsavedChanges(canGrade && !readOnlyMode && !excused && dirty && !leaving);

  /**
   * Leaving happens in an effect, not inside the mutation callback. The
   * unsaved-changes guard would otherwise see the pre-save state and block
   * the route it is supposed to allow — the teacher would be asked to discard
   * work the server already accepted.
   */
  useEffect(() => {
    if (!leaving) return;
    if (router.canGoBack()) router.back();
    else {
      router.replace({
        pathname: "/homework/[id]/grade",
        params: { id: assignment.id },
      });
    }
  }, [leaving, assignment.id]);

  const invalidate = async () => {
    await Promise.all([
      utils.homework.students.get.invalidate(),
      utils.homework.students.list.invalidate(),
      utils.homework.byId.invalidate(),
      utils.homework.list.invalidate(),
      ...(hasQuestions
        ? [utils.homework.students.attempts.list.invalidate()]
        : []),
    ]);
  };

  const leave = () => setLeaving(true);

  const evaluate = trpc.homework.students.evaluate.useMutation({
    onSuccess: async () => {
      // Unmount the resubmit sheet in the same commit that releases the
      // unsaved guard; navigating with a Modal still mounted crashes Fabric.
      setSheet("none");
      await invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      leave();
    },
    onError: (error) => {
      if (sheet === "resubmit") setActionError(error);
      else setSaveError(error);
    },
  });

  const extend = trpc.homework.students.extend.useMutation({
    onSuccess: async () => {
      await invalidate();
      setSheet("none");
      setActionError(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => setActionError(error),
  });

  const excuse = trpc.homework.students.excuse.useMutation({
    onSuccess: async () => {
      setSheet("none");
      await invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      leave();
    },
    onError: (error) => setActionError(error),
  });

  /**
   * Marks for one answer. The sheet closes before the cache refresh so the
   * screen never re-renders a modal over freshly sorted rows (Fabric's
   * addViewAt crash). `fullyGraded` is the server's word, not ours: the notice
   * appears only when every answer is settled.
   */
  const gradeAnswer = trpc.homework.students.attempts.gradeAnswer.useMutation({
    onSuccess: async (data) => {
      setAnswerTarget(null);
      setAnswerError(null);
      setAttemptSaved(data.fullyGraded);
      await invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => setAnswerError(error),
  });

  const busy =
    evaluate.isPending ||
    extend.isPending ||
    excuse.isPending ||
    gradeAnswer.isPending;

  const openSheet = (next: "resubmit" | "extend" | "excuse" | "more") => {
    setActionError(null);
    setSaveError(null);
    setSheet(next);
  };

  const closeSheet = () => {
    if (busy) return;
    setSheet("none");
    setActionError(null);
  };

  const save = () => {
    setTouched(true);
    if (!check.valid) return;
    setSaveError(null);
    evaluate.mutate({
      organizationId,
      id: student.id,
      sectionId: student.sectionId,
      subjectId: assignment.subjectId,
      outcome: "reviewed",
      ...(check.marks !== null ? { marks: check.marks } : {}),
      ...(check.feedback !== null ? { feedback: check.feedback } : {}),
    });
  };

  const requestResubmit = (note: string) => {
    setActionError(null);
    evaluate.mutate({
      organizationId,
      id: student.id,
      sectionId: student.sectionId,
      subjectId: assignment.subjectId,
      outcome: "resubmit_requested",
      feedback: note,
    });
  };

  const grantExtension = (input: {
    dueAt: string;
    closeAt: string;
    reason?: string;
  }) => {
    setActionError(null);
    extend.mutate({
      organizationId,
      id: student.id,
      sectionId: student.sectionId,
      subjectId: assignment.subjectId,
      newDueAt: input.dueAt,
      newCloseAt: input.closeAt,
      ...(input.reason ? { reason: input.reason } : {}),
    });
  };

  const excuseStudent = (reason: string) => {
    setActionError(null);
    excuse.mutate({
      organizationId,
      id: student.id,
      sectionId: student.sectionId,
      subjectId: assignment.subjectId,
      reason,
    });
  };

  const requestAnswerGrade = (
    attemptId: string,
    answer: AttemptAnswerRow,
  ) => {
    setAnswerError(null);
    setAttemptSaved(false);
    setAnswerTarget({ attemptId, answer });
  };

  const closeAnswerSheet = () => {
    if (gradeAnswer.isPending) return;
    setAnswerTarget(null);
    setAnswerError(null);
  };

  const toggleAttempt = (attemptId: string, open: boolean) => {
    setOpenAttempts((current) => ({ ...current, [attemptId]: !open }));
  };

  const answerTargetQuestion = answerTarget
    ? questionSet.data?.find(
        (row) => row.id === answerTarget.answer.assignmentQuestionId,
      )
    : undefined;

  const dueLabel = `${dayLabel(dayKeyOf(student.effectiveDueAt))} · ${
    clockOf(student.effectiveDueAt) ?? "—"
  }`;
  const closeLabel = `${dayLabel(dayKeyOf(student.effectiveCloseAt))} · ${
    clockOf(student.effectiveCloseAt) ?? "—"
  }`;
  const extended =
    new Date(student.effectiveDueAt).getTime() !==
    new Date(assignment.dueAt).getTime();
  const lateWindowMs =
    new Date(student.effectiveCloseAt).getTime() -
    new Date(student.effectiveDueAt).getTime();
  const lateLine =
    assignment.status === "closed"
      ? copy.homework.grade.submissionsClosed
      : lateWindowMs > 0
        ? `${
            isPastClose(student.effectiveCloseAt)
              ? copy.homework.grade.lateWorkClosed
              : copy.homework.grade.lateWorkUntil
          } ${closeLabel}`
        : null;
  const pastDue = isPastDue({
    status: assignment.status,
    dueAt: student.effectiveDueAt,
  });

  const canResubmit = canGrade && !excused;
  const canMore = canUpdate && !excused;
  const canSave = canGrade && !readOnlyMode && !excused;

  const footer =
    canResubmit || canMore ? (
      <>
        {canSave ? (
          <CapsuleButton
            title={
              assignment.gradingMode === "marks"
                ? copy.homework.grade.saveMarks
                : copy.homework.grade.save
            }
            icon="check"
            onPress={save}
            loading={evaluate.isPending && sheet === "none"}
            disabled={!check.valid || busy}
            testID="homework-grade-save"
          />
        ) : null}
        <View style={styles.footerRow}>
          {canResubmit ? (
            <CapsuleButton
              title={copy.homework.grade.resubmit}
              icon="resubmit"
              variant="secondary"
              size="compact"
              onPress={() => openSheet("resubmit")}
              disabled={busy}
              testID="homework-grade-resubmit"
              style={styles.footerButton}
            />
          ) : null}
          {canMore ? (
            <CapsuleButton
              title={copy.homework.grade.more}
              icon="more"
              variant="secondary"
              size="compact"
              onPress={() => openSheet("more")}
              disabled={busy}
              testID="homework-grade-more"
              style={styles.footerButton}
            />
          ) : null}
        </View>
      </>
    ) : undefined;

  return (
    <>
      <ScreenFrame
        title={displayName}
        meta={`${assignment.title} · ${copy.homework.grade.meta(dueLabel)}`}
        backAccessibilityLabel={copy.common.back}
        backTestID="homework-grade-student-back"
        titleTestID="homework-grade-student-title"
        footer={footer}
        onRefresh={() => {
          void invalidate();
        }}
        refreshing={false}
      >
        <View style={styles.body}>
          <Card style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.person}>
                <Avatar name={displayName} size="lg" />
                <View style={styles.personText}>
                  <ThemedText variant="name" numberOfLines={2}>
                    {displayName}
                  </ThemedText>
                  {roll ? (
                    <ThemedText variant="meta">{`Roll ${roll}`}</ThemedText>
                  ) : null}
                </View>
              </View>
              <StatusPill label={statusText} tone={tone} />
            </View>

            <View style={styles.dueStrip}>
              <View style={styles.dueText}>
                <ThemedText variant="sectionLabel">
                  {copy.homework.grade.deadline}
                </ThemedText>
                <ThemedText variant="bodyStrong">{dueLabel}</ThemedText>
                {lateLine ? (
                  <ThemedText variant="meta">{lateLine}</ThemedText>
                ) : null}
              </View>
              {pastDue && !excused ? (
                <StatusPill
                  label={copy.homework.agenda.pastDueFilter}
                  tone="critical"
                />
              ) : null}
            </View>

            {extended ? (
              <ThemedText variant="meta">
                {copy.homework.grade.extended(dueLabel)}
              </ThemedText>
            ) : null}
          </Card>

          {student.status === "missing" ? (
            <Notice
              tone="critical"
              title={copy.homework.grade.missing}
              message={copy.homework.grade.missingBody}
              testID="homework-grade-student-missing-notice"
            />
          ) : null}

          {student.status === "resubmit_requested" ? (
            <Notice
              tone="caution"
              title={copy.homework.grade.resubmitAsked}
              message={current?.feedback || copy.homework.grade.resubmitWaiting}
              testID="homework-grade-student-resubmit-notice"
            />
          ) : null}

          {excused ? (
            <Notice
              tone="neutral"
              title={copy.homework.grade.excused}
              message={[
                student.excusedAt
                  ? copy.homework.grade.excusedAt(
                      `${dayLabel(dayKeyOf(student.excusedAt))} · ${
                        clockOf(student.excusedAt) ?? "—"
                      }`,
                    )
                  : null,
                student.excusedReason
                  ? copy.homework.grade.excuseReason(student.excusedReason)
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
              testID="homework-grade-student-excused"
            />
          ) : null}

          <SubmissionCard
            submissions={student.submissions}
            submissionTypes={assignment.submissionTypes}
          />

          {hasQuestions ? (
            <AttemptsCard
              loading={attempts.isPending || questionSet.isPending}
              attemptsError={attempts.error}
              questionsError={questionSet.error}
              attempts={attemptRows}
              questionById={questionById}
              canGrade={canGrade}
              saved={attemptSaved}
              openAttempts={openAttempts}
              onToggle={toggleAttempt}
              onGrade={requestAnswerGrade}
              onRetry={() => {
                setAttemptSaved(false);
                void attempts.refetch();
                void questionSet.refetch();
              }}
            />
          ) : null}

          <Card padless testID="homework-grade-private-comments">
            <LinkRow
              title={copy.homework.grade.privateComments}
              detail={copy.homework.grade.privateCommentsNote}
              icon="comments"
              onPress={() =>
                router.push({
                  pathname: "/homework/[id]/comments",
                  params: {
                    id: assignment.id,
                    saId: student.id,
                    name: displayName,
                  },
                })
              }
              accessibilityHint={copy.homework.grade.privateCommentsHint}
              first
              testID="homework-grade-private-comments-link"
            />
          </Card>

          {!excused ? (
            readOnlyMode ? (
              <Notice
                tone="caution"
                title={copy.homework.grade.readOnlyTitle}
                message={copy.homework.grade.readOnlyBody}
                testID="homework-grade-student-read-only"
              />
            ) : (
              <Card style={styles.formCard}>
                <ThemedText variant="sectionLabel">
                  {copy.homework.form.gradingSection}
                </ThemedText>

                {assignment.gradingMode === "marks" ? (
                  <FormField
                    label={copy.homework.grade.marks}
                    value={marks}
                    onChangeText={setMarks}
                    onBlur={() => setTouched(true)}
                    keyboardType="decimal-pad"
                    suffix={
                      assignment.maxMarks
                        ? `/ ${formatMarks(assignment.maxMarks)}`
                        : undefined
                    }
                    help={
                      assignment.maxMarks
                        ? copy.homework.grade.marksHelp(
                            formatMarks(assignment.maxMarks) ?? "",
                          )
                        : copy.homework.grade.marksUncappedHelp
                    }
                    error={
                      touched && check.errors.marks
                        ? check.errors.marks
                        : undefined
                    }
                    editable={!busy}
                    maxLength={8}
                    testID="homework-grade-marks"
                  />
                ) : (
                  <ThemedText variant="meta" style={styles.gradingNote}>
                    {assignment.gradingMode === "completion"
                      ? copy.homework.grade.completionNote
                      : copy.homework.grade.noneNote}
                  </ThemedText>
                )}

                {check.reviewBlocked ? (
                  <Notice
                    tone="caution"
                    title={copy.homework.grade.marksNeedSubmissionTitle}
                    message={copy.homework.grade.marksNeedSubmissionBody}
                    style={styles.blocked}
                    testID="homework-grade-marks-blocked"
                  />
                ) : null}

                <FormField
                  label={copy.homework.grade.feedback}
                  value={feedback}
                  onChangeText={setFeedback}
                  onBlur={() => setTouched(true)}
                  placeholder={copy.homework.grade.feedbackPlaceholder}
                  help={copy.homework.grade.feedbackHelp}
                  error={
                    touched && check.errors.feedback
                      ? check.errors.feedback
                      : undefined
                  }
                  editable={!busy}
                  maxLength={MAX_FEEDBACK}
                  multiline
                  numberOfLines={4}
                  testID="homework-grade-feedback"
                />
              </Card>
            )
          ) : null}

          {saveError ? (
            <Notice
              tone="critical"
              title={copy.homework.grade.saveError}
              message={errorMessage(saveError)}
              testID="homework-grade-save-error"
            />
          ) : null}

          {student.evaluations.length > 0 ? (
            <HistoryCard evaluations={student.evaluations} />
          ) : null}
        </View>
      </ScreenFrame>

      {sheet === "more" ? (
        <GradeActionsSheet
          onExtend={() => openSheet("extend")}
          onExcuse={() => openSheet("excuse")}
          onClose={closeSheet}
        />
      ) : null}

      {sheet === "resubmit" ? (
        <ResubmitSheet
          studentName={displayName}
          submitting={evaluate.isPending}
          error={actionError}
          onConfirm={requestResubmit}
          onClose={closeSheet}
        />
      ) : null}

      {sheet === "extend" ? (
        <ExtendSheet
          studentName={displayName}
          currentDueAt={student.effectiveDueAt}
          currentCloseAt={student.effectiveCloseAt}
          submitting={extend.isPending}
          error={actionError}
          onConfirm={grantExtension}
          onClose={closeSheet}
        />
      ) : null}

      {sheet === "excuse" ? (
        <ExcuseSheet
          studentName={displayName}
          submitting={excuse.isPending}
          error={actionError}
          onConfirm={excuseStudent}
          onClose={closeSheet}
        />
      ) : null}

      {answerTarget && answerTargetQuestion ? (
        <AnswerGradeSheet
          key={answerTarget.answer.id}
          position={answerTarget.answer.position}
          body={answerTarget.answer.body}
          max={
            formatMarks(answerTargetQuestion.marks) ??
            answerTargetQuestion.marks
          }
          initialMarks={formatMarks(answerTarget.answer.marksAwarded) ?? ""}
          initialFeedback={answerTarget.answer.feedback ?? ""}
          submitting={gradeAnswer.isPending}
          error={answerError}
          onSubmit={({ marks: nextMarks, feedback: nextFeedback }) =>
            gradeAnswer.mutate({
              organizationId,
              id: answerTarget.attemptId,
              sectionId: student.sectionId,
              subjectId: assignment.subjectId,
              answerId: answerTarget.answer.id,
              marksAwarded: nextMarks,
              ...(nextFeedback ? { feedback: nextFeedback } : {}),
            })
          }
          onClose={closeAnswerSheet}
        />
      ) : null}
    </>
  );
}

/** What came in, newest version first, in the student's own words. */
function SubmissionCard({
  submissions,
  submissionTypes,
}: {
  submissions: StudentAssignmentDetail["submissions"];
  submissionTypes: readonly string[];
}) {
  const emptyText = submissionTypes.includes("offline")
    ? copy.homework.grade.noSubmissionOffline
    : submissionTypes.includes("tick")
      ? copy.homework.grade.noSubmissionOther
      : copy.homework.grade.noSubmission;

  return (
    <Card style={styles.card} testID="homework-grade-submission">
      <ThemedText variant="sectionLabel">
        {copy.homework.grade.submissions}
      </ThemedText>

      {submissions.length === 0 ? (
        <ThemedText variant="meta" style={styles.cardBody}>
          {emptyText}
        </ThemedText>
      ) : (
        submissions.map((submission, index) => {
          const when = `${dayLabel(dayKeyOf(submission.submittedAt))} · ${
            clockOf(submission.submittedAt) ?? "—"
          }`;
          return (
            <View
              key={submission.id}
              style={[
                styles.version,
                index > 0 ? styles.versionDivider : null,
              ]}
            >
              <View style={styles.versionHead}>
                <ThemedText variant="bodyStrong">
                  {copy.homework.grade.version(submission.versionNo)}
                </ThemedText>
                {submission.isLate ? (
                  <StatusPill
                    label={copy.homework.grade.late}
                    tone="caution"
                  />
                ) : null}
              </View>
              <ThemedText variant="meta">
                {submission.isLate
                  ? copy.homework.grade.submittedLate(when)
                  : copy.homework.grade.submittedAt(when)}
              </ThemedText>

              {submission.bodyText ? (
                <ThemedText
                  variant="body"
                  selectable
                  style={styles.submissionText}
                >
                  {submission.bodyText}
                </ThemedText>
              ) : null}

              {submission.linkUrl ? (
                <SubmissionLink url={submission.linkUrl} />
              ) : null}

              {!submission.bodyText && !submission.linkUrl ? (
                <ThemedText variant="meta">
                  {copy.homework.grade.noSubmission}
                </ThemedText>
              ) : null}
            </View>
          );
        })
      )}
    </Card>
  );
}

/**
 * Only http(s) links become buttons: a submission is student-authored text
 * and must not be able to launch an arbitrary scheme from a teacher's phone.
 * Anything else stays visible and selectable, which is enough to copy it.
 */
function SubmissionLink({ url }: { url: string }) {
  const trimmed = url.trim();
  const safe = /^https?:\/\//i.test(trimmed);

  return (
    <View style={styles.linkWrap}>
      <ThemedText variant="body" selectable style={styles.linkText}>
        {trimmed}
      </ThemedText>
      {safe ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${copy.homework.grade.openLink}, ${trimmed}`}
          onPress={() => void Linking.openURL(trimmed)}
          style={({ pressed }) => [
            styles.linkButton,
            pressed ? styles.pressed : null,
          ]}
          testID="homework-grade-open-link"
        >
          <AppIcon name="link" size={16} color={colors.accentDeep} />
          <ThemedText variant="bodyStrong" color={colors.accentDeep}>
            {copy.homework.grade.openLink}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The quiz attempts behind a question submission. The newest effort is open;
 * older ones collapse so a second attempt does not push the evaluation form
 * off the screen. The card is only rendered when the homework actually takes
 * question answers.
 */
function AttemptsCard({
  loading,
  attemptsError,
  questionsError,
  attempts,
  questionById,
  canGrade,
  saved,
  openAttempts,
  onToggle,
  onGrade,
  onRetry,
}: {
  loading: boolean;
  attemptsError: unknown;
  questionsError: unknown;
  attempts: AttemptRow[];
  questionById: ReadonlyMap<string, AssignmentQuestionRow>;
  canGrade: boolean;
  saved: boolean;
  openAttempts: Record<string, boolean>;
  onToggle: (attemptId: string, open: boolean) => void;
  onGrade: (attemptId: string, answer: AttemptAnswerRow) => void;
  onRetry: () => void;
}) {
  const text = copy.homework.grade;
  const failure = attemptsError ?? questionsError;

  return (
    <Card style={styles.card} testID="homework-grade-attempts">
      <View style={styles.attemptsHead}>
        <ThemedText variant="sectionLabel">{text.attempts}</ThemedText>
        {!loading && !failure ? (
          <ThemedText variant="meta">{attempts.length}</ThemedText>
        ) : null}
      </View>

      {saved ? (
        <Notice
          tone="positive"
          title={text.attemptGradedTitle}
          message={text.attemptGradedBody}
          testID="homework-grade-attempt-saved"
        />
      ) : null}

      {loading ? (
        <View style={styles.attemptSkeleton}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : failure ? (
        <>
          <Notice
            tone="critical"
            title={text.attemptsLoadError}
            message={errorMessage(failure)}
            testID="homework-grade-attempts-error"
          />
          <CapsuleButton
            title={copy.common.retry}
            variant="secondary"
            size="compact"
            onPress={onRetry}
            testID="homework-grade-attempts-retry"
          />
        </>
      ) : attempts.length === 0 ? (
        <>
          <ThemedText variant="bodyStrong">{text.attemptsEmpty}</ThemedText>
          <ThemedText variant="meta">{text.attemptsEmptyBody}</ThemedText>
        </>
      ) : (
        attempts.map((attempt, index) => {
          const open = openAttempts[attempt.id] ?? index === 0;
          return (
            <AttemptItem
              key={attempt.id}
              attempt={attempt}
              open={open}
              first={index === 0}
              questionById={questionById}
              canGrade={canGrade}
              onToggle={() => onToggle(attempt.id, open)}
              onGrade={(answer) => onGrade(attempt.id, answer)}
            />
          );
        })
      )}
    </Card>
  );
}

function AttemptItem({
  attempt,
  open,
  first,
  questionById,
  canGrade,
  onToggle,
  onGrade,
}: {
  attempt: AttemptRow;
  open: boolean;
  first: boolean;
  questionById: ReadonlyMap<string, AssignmentQuestionRow>;
  canGrade: boolean;
  onToggle: () => void;
  onGrade: (answer: AttemptAnswerRow) => void;
}) {
  const text = copy.homework.grade;
  const status = isAttemptStatus(attempt.status) ? attempt.status : null;
  const started = `${dayLabel(dayKeyOf(attempt.startedAt))} · ${
    clockOf(attempt.startedAt) ?? "—"
  }`;
  const submitted = attempt.submittedAt
    ? `${dayLabel(dayKeyOf(attempt.submittedAt))} · ${
        clockOf(attempt.submittedAt) ?? "—"
      }`
    : null;
  const when = submitted
    ? text.attemptSubmitted(submitted)
    : text.attemptStarted(started);
  const gradedCount = attempt.answers.filter(
    (answer) => !answer.needsManualReview,
  ).length;
  const editable = canGrade && attempt.status !== "in_progress";

  return (
    <View style={[styles.attempt, first ? null : styles.attemptDivider]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${text.attemptNo(attempt.attemptNo)}, ${attemptStatusLabel(
          attempt.status,
        )}`}
        accessibilityHint={text.attemptAnswersToggle(open)}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.attemptHead,
          pressed ? styles.pressed : null,
        ]}
        testID={`homework-grade-attempt-${attempt.attemptNo}`}
      >
        <View style={styles.attemptTitle}>
          <ThemedText variant="bodyStrong">
            {text.attemptNo(attempt.attemptNo)}
          </ThemedText>
          <StatusPill
            label={attemptStatusLabel(attempt.status)}
            tone={status ? attemptStatusTone[status] : "neutral"}
          />
          {attempt.isLate ? (
            <StatusPill label={text.late} tone="caution" />
          ) : null}
        </View>
        <AppIcon
          name={open ? "chevronDown" : "chevronRight"}
          size={18}
          color={colors.chevron}
        />
      </Pressable>

      <ThemedText variant="meta">{when}</ThemedText>

      {attempt.status !== "in_progress" ? (
        <View style={styles.attemptStats}>
          <ThemedText variant="meta">
            {text.attemptTotal(
              formatMarks(attempt.totalScore) ?? attempt.totalScore,
              formatMarks(attempt.maxScore) ?? attempt.maxScore,
            )}
          </ThemedText>
          <ThemedText variant="meta">
            {text.attemptReviewed(gradedCount, attempt.answers.length)}
          </ThemedText>
        </View>
      ) : null}

      {open ? (
        <View style={styles.answers}>
          {attempt.status === "in_progress" ? (
            <Notice
              tone="neutral"
              message={text.attemptInProgress}
              testID="homework-grade-attempt-in-progress"
            />
          ) : null}

          {attempt.answers.length === 0 ? (
            <ThemedText variant="meta">{text.attemptNoAnswers}</ThemedText>
          ) : (
            attempt.answers.map((answer, index) => (
              <AnswerItem
                key={answer.id}
                answer={answer}
                question={
                  questionById.get(answer.assignmentQuestionId) ?? null
                }
                editable={editable}
                first={index === 0}
                onGrade={() => onGrade(answer)}
              />
            ))
          )}

          {attempt.status !== "in_progress" &&
          attempt.answers.length > 0 ? (
            <>
              <ThemedText variant="caption" color={colors.muted}>
                {text.attemptAnswersOnly}
              </ThemedText>
              <ThemedText variant="caption" color={colors.muted}>
                {text.attemptManualNote}
              </ThemedText>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One answer. The attempt read model carries the JSON answer but not the
 * options or the question's marks, so both come from the snapshot queried
 * alongside it. Automatic marks are read-only here; a manual type — or an
 * answer the server flagged for review — opens the marks sheet.
 */
function AnswerItem({
  answer,
  question,
  editable,
  first,
  onGrade,
}: {
  answer: AttemptAnswerRow;
  question: AssignmentQuestionRow | null;
  editable: boolean;
  first: boolean;
  onGrade: () => void;
}) {
  const text = copy.homework.grade;
  const given = answerSummary(
    answer.questionType,
    answer.answer,
    question?.options ?? null,
  );
  const key = answerKeySummary({
    questionType: answer.questionType,
    options: question?.options ?? null,
    correctAnswer: question?.correctAnswer ?? null,
  });
  const marks = formatMarks(answer.marksAwarded);
  const max = question ? formatMarks(question.marks) ?? question.marks : null;
  const manualType =
    answer.questionType === "short_answer" ||
    answer.questionType === "long_answer";
  const markable = editable && (answer.needsManualReview || manualType);
  const actionLabel =
    answer.marksAwarded === null ? text.gradeAnswer : text.answerEdit;

  return (
    <View style={[styles.answer, first ? null : styles.answerDivider]}>
      <View style={styles.answerHead}>
        <ThemedText variant="caption" color={colors.muted}>
          {`Q${answer.position} · ${questionTypeLabel(answer.questionType)}`}
        </ThemedText>
        {answer.needsManualReview ? (
          <StatusPill label={text.needsMarks} tone="caution" />
        ) : answer.isCorrect === true ? (
          <StatusPill label={text.autoCorrect} tone="positive" />
        ) : answer.isCorrect === false ? (
          <StatusPill label={text.autoWrong} tone="critical" />
        ) : null}
      </View>

      <ThemedText variant="bodyStrong" numberOfLines={4}>
        {answer.body}
      </ThemedText>

      <View style={styles.answerGiven}>
        <ThemedText variant="caption" color={colors.muted}>
          {text.answerGiven}
        </ThemedText>
        <ThemedText variant="body" selectable style={styles.answerText}>
          {given ?? text.leftBlank}
        </ThemedText>
      </View>

      {key ? (
        <ThemedText variant="meta">{text.answerKey(key)}</ThemedText>
      ) : (
        <ThemedText variant="meta">{text.noKey}</ThemedText>
      )}

      <View style={styles.answerFoot}>
        <ThemedText
          variant="bodyStrong"
          color={marks ? colors.ink : colors.muted}
        >
          {marks && max
            ? text.answerScore(marks, max)
            : (marks ?? text.answerNotGraded)}
        </ThemedText>
        {markable ? (
          <CapsuleButton
            title={actionLabel}
            icon="grade"
            variant="secondary"
            size="compact"
            onPress={onGrade}
            testID={`homework-grade-answer-${answer.id}`}
          />
        ) : null}
      </View>

      {answer.feedback ? (
        <ThemedText variant="meta" style={styles.answerFeedback}>
          {answer.feedback}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Every evaluation kept for this row, newest first, current one marked. */
function HistoryCard({ evaluations }: { evaluations: EvaluationRow[] }) {
  return (
    <Card padless testID="homework-grade-history">
      <View style={styles.historyHead}>
        <ThemedText variant="sectionLabel">
          {copy.homework.grade.history}
        </ThemedText>
        <ThemedText variant="meta">{evaluations.length}</ThemedText>
      </View>
      {evaluations.map((evaluation, index) => (
        <EvaluationItem
          key={evaluation.id}
          evaluation={evaluation}
          first={index === 0}
        />
      ))}
    </Card>
  );
}

function EvaluationItem({
  evaluation,
  first,
}: {
  evaluation: EvaluationRow;
  first: boolean;
}) {
  const reviewed = evaluation.outcome === "reviewed";
  const when = `${dayLabel(dayKeyOf(evaluation.evaluatedAt))} · ${
    clockOf(evaluation.evaluatedAt) ?? "—"
  }`;
  const score =
    evaluation.marks !== null ? formatMarks(evaluation.marks) : null;

  return (
    <View style={[styles.evaluation, first ? null : styles.evaluationDivider]}>
      <View style={styles.evaluationHead}>
        <View style={styles.evaluationTitle}>
          <ThemedText
            variant="bodyStrong"
            color={
              reviewed
                ? colors.tone.positive.fg
                : colors.tone.caution.fg
            }
          >
            {outcomeLabel(evaluation.outcome)}
          </ThemedText>
          {score ? (
            <ThemedText variant="bodyStrong">{`· ${score}`}</ThemedText>
          ) : null}
        </View>
        {evaluation.isCurrent ? (
          <StatusPill
            label={copy.homework.grade.historyCurrent}
            tone="neutral"
          />
        ) : null}
      </View>
      <ThemedText variant="meta">
        {copy.homework.grade.reviewedAt(when)}
      </ThemedText>
      {evaluation.feedback ? (
        <ThemedText variant="body" style={styles.evaluationFeedback}>
          {evaluation.feedback}
        </ThemedText>
      ) : null}
    </View>
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
  hero: {
    gap: spacing.md,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  person: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  personText: {
    flex: 1,
    gap: spacing.xxs,
  },
  dueStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  dueText: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  card: {
    gap: spacing.sm,
  },
  cardBody: {
    marginTop: spacing.xs,
  },
  version: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  versionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
  },
  versionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  submissionText: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  linkWrap: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  linkText: {
    color: colors.accentDeep,
  },
  linkButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
  },
  formCard: {
    gap: spacing.xs,
  },
  gradingNote: {
    marginTop: spacing.sm,
  },
  blocked: {
    marginTop: spacing.md,
  },
  attemptsHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  attemptSkeleton: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  attempt: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  attemptDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
  },
  attemptHead: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  attemptTitle: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
  },
  attemptStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  answers: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  answer: {
    gap: spacing.xs,
  },
  answerDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.sm,
  },
  answerHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  answerGiven: {
    gap: spacing.xxs,
    marginTop: spacing.xxs,
  },
  answerText: {
    lineHeight: 22,
  },
  answerFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  answerFeedback: {
    fontStyle: "italic",
    lineHeight: 20,
  },
  historyHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  evaluation: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xxs,
  },
  evaluationDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  evaluationHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  evaluationTitle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  evaluationFeedback: {
    marginTop: spacing.xs,
    lineHeight: 21,
  },
  footerRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  footerButton: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
