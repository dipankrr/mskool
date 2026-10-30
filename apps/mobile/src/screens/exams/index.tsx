import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import {
  BottomSheetModal,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { EntityCard } from "../../components/entity-card";
import { ErrorCard } from "../../components/error-card";
import { LinkRow } from "../../components/link-row";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { SegmentBar } from "../../components/segment-bar";
import type { SegmentOption } from "../../components/segment-bar";
import { Skeleton } from "../../components/skeleton";
import { useActiveBranchName } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import {
  countBySegment,
  matchesSegment,
  sortExams,
} from "../../lib/exams";
import type { ExamSegment } from "../../lib/exams";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { examTypeLabel, stageLabel, stageTone } from "./meta";
import { useExamList, useExamScope } from "./use-exam-data";

const SEGMENT_EMPTY: Record<
  Exclude<ExamSegment, "all">,
  { title: string; body: string }
> = {
  open: {
    title: copy.exams.list.emptyOpenTitle,
    body: copy.exams.list.emptyOpenBody,
  },
  upcoming: {
    title: copy.exams.list.emptyUpcomingTitle,
    body: copy.exams.list.emptyUpcomingBody,
  },
  published: {
    title: copy.exams.list.emptyPublishedTitle,
    body: copy.exams.list.emptyPublishedBody,
  },
};

/**
 * The session's exams (Step 7A). The teacher arrives wanting one thing — the
 * exam that is open for marks — so the list opens on that segment whenever one
 * exists and on everything otherwise. The segments and their counts are
 * client-side over one read: a session holds tens of exams, not thousands.
 *
 * Cards state only what `exam.list` knows (stage, term, type, classes). Entry
 * progress is per paper and would cost a read per exam, so it lives on the
 * hub, not here.
 */
export function ExamsListScreen() {
  const scope = useExamScope();
  const branchName = useActiveBranchName();
  const list = useExamList();
  const [picked, setPicked] = useState<ExamSegment | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);

  const rows = useMemo(() => sortExams(list.data ?? []), [list.data]);
  const counts = useMemo(() => countBySegment(rows), [rows]);
  const segment: ExamSegment = picked ?? (counts.open > 0 ? "open" : "all");
  const visible = rows.filter((row) => matchesSegment(row.status, segment));

  const options: readonly SegmentOption<ExamSegment>[] = [
    {
      value: "open",
      label: `${copy.exams.list.segments.open} ${counts.open}`,
      accessibilityLabel: copy.exams.list.segmentA11y(
        copy.exams.list.openA11y,
        counts.open,
      ),
      testID: "exams-segment-open",
    },
    {
      value: "upcoming",
      label: `${copy.exams.list.segments.upcoming} ${counts.upcoming}`,
      accessibilityLabel: copy.exams.list.segmentA11y(
        copy.exams.list.segments.upcoming,
        counts.upcoming,
      ),
      testID: "exams-segment-upcoming",
    },
    {
      value: "published",
      label: `${copy.exams.list.segments.published} ${counts.published}`,
      accessibilityLabel: copy.exams.list.segmentA11y(
        copy.exams.list.segments.published,
        counts.published,
      ),
      testID: "exams-segment-published",
    },
    {
      value: "all",
      label: copy.exams.list.segments.all,
      accessibilityLabel: copy.exams.list.segmentA11y(
        copy.exams.list.segments.all,
        counts.all,
      ),
      testID: "exams-segment-all",
    },
  ];

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.title}
      meta={copy.exams.meta(scope.academicYear?.name ?? null, branchName)}
      backAccessibilityLabel={copy.common.back}
      backTestID="exams-back"
      titleTestID="exams-title"
      action={
        scope.canRead && scope.canCreate
          ? {
              label: copy.exams.form.newAction,
              icon: "add",
              onPress: () => router.push("/exams/exam-form"),
              testID: "exams-new-action",
            }
          : undefined
      }
      secondaryAction={
        scope.canRead && scope.addressable
          ? {
              label: copy.exams.list.toolsLabel,
              icon: "settings",
              iconOnly: true,
              onPress: () => setToolsOpen(true),
              accessibilityHint: copy.exams.list.toolsHint,
              testID: "exams-tools-action",
            }
          : undefined
      }
      onRefresh={scope.canRead && scope.addressable ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
    >
      {children}
      <ExamToolsSheet
        visible={toolsOpen}
        canCreate={scope.canCreate}
        canUpdate={scope.canUpdate}
        onClose={() => setToolsOpen(false)}
      />
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="exams-denied"
      />,
    );
  }

  if (!scope.ready || scope.yearPending) {
    return frame(<ListSkeleton />);
  }

  if (!scope.organizationId || !scope.schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.exams.noBranchTitle}
        message={copy.exams.noBranchBody}
        testID="exams-no-branch"
      />,
    );
  }

  if (!scope.academicYear) {
    return frame(
      <EmptyState
        icon="calendarOff"
        title={copy.exams.noYearTitle}
        message={copy.exams.noYearBody}
        testID="exams-no-year"
      />,
    );
  }

  if (list.isPending) return frame(<ListSkeleton />);

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="exams-error"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      {rows.length > 0 ? (
        <SegmentBar
          label={copy.exams.list.segmentLabel}
          value={segment}
          options={options}
          onChange={setPicked}
        />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon="exams"
          title={copy.exams.list.emptyTitle}
          message={copy.exams.list.emptyBody}
          testID="exams-empty"
        >
          {scope.canCreate ? (
            <CapsuleButton
              title={copy.exams.list.createFirst}
              variant="secondary"
              size="compact"
              onPress={() => router.push("/exams/exam-form")}
              testID="exams-empty-create"
            />
          ) : null}
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="exams"
          title={
            segment === "all"
              ? copy.exams.list.emptyTitle
              : SEGMENT_EMPTY[segment].title
          }
          message={
            segment === "all"
              ? copy.exams.list.emptyBody
              : SEGMENT_EMPTY[segment].body
          }
          testID="exams-segment-empty"
        />
      ) : (
        <View style={styles.cards}>
          {visible.map((row) => (
            <EntityCard
              key={row.id}
              title={row.name}
              meta={`${row.termName} · ${examTypeLabel(row.examType)}\n${copy.exams.list.classes(row.scheduledClasses, row.publishedClasses)}`}
              icon="exams"
              emphasis={row.status === "marks_entry" ? "accent" : "neutral"}
              status={{ label: stageLabel(row.status), tone: stageTone(row.status) }}
              onPress={() =>
                router.push({
                  pathname: "/exams/[examId]",
                  params: { examId: row.id },
                })
              }
              accessibilityHint={copy.exams.list.hint}
              testID={`exam-card-${row.id}`}
            />
          ))}
        </View>
      )}
    </View>,
  );
}

function ExamToolsSheet({
  visible,
  canCreate,
  canUpdate,
  onClose,
}: {
  visible: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  onClose: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (visible) ref.current?.present();
    else ref.current?.dismiss();
  }, [visible]);

  const tools: {
    id: string;
    title: string;
    detail: string;
    icon: AppIconName;
    open: () => void;
  }[] = [];

  if (canCreate) {
    tools.push({
      id: "new",
      title: copy.exams.form.newRow,
      detail: copy.exams.form.newRowDetail,
      icon: "exams",
      open: () => router.push("/exams/exam-form"),
    });
  }
  tools.push({
    id: "term-grades",
    title: copy.exams.termGrades.row,
    detail: copy.exams.termGrades.rowBody,
    icon: "rubric",
    open: () => router.push("/exams/term-grades"),
  });
  if (canUpdate) {
    tools.push({
      id: "final",
      title: copy.exams.final.title,
      detail: copy.exams.final.rowBody,
      icon: "grade",
      open: () => router.push("/exams/final"),
    });
  }
  if (canCreate || canUpdate) {
    tools.push({
      id: "grading",
      title: copy.exams.grading.row,
      detail: copy.exams.grading.rowBody,
      icon: "settings",
      open: () => router.push("/exams/setup"),
    });
  }

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onClose}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetView style={styles.toolsSheet}>
        <SectionLabel style={styles.toolsTitle}>
          {copy.exams.list.toolsLabel}
        </SectionLabel>
        <Card padless testID="exams-tools-sheet">
          {tools.map((tool, index) => (
            <LinkRow
              key={tool.id}
              title={tool.title}
              detail={tool.detail}
              icon={tool.icon}
              onPress={() => {
                onClose();
                tool.open();
              }}
              accessibilityHint={tool.detail}
              first={index === 0}
              testID={`exams-tool-${tool.id}`}
            />
          ))}
        </Card>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

function ListSkeleton() {
  return (
    <View style={styles.cards} testID="exams-loading">
      <Skeleton height={44} />
      {[0, 1, 2].map((key) => (
        <Skeleton key={key} height={92} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  cards: {
    gap: spacing.md,
  },
  toolsSheet: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
  },
  toolsTitle: {
    marginTop: 0,
  },
});
