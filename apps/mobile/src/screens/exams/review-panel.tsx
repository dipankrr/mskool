import { useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ListScreenFrame } from "../../components/list-screen-frame";
import { Notice } from "../../components/notice";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import {
  reviewSummary,
  staleItems,
  studentsMatchingReview,
  verifyBatch,
} from "../../lib/exam-draft";
import type {
  PaperDraft,
  ReviewFilter,
  ServerEntry,
  VerifyBatch,
  VerifyItem,
} from "../../lib/exam-draft";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { ConfirmSheet } from "../homework/confirm-sheet";
import { ChipRow } from "./chip-row";
import type { Chip } from "./chip-row";
import type { EntryComponent } from "./entry-row";
import { ReviewRow } from "./review-row";
import { ReviewSummaryCard } from "./review-summary";
import type { RosterStudent } from "./types";
import type { ReviewActions, ReviewScope } from "./use-review";
import { VerifySheet } from "./verify-sheet";

type Banner = { kind: "verified" | "reopened"; count: number; items: VerifyItem[] };

/**
 * REVIEW (Step 7B) — one paper, one section, the reviewer's side of marks.
 *
 * The same `PaperDraft` store as entry, read first: values you can scan, a count
 * of what is left, and one primary act — verify what has been entered. The act
 * is built from what the SERVER holds (never from typed text), is held back
 * while there is unsaved work, and re-reads the paper before it sends: the
 * server has no per-row guard, so a value that moved under the reviewer must
 * not be locked as if they had seen it.
 */
export function ReviewPanel({
  title,
  meta,
  topNodes,
  draft,
  version,
  roster,
  components,
  graded,
  subjectId,
  scope,
  barFlags,
  unsavedTotal,
  failed,
  onRetryAll,
  actions,
  refetchEntries,
  sectionName,
  onOpenSheet,
  onGoToEntry,
}: {
  title: string;
  meta: string | null;
  /** Mode switch, notices and the section row, built by the screen. */
  topNodes: ReactNode;
  draft: PaperDraft;
  version: number;
  roster: RosterStudent[];
  components: EntryComponent[];
  graded: boolean;
  subjectId: string;
  scope: ReviewScope;
  barFlags: ReadonlyMap<string, "below" | "allowed">;
  unsavedTotal: number;
  /** Saves that failed (from a correction in the sheet) and their retry. */
  failed: number;
  onRetryAll: () => void;
  actions: ReviewActions;
  /** Re-reads the paper; resolves with its entries, rejects when it cannot. */
  refetchEntries: () => Promise<readonly ServerEntry[]>;
  sectionName: string | null;
  onOpenSheet: (studentId: string) => void;
  onGoToEntry: () => void;
}) {
  const [picked, setPicked] = useState<{
    kind: ReviewFilter;
    ids: ReadonlySet<string> | null;
  } | null>(null);
  const [sheet, setSheet] = useState<VerifyBatch | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "sending">("idle");
  const [error, setError] = useState<unknown>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [staleCount, setStaleCount] = useState<number | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<unknown>(null);

  const scopeIds = scope.students.map((student) => student.studentId);
  const rosterIds = roster.map((student) => student.studentId);
  const componentIds = components.map((component) => component.id);
  const multi = components.length > 1;

  const summary = reviewSummary(draft, scopeIds, componentIds, version);
  const paperSummary = scope.partitioned
    ? reviewSummary(draft, rosterIds, componentIds, version)
    : null;
  const batch = verifyBatch(draft, scopeIds, componentIds, version);

  const defaultKind: ReviewFilter =
    summary.studentsToVerify > 0 ? "toVerify" : "verified";
  const kind = picked?.kind ?? defaultKind;
  const memberIds =
    picked?.ids ?? studentsMatchingReview(draft, scopeIds, componentIds, kind, version);
  const visible = scope.students.filter((student) =>
    memberIds.has(student.studentId),
  );

  const chips: readonly Chip<ReviewFilter>[] = [
    chip("toVerify", summary.studentsToVerify),
    chip("verified", summary.studentsVerified),
    chip("missing", summary.studentsMissing),
    chip("absent", summary.studentsAbsent),
  ];

  const selectFilter = (next: ReviewFilter) =>
    setPicked({
      kind: next,
      ids: studentsMatchingReview(draft, scopeIds, componentIds, next),
    });

  const reviewChanges = () => {
    const ids = new Set<string>();
    for (const student of scope.students) {
      for (const componentId of componentIds) {
        if (draft.get(`${student.studentId}:${componentId}`)?.remoteChange) {
          ids.add(student.studentId);
        }
      }
    }
    setPicked({ kind: "toVerify", ids });
    setStaleCount(null);
  };

  const why =
    scope.state === "loading"
      ? copy.exams.paper.review.why.loading
      : scope.state === "needsSection"
        ? copy.exams.paper.review.why.noSection
        : scope.state === "unknown"
          ? copy.exams.paper.review.why.noPartition
          : unsavedTotal > 0
            ? copy.exams.paper.review.why.unsaved
            : batch.items.length === 0
              ? batch.changedEntries > 0
                ? copy.exams.paper.review.why.onlyChanged
                : summary.cells - summary.missing === 0
                  ? copy.exams.paper.review.why.nothingEntered
                  : copy.exams.paper.review.why.allVerified
              : null;

  const nothingEntered =
    scope.state === "ready" && summary.cells > 0 && summary.cells === summary.missing;
  const allVerified =
    scope.state === "ready" &&
    summary.toVerify === 0 &&
    summary.verified > 0 &&
    summary.missing === 0;
  const changedNow = summary.changed || staleCount || 0;

  const openVerify = () => {
    setError(null);
    setStaleCount(null);
    setBanner(null);
    setSheet(batch);
  };

  const confirmVerify = async () => {
    if (!sheet || !scope.sectionId) return;
    setError(null);
    setPhase("checking");
    try {
      // Re-read first: whatever the server holds NOW is what would be locked.
      const entries = await refetchEntries();
      draft.sync(entries);
      const stale = staleItems(sheet.items, entries);
      if (stale.length > 0) {
        setStaleCount(stale.length);
        setSheet(null);
        return;
      }
      setPhase("sending");
      await actions.verify({
        rowIds: sheet.items.map((item) => item.rowId),
        sectionId: scope.sectionId,
        subjectId,
      });
      setBanner({ kind: "verified", count: sheet.items.length, items: sheet.items });
      setPicked(null);
      setSheet(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setPhase("idle");
    }
  };

  const confirmReopen = async () => {
    if (!banner || !scope.sectionId) return;
    setReopening(true);
    setReopenError(null);
    try {
      await actions.unverify({
        rowIds: banner.items.map((item) => item.rowId),
        sectionId: scope.sectionId,
        subjectId,
      });
      setBanner({ kind: "reopened", count: banner.count, items: [] });
      setPicked(null);
      setReopenOpen(false);
    } catch (cause) {
      setReopenError(cause);
    } finally {
      setReopening(false);
    }
  };

  const openRow = (studentId: string) => {
    // Opening a row is looking at it: its "changed" flag has done its job.
    for (const component of components) draft.acknowledge(studentId, component.id);
    setStaleCount(null);
    onOpenSheet(studentId);
  };

  const header = (
    <View style={styles.header}>
      {topNodes}
      {scope.partitioned && sectionName ? (
        <ThemedText variant="meta" testID="review-scope-line">
          {copy.exams.paper.review.sectionScope(
            sectionName,
            scope.students.length,
            scope.sectionless,
          )}
        </ThemedText>
      ) : null}

      {banner ? (
        <Notice
          tone="positive"
          icon="checkCircle"
          title={
            banner.kind === "verified"
              ? copy.exams.paper.review.success(banner.count)
              : copy.exams.paper.review.reopened(banner.count)
          }
          testID="review-banner"
        >
          {banner.kind === "verified" ? (
            <CapsuleButton
              title={copy.exams.paper.review.reopenThese}
              variant="secondary"
              size="compact"
              onPress={() => {
                setReopenError(null);
                setReopenOpen(true);
              }}
              testID="review-reopen-these"
              style={styles.bannerAction}
            />
          ) : null}
        </Notice>
      ) : null}

      {changedNow > 0 ? (
        <Notice
          tone="caution"
          title={copy.exams.paper.review.changedBanner(changedNow)}
          testID="review-changed"
        >
          <CapsuleButton
            title={copy.exams.paper.review.reviewChanges}
            variant="secondary"
            size="compact"
            onPress={reviewChanges}
            testID="review-changes"
            style={styles.bannerAction}
          />
        </Notice>
      ) : null}

      {allVerified && !banner ? (
        <Notice
          tone="positive"
          icon="checkCircle"
          title={copy.exams.paper.review.allVerifiedTitle(summary.verified)}
          message={copy.exams.paper.review.allVerifiedBody}
          testID="review-all-verified"
        />
      ) : null}

      {scope.state === "ready" ? (
        <>
          <ReviewSummaryCard
            summary={summary}
            multi={multi}
            paperLine={
              paperSummary
                ? copy.exams.paper.review.wholePaper(paperSummary.verified, paperSummary.cells)
                : null
            }
          />
          <ChipRow
            label={copy.exams.paper.review.filterLabel}
            value={kind}
            options={chips}
            onChange={selectFilter}
          />
        </>
      ) : null}
    </View>
  );

  const empty =
    scope.state !== "ready" ? null : nothingEntered ? (
      <EmptyState
        icon="marks"
        title={copy.exams.paper.review.emptyTitle}
        message={copy.exams.paper.review.emptyBody}
        testID="review-empty"
      >
        <CapsuleButton
          title={copy.exams.paper.review.goToEntry}
          variant="secondary"
          size="compact"
          onPress={onGoToEntry}
          testID="review-go-to-entry"
        />
      </EmptyState>
    ) : (
      <EmptyState
        icon="filter"
        title={copy.exams.paper.review.filterEmptyTitle}
        message={copy.exams.paper.review.filterEmptyBody}
        testID="review-filter-empty"
      />
    );

  const footer = (
    <View style={styles.footer}>
      {failed > 0 ? (
        <View style={styles.failedRow}>
          <ThemedText variant="bodyStrong" color={colors.tone.caution.fg} style={styles.failedText}>
            {copy.exams.paper.saveStatus.unsaved(failed)}
          </ThemedText>
          <CapsuleButton
            title={copy.exams.paper.retryAll}
            size="mini"
            variant="secondary"
            onPress={onRetryAll}
            testID="review-retry-all"
          />
        </View>
      ) : null}
      <CapsuleButton
        title={copy.exams.paper.review.verify(batch.items.length)}
        onPress={openVerify}
        disabled={why !== null}
        testID="review-verify"
        style={styles.cta}
      />
      {why ? (
        <ThemedText variant="meta" style={styles.why} testID="review-why">
          {why}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <>
      <ListScreenFrame<RosterStudent>
        title={title}
        meta={meta}
        backAccessibilityLabel={copy.common.back}
        backTestID="paper-back"
        titleTestID="paper-title"
        header={header}
        data={scope.state === "ready" ? visible : []}
        keyExtractor={(row) => row.studentId}
        extraData={[kind, summary.verified, summary.toVerify, summary.changed, barFlags]}
        renderItem={({ item }) => (
          <ReviewRow
            draft={draft}
            student={item}
            components={components}
            graded={graded}
            barFlag={barFlags.get(item.studentId) ?? null}
            onOpen={openRow}
          />
        )}
        empty={empty}
        footer={footer}
        testID="review-screen"
      />

      {sheet ? (
        <VerifySheet
          batch={sheet}
          sectionName={sectionName}
          checking={phase === "checking"}
          submitting={phase === "sending"}
          error={error}
          onConfirm={() => void confirmVerify()}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {reopenOpen && banner ? (
        <ConfirmSheet
          title={copy.exams.paper.review.reopenBatchTitle(banner.items.length)}
          body={copy.exams.paper.review.reopenBatchBody}
          confirmLabel={copy.exams.paper.sheet.reopenConfirm}
          keepLabel={copy.exams.paper.sheet.reopenKeep}
          submitting={reopening}
          error={reopenError}
          onConfirm={() => void confirmReopen()}
          onClose={() => setReopenOpen(false)}
          testIDPrefix="review-reopen"
        />
      ) : null}
    </>
  );
}

function chip(kind: ReviewFilter, count: number): Chip<ReviewFilter> {
  const label = copy.exams.paper.review.filters[kind];
  return {
    value: kind,
    label: `${label} ${count}`,
    accessibilityLabel: copy.exams.paper.filterA11y(label, count),
    testID: `review-filter-${kind}`,
  };
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  bannerAction: {
    alignSelf: "flex-start",
  },
  footer: {
    gap: spacing.xs,
  },
  cta: {
    alignSelf: "stretch",
  },
  why: {
    textAlign: "center",
  },
  failedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  failedText: {
    flex: 1,
  },
});
