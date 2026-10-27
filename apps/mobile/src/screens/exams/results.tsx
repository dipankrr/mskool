import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { LinkRow } from "../../components/link-row";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusMeter } from "../../components/status-meter";
import { ThemedText } from "../../components/themed-text";
import { ConfirmSheet } from "../homework/confirm-sheet";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { formatTimestampDate } from "../../lib/format";
import {
  isoOf,
  matchesResultFilter,
  publicationState,
  resultRows,
} from "../../lib/exam-results";
import type { PublicationRow, ResultFilter } from "../../lib/exam-results";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { stageLabel } from "./meta";
import { ChipRow } from "./chip-row";
import type { Chip } from "./chip-row";
import { ResultRow } from "./result-row";
import {
  useClassResults,
  usePublications,
  useResultActions,
} from "./use-results";
import { useClassSubjectNames, useExamDetail, useExamScope } from "./use-exam-data";
import { useClassReadiness } from "./use-review-counts";

const FILTERS: readonly {
  value: ResultFilter;
  labelKey: keyof typeof copy.exams.results.filters;
}[] = [
  { value: "all", labelKey: "all" },
  { value: "failed", labelKey: "failed" },
  { value: "attention", labelKey: "attention" },
  { value: "absent", labelKey: "absent" },
];

/**
 * One class's results, publication and corrections (chunk 7C) — the
 * principal's decision surface, one decision per screen: compute first, then
 * publish, then (after publication) correct through the ledger. The list is a
 * photograph of the last compute; the readiness strip and the stale banner
 * say when to re-take it. A teacher gets the same screen with every act
 * hidden, and nothing here is optimistic — publish and the window buttons
 * seal only after the server answers.
 */
export function ClassResultsScreen() {
  const { examId = "", classId = "" } = useLocalSearchParams<{
    examId: string;
    classId: string;
  }>();
  const scope = useExamScope();
  const detail = useExamDetail(examId);
  const names = useClassSubjectNames();
  const table = useClassResults(examId, classId);
  const publications = usePublications(examId);
  const readiness = useClassReadiness(examId, classId, true);
  const actions = useResultActions(examId);

  const [filter, setFilter] = useState<ResultFilter>("all");
  const [banner, setBanner] = useState<{
    tone: "positive" | "caution";
    text: string;
  } | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    "publish" | "openWindow" | "closeWindow" | null
  >(null);

  const exam = detail.data?.exam ?? null;
  const rows = useMemo(() => (table.data ? resultRows(table.data) : []), [table.data]);
  const counts = useMemo(() => {
    const map = new Map<ResultFilter, number>();
    for (const key of FILTERS) {
      map.set(
        key.value,
        key.value === "all"
          ? rows.length
          : rows.filter((row) => matchesResultFilter(row, key.value)).length,
      );
    }
    return map;
  }, [rows]);
  const visible = useMemo(
    () => rows.filter((row) => matchesResultFilter(row, filter)),
    [rows, filter],
  );

  const publication = useMemo(() => {
    const row = (publications.data ?? []).find(
      (candidate: PublicationRow) => candidate.classId === classId,
    );
    return { row, state: publicationState(row) };
  }, [publications.data, classId]);

  const className = names.className(classId) ?? copy.exams.hub.classChipsLabel;
  const windowOpen = publication.state === "revision_open";

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <ScreenFrame
      title={className}
      meta={
        exam ? [exam.name, stageLabel(exam.status)].filter(Boolean).join(" · ") : undefined
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-results-back"
      titleTestID="exam-results-title"
      onRefresh={() => void table.refetch()}
      refreshing={table.isRefetching}
      footer={footer}
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
        testID="exam-results-denied"
      />,
    );
  }

  if (!scope.ready || table.isPending) {
    return frame(
      <View style={styles.body} testID="exam-results-loading">
        <Skeleton height={120} />
        <Skeleton height={44} />
        <Skeleton height={64} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>,
    );
  }

  if (table.isError) {
    return frame(
      <ErrorCard
        cause={table.error}
        onRetry={() => void table.refetch()}
        testID="exam-results-error"
      />,
    );
  }

  if (!table.data) {
    return frame(
      <EmptyState
        icon="exams"
        title={copy.exams.gone}
        message={copy.exams.goneBody}
        testID="exam-results-gone"
      />,
    );
  }

  const chips: readonly Chip<ResultFilter>[] = FILTERS.map((entry) => ({
    value: entry.value,
    label: `${copy.exams.results.filters[entry.labelKey]} ${counts.get(entry.value) ?? 0}`,
    testID: `result-filter-${entry.value}`,
  }));

  const publishFooter = scope.canPublish ? (
    <CapsuleButton
      title={copy.exams.publication.publish}
      onPress={() => {
        actions.mutations.publishClass.reset();
        setBanner(null);
        setActError(null);
        setConfirm("publish");
      }}
      loading={actions.pending}
      disabled={actions.pending}
      testID="exam-results-publish"
      style={styles.cta}
    />
  ) : undefined;

  return frame(
    <View style={styles.body}>
      {banner ? (
        <Notice
          tone={banner.tone}
          title={banner.text}
          icon={banner.tone === "positive" ? "checkCircle" : "info"}
          testID="exam-results-banner"
        />
      ) : null}
      {actError ? (
        <Notice
          tone="critical"
          title={copy.exams.results.computeFailed}
          message={actError}
          icon="info"
          testID="exam-results-act-error"
        />
      ) : null}

      <Card testID="exam-results-readiness">
        <ThemedText variant="meta" color={colors.muted}>
          {copy.exams.results.readinessTitle}
        </ThemedText>
        {readiness.data ? (
          <>
            <ThemedText variant="bodyStrong">
              {[
                copy.exams.results.enteredOf(
                  readiness.data.enteredEntries,
                  readiness.data.expectedEntries,
                ),
                copy.exams.results.verifiedOf(readiness.data.verifiedEntries),
              ].join(" · ")}
            </ThemedText>
            <StatusMeter
              segments={[
                {
                  key: "verified",
                  value: readiness.data.verifiedEntries,
                  tone: "positive",
                },
                {
                  key: "toVerify",
                  value: Math.max(
                    0,
                    readiness.data.enteredEntries - readiness.data.verifiedEntries,
                  ),
                  tone: "positive",
                  opacity: 0.35,
                },
                {
                  key: "missing",
                  value: Math.max(
                    0,
                    readiness.data.expectedEntries - readiness.data.enteredEntries,
                  ),
                  tone: "neutral",
                  opacity: 0.2,
                },
              ]}
              style={styles.meter}
              testID="exam-results-readiness-meter"
            />
            {readiness.data.belowBar.length > 0 ? (
              <ThemedText variant="meta" color={colors.tone.caution.fg}>
                {copy.exams.results.belowBar(readiness.data.belowBar.length)}
              </ThemedText>
            ) : null}
            {readiness.data.staleCompute ? (
              <Notice
                tone="caution"
                title={copy.exams.results.staleTitle}
                message={copy.exams.results.staleBody}
                icon="info"
                testID="exam-results-stale"
              />
            ) : null}
          </>
        ) : (
          <ThemedText variant="body">{copy.exams.results.loadError}</ThemedText>
        )}
      </Card>

      {scope.canUpdate ? (
        <View style={styles.actions}>
          <CapsuleButton
            title={copy.exams.results.compute}
            variant="secondary"
            onPress={() => {
              setBanner(null);
              setActError(null);
              void actions
                .compute(classId)
                .then((computed) => {
                  setBanner({
                    tone: "positive",
                    text: copy.exams.results.computed(computed?.length ?? 0),
                  });
                })
                .catch((error: unknown) => setActError(errorMessage(error)));
            }}
            loading={actions.pending}
            disabled={actions.pending}
            testID="exam-results-compute"
          />
          <CapsuleButton
            title={copy.exams.results.computeRanks}
            variant="secondary"
            onPress={() => {
              if (!exam?.termId) return;
              setBanner(null);
              setActError(null);
              void actions
                .computeRanks(exam.termId)
                .then((result) => {
                  setBanner({
                    tone: "positive",
                    text: copy.exams.results.ranksComputed(result.updated),
                  });
                })
                .catch((error: unknown) => setActError(errorMessage(error)));
            }}
            loading={actions.pending}
            disabled={actions.pending}
            testID="exam-results-ranks"
          />
        </View>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="exams"
          title={copy.exams.results.nothingTitle}
          message={copy.exams.results.nothingBody}
          testID="exam-results-empty"
        />
      ) : (
        <View>
          <ChipRow
            label={copy.exams.results.filterLabel}
            value={filter}
            options={chips}
            onChange={setFilter}
          />
          <View style={styles.rows}>
            {visible.map((row) => (
              <ResultRow
                key={row.student.studentId}
                row={row}
                onOpen={(studentId) =>
                  router.push({
                    pathname: "/exams/[examId]/class/[classId]/student/[studentId]",
                    params: { examId, classId, studentId },
                  })
                }
              />
            ))}
            {visible.length === 0 ? (
              <EmptyState
                icon="exams"
                title={copy.exams.results.filterEmptyTitle}
                message={copy.exams.results.filterEmptyBody}
                testID="exam-results-filter-empty"
              />
            ) : null}
          </View>
        </View>
      )}

      {publication.state && publication.row ? (
        <Card testID="exam-results-publication">
          <ThemedText variant="bodyStrong">
            {windowOpen
              ? copy.exams.publication.windowOpenSince(
                  formatTimestampDate(isoOf(publication.row.revisionOpenedAt)),
                )
              : publication.state === "re_issued"
                ? copy.exams.publication.reIssuedOn(
                    formatTimestampDate(
                      isoOf(publication.row.reIssuedAt ?? publication.row.publishedAt),
                    ),
                  )
                : copy.exams.publication.publishedOn(
                    formatTimestampDate(isoOf(publication.row.publishedAt)),
                  )}
          </ThemedText>
          {scope.canCorrect ? (
            <View style={styles.windowActions}>
              <CapsuleButton
                title={
                  windowOpen
                    ? copy.exams.publication.windowCloseAction
                    : copy.exams.publication.windowOpenAction
                }
                variant={windowOpen ? "destructive" : "secondary"}
                size="compact"
                onPress={() => {
                  actions.mutations.openWindow.reset();
                  actions.mutations.closeWindow.reset();
                  setBanner(null);
                  setConfirm(windowOpen ? "closeWindow" : "openWindow");
                }}
                loading={actions.pending}
                disabled={actions.pending}
                testID={
                  windowOpen ? "exam-results-close-window" : "exam-results-open-window"
                }
              />
            </View>
          ) : null}
        </Card>
      ) : null}

      {scope.canReadCards ? (
        <Card padless testID="exam-results-cards-row">
          <LinkRow
            title={copy.exams.cards.row}
            detail={
              publication.row?.publishedAt
                ? copy.exams.cards.publishedOn(formatTimestampDate(isoOf(publication.row.publishedAt)))
                : undefined
            }
            icon="grade"
            onPress={() =>
              router.push({
                pathname: "/exams/[examId]/class/[classId]/cards",
                params: { examId, classId },
              })
            }
            first
            testID="exam-results-cards"
          />
        </Card>
      ) : null}

      {confirm === "publish" ? (
        <ConfirmSheet
          title={copy.exams.publication.publishTitle}
          body={[
            copy.exams.publication.publishBody(
              readiness.data?.enteredEntries ?? 0,
              readiness.data?.expectedEntries ?? 0,
              readiness.data?.verifiedEntries ?? 0,
            ),
            copy.exams.publication.publishConsequence,
          ].join("\n\n")}
          confirmLabel={copy.exams.publication.publish}
          keepLabel={copy.exams.publication.publishKeep}
          submitting={actions.mutations.publishClass.isPending}
          error={actions.mutations.publishClass.error}
          onConfirm={() => {
            void actions
              .publishClass(classId)
              .then(() => {
                setConfirm(null);
                setBanner({ tone: "positive", text: copy.exams.publication.published });
              })
              .catch(() => {
                // The sheet keeps the server's refusal wording inline.
              });
          }}
          onClose={() => setConfirm(null)}
          testIDPrefix="exam-publish"
        />
      ) : null}

      {confirm === "openWindow" || confirm === "closeWindow" ? (
        <ConfirmSheet
          title={
            confirm === "openWindow"
              ? copy.exams.publication.windowOpenTitle
              : copy.exams.publication.windowCloseTitle
          }
          body={
            confirm === "openWindow"
              ? copy.exams.publication.windowOpenBody
              : copy.exams.publication.windowCloseBody
          }
          confirmLabel={
            confirm === "openWindow"
              ? copy.exams.publication.windowOpenAction
              : copy.exams.publication.windowCloseAction
          }
          keepLabel={copy.exams.publication.publishKeep}
          tone={confirm === "closeWindow" ? "destructive" : "default"}
          submitting={actions.pending}
          error={
            confirm === "openWindow"
              ? actions.mutations.openWindow.error
              : actions.mutations.closeWindow.error
          }
          onConfirm={() => {
            if (confirm === "openWindow") {
              void actions
                .openWindow(classId)
                .then((result) => {
                  setConfirm(null);
                  setBanner({
                    tone: result ? "positive" : "caution",
                    text: result
                      ? copy.exams.publication.windowOpened
                      : copy.exams.publication.windowNull,
                  });
                })
                .catch(() => {
                  // The sheet keeps the server's refusal wording inline.
                });
            } else {
              void actions
                .closeWindow(classId)
                .then((result) => {
                  setConfirm(null);
                  setBanner({
                    tone: "positive",
                    text: copy.exams.publication.windowClosed(
                      result && "reIssued" in result ? result.reIssued : 0,
                    ),
                  });
                })
                .catch(() => {
                  // The sheet keeps the server's refusal wording inline.
                });
            }
          }}
          onClose={() => setConfirm(null)}
          testIDPrefix="exam-window"
        />
      ) : null}
    </View>,
    publishFooter,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  meter: {
    marginVertical: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
  },
  rows: {
    marginTop: spacing.sm,
  },
  windowActions: {
    marginTop: spacing.sm,
  },
  cta: {
    alignSelf: "stretch",
  },
});
