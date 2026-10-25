import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatTile } from "../../components/stat-tile";
import { StatusMeter } from "../../components/status-meter";
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
  formatMarks,
  matchesStudentFilter,
  sortRoster,
} from "../../lib/homework";
import type { StudentGradeFilter } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";
import { SegmentBar } from "./segments";
import type { SegmentOption } from "./segments";
import {
  isStudentWorkStatus,
  studentStatusLabel,
  studentStatusTone,
} from "./meta";
import type { HomeworkDetail, StudentAssignmentRow } from "./types";

/**
 * The grading grid: one homework, every student who received it, and the one
 * next act — open a student's work.
 *
 * The teacher arrives here at the end of a school day with a stack of
 * notebooks in front of them. So the screen leads with progress (reviewed of
 * reviewable, not of all rows: an excused student is not work waiting), then
 * the four filters that match how they triage — everything, the two states
 * that need a decision, what is already done, and who never handed in.
 *
 * Late joiners are shown and labelled, never counted: the server marks them
 * `countsTowardStats = false`, and including them would make the denominator
 * disagree with the report the school sees.
 *
 * Grades and rubrics are read-only in this build. The screen says so once,
 * plainly, rather than hiding the mode or offering a save the server would
 * reject.
 */
export function HomeworkGradeGridScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? "";
  const { organizationId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("homework:read");
  const canGrade = has("homework:grade");

  const [filter, setFilter] = useState<StudentGradeFilter>("all");

  const detail = trpc.homework.byId.useQuery(
    { organizationId: organizationId ?? "", id },
    {
      enabled: ready && canRead && Boolean(organizationId) && Boolean(id),
    },
  );

  const assignment = detail.data ?? null;
  const status = assignment?.status ?? "draft";
  const isLive = status === "published" || status === "closed";

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

  const rows = useMemo(() => students.data ?? [], [students.data]);

  const counts = useMemo(() => countStudentWork(rows), [rows]);

  const sorted = useMemo(() => sortRoster(rows), [rows]);

  const visible = useMemo(
    () => sorted.filter((row) => matchesStudentFilter(row.status, filter)),
    [sorted, filter],
  );

  const dueText = assignment
    ? `${dayLabel(dayKeyOf(assignment.dueAt))} · ${
        clockOf(assignment.dueAt) ?? "—"
      }`
    : null;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.homework.grade.title}
      meta={
        assignment
          ? [
              assignment.title,
              dueText ? copy.homework.grade.meta(dueText) : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : null
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-grade-back"
      titleTestID="homework-grade-title"
      onRefresh={
        assignment
          ? () => {
              void detail.refetch();
              if (isLive) void students.refetch();
            }
          : undefined
      }
      refreshing={detail.isRefetching || students.isRefetching}
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
        testID="homework-grade-denied"
      />,
    );
  }

  if (!id) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.grade.loadError}
        message={copy.homework.detail.notFoundBody}
        testID="homework-grade-missing"
      />,
    );
  }

  if (detail.isPending) {
    return frame(
      <View style={styles.skeleton}>
        <Skeleton height={168} />
        <Skeleton height={48} />
        <Skeleton height={280} />
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
          testID="homework-grade-no-access"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={detail.error}
        onRetry={() => void detail.refetch()}
        testID="homework-grade-error"
      />,
    );
  }

  if (!assignment) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.detail.notFoundTitle}
        message={copy.homework.detail.notFoundBody}
        testID="homework-grade-not-found"
      />,
    );
  }

  if (!isLive) {
    return frame(
      <EmptyState
        icon={status === "cancelled" ? "closeCircle" : "clock"}
        title={copy.homework.grade.notLiveTitle}
        message={
          status === "scheduled"
            ? copy.homework.grade.scheduledBody
            : status === "cancelled"
              ? copy.homework.grade.cancelledBody
              : copy.homework.grade.notLiveBody
        }
        testID="homework-grade-not-live"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.homework.grade.openHomework}
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.openHomework,
            pressed ? styles.pressed : null,
          ]}
          testID="homework-grade-open"
        >
          <ThemedText variant="bodyStrong" color={colors.accentDeep}>
            {copy.homework.grade.openHomework}
          </ThemedText>
        </Pressable>
      </EmptyState>,
    );
  }

  if (students.isPending) {
    return frame(
      <View style={styles.skeleton}>
        <Skeleton height={168} />
        <Skeleton height={48} />
        <Skeleton height={280} />
      </View>,
    );
  }

  if (students.isError) {
    const friendly = toFriendlyError(students.error);
    if (friendly.kind === "forbidden" || friendly.kind === "notFound") {
      return frame(
        <EmptyState
          icon="shield"
          title={copy.homework.grade.noAccessTitle}
          message={copy.homework.grade.noAccessBody}
          testID="homework-grade-students-denied"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={students.error}
        onRetry={() => void students.refetch()}
        testID="homework-grade-students-error"
      />,
    );
  }

  const options: readonly SegmentOption<StudentGradeFilter>[] = [
    {
      value: "all",
      label: copy.homework.grade.all,
      accessibilityLabel: `${copy.homework.grade.all}, ${counts.total}`,
      testID: "grade-filter-all",
    },
    {
      value: "to_grade",
      label: copy.homework.grade.toGrade,
      accessibilityLabel: `${copy.homework.grade.toGrade}, ${counts.toGrade}`,
      testID: "grade-filter-to-grade",
    },
    {
      value: "graded",
      label: copy.homework.grade.graded,
      accessibilityLabel: `${copy.homework.grade.graded}, ${counts.reviewed}`,
      testID: "grade-filter-graded",
    },
    {
      value: "missing",
      label: copy.homework.grade.missing,
      accessibilityLabel: `${copy.homework.grade.missing}, ${counts.missing}`,
      testID: "grade-filter-missing",
    },
  ];

  const filterEmpty = copy.homework.grade.filterEmpty[filter];
  const readOnlyMode =
    assignment.gradingMode === "grade" || assignment.gradingMode === "rubric";

  return frame(
    <View style={styles.body}>
      {!canGrade ? (
        <Notice
          tone="caution"
          title={copy.homework.grade.viewerTitle}
          message={copy.homework.grade.viewerBody}
          testID="homework-grade-viewer"
        />
      ) : null}

      <Card style={styles.summary}>
        <View style={styles.summaryHead}>
          <ThemedText variant="sectionLabel">
            {copy.homework.grade.progress}
          </ThemedText>
          <ThemedText variant="bodyStrong">
            {copy.homework.grade.progressLine(counts.reviewed, counts.reviewable)}
          </ThemedText>
        </View>

        <View style={styles.tiles}>
          <StatTile
            value={counts.reviewed}
            label={copy.homework.grade.reviewed}
            tone="positive"
          />
          <StatTile
            value={counts.toGrade}
            label={copy.homework.grade.toGrade}
            tone="caution"
          />
          <StatTile
            value={counts.missing}
            label={copy.homework.grade.missing}
            tone="critical"
          />
          <StatTile
            value={counts.excused}
            label={copy.homework.grade.excused}
            tone="neutral"
          />
        </View>

        <StatusMeter
          segments={[
            { key: "reviewed", value: counts.reviewed, tone: "positive" },
            { key: "toGrade", value: counts.toGrade, tone: "caution" },
            {
              key: "notSubmitted",
              value: counts.notSubmitted,
              tone: "neutral",
            },
            { key: "missing", value: counts.missing, tone: "critical" },
          ]}
          style={styles.meter}
          testID="homework-grade-meter"
        />

        {counts.notSubmitted > 0 ? (
          <ThemedText variant="meta">
            {`${counts.notSubmitted} ${copy.homework.detail.notSubmitted.toLowerCase()}`}
          </ThemedText>
        ) : null}
        {counts.viewOnly > 0 ? (
          <ThemedText variant="meta">
            {copy.homework.grade.viewOnly(counts.viewOnly)}
          </ThemedText>
        ) : null}
      </Card>

      {readOnlyMode ? (
        <Notice
          tone="caution"
          title={copy.homework.grade.readOnlyTitle}
          message={copy.homework.grade.readOnlyBody}
          testID="homework-grade-read-only"
        />
      ) : null}

      <View style={styles.filters}>
        <SegmentBar
          label={copy.homework.grade.title}
          value={filter}
          options={options}
          onChange={setFilter}
        />
        <ThemedText variant="meta" style={styles.showing}>
          {copy.homework.grade.studentCount(visible.length)}
        </ThemedText>
      </View>

      {visible.length > 0 ? (
        <Card padless>
          {visible.map((row, index) => (
            <GradeRow
              key={row.id}
              row={row}
              assignment={assignment}
              first={index === 0}
              onPress={() =>
                router.push({
                  pathname: "/homework/grade/[saId]",
                  params: {
                    saId: row.id,
                    name: row.studentName,
                    roll: row.rollNumber ?? "",
                  },
                })
              }
            />
          ))}
        </Card>
      ) : (
        <EmptyState
          icon={filter === "missing" ? "warning" : "students"}
          title={filterEmpty.title}
          message={filterEmpty.body}
          testID="homework-grade-empty"
        />
      )}
    </View>,
  );
}

/**
 * One student in the register. The status word is the coloured line because
 * that is the fact a teacher scans for; the score sits at the trailing edge
 * where the eye lands last. A late joiner carries its label here so the count
 * above can stay honest without hiding the row.
 */
function GradeRow({
  row,
  assignment,
  first,
  onPress,
}: {
  row: StudentAssignmentRow;
  assignment: HomeworkDetail;
  first: boolean;
  onPress: () => void;
}) {
  const status = isStudentWorkStatus(row.status) ? row.status : null;
  const tone = status ? studentStatusTone[status] : "neutral";
  const statusText = status ? studentStatusLabel[status] : row.status;
  const score =
    assignment.gradingMode === "marks" && row.currentMarks !== null
      ? `${formatMarks(row.currentMarks)}${
          assignment.maxMarks
            ? ` / ${formatMarks(assignment.maxMarks)}`
            : ""
        }`
      : null;

  const context = [
    row.rollNumber ? `Roll ${row.rollNumber}` : null,
    row.countsTowardStats === false ? copy.homework.grade.lateJoiner : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const label = [
    row.studentName,
    statusText,
    context,
    score ? `${score}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={copy.homework.grade.openStudentHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed ? styles.rowPressed : null,
      ]}
      testID={`homework-grade-row-${row.id}`}
    >
      {!first ? <View style={styles.separator} pointerEvents="none" /> : null}
      <Avatar name={row.studentName} />
      <View style={styles.rowText}>
        <ThemedText variant="name" numberOfLines={1}>
          {row.studentName}
        </ThemedText>
        <View style={styles.rowMeta}>
          <ThemedText
            variant="meta"
            color={colors.tone[tone].fg}
            numberOfLines={1}
          >
            {statusText}
          </ThemedText>
          {context ? (
            <ThemedText variant="meta" numberOfLines={1} style={styles.rowRest}>
              {` · ${context}`}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <View style={styles.trailing}>
        {score ? (
          <ThemedText variant="bodyStrong" numberOfLines={1}>
            {score}
          </ThemedText>
        ) : status === "reviewed" ? (
          <AppIcon
            name="checkCircle"
            size={18}
            color={colors.tone.positive.fg}
          />
        ) : null}
        <AppIcon name="chevronRight" size={16} color={colors.chevron} />
      </View>
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
    gap: spacing.md,
  },
  summaryHead: {
    gap: spacing.xxs,
  },
  tiles: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  meter: {
    marginTop: spacing.xxs,
  },
  filters: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  showing: {
    paddingHorizontal: spacing.xs,
  },
  row: {
    minHeight: touch.rosterRow,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.tone.neutral.bg,
  },
  separator: {
    position: "absolute",
    top: 0,
    left: spacing.lg + 40 + spacing.md,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowRest: {
    flexShrink: 1,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  openHomework: {
    minHeight: touch.comfortable,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  pressed: {
    opacity: 0.6,
  },
});
