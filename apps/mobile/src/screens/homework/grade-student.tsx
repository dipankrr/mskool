import { useEffect, useState } from "react";
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
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ExcuseSheet } from "./excuse-sheet";
import { ExtendSheet } from "./extend-sheet";
import { GradeActionsSheet } from "./grade-actions-sheet";
import { checkGradeDraft, MAX_FEEDBACK } from "./grade-logic";
import {
  isStudentWorkStatus,
  outcomeLabel,
  studentStatusLabel,
  studentStatusTone,
} from "./meta";
import { ResubmitSheet } from "./resubmit-sheet";
import type {
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
  const [leaving, setLeaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);

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

  const busy = evaluate.isPending || extend.isPending || excuse.isPending;

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
