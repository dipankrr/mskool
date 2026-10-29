import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { LinkRow } from "../../components/link-row";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { displayMarks, fullName } from "../../lib/exams";
import {
  displayPercent,
  isoOf,
  publicationState,
  rankLine,
} from "../../lib/exam-results";
import type { PublicationRow } from "../../lib/exam-results";
import { formatTimestampDate } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import type { Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { EntriesSheet } from "./entries-sheet";
import { CorrectionSheet } from "./correction-sheet";
import {
  useClassResults,
  useCardVersions,
  usePublications,
} from "./use-results";
import { useClassSubjectNames, useExamDetail, useExamScope } from "./use-exam-data";

type SubjectLine = {
  subjectId: string;
  name: string;
  marks: string | null;
  maxMarks: string | null;
  grade: string | null;
  isPassed: boolean;
  isAbsent: boolean;
  isExempted: boolean;
  isGradedOnly: boolean;
};

/**
 * One student's result (chunk 7C): the term totals, every assessed subject in
 * paper order, and the door to the correction flow — tap a subject, see its
 * component entries, correct a published mark through the ledger. The report
 * card row opens the rendered card and its version history.
 */
export function ResultDetailScreen() {
  const { examId = "", classId = "", studentId = "" } = useLocalSearchParams<{
    examId: string;
    classId: string;
    studentId: string;
  }>();
  const scope = useExamScope();
  const detail = useExamDetail(examId);
  const names = useClassSubjectNames();
  const table = useClassResults(examId, classId);
  const publications = usePublications(examId);
  const versions = useCardVersions(studentId);

  const [subjectSheet, setSubjectSheet] = useState<{ id: string; name: string } | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const publication = useMemo(
    () =>
      (publications.data ?? []).find(
        (row: PublicationRow) => row.classId === classId,
      ) ?? null,
    [publications.data, classId],
  );
  const windowOpen = publication?.state === "revision_open";
  const publicationStateNow = publication ? publicationState(publication) : null;

  const rows = useMemo(() => {
    const data = table.data;
    if (!data) return null;
    const student = data.roster.find((row) => row.studentId === studentId) ?? null;
    const term = data.termResults.find((row) => row.studentId === studentId) ?? null;
    // The read's subject list is exam-wide (gap 25); the class's own papers
    // order and bound the rows this screen shows.
    const classSubjectIds = [
      ...new Set(
        (detail.data?.schedules ?? [])
          .filter((schedule) => schedule.classId === classId)
          .map((schedule) => schedule.subjectId),
      ),
    ];
    const nameOf = new Map(data.subjects.map((row) => [row.id, row.name]));
    const lines: SubjectLine[] = [];
    for (const subjectId of classSubjectIds) {
      const result = data.subjectResults.find(
        (row) => row.studentId === studentId && row.subjectId === subjectId,
      );
      if (!result) continue;
      lines.push({
        subjectId,
        name: nameOf.get(subjectId) ?? subjectId,
        marks: result.finalMarks,
        maxMarks: result.maxMarks,
        grade: result.grade,
        isPassed: result.isPassed,
        isAbsent: result.isAbsent,
        isExempted: result.isExempted,
        isGradedOnly: result.isGradedOnly,
      });
    }
    return { student, term, lines };
  }, [table.data, detail.data, studentId, classId]);

  const currentCard = useMemo(
    () => (versions.data ?? []).find((row) => row.isCurrent) ?? null,
    [versions.data],
  );

  const studentName = rows?.student
    ? fullName(rows.student)
    : copy.exams.hub.classChipsLabel;
  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={studentName}
      meta={names.className(classId) ?? undefined}
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-result-back"
      titleTestID="exam-result-title"
      onRefresh={() => void table.refetch()}
      refreshing={table.isRefetching}
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
        testID="exam-result-denied"
      />,
    );
  }

  if (!scope.ready || table.isPending) {
    return frame(
      <View style={styles.body} testID="exam-result-loading">
        <Skeleton height={104} />
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
        testID="exam-result-error"
      />,
    );
  }

  if (!rows || !rows.student) {
    return frame(
      <EmptyState
        icon="exams"
        title={copy.exams.gone}
        message={copy.exams.goneBody}
        testID="exam-result-gone"
      />,
    );
  }

  const term = rows.term;
  const ranks = rankLine(term);

  return frame(
    <View style={styles.body}>
      {banner ? (
        <ThemedText variant="meta" color={colors.accentDeep} testID="exam-result-banner">
          {banner}
        </ThemedText>
      ) : null}

      <Card testID="exam-result-term">
        <ThemedText variant="meta" color={colors.muted}>
          {copy.exams.cards.totalsLabel}
        </ThemedText>
        {term ? (
          <>
            <ThemedText variant="name">
              {term.percentage === null && term.grade
                ? term.grade
                : `${displayMarks(term.totalMarks)}/${displayMarks(term.maxMarks)}`}
            </ThemedText>
            <ThemedText variant="meta" color={colors.muted}>
              {[
                term.percentage !== null
                  ? `${displayPercent(term.percentage)}%`
                  : null,
                term.grade,
                term.isPassed ? copy.exams.results.pass : copy.exams.results.fail,
                ranks
                  ? [
                      ranks.class !== null
                        ? copy.exams.results.rankInClass(ranks.class)
                        : null,
                      ranks.section !== null
                        ? copy.exams.results.rankInSection(ranks.section)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </ThemedText>
          </>
        ) : (
          <ThemedText variant="body">{copy.exams.results.notComputed}</ThemedText>
        )}
      </Card>

      {publication && publicationStateNow ? (
        <ThemedText
          variant="meta"
          color={colors.muted}
          testID="exam-result-publication"
        >
          {publicationStateNow === "revision_open"
            ? copy.exams.publication.windowOpenSince(
                formatTimestampDate(isoOf(publication.revisionOpenedAt)),
              )
            : publicationStateNow === "re_issued"
              ? copy.exams.publication.reIssuedOn(
                  formatTimestampDate(
                    isoOf(publication.reIssuedAt ?? publication.publishedAt),
                  ),
                )
              : copy.exams.publication.publishedOn(
                  formatTimestampDate(isoOf(publication.publishedAt)),
                )}
        </ThemedText>
      ) : null}

      <View style={styles.subjects}>
        {rows.lines.map((line) => (
          <SubjectRow
            key={line.subjectId}
            line={line}
            onOpen={() => {
              setBanner(null);
              setSubjectSheet({ id: line.subjectId, name: line.name });
            }}
          />
        ))}
        {rows.lines.length === 0 ? (
          <EmptyState
            icon="exams"
            title={copy.exams.correction.entriesEmptyTitle}
            message={copy.exams.correction.entriesEmptyBody}
            testID="exam-result-no-subjects"
          />
        ) : null}
      </View>

      {scope.canReadCards && currentCard ? (
        <Card padless testID="exam-result-card-row">
          <LinkRow
            title={copy.exams.cards.row}
            detail={`${copy.exams.cards.version(currentCard.version)} · ${copy.exams.cards.publishedOn(
              formatTimestampDate(isoOf(currentCard.publishedAt)),
            )}`}
            icon="grade"
            onPress={() =>
              router.push({
                pathname: "/exams/[examId]/class/[classId]/card/[studentId]",
                params: { examId, classId, studentId },
              })
            }
            first
            testID="exam-result-card"
          />
        </Card>
      ) : null}

      {subjectSheet ? (
        <EntriesSheet
          examId={examId}
          studentId={studentId}
          studentName={studentName}
          subject={subjectSheet}
          windowOpen={windowOpen}
          canCorrect={scope.canCorrect}
          onCorrect={(componentResultId) => setCorrecting(componentResultId)}
          onClose={() => setSubjectSheet(null)}
        />
      ) : null}

      {subjectSheet && correcting ? (
        <CorrectionSheet
          examId={examId}
          studentId={studentId}
          componentResultId={correcting}
          subjectName={subjectSheet.name}
          gradedOnly={
            rows.lines.find((line) => line.subjectId === subjectSheet.id)
              ?.isGradedOnly ?? false
          }
          windowOpen={windowOpen}
          onApplied={() => {
            setCorrecting(null);
            setSubjectSheet(null);
            setBanner(
              windowOpen
                ? copy.exams.correction.windowApplied
                : copy.exams.correction.applied,
            );
            void table.refetch();
            void versions.refetch();
          }}
          onClose={() => setCorrecting(null)}
        />
      ) : null}
    </View>,
  );
}

function SubjectRow({
  line,
  onOpen,
}: {
  line: SubjectLine;
  onOpen: () => void;
}) {
  const pill: { label: string; tone: Tone } | null = line.isAbsent
    ? { label: copy.exams.results.absent, tone: "caution" }
    : line.isExempted
      ? { label: copy.exams.paper.exemptChip, tone: "neutral" }
      : line.isGradedOnly
        ? null
        : line.isPassed
          ? { label: copy.exams.results.pass, tone: "positive" }
          : { label: copy.exams.results.fail, tone: "critical" };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${line.name}, ${line.isAbsent ? copy.exams.results.absent : `${displayMarks(line.marks)} of ${displayMarks(line.maxMarks)}`}`}
      accessibilityHint={copy.exams.results.openStudent}
      onPress={onOpen}
      style={({ pressed }) => [styles.subjectRow, pressed ? styles.rowPressed : null]}
      testID={`exam-result-subject-${line.subjectId}`}
    >
      <View style={styles.nameBlock}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {line.name}
        </ThemedText>
        {line.isGradedOnly ? (
          <ThemedText variant="meta" color={colors.muted}>
            {copy.exams.results.gradeOnlyNote}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText variant="body" style={styles.marks} numberOfLines={1}>
        {line.isGradedOnly
          ? (line.grade ?? "–")
          : line.isAbsent
            ? copy.exams.results.absent
            : `${displayMarks(line.marks)}/${displayMarks(line.maxMarks)}`}
      </ThemedText>
      {pill ? <StatusPill label={pill.label} tone={pill.tone} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  subjects: {
    gap: spacing.sm,
  },
  subjectRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  nameBlock: {
    flex: 1,
    gap: spacing.xxs,
  },
  marks: {
    fontVariant: ["tabular-nums"],
  },
});
