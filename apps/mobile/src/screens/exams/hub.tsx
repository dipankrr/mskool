import { useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { CapsuleButton } from "../../components/capsule-button";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { copy } from "../../lib/copy";
import {
  isEntryOpen,
  isMyPaper,
  isResultsStage,
  stageMoves,
} from "../../lib/exams";
import type { StageMove } from "../../lib/exams";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import { ConfirmSheet } from "../homework/confirm-sheet";
import { ChipRow } from "./chip-row";
import type { Chip } from "./chip-row";
import {
  examTypeLabel,
  stageLabel,
  transitionConsequence,
  transitionLabel,
  transitionTitle,
} from "./meta";
import { PaperCard } from "./paper-card";
import { StageTrack } from "./stage-track";
import { HubReviewCard } from "./hub-review-card";
import type { ExamPaper } from "./types";
import {
  useClassSubjectNames,
  useExamDetail,
  useExamScope,
  useExamSections,
  useMyPairs,
} from "./use-exam-data";
import { useClassReadiness, usePaperCounts } from "./use-review-counts";
import type { PaperCounts } from "./use-review-counts";

/**
 * One exam (Step 7A): where it is in its life, its papers by class, and the
 * one thing that moves it forward.
 *
 * The screen changes shape with the stage, not with a tab: before marks entry
 * the papers are a schedule to read; during entry they are doors to the marks
 * grid, the caller's own pinned first; after publication they open read-only.
 * The server stays the referee for every move — a refused transition comes
 * back in its own words inside the confirm sheet, which stays open so the
 * refusal is seen rather than swallowed.
 */
export function ExamHubScreen() {
  const { examId = "" } = useLocalSearchParams<{ examId: string }>();
  const scope = useExamScope();
  const detail = useExamDetail(examId);
  const names = useClassSubjectNames();
  const sections = useExamSections();
  const utils = trpc.useUtils();
  const move = trpc.exam.exam.transition.useMutation();

  const [pickedClass, setPickedClass] = useState<string | null>(null);
  const [pending, setPending] = useState<StageMove | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);

  const exam = detail.data?.exam ?? null;
  const papers = detail.data?.schedules ?? [];

  const classIds = [...new Set(papers.map((paper) => paper.classId))].sort(
    (a, b) =>
      names.classOrder(a) - names.classOrder(b) ||
      (names.className(a) ?? "").localeCompare(names.className(b) ?? ""),
  );
  const activeClass =
    pickedClass && classIds.includes(pickedClass) ? pickedClass : (classIds[0] ?? null);
  const { pairs, pending: pairsPending } = useMyPairs(classIds);

  const entryOpen = exam ? isEntryOpen(exam.status) : false;
  const openable = exam ? entryOpen || isResultsStage(exam.status) : false;
  const moves = exam ? stageMoves(exam.status) : { primary: null, overflow: [] };
  const mineOf = (paper: ExamPaper): boolean | null =>
    pairs && !pairsPending ? isMyPaper(paper, pairs) : null;

  // Reviewers (marks:verify) at an entry stage see review progress: the class
  // line from one readiness read, and each paper's own counts. A teacher's hub
  // never pays for either.
  const reviewerView = scope.canVerify && entryOpen;
  const classPapersRaw = papers.filter((paper) => paper.classId === activeClass);
  const readiness = useClassReadiness(examId, activeClass, reviewerView);
  const paperCounts = usePaperCounts(examId, classPapersRaw, reviewerView);
  const needsReview = (paper: ExamPaper): boolean => {
    const counts = paperCounts.counts.get(paper.id);
    return Boolean(counts && counts.entered - counts.verified > 0);
  };

  const classPapers = classPapersRaw
    .sort(
      (a, b) =>
        (reviewerView ? Number(needsReview(b)) - Number(needsReview(a)) : 0) ||
        Number(mineOf(b) === true) - Number(mineOf(a) === true) ||
        `${a.examDate}${a.startTime}`.localeCompare(`${b.examDate}${b.startTime}`) ||
        (names.subjectName(a.subjectId) ?? "").localeCompare(
          names.subjectName(b.subjectId) ?? "",
        ),
    );
  const noneMine =
    pairs !== null &&
    !pairsPending &&
    papers.length > 0 &&
    !papers.some((paper) => isMyPaper(paper, pairs));

  const chips: readonly Chip<string>[] = classIds.map((id) => ({
    value: id,
    label: names.className(id) ?? copy.exams.hub.classChipsLabel,
    testID: `exam-class-${id}`,
  }));

  const sectionName = (id: string | null) =>
    id ? (sections.data?.find((row) => row.id === id)?.name ?? null) : null;

  const confirm = () => {
    if (!pending || !scope.organizationId) return;
    move.mutate(
      {
        organizationId: scope.organizationId,
        ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
        id: examId,
        target: pending.target,
      },
      {
        onSuccess: async (_data, variables) => {
          await Promise.all([
            utils.exam.exam.byId.invalidate(),
            utils.exam.exam.list.invalidate(),
          ]);
          setMoved(copy.exams.hub.moved(stageLabel(variables.target)));
          setPending(null);
        },
      },
    );
  };

  const meta = exam
    ? [
        examTypeLabel(exam.examType),
        exam.countsTowardTermResult
          ? copy.exams.hub.weight(String(Number(exam.weightageInTerm)))
          : copy.exams.hub.notCounted,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <ScreenFrame
      title={exam?.name ?? copy.exams.title}
      meta={meta}
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-hub-back"
      titleTestID="exam-hub-title"
      action={
        scope.canUpdate && moves.overflow.length > 0
          ? {
              label: copy.exams.hub.options,
              icon: "manage",
              onPress: () => setOptionsOpen(true),
              accessibilityHint: copy.exams.hub.optionsHint,
              testID: "exam-hub-options",
            }
          : undefined
      }
      footer={footer}
      onRefresh={() => void detail.refetch()}
      refreshing={detail.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="exam-hub-denied"
      />,
    );
  }

  if (!scope.ready || detail.isPending) {
    return frame(
      <View style={styles.body} testID="exam-hub-loading">
        <Skeleton height={104} />
        <Skeleton height={44} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </View>,
    );
  }

  if (detail.isError) {
    return frame(
      <ErrorCard
        cause={detail.error}
        onRetry={() => void detail.refetch()}
        testID="exam-hub-error"
      />,
    );
  }

  if (!detail.data || !exam) {
    return frame(
      <EmptyState
        icon="exams"
        title={copy.exams.gone}
        message={copy.exams.goneBody}
        testID="exam-hub-gone"
      />,
    );
  }

  const primary = moves.primary;
  const footer =
    scope.canUpdate && primary ? (
      <CapsuleButton
        title={transitionLabel(primary.key)}
        onPress={() => {
          move.reset();
          setPending(primary);
        }}
        testID="exam-hub-primary"
        style={styles.cta}
      />
    ) : undefined;

  return frame(
    <View style={styles.body}>
      {moved ? (
        <Notice tone="positive" title={moved} icon="checkCircle" testID="exam-hub-moved" />
      ) : null}
      <StageTrack status={exam.status} />
      {!openable ? (
        <Notice
          tone="neutral"
          title={copy.exams.hub.notStartedTitle}
          message={copy.exams.hub.notStartedBody}
          icon="info"
          testID="exam-hub-not-open"
        />
      ) : null}
      {noneMine && entryOpen ? (
        <Notice
          tone="neutral"
          title={copy.exams.hub.noneMineTitle}
          message={copy.exams.hub.noneMineBody}
          icon="info"
          testID="exam-hub-none-mine"
        />
      ) : null}

      {papers.length === 0 ? (
        <EmptyState
          icon="exams"
          title={copy.exams.hub.noPapersTitle}
          message={copy.exams.hub.noPapersBody}
          testID="exam-hub-no-papers"
        />
      ) : (
        <View>
          <SectionLabel style={styles.label}>
            {[
              chips.length === 1 && activeClass && names.className(activeClass)
                ? `${copy.exams.hub.papers} · ${names.className(activeClass)}`
                : copy.exams.hub.papers,
              reviewerView ? copy.exams.hub.review.orderHint : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </SectionLabel>
          {chips.length > 1 && activeClass ? (
            <View style={styles.chips}>
              <ChipRow
                label={copy.exams.hub.classChipsLabel}
                value={activeClass}
                options={chips}
                onChange={setPickedClass}
              />
            </View>
          ) : null}
          {reviewerView && readiness.data ? (
            <View style={styles.reviewCard}>
              <HubReviewCard
                entered={readiness.data.enteredEntries}
                expected={readiness.data.expectedEntries}
                verified={readiness.data.verifiedEntries}
              />
            </View>
          ) : null}
          <View style={styles.papers}>
            {classPapers.map((paper) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                subject={names.subjectName(paper.subjectId) ?? "Subject"}
                sectionName={sectionName(paper.sectionId)}
                mine={mineOf(paper)}
                reviewer={reviewerView}
                counts={paperCounts.counts.get(paper.id) as PaperCounts | null | undefined}
                openable={openable}
                entryOpen={entryOpen}
                onPress={() =>
                  router.push({
                    pathname: "/exams/[examId]/paper/[scheduleId]",
                    params: { examId, scheduleId: paper.id },
                  })
                }
              />
            ))}
          </View>
        </View>
      )}

      {pending ? (
        <ConfirmSheet
          title={transitionTitle(pending.key)}
          body={transitionConsequence(pending.key)}
          confirmLabel={transitionLabel(pending.key)}
          keepLabel={copy.exams.hub.keep}
          tone={pending.destructive ? "destructive" : "default"}
          submitting={move.isPending}
          error={move.error}
          onConfirm={confirm}
          onClose={() => setPending(null)}
          testIDPrefix="exam-transition"
        />
      ) : null}

      <ChoiceSheet
        visible={optionsOpen}
        title={copy.exams.hub.optionsTitle}
        options={moves.overflow.map((option) => ({
          id: option.key,
          label: transitionLabel(option.key),
          detail: transitionConsequence(option.key),
        }))}
        currentId=""
        onSelect={(id) => {
          const choice = moves.overflow.find((option) => option.key === id);
          setOptionsOpen(false);
          if (choice) {
            move.reset();
            setPending(choice);
          }
        }}
        onDismiss={() => setOptionsOpen(false)}
        testIDPrefix="exam-option"
      />
    </View>,
    footer,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  label: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  chips: {
    marginBottom: spacing.md,
  },
  papers: {
    gap: spacing.md,
  },
  cta: {
    alignSelf: "stretch",
  },
  reviewCard: {
    marginBottom: spacing.md,
  },
});
