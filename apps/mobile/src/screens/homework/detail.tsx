import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FactRow } from "../../components/fact-row";
import { LinkRow } from "../../components/link-row";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatTile } from "../../components/stat-tile";
import { StatusMeter } from "../../components/status-meter";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  clockOf,
  countStudentWork,
  dayKeyOf,
  dayLabel,
  formatMinutes,
  isPastDue,
} from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { CancelSheet } from "./cancel-sheet";
import { ConfirmSheet } from "./confirm-sheet";
import {
  gradingLabel,
  kindGlyph,
  kindLabel,
  statusLabel,
  statusTone,
  submissionLabel,
} from "./meta";
import { sectionTargetOf } from "./types";

/**
 * One assignment, as the teacher owns it: what it is, who has it, what has
 * come back, and the one lifecycle act that moves it on.
 *
 * Status is never guessed from a flag. Each transitional state has its own
 * banner (scheduled is read-only, cancelled keeps its reason, closed keeps
 * grading open) and the footer only offers an action the server will accept.
 * Publish and close are confirmed first because both change what students see
 * — each gets the same in-app decision sheet — and cancel needs a reason,
 * which iOS-only `Alert.prompt` cannot collect, so it has its own sheet.
 *
 * The pair `(sectionId, subjectId)` is not decoration: every row-addressed
 * mutation carries it so the server can verify the gate fact describes THIS
 * row. Without a section target the screen says so instead of firing a call
 * that must fail.
 */
export function HomeworkDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? "";
  const { organizationId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("homework:read");
  const canWrite = has("homework:update");
  const canGrade = has("homework:grade");
  const canReadSections = has("section:read");
  const canReadClasses = has("class:read");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState<unknown>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeError, setCloseError] = useState<unknown>(null);

  const utils = trpc.useUtils();

  const detail = trpc.homework.byId.useQuery(
    { organizationId: organizationId ?? "", id },
    {
      enabled: ready && canRead && Boolean(organizationId) && Boolean(id),
    },
  );

  const assignment = detail.data ?? null;
  const status = assignment?.status ?? "draft";
  const isLive = status === "published" || status === "closed";

  const sectionTarget = sectionTargetOf(assignment);
  const sectionId = sectionTarget?.sectionId ?? null;
  const subjectId = assignment?.subjectId ?? null;
  const pairReady = Boolean(sectionId && subjectId);

  const subjects = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(assignment),
    },
  );

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled:
        ready && canReadSections && canReadClasses && Boolean(organizationId),
    },
  );

  const sections = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
    },
    {
      enabled:
        ready &&
        canReadSections &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id),
    },
  );

  const students = trpc.homework.students.list.useQuery(
    { organizationId: organizationId ?? "", id },
    {
      enabled:
        ready &&
        canRead &&
        Boolean(organizationId) &&
        Boolean(assignment) &&
        isLive,
    },
  );

  /**
   * The two teaching surfaces behind a homework: its question set and the
   * class thread. Their counts are quiet metadata on the Tools rows; a failed
   * count is left blank rather than turning the whole detail screen into an
   * error, because both destinations can still be opened and retried there.
   */
  const questionSet = trpc.homework.questions.get.useQuery(
    { organizationId: organizationId ?? "", id },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(assignment),
    },
  );

  const classComments = trpc.homework.comments.list.useQuery(
    { organizationId: organizationId ?? "", assignmentId: id },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(assignment),
    },
  );

  const subjectName = useMemo(
    () =>
      (subjects.data ?? []).find((row) => row.id === subjectId)?.name ?? null,
    [subjects.data, subjectId],
  );

  const sectionLabel = useMemo(() => {
    if (!sectionId) return null;
    const section = (sections.data ?? []).find((row) => row.id === sectionId);
    if (!section) return null;
    const className = (classes.data ?? []).find(
      (row) => row.id === section.classId,
    )?.name;
    return className ? `${className} · ${section.name}` : section.name;
  }, [sectionId, sections.data, classes.data]);

  const counts = useMemo(
    () => countStudentWork(students.data ?? []),
    [students.data],
  );

  const questionCount = questionSet.isSuccess
    ? (questionSet.data ?? []).length
    : null;

  const classCommentCount = classComments.isSuccess
    ? (classComments.data ?? []).filter(
        (row) => row.studentAssignmentId === null,
      ).length
    : null;

  const invalidate = async () => {
    await Promise.all([
      utils.homework.byId.invalidate(),
      utils.homework.list.invalidate(),
      utils.homework.students.list.invalidate(),
    ]);
  };

  const publish = trpc.homework.publish.useMutation({
    onSuccess: async () => {
      setPublishOpen(false);
      setPublishError(null);
      await invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => setPublishError(error),
  });

  const close = trpc.homework.close.useMutation({
    onSuccess: async () => {
      setCloseOpen(false);
      setCloseError(null);
      await invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => setCloseError(error),
  });

  const cancel = trpc.homework.cancel.useMutation({
    onSuccess: async () => {
      setCancelOpen(false);
      setCancelError(null);
      await invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => setCancelError(error),
  });

  const editable = canWrite && (status === "draft" || status === "published");
  const framing = sectionLabel ?? copy.homework.detail.sectionFallback;

  const confirmPublish = () => {
    if (!assignment || !sectionId || !subjectId) return;
    setPublishError(null);
    setPublishOpen(true);
  };

  const confirmClose = () => {
    if (!assignment || !sectionId || !subjectId) return;
    setCloseError(null);
    setCloseOpen(true);
  };

  const action = editable
    ? {
        label: copy.homework.detail.edit,
        icon: "edit" as const,
        onPress: () =>
          router.push({
            pathname: "/homework/[id]/edit",
            params: { id },
          }),
        accessibilityHint: copy.homework.detail.revisionHint,
        testID: "homework-edit",
      }
    : undefined;

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <ScreenFrame
      title={assignment?.title ?? copy.homework.detail.title}
      meta={
        assignment
          ? [subjectName, sectionLabel].filter(Boolean).join(" · ") || null
          : null
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-detail-back"
      action={action}
      titleTestID="homework-detail-title"
      footer={footer}
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
        testID="homework-detail-denied"
      />,
    );
  }

  if (!id) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.detail.notFoundTitle}
        message={copy.homework.detail.notFoundBody}
        testID="homework-detail-missing"
      />,
    );
  }

  if (detail.isPending) {
    return frame(
      <View style={styles.skeleton} accessibilityLiveRegion="polite">
        <Skeleton height={148} />
        <Skeleton height={112} />
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
          title={copy.homework.detail.noAccessTitle}
          message={copy.homework.detail.noAccessBody}
          testID="homework-detail-no-access"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={detail.error}
        onRetry={() => void detail.refetch()}
        testID="homework-detail-error"
      />,
    );
  }

  if (!assignment) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.detail.notFoundTitle}
        message={copy.homework.detail.notFoundBody}
        testID="homework-detail-not-found"
      />,
    );
  }

  const dueDay = dayKeyOf(assignment.dueAt);
  const closeDay = dayKeyOf(assignment.closeAt);
  const overdue = isPastDue(assignment);
  const extraStudents = assignment.targets.filter(
    (target) => target.targetType === "student",
  ).length;
  const zeroStudents =
    assignment.status === "published" &&
    students.isSuccess &&
    (students.data ?? []).length === 0;

  const submissions =
    assignment.submissionTypes.length > 0
      ? assignment.submissionTypes.map(submissionLabel).join(", ")
      : "—";

  const lateWindowMs =
    new Date(assignment.closeAt).getTime() -
    new Date(assignment.dueAt).getTime();

  const footer =
    canWrite && assignment.status === "draft" ? (
      <>
        <CapsuleButton
          title={copy.homework.actions.publishConfirm}
          icon="check"
          onPress={confirmPublish}
          loading={publish.isPending}
          disabled={!pairReady || publish.isPending}
          testID="homework-publish"
        />
        <CapsuleButton
          title={copy.homework.actions.cancelTitle}
          variant="destructive"
          size="compact"
          onPress={() => {
            setCancelError(null);
            setCancelOpen(true);
          }}
          disabled={publish.isPending || !pairReady}
          testID="homework-cancel"
          style={styles.footerSecondary}
        />
      </>
    ) : isLive && (canGrade || (canWrite && assignment.status === "published")) ? (
      <>
        {canGrade ? (
          <CapsuleButton
            title={copy.homework.detail.grade}
            icon="grade"
            onPress={() =>
              router.push({
                pathname: "/homework/[id]/grade",
                params: { id },
              })
            }
            disabled={!pairReady || close.isPending}
            testID="homework-grade"
          />
        ) : null}
        {canWrite && assignment.status === "published" ? (
          <CapsuleButton
            title={copy.homework.actions.closeConfirm}
            variant="secondary"
            onPress={confirmClose}
            loading={close.isPending}
            disabled={!pairReady || close.isPending}
            testID="homework-close"
            style={canGrade ? styles.footerSecondary : undefined}
          />
        ) : null}
        {canWrite && assignment.status === "published" ? (
          <CapsuleButton
            title={copy.homework.actions.cancelTitle}
            variant="destructive"
            size="compact"
            onPress={() => {
              setCancelError(null);
              setCancelOpen(true);
            }}
            disabled={close.isPending || !pairReady}
            testID="homework-cancel"
            style={styles.footerSecondary}
          />
        ) : null}
      </>
    ) : undefined;

  return (
    <>
      {frame(
        <View style={styles.body}>
          {assignment.status === "scheduled" ? (
            <Notice
              tone="caution"
              title={copy.homework.detail.scheduledTitle}
              message={copy.homework.detail.scheduledBody}
              testID="homework-scheduled"
            />
          ) : null}

          {assignment.status === "cancelled" ? (
            <Notice
              tone="critical"
              title={copy.homework.detail.cancelledTitle}
              message={
                assignment.cancelReason
                  ? `${copy.homework.detail.cancelledBody} ${copy.homework.detail.cancelReason(
                      assignment.cancelReason,
                    )}`
                  : copy.homework.detail.cancelledBody
              }
              testID="homework-cancelled"
            />
          ) : null}

          {assignment.status === "closed" ? (
            <Notice
              tone="neutral"
              message={copy.homework.detail.closedBody}
              testID="homework-closed"
            />
          ) : null}

          {assignment.status === "draft" ? (
            <Notice
              tone="neutral"
              message={copy.homework.form.draftNote}
              testID="homework-draft-note"
            />
          ) : null}

          {zeroStudents ? (
            <Notice
              tone="caution"
              title={copy.homework.detail.zeroStudentsTitle}
              message={copy.homework.detail.zeroStudentsBody}
              testID="homework-zero-students"
            >
              {canWrite && pairReady ? (
                <CapsuleButton
                  title={copy.homework.actions.cancelTitle}
                  variant="destructive"
                  size="compact"
                  onPress={() => {
                    setCancelError(null);
                    setCancelOpen(true);
                  }}
                  testID="homework-zero-cancel"
                />
              ) : null}
            </Notice>
          ) : null}

          {!pairReady && assignment.status !== "cancelled" ? (
            <Notice
              tone="caution"
              title={copy.homework.detail.noTargetTitle}
              message={copy.homework.detail.noTargetBody}
              testID="homework-no-target"
            />
          ) : null}

          <Card style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.kind}>
                <AppIcon
                  name={kindGlyph(assignment.kind)}
                  size={16}
                  color={colors.muted}
                />
                <ThemedText variant="meta">
                  {kindLabel(assignment.kind)}
                </ThemedText>
              </View>
              <StatusPill
                label={statusLabel(assignment.status)}
                tone={statusTone[assignment.status] ?? "neutral"}
              />
            </View>

            <View style={styles.dueStrip}>
              <View style={styles.dueText}>
                <ThemedText variant="sectionLabel">
                  {copy.homework.detail.due}
                </ThemedText>
                <ThemedText variant="bodyStrong">
                  {dayLabel(dueDay)} · {clockOf(assignment.dueAt) ?? "—"}
                </ThemedText>
              </View>
              {overdue ? (
                <StatusPill
                  label={copy.homework.agenda.pastDueFilter}
                  tone="critical"
                />
              ) : null}
            </View>
          </Card>

          {isLive ? (
            <Card style={styles.progress}>
              <View style={styles.progressHead}>
                <ThemedText variant="sectionLabel">
                  {copy.homework.detail.progress}
                </ThemedText>
                {students.isSuccess ? (
                  <ThemedText variant="meta">
                    {copy.homework.detail.progressLine(
                      counts.reviewed,
                      counts.reviewable,
                    )}
                  </ThemedText>
                ) : null}
              </View>

              {students.isPending ? (
                <Skeleton height={74} />
              ) : students.isError ? (
                <>
                  <ThemedText variant="meta">
                    {copy.homework.detail.studentsLoadError}
                  </ThemedText>
                  <CapsuleButton
                    title={copy.common.retry}
                    variant="secondary"
                    size="compact"
                    onPress={() => void students.refetch()}
                    testID="homework-students-retry"
                    style={styles.retry}
                  />
                </>
              ) : (
                <>
                  <View style={styles.tiles}>
                    <StatTile
                      value={counts.reviewed}
                      label={copy.homework.detail.reviewed}
                      tone="positive"
                    />
                    <StatTile
                      value={counts.toGrade}
                      label={copy.homework.detail.toGrade}
                      tone="caution"
                    />
                    <StatTile
                      value={counts.notSubmitted}
                      label={copy.homework.detail.notSubmitted}
                      tone="neutral"
                    />
                    <StatTile
                      value={counts.missing}
                      label={copy.homework.detail.missing}
                      tone="critical"
                    />
                  </View>
                  <StatusMeter
                    segments={[
                      {
                        key: "reviewed",
                        value: counts.reviewed,
                        tone: "positive",
                      },
                      {
                        key: "toGrade",
                        value: counts.toGrade,
                        tone: "caution",
                      },
                      {
                        key: "notSubmitted",
                        value: counts.notSubmitted,
                        tone: "neutral",
                      },
                      {
                        key: "missing",
                        value: counts.missing,
                        tone: "critical",
                      },
                    ]}
                    style={styles.meter}
                    testID="homework-progress-meter"
                  />
                  {counts.excused > 0 ? (
                    <View style={styles.excusedRow}>
                      <View style={styles.excusedDot} />
                      <ThemedText variant="meta">
                        {`${counts.excused} ${copy.homework.detail.excused.toLowerCase()}`}
                      </ThemedText>
                    </View>
                  ) : null}
                  {counts.viewOnly > 0 ? (
                    <ThemedText variant="meta">
                      {copy.homework.grade.viewOnly(counts.viewOnly)}
                    </ThemedText>
                  ) : null}
                </>
              )}
            </Card>
          ) : null}

          <Card>
            <ThemedText variant="sectionLabel">
              {copy.homework.detail.instructions}
            </ThemedText>
            <ThemedText
              variant="body"
              color={assignment.description ? colors.ink : colors.muted}
              style={styles.instructions}
            >
              {assignment.description || copy.homework.detail.noInstructions}
            </ThemedText>
          </Card>

          <Card padless testID="homework-tools">
            <View style={styles.factsHead}>
              <ThemedText variant="sectionLabel">
                {copy.homework.detail.tools}
              </ThemedText>
            </View>
            <LinkRow
              title={copy.homework.detail.questionSet}
              detail={
                questionCount === null
                  ? null
                  : questionCount > 0
                    ? copy.homework.detail.questionsCount(questionCount)
                    : copy.homework.detail.questionsNone
              }
              icon="quiz"
              onPress={() =>
                router.push({
                  pathname: "/homework/[id]/questions",
                  params: { id },
                })
              }
              accessibilityHint={copy.homework.detail.questionSetHint}
              first
              testID="homework-tools-questions"
            />
            <LinkRow
              title={copy.homework.detail.classComments}
              detail={
                classCommentCount === null
                  ? null
                  : classCommentCount > 0
                    ? copy.homework.detail.commentsCount(classCommentCount)
                    : copy.homework.detail.commentsNone
              }
              icon="comments"
              onPress={() =>
                router.push({
                  pathname: "/homework/[id]/comments",
                  params: { id },
                })
              }
              accessibilityHint={copy.homework.detail.classCommentsHint}
              testID="homework-tools-comments"
            />
          </Card>

          <Card padless>
            <View style={styles.factsHead}>
              <ThemedText variant="sectionLabel">
                {copy.homework.detail.details}
              </ThemedText>
            </View>
            <FactRow
              label={copy.homework.detail.audience}
              value={`${copy.homework.detail.wholeSection(sectionLabel ?? "—")}${
                extraStudents > 0
                  ? ` · ${copy.homework.detail.extraStudents(extraStudents)}`
                  : ""
              }`}
              first
            />
            {assignment.topic ? (
              <FactRow
                label={copy.homework.detail.topic}
                value={assignment.topic}
              />
            ) : null}
            <FactRow
              label={copy.homework.detail.estimated}
              value={formatMinutes(assignment.estimatedMinutes)}
            />
            <FactRow
              label={copy.homework.detail.submits}
              value={submissions}
            />
            <FactRow
              label={copy.homework.detail.grading}
              value={
                assignment.gradingMode === "marks" && assignment.maxMarks
                  ? `${gradingLabel(assignment.gradingMode)} · ${copy.homework.detail.outOf(
                      assignment.maxMarks,
                    )}`
                  : gradingLabel(assignment.gradingMode)
              }
            />
            <FactRow
              label={copy.homework.detail.resubmission}
              value={[
                assignment.allowResubmission
                  ? copy.homework.detail.resubmitAllowed
                  : copy.homework.detail.resubmitBlocked,
                assignment.allowResubmission
                  ? assignment.maxSubmissions
                    ? copy.homework.detail.upToAttempts(
                        assignment.maxSubmissions,
                      )
                    : copy.homework.detail.unlimitedAttempts
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <FactRow
              label={copy.homework.detail.lateWork}
              value={
                assignment.latePolicy === "not_allowed" || lateWindowMs <= 0
                  ? copy.homework.detail.lateBlocked
                  : copy.homework.detail.lateAllowed
              }
            />
            {assignment.latePolicy === "allowed" && lateWindowMs > 0 ? (
              <FactRow
                label={copy.homework.detail.lateUntil}
                value={`${dayLabel(closeDay)} · ${
                  clockOf(assignment.closeAt) ?? "—"
                }`}
              />
            ) : null}
            {assignment.revisionCount > 0 ? (
              <FactRow
                label={copy.homework.detail.history}
                value={copy.homework.detail.revisions(assignment.revisionCount)}
              />
            ) : null}
          </Card>

          {assignment.gradingMode === "grade" ||
          assignment.gradingMode === "rubric" ? (
            <Notice
              tone="caution"
              message={copy.homework.deskOnly}
              testID="homework-desk-only"
            />
          ) : null}
        </View>,
        footer,
      )}

      {cancelOpen && pairReady && sectionId && subjectId ? (
        <CancelSheet
          sectionLabel={framing}
          submitting={cancel.isPending}
          error={cancelError}
          onConfirm={(reason) =>
            cancel.mutate({
              organizationId: organizationId ?? "",
              id: assignment.id,
              sectionId,
              subjectId,
              reason,
            })
          }
          onClose={() => {
            if (cancel.isPending) return;
            setCancelOpen(false);
            setCancelError(null);
          }}
        />
      ) : null}

      {publishOpen && pairReady && sectionId && subjectId ? (
        <ConfirmSheet
          title={copy.homework.actions.publishTitle}
          body={copy.homework.actions.publishBody(framing)}
          confirmLabel={copy.homework.actions.publishConfirm}
          keepLabel={copy.homework.actions.keep}
          submitting={publish.isPending}
          error={publishError}
          onConfirm={() =>
            publish.mutate({
              organizationId: organizationId ?? "",
              id: assignment.id,
              sectionId,
              subjectId,
            })
          }
          onClose={() => {
            if (publish.isPending) return;
            setPublishOpen(false);
            setPublishError(null);
          }}
          testIDPrefix="homework-publish"
        />
      ) : null}

      {closeOpen && pairReady && sectionId && subjectId ? (
        <ConfirmSheet
          title={copy.homework.actions.closeTitle}
          body={copy.homework.actions.closeBody}
          confirmLabel={copy.homework.actions.closeConfirm}
          keepLabel={copy.homework.actions.keep}
          submitting={close.isPending}
          error={closeError}
          onConfirm={() =>
            close.mutate({
              organizationId: organizationId ?? "",
              id: assignment.id,
              sectionId,
              subjectId,
            })
          }
          onClose={() => {
            if (close.isPending) return;
            setCloseOpen(false);
            setCloseError(null);
          }}
          testIDPrefix="homework-close"
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
  hero: {
    gap: spacing.md,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  kind: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
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
  progress: {
    gap: spacing.md,
  },
  progressHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  tiles: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  meter: {
    marginTop: spacing.xxs,
  },
  excusedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  excusedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.tone.neutral.fg,
  },
  retry: {
    marginTop: spacing.sm,
  },
  instructions: {
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  factsHead: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  footerSecondary: {
    marginTop: spacing.sm,
  },
});
