import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  FlatList,
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ListScreenFrame } from "../../components/list-screen-frame";
import { Notice } from "../../components/notice";
import { Skeleton } from "../../components/skeleton";
import { StatusMeter } from "../../components/status-meter";
import { ThemedText } from "../../components/themed-text";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { toIsoVerbatim } from "../../lib/exam-draft";
import { TermGradeDraft } from "../../lib/term-grade-draft";
import type { TermGradeSaveInput } from "../../lib/term-grade-draft";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { ChipRow } from "./chip-row";
import type { Chip } from "./chip-row";
import { TERM_GRADE_ACCESSORY_ID, TermGradeRow } from "./term-grade-row";
import { TermGradeSheet } from "./term-grade-sheet";
import { useTermGradeEntries, useTermGradeRoster } from "./use-term-grades";
import type { TermGradeStudent } from "./use-term-grades";

type TermGradeFilter = "all" | "missing" | "graded";
type FilterState = {
  kind: TermGradeFilter;
  ids: ReadonlySet<string> | null;
};

type SaveContext = {
  organizationId: string;
  schoolId: string;
  termId: string;
  mappingId: string;
  sectionId: string;
  subjectId: string;
  client: ReturnType<typeof trpc.useUtils>["client"];
};

/**
 * The one write this screen makes. The context is captured when the entry
 * mounts (and rebound each render), so a save can never land against the
 * section or subject the teacher has since switched away from — the outer
 * screen remounts the whole entry per (term, subject, section).
 */
function saveGrade(c: SaveContext, input: TermGradeSaveInput) {
  return c.client.exam.termGrades.save
    .mutate({
      organizationId: c.organizationId,
      schoolId: c.schoolId,
      termId: c.termId,
      mappingId: c.mappingId,
      sectionId: c.sectionId,
      subjectId: c.subjectId,
      studentId: input.studentId,
      grade: input.grade,
      ...(input.remarks ? { teacherRemarks: input.remarks } : {}),
    })
    .then((row) =>
      row
        ? {
            rowId: row.id,
            grade: row.grade,
            remarks: row.teacherRemarks,
            updatedAt: toIsoVerbatim(row.updatedAt),
          }
        : null,
    );
}

type Props = {
  organizationId: string;
  schoolId: string;
  termId: string;
  sectionId: string;
  subjectId: string;
  mappingId: string;
  subjectName: string | null;
  meta: string;
  pickers: ReactNode;
  /**
   * The outer screen's context chips own the remount that follows a switch;
   * they call this first so typed work is never thrown away silently.
   */
  guardRef: { current: ((apply: () => void) => void) | null };
  canEnter: boolean;
  /**
   * `true` = the caller may grade this (section, subject); `false` = proven
   * not theirs; `null` = the assignment read is still in flight.
   */
  assigned: boolean | null;
  pairsPending: boolean;
};

/**
 * TERM-GRADE ENTRY (chunk 7E) — one term-grade area, one section, every
 * student. The marks grid's (7A) rhythm in a smaller key: type a grade, press
 * Next, keep the keyboard up, commit on Next or blur. Remarks are the rare
 * second act and live in a sheet, so the row stays one field wide.
 *
 * The draft store (`term-grade-draft.ts`) owns typed work, one in-flight save
 * per student, and the "a cleared field never deletes a saved grade" rule.
 * This screen owns the context, the states, and the words — including what
 * the server *didn't* confirm.
 */
export function TermGradeEntry({
  organizationId,
  schoolId,
  termId,
  sectionId,
  subjectId,
  mappingId,
  subjectName,
  meta,
  pickers,
  guardRef,
  canEnter,
  assigned,
  pairsPending,
}: Props) {
  const utils = trpc.useUtils();
  const roster = useTermGradeRoster(sectionId);
  const entries = useTermGradeEntries(termId, mappingId);

  const [filter, setFilter] = useState<FilterState>({ kind: "all", ids: null });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  // Reads that STARTED before this screen mounted (the exam hub warms some
  // caches) may be older than the values the teacher is about to see; only a
  // read that started after mounting may load the draft, or a value that moved
  // in between would be flagged as changed under a teacher who never saw it.
  const [mountedAt] = useState(() => Date.now());
  const listRef = useRef<FlatList<TermGradeStudent>>(null);

  const [draft] = useState(
    () =>
      new TermGradeDraft({
        // Rebound from the effect below on every render, so the store always
        // saves against the subject and section the screen holds right now.
        save: () => Promise.reject(new Error("not-ready")),
        describeError: (cause) => {
          const friendly = toFriendlyError(cause);
          return {
            message: friendly.message,
            conflict: friendly.kind === "conflict",
          };
        },
      }),
  );

  useEffect(() => {
    const context: SaveContext = {
      organizationId,
      schoolId,
      termId,
      mappingId,
      sectionId,
      subjectId,
      client: utils.client,
    };
    draft.bind({
      save: (input) => saveGrade(context, input),
      // Any conflict means the server knows something the screen doesn't:
      // re-read the term's rows, merge, and keep typed work.
      onConflict: () => void entries.refetch(),
    });
  });

  const version = useSyncExternalStore(draft.subscribe, draft.getVersion);

  useEffect(() => {
    // Read the store live: the blur-commit that fires when a chip is pressed
    // can land between the tap and this handler, so a render-time count would
    // be one save behind.
    const guard = (apply: () => void) => {
      if (draft.status().total === 0) {
        apply();
        return;
      }
      Alert.alert(
        copy.exams.termGrades.leaveTitle,
        copy.exams.termGrades.leaveBody,
        [
          { text: copy.exams.termGrades.keepEditing, style: "cancel" },
          {
            text: copy.exams.termGrades.leave,
            style: "destructive",
            onPress: apply,
          },
        ],
      );
    };
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) guardRef.current = null;
    };
  }, [draft, guardRef]);

  useEffect(() => {
    if (!roster.isSuccess || !entries.isSuccess) return;
    if (entries.dataUpdatedAt < mountedAt) return;
    draft.load(
      roster.rows.map((row) => row.studentId),
      entries.rows,
    );
  }, [
    draft,
    entries.dataUpdatedAt,
    entries.isSuccess,
    entries.rows,
    mountedAt,
    roster.isSuccess,
    roster.rows,
  ]);

  const status = draft.status(version);
  const total = roster.rows.length;
  const graded = Math.min(status.graded, total);
  const missing = total - graded;

  useUnsavedChanges(status.total > 0, {
    title: copy.exams.termGrades.leaveTitle,
    body: copy.exams.termGrades.leaveBody,
    keepEditing: copy.exams.termGrades.keepEditing,
    discard: copy.exams.termGrades.leave,
  });

  const editable = canEnter && assigned === true && !pairsPending;

  const visible = useMemo(
    () =>
      filter.ids
        ? roster.rows.filter((row) => filter.ids?.has(row.studentId))
        : roster.rows,
    [filter.ids, roster.rows],
  );

  // -- focus / navigation between rows --------------------------------------
  const focusFrom = (fromId: string | null, step: 1 | -1) => {
    const start = fromId
      ? visible.findIndex((row) => row.studentId === fromId)
      : -1;
    for (let i = start + step; i >= 0 && i < visible.length; i += step) {
      const candidate = visible[i];
      if (!candidate) continue;
      setFocusId(candidate.studentId);
      listRef.current?.scrollToIndex({
        index: i,
        viewPosition: 0.3,
        animated: true,
      });
      return;
    }
    if (step === 1) {
      Keyboard.dismiss();
      setFocusId(null);
    }
  };

  const goToFirstBlank = () => {
    const index = visible.findIndex((row) => {
      const cell = draft.get(row.studentId);
      return (cell?.grade.trim() ?? "") === "";
    });
    const target = visible[index];
    if (index === -1 || !target) {
      Alert.alert(copy.exams.termGrades.noBlank);
      return;
    }
    setFocusId(target.studentId);
    listRef.current?.scrollToIndex({
      index,
      viewPosition: 0.3,
      animated: true,
    });
  };

  const selectFilter = (kind: TermGradeFilter) => {
    setFilter({
      kind,
      ids:
        kind === "all"
          ? null
          : new Set(
              roster.rows
                .filter((row) => {
                  const saved = Boolean(draft.get(row.studentId)?.base.grade);
                  return kind === "graded" ? saved : !saved;
                })
                .map((row) => row.studentId),
            ),
    });
  };

  const onFailedPress = (studentId: string) => {
    const cell = draft.get(studentId);
    if (!cell) return;
    Alert.alert(
      copy.exams.termGrades.failedTitle,
      cell.problem?.message ?? copy.exams.termGrades.notSaved,
      [
        { text: copy.exams.termGrades.keepEditing, style: "cancel" },
        {
          text: copy.exams.termGrades.useSaved,
          style: "destructive",
          onPress: () => draft.discard(studentId),
        },
        {
          text: copy.exams.termGrades.tryAgain,
          onPress: () => draft.retry(studentId),
        },
      ],
    );
  };

  // Once, when the roster first arrives: bring the teacher to where they left
  // off instead of the top of a list they already filled.
  const arrivedRef = useRef(false);
  useEffect(() => {
    if (arrivedRef.current || !editable || visible.length < 8) return;
    arrivedRef.current = true;
    const index = visible.findIndex(
      (row) => (draft.get(row.studentId)?.grade.trim() ?? "") === "",
    );
    if (index > 3) {
      listRef.current?.scrollToIndex({
        index,
        viewPosition: 0.15,
        animated: false,
      });
    }
  }, [draft, editable, visible]);

  const frame = (empty: ReactNode, header?: ReactNode) => (
    <ListScreenFrame<TermGradeStudent>
      title={subjectName ?? copy.exams.termGrades.title}
      meta={meta}
      backAccessibilityLabel={copy.common.back}
      backTestID="term-grades-back"
      titleTestID="term-grades-title"
      header={header}
      data={[]}
      renderItem={() => null}
      keyExtractor={(row) => row.studentId}
      empty={empty}
    />
  );

  if (roster.isError || (entries.isError && !draft.loaded)) {
    return frame(
      <ErrorCard
        cause={roster.error ?? entries.error}
        onRetry={() => {
          void roster.refetch();
          void entries.refetch();
        }}
        testID="term-grades-entry-error"
      />,
    );
  }

  if (!draft.loaded || pairsPending) {
    return frame(
      <View style={styles.skeletons} testID="term-grades-entry-loading">
        <Skeleton height={72} />
        {[0, 1, 2, 3, 4, 5].map((key) => (
          <Skeleton key={key} height={64} />
        ))}
      </View>,
      <View style={styles.header}>{pickers}</View>,
    );
  }

  const notice = !canEnter ? (
    <Notice
      tone="neutral"
      icon="lock"
      title={copy.exams.termGrades.readOnlyTitle}
      message={copy.exams.termGrades.readOnlyBody}
      testID="term-grades-read-only"
    />
  ) : assigned === false ? (
    <Notice
      tone="neutral"
      icon="lock"
      title={copy.exams.termGrades.notAssignedTitle}
      message={copy.exams.termGrades.notAssignedBody}
      testID="term-grades-not-assigned"
    />
  ) : null;

  const filterOptions: readonly Chip<TermGradeFilter>[] = [
    {
      value: "all",
      label: `${copy.exams.termGrades.filters.all} ${total}`,
      accessibilityLabel: copy.exams.termGrades.filterA11y(
        copy.exams.termGrades.filters.all,
        total,
      ),
      testID: "term-grade-filter-all",
    },
    {
      value: "missing",
      label: `${copy.exams.termGrades.filters.missing} ${missing}`,
      accessibilityLabel: copy.exams.termGrades.filterA11y(
        copy.exams.termGrades.filters.missing,
        missing,
      ),
      testID: "term-grade-filter-missing",
    },
    {
      value: "graded",
      label: `${copy.exams.termGrades.filters.graded} ${graded}`,
      accessibilityLabel: copy.exams.termGrades.filterA11y(
        copy.exams.termGrades.filters.graded,
        graded,
      ),
      testID: "term-grade-filter-graded",
    },
  ];

  const header = (
    <View style={styles.header}>
      {pickers}
      {notice}

      {total > 0 ? (
        <Card>
          <View style={styles.progressTop}>
            <ThemedText
              variant="bodyStrong"
              accessibilityLabel={copy.exams.termGrades.progressA11y(
                graded,
                total,
              )}
            >
              {copy.exams.termGrades.progress(graded, total)}
            </ThemedText>
          </View>
          <StatusMeter
            segments={[
              { key: "graded", value: graded, tone: "positive" },
              {
                key: "rest",
                value: total - graded,
                tone: "neutral",
                opacity: 0.2,
              },
            ]}
            style={styles.meter}
            testID="term-grades-progress"
          />
        </Card>
      ) : null}

      {total > 0 ? (
        <ChipRow
          label={copy.exams.termGrades.filterLabel}
          value={filter.kind}
          options={filterOptions}
          onChange={selectFilter}
        />
      ) : null}
    </View>
  );

  const footer =
    editable || status.failed > 0 ? (
      status.failed > 0 ? (
        <View style={styles.footerRow}>
          <View style={styles.footerText}>
            <AppIcon name="warning" size={18} color={colors.tone.caution.fg} />
            <ThemedText
              variant="bodyStrong"
              color={colors.tone.caution.fg}
              testID="term-grades-save-status"
            >
              {copy.exams.termGrades.saveStatus.unsaved(status.failed)}
            </ThemedText>
          </View>
          <CapsuleButton
            title={copy.exams.termGrades.retryAll}
            size="mini"
            variant="secondary"
            onPress={() => draft.retryAll()}
            testID="term-grades-retry-all"
          />
        </View>
      ) : (
        <View style={styles.footerText}>
          {status.saving > 0 ? (
            <ThemedText variant="meta" testID="term-grades-save-status">
              {copy.exams.termGrades.saveStatus.saving}
            </ThemedText>
          ) : status.typing > 0 ? (
            <ThemedText variant="meta" testID="term-grades-save-status">
              {copy.exams.termGrades.saveStatus.typing}
            </ThemedText>
          ) : (
            <>
              <AppIcon name="check" size={18} color={colors.accentDeep} />
              <ThemedText variant="meta" testID="term-grades-save-status">
                {copy.exams.termGrades.saveStatus.saved}
              </ThemedText>
            </>
          )}
        </View>
      )
    ) : undefined;

  const sheetStudent = sheetFor
    ? (roster.rows.find((row) => row.studentId === sheetFor) ?? null)
    : null;

  return (
    <>
      <ListScreenFrame<TermGradeStudent>
        title={subjectName ?? copy.exams.termGrades.title}
        meta={meta}
        backAccessibilityLabel={copy.common.back}
        backTestID="term-grades-back"
        titleTestID="term-grades-title"
        action={
          // Graded-only filter holds no blanks; offering the jump there would
          // lie. All and Missing both contain at least one while `missing > 0`.
          editable && missing > 0 && filter.kind !== "graded"
            ? {
                label: copy.exams.termGrades.goToBlank,
                icon: "marks",
                onPress: goToFirstBlank,
                testID: "term-grades-first-blank",
              }
            : undefined
        }
        header={header}
        data={visible}
        keyExtractor={(row) => row.studentId}
        extraData={[editable, focusId, filter.kind]}
        renderItem={({ item }) => (
          <TermGradeRow
            draft={draft}
            student={item}
            editable={editable}
            focused={focusId === item.studentId}
            onFocusRow={setFocusId}
            onBlurRow={(id) =>
              setFocusId((current) => (current === id ? null : current))
            }
            onNext={(id) => focusFrom(id, 1)}
            onOpenSheet={(id) => {
              // The sheet has its own fields; leaving the row keyboard up
              // stacks two inputs behind one another.
              Keyboard.dismiss();
              setSheetFor(id);
            }}
            onFailedPress={onFailedPress}
          />
        )}
        empty={
          total === 0 ? (
            <EmptyState
              icon="students"
              title={copy.exams.termGrades.noRosterTitle}
              message={copy.exams.termGrades.noRosterBody}
              testID="term-grades-entry-empty"
            />
          ) : (
            <EmptyState
              icon="filter"
              title={copy.exams.termGrades.filterEmptyTitle}
              message={copy.exams.termGrades.filterEmptyBody}
              testID="term-grades-filter-empty"
            >
              <CapsuleButton
                title={copy.exams.termGrades.showAll}
                variant="secondary"
                size="compact"
                onPress={() => selectFilter("all")}
              />
            </EmptyState>
          )
        }
        footer={footer}
        listRef={listRef}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          // The row is outside the rendered window: jump near it, then retry.
          listRef.current?.scrollToOffset({
            offset: Math.max(0, averageItemLength * index),
            animated: false,
          });
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index,
              viewPosition: 0.3,
              animated: true,
            });
          }, 80);
        }}
        onRefresh={() => {
          void roster.refetch();
          void entries.refetch();
        }}
        refreshing={roster.isRefetching || entries.isFetching}
        testID="term-grades-screen"
      />

      {sheetStudent ? (
        <TermGradeSheet
          draft={draft}
          student={sheetStudent}
          editable={editable}
          onClose={() => {
            // The sheet's input owned the keyboard; closing the sheet without
            // this left it up over the roster with nothing to type into
            // (walk 2026-10-28).
            Keyboard.dismiss();
            // Seeing the sheet is seeing the warning it carries.
            draft.acknowledge(sheetStudent.studentId);
            setSheetFor(null);
          }}
        />
      ) : null}

      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={TERM_GRADE_ACCESSORY_ID}>
          <View style={styles.accessory}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.exams.paper.sheet.previous}
              onPress={() => focusFrom(focusId, -1)}
              style={styles.accessoryButton}
            >
              <AppIcon name="chevronLeft" size={20} color={colors.accentDeep} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.exams.paper.next}
              onPress={() => focusFrom(focusId, 1)}
              style={styles.accessoryButton}
            >
              <AppIcon name="chevronRight" size={20} color={colors.accentDeep} />
            </Pressable>
            <View style={styles.accessoryGrow} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.exams.paper.done}
              onPress={() => Keyboard.dismiss()}
              style={styles.accessoryButton}
            >
              <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                {copy.exams.paper.done}
              </ThemedText>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  skeletons: {
    gap: spacing.sm,
  },
  progressTop: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  meter: {
    marginTop: spacing.sm,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  footerText: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 34,
  },
  accessory: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.chip,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    gap: spacing.sm,
  },
  accessoryButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  accessoryGrow: {
    flex: 1,
  },
});
