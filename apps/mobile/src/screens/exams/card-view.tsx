import { useMemo } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { displayMarks } from "../../lib/exams";
import {
  asSnapshot,
  displayPercent,
  isoOf,
  versionChanges,
} from "../../lib/exam-results";
import type { CardVersion } from "../../lib/exam-results";
import type { ReportCardSnapshotV1 } from "@repo/contracts";
import { formatIsoDate } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { useCardVersions } from "./use-results";
import { useExamScope } from "./use-exam-data";

/**
 * One student's report card, rendered natively from the published snapshot
 * (chunk 7C, D15: review here, print/share deferred). The snapshot is the
 * frozen photograph families see — this screen draws exactly what is stored,
 * guarded: a card that fails the structural check renders "unreadable", never
 * a crash. Below the card, the version history says what each re-issue moved.
 */
export function CardViewScreen() {
  const { examId = "", classId = "", studentId = "" } = useLocalSearchParams<{
    examId: string;
    classId: string;
    studentId: string;
  }>();
  void examId;
  void classId;
  const scope = useExamScope();
  const versions = useCardVersions(studentId);

  const parsed = useMemo(() => {
    const rows = versions.data ?? [];
    const current = rows.find((row) => row.isCurrent) ?? rows[0] ?? null;
    return {
      rows: [...rows].sort((a, b) => b.version - a.version),
      current: current ? { row: current, card: asSnapshot(current.snapshotData) } : null,
    };
  }, [versions.data]);

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.cards.row}
      meta={
        parsed.current?.card
          ? `${parsed.current.card.student.name} · ${parsed.current.card.academicYear.name}`
          : undefined
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-card-back"
      titleTestID="exam-card-title"
      onRefresh={() => void versions.refetch()}
      refreshing={versions.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canReadCards) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="exam-card-denied"
      />,
    );
  }

  if (versions.isPending) {
    return frame(
      <View style={styles.body} testID="exam-card-loading">
        <Skeleton height={200} />
        <Skeleton height={64} />
      </View>,
    );
  }

  if (versions.isError) {
    return frame(
      <ErrorCard
        cause={versions.error}
        onRetry={() => void versions.refetch()}
        testID="exam-card-error"
      />,
    );
  }

  if (!parsed.current) {
    return frame(
      <EmptyState
        icon="grade"
        title={copy.exams.cards.noCard}
        message={copy.exams.cards.noCardBody}
        testID="exam-card-none"
      />,
    );
  }

  const { row, card } = parsed.current;

  return frame(
    <View style={styles.body}>
      {card ? (
        <CardView card={card} version={row.version} />
      ) : (
        <EmptyState
          icon="grade"
          title={copy.exams.cards.unreadableTitle}
          message={copy.exams.cards.unreadableBody}
          testID="exam-card-unreadable"
        />
      )}

      <View style={styles.history}>
        <ThemedText variant="bodyStrong">{copy.exams.cards.versionsTitle}</ThemedText>
        {parsed.rows.map((version, index) => (
          <VersionRow
            key={version.id}
            version={version}
            previous={parsed.rows[index + 1] ?? null}
          />
        ))}
      </View>
    </View>,
  );
}

function CardView({ card, version }: { card: ReportCardSnapshotV1; version: number }) {
  // Widget groups in their sequence; a subject without a widget is its own group.
  const groups = useMemo(() => {
    const byWidget = new Map<string, ReportCardSnapshotV1["subjects"]>();
    for (const subject of card.subjects) {
      const key = subject.widgetName ?? "—";
      const list = byWidget.get(key);
      if (list) list.push(subject);
      else byWidget.set(key, [subject]);
    }
    return [...byWidget.entries()].sort((a, b) => {
      const seq = (rows: ReportCardSnapshotV1["subjects"]) =>
        Math.min(...rows.map((row) => row.widgetSequence ?? 999));
      return seq(a[1]) - seq(b[1]);
    });
  }, [card.subjects]);

  return (
    <Card testID="exam-card-card">
      <View style={styles.header}>
        <ThemedText variant="name">{card.school.name}</ThemedText>
        <ThemedText variant="meta" color={colors.muted}>
          {[
            card.academicYear.name,
            card.term?.name ?? null,
            copy.exams.cards.version(version),
          ]
            .filter(Boolean)
            .join(" · ")}
        </ThemedText>
      </View>
      <View style={styles.student}>
        <ThemedText variant="bodyStrong">{card.student.name}</ThemedText>
        <ThemedText variant="meta" color={colors.muted}>
          {[
            card.student.admissionNumber,
            [card.student.className, card.student.sectionName]
              .filter(Boolean)
              .join(" · "),
            card.student.rollNumber
              ? `Roll ${card.student.rollNumber}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </ThemedText>
      </View>

      {groups.map(([widget, subjects]) => (
        <View key={widget} style={styles.group}>
          {widget !== "—" ? (
            <ThemedText variant="meta" color={colors.muted}>
              {widget}
            </ThemedText>
          ) : null}
          {subjects.map((subject) => (
            <View
              key={subject.subjectId}
              style={styles.subjectRow}
              testID={`exam-card-subject-${subject.subjectId}`}
            >
              <ThemedText variant="body" style={styles.subjectName} numberOfLines={1}>
                {subject.subjectName}
              </ThemedText>
              <ThemedText variant="body" style={styles.subjectValue}>
                {subject.isAbsent
                  ? copy.exams.results.absent
                  : subject.isExempted
                    ? copy.exams.paper.exemptChip
                    : [
                        subject.marksObtained !== null
                          ? `${displayMarks(subject.marksObtained)}${
                              subject.maxMarks ? `/${displayMarks(subject.maxMarks)}` : ""
                            }`
                          : null,
                        subject.grade,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
              </ThemedText>
            </View>
          ))}
        </View>
      ))}

      <View style={styles.totals}>
        <ThemedText variant="bodyStrong">
          {[
            card.totals.totalMarks !== null
              ? `${displayMarks(card.totals.totalMarks)}${
                  card.totals.maxMarks ? `/${displayMarks(card.totals.maxMarks)}` : ""
                }`
              : null,
            card.totals.percentage !== null
              ? `${displayPercent(card.totals.percentage)}%`
              : null,
            card.totals.grade,
          ]
            .filter(Boolean)
            .join(" · ") || copy.exams.results.notComputed}
        </ThemedText>
        <ThemedText variant="meta" color={colors.muted}>
          {copy.exams.cards.rankLine(
            card.totals.rankInSection,
            card.totals.rankInClass,
          )}
        </ThemedText>
      </View>

      {card.attendance ? (
        <View style={styles.attendance}>
          <ThemedText variant="meta" color={colors.muted}>
            {copy.exams.cards.attendance}
          </ThemedText>
          <ThemedText variant="body">
            {`${copy.exams.cards.attendanceLine(card.attendance.daysPresent, card.attendance.workingDays)}` +
              (card.attendance.percentage
                ? ` · ${displayPercent(card.attendance.percentage)}%`
                : "")}
          </ThemedText>
        </View>
      ) : null}

      {card.termAssessments.length > 0 ? (
        <View style={styles.group}>
          <ThemedText variant="meta" color={colors.muted}>
            {copy.exams.cards.areas}
          </ThemedText>
          {card.termAssessments.map((area) => (
            <View key={area.mappingId} style={styles.subjectRow}>
              <ThemedText variant="body" style={styles.subjectName} numberOfLines={1}>
                {area.areaName}
              </ThemedText>
              <ThemedText variant="body" style={styles.subjectValue}>
                {area.grade}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function VersionRow({
  version,
  previous,
}: {
  version: CardVersion;
  previous: CardVersion | null;
}) {
  const changes = versionChanges(asSnapshot(previous?.snapshotData ?? null), asSnapshot(version.snapshotData));
  return (
    <View style={styles.versionRow} testID={`exam-card-version-${version.version}`}>
      <View style={styles.versionHead}>
        <ThemedText variant="bodyStrong">
          {[
            copy.exams.cards.version(version.version),
            version.isCurrent ? copy.exams.cards.current : null,
            version.replacesVersion
              ? copy.exams.cards.replaces(version.replacesVersion)
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </ThemedText>
        <ThemedText variant="meta" color={colors.muted}>
          {formatIsoDate(isoOf(version.publishedAt))}
        </ThemedText>
      </View>
      {version.revisionReason ? (
        <ThemedText variant="meta" color={colors.muted} numberOfLines={1}>
          {version.revisionReason}
        </ThemedText>
      ) : null}
      {changes.length > 0 ? (
        <ThemedText variant="meta" numberOfLines={2}>
          {changes.join(" · ")}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  header: {
    gap: spacing.xxs,
  },
  student: {
    marginTop: spacing.sm,
    gap: spacing.xxs,
  },
  group: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  subjectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 36,
  },
  subjectName: {
    flex: 1,
  },
  subjectValue: {
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  totals: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: spacing.xxs,
  },
  attendance: {
    marginTop: spacing.sm,
    gap: spacing.xxs,
  },
  history: {
    gap: spacing.sm,
  },
  versionRow: {
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  versionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
});
