import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { LinkRow } from "../../components/link-row";
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
import { isoOf, publicationState } from "../../lib/exam-results";
import type { PublicationRow } from "../../lib/exam-results";
import { formatTimestampDate } from "../../lib/format";
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
import { useResultActions, usePublications } from "./use-results";
import {
  useClassSubjectNames,
  useExamDetail,
  useExamScope,
  useExamSections,
  useMyPairs,
} from "./use-exam-data";
import { useClassReadiness, usePaperCounts } from "./use-review-counts";
import type { PaperCounts } from "./use-review-counts";

/** The publication line under a class's Results row — one row per class. */
function resultsDetailLine(
  state: ReturnType<typeof publicationState>,
  pub: PublicationRow | null,
): string {
  if (!pub || !state) return copy.exams.hub.resultsNotPublished;
  if (state === "revision_open")
    return copy.exams.publication.windowOpenSince(
      formatTimestampDate(isoOf(pub.revisionOpenedAt)),
    );
  if (state === "re_issued")
    return copy.exams.publication.reIssuedOn(
      formatTimestampDate(isoOf(pub.reIssuedAt ?? pub.publishedAt)),
    );
  return copy.exams.publication.publishedOn(
    formatTimestampDate(isoOf(pub.publishedAt)),
  );
}

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
  const results = useResultActions(examId);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [publishOut, setPublishOut] = useState<{
    published: number;
    failed: string[];
  } | null>(null);

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
  // Results live from verification onward (D13): compute, publish, correct.
  const resultsOpen =
    exam !== null && (exam.status === "under_verification" || isResultsStage(exam.status));
  // One Results row per class, each naming where that class stands — the
  // publish-all follow-up ("Not published: Class 7") lands here without
  // chip-switching.
  const publications = usePublications(examId, resultsOpen);
  const pubByClass = useMemo(
    () =>
      new Map<string, PublicationRow>(
        (publications.data ?? []).map((row) => [row.classId, row]),
      ),
    [publications.data],
  );
  const moves = exam ? stageMoves(exam.status) : { primary: null, overflow: [] };
  const mineOf = (paper: ExamPaper): boolean | null =>
    pairs && !pairsPending ? isMyPaper(paper, pairs) : null;

  // Reviewers (marks:verify) at an entry stage see review progress: the class
  // line from one readiness read, and each paper's own counts. A teacher's hub
  // now pays for the same per-paper counts, but only for the papers the
  // caller owns during entry — bounded by their teaching assignments — so
  // "Enter marks" cards carry live progress and the continue row knows what
  // is left.
  const ownPapers = papers.filter((paper) => mineOf(paper) === true);
  const reviewerView = scope.canVerify && entryOpen;
  const classPapersRaw = papers.filter((paper) => paper.classId === activeClass);
  const readiness = useClassReadiness(examId, activeClass, reviewerView);
  const countsPapers = reviewerView ? classPapersRaw : entryOpen ? ownPapers : [];
  const paperCounts = usePaperCounts(
    examId,
    countsPapers,
    reviewerView || (entryOpen && ownPapers.length > 0),
  );

  // The teacher's next unfinished paper, in schedule order: the one tap that
  // answers "where was I?" without reading the papers list.
  const continuePaper = (() => {
    if (!entryOpen || reviewerView) return null;
    const candidate = ownPapers
      .map((paper) => ({ paper, counts: paperCounts.counts.get(paper.id) }))
      .filter(
        (entry): entry is { paper: ExamPaper; counts: PaperCounts } =>
          entry.counts != null && entry.counts.entered < entry.counts.expected,
      )
      .sort((a, b) =>
        `${a.paper.examDate}${a.paper.startTime}`.localeCompare(
          `${b.paper.examDate}${b.paper.startTime}`,
        ),
      )[0];
    if (!candidate) return null;
    return {
      paper: candidate.paper,
      left: candidate.counts.expected - candidate.counts.entered,
    };
  })();
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
        scope.canUpdate && exam !== null
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
      // The paper counts ride the same marks.entry cache the paper screen
      // writes through; a refresh that skipped them would show pre-entry
      // numbers after a round of typing.
      onRefresh={() => {
        void detail.refetch();
        void utils.exam.marks.entry.invalidate();
      }}
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

      {resultsOpen ? (
        <View style={styles.resultsRows}>
          {classIds.map((classId) => {
            const pub = pubByClass.get(classId) ?? null;
            return (
              <Card padless key={classId} testID={`exam-hub-results-${classId}`}>
                <LinkRow
                  title={copy.exams.hub.resultsRowTitle(
                    names.className(classId) ?? copy.exams.hub.classChipsLabel,
                  )}
                  detail={resultsDetailLine(publicationState(pub ?? undefined), pub)}
                  icon="grade"
                  onPress={() =>
                    router.push({
                      pathname: "/exams/[examId]/class/[classId]",
                      params: { examId, classId },
                    })
                  }
                  first
                  testID={`exam-hub-results-row-${classId}`}
                />
              </Card>
            );
          })}
        </View>
      ) : null}

      {continuePaper ? (
        <Card padless testID="exam-hub-continue">
          <LinkRow
            title={copy.exams.hub.continueTitle}
            detail={copy.exams.hub.continueDetail(
              names.subjectName(continuePaper.paper.subjectId) ?? "",
              continuePaper.left,
            )}
            icon="marks"
            onPress={() =>
              router.push({
                pathname: "/exams/[examId]/paper/[scheduleId]",
                params: { examId, scheduleId: continuePaper.paper.id },
              })
            }
            first
            testID="exam-hub-continue-row"
          />
        </Card>
      ) : null}

      {papers.length === 0 ? (
        <EmptyState
          icon="exams"
          title={copy.exams.hub.noPapersTitle}
          message={copy.exams.hub.noPapersBody}
          testID="exam-hub-no-papers"
        >
          {scope.canUpdate && !isEntryOpen(exam?.status ?? "draft") ? (
            <CapsuleButton
              title={copy.exams.hub.addPapers}
              variant="secondary"
              size="compact"
              onPress={() =>
                router.push({
                  pathname: "/exams/[examId]/setup",
                  params: { examId },
                })
              }
              testID="exam-hub-add-papers"
              style={styles.cta}
            />
          ) : null}
        </EmptyState>
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
                showEntryProgress={
                  !reviewerView && entryOpen && openable && mineOf(paper) === true
                }
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

      {publishOut ? (
        <>
          <Notice
            tone="positive"
            title={copy.exams.publication.publishAllDone(publishOut.published)}
            icon="checkCircle"
            testID="exam-hub-publish-all-done"
          />
          {publishOut.failed.length > 0 ? (
            <Notice
              tone="caution"
              title={copy.exams.publication.publishAllFailed(
                publishOut.failed.map((id) => names.className(id) ?? id).join(", "),
              )}
              icon="info"
              testID="exam-hub-publish-all-failed"
            />
          ) : null}
        </>
      ) : null}

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

      {publishAllOpen ? (
        <ConfirmSheet
          title={copy.exams.publication.publishAllTitle}
          body={copy.exams.publication.publishAllBody}
          confirmLabel={copy.exams.publication.publishAll}
          keepLabel={copy.exams.publication.publishKeep}
          submitting={results.mutations.publishExam.isPending}
          error={results.mutations.publishExam.error}
          onConfirm={() => {
            void results
              .publishExam()
              .then((out) => {
                setPublishAllOpen(false);
                setPublishOut({
                  published: out.publishedClasses,
                  failed: out.failedClassIds,
                });
              })
              .catch(() => {
                // The sheet keeps the server's refusal wording inline.
              });
          }}
          onClose={() => setPublishAllOpen(false)}
          testIDPrefix="exam-publish-all"
        />
      ) : null}

      <ChoiceSheet
        visible={optionsOpen}
        title={copy.exams.hub.optionsTitle}
        options={[
          ...(scope.canUpdate && !isResultsStage(exam?.status ?? "draft")
            ? [
                {
                  id: "editExam",
                  label: copy.exams.hub.optionEdit,
                  detail: copy.exams.hub.optionEditDetail,
                },
              ]
            : []),
          ...(scope.canUpdate &&
          exam !== null &&
          !isResultsStage(exam.status)
            ? [
                {
                  id: "setup",
                  label: copy.exams.hub.optionSetup,
                  detail:
                    isEntryOpen(exam.status) || exam.status === "ongoing"
                      ? copy.exams.hub.optionSetupFrozenDetail
                      : copy.exams.hub.optionSetupDetail,
                },
              ]
            : []),
          ...(scope.canUpdate && exam !== null && isEntryOpen(exam.status)
            ? [
                {
                  id: "eligibility",
                  label: copy.exams.hub.optionEligibility,
                  detail: copy.exams.hub.optionEligibilityDetail,
                },
              ]
            : []),
          ...moves.overflow.map((option) => ({
            id: option.key,
            label: transitionLabel(option.key),
            detail: transitionConsequence(option.key),
          })),
          ...(scope.canPublish && resultsOpen
            ? [
                {
                  id: "publishAll",
                  label: copy.exams.publication.publishAll,
                  detail: copy.exams.publication.publishAllBody,
                },
              ]
            : []),
        ]}
        currentId=""
        onSelect={(id) => {
          setOptionsOpen(false);
          if (id === "editExam") {
            router.push({
              pathname: "/exams/exam-form",
              params: { examId },
            });
            return;
          }
          if (id === "setup") {
            router.push({
              pathname: "/exams/[examId]/setup",
              params: { examId },
            });
            return;
          }
          if (id === "eligibility") {
            router.push({
              pathname: "/exams/[examId]/eligibility",
              params: { examId },
            });
            return;
          }
          if (id === "publishAll") {
            results.mutations.publishExam.reset();
            setPublishAllOpen(true);
            return;
          }
          const choice = moves.overflow.find((option) => option.key === id);
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
  resultsRows: {
    gap: spacing.md,
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
