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
import { useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ListScreenFrame } from "../../components/list-screen-frame";
import { Notice } from "../../components/notice";
import { SegmentBar } from "../../components/segment-bar";
import type { SegmentOption } from "../../components/segment-bar";
import { Skeleton } from "../../components/skeleton";
import { StatusMeter } from "../../components/status-meter";
import { ThemedText } from "../../components/themed-text";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import {
  PaperDraft,
  cellKey,
  isLockedStatus,
  reopenItems,
  studentsMatching,
  summarizePaper,
} from "../../lib/exam-draft";
import type { PaperFilter, SaveInput } from "../../lib/exam-draft";
import { toFriendlyError } from "../../lib/errors";
import {
  canReview,
  displayMarks,
  isEntryOpen,
  partitionBySection,
  sectionsForPaper,
  sortRosterByRoll,
} from "../../lib/exams";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ChipRow } from "./chip-row";
import type { Chip } from "./chip-row";
import { EntryRow, MARKS_ACCESSORY_ID } from "./entry-row";
import type { EntryComponent } from "./entry-row";
import { ReviewPanel } from "./review-panel";
import { StudentSheet } from "./student-sheet";
import type { RosterStudent } from "./types";
import {
  useClassSubjectNames,
  useExamDetail,
  useExamScope,
  useExamSections,
  useMyPairs,
} from "./use-exam-data";
import { useReviewActions, useReviewScope } from "./use-review";
import { useSectionByStudent } from "./use-verification";

type SaveContext = {
  organizationId: string | null;
  schoolId: string | null;
  examId: string;
  scheduleId: string;
  sectionId: string | null;
  subjectId: string | null;
  client: ReturnType<typeof trpc.useUtils>["client"];
};

/**
 * The one write the screen makes. The context is the screen's CURRENT section
 * and paper, captured when the screen rebinds the draft — the store outlives
 * any single render and must never save against a stale section.
 */
function saveCell(c: SaveContext, input: SaveInput) {
  if (!c.organizationId || !c.sectionId || !c.subjectId) {
    return Promise.reject(new Error("no-section"));
  }
  return c.client.exam.marks.save.mutate({
    organizationId: c.organizationId,
    ...(c.schoolId ? { schoolId: c.schoolId } : {}),
    sectionId: c.sectionId,
    subjectId: c.subjectId,
    examId: c.examId,
    scheduleId: c.scheduleId,
    componentId: input.componentId,
    studentId: input.studentId,
    marks: input.marks,
    grade: input.grade,
    isAbsent: input.isAbsent,
    isExempted: input.isExempted,
    exemptionType: input.exemptionType,
    ...(input.expectedUpdatedAt
      ? { expectedUpdatedAt: input.expectedUpdatedAt }
      : {}),
  });
}

/**
 * MARKS ENTRY (Step 7A) — one paper, one section, every student.
 *
 * What a teacher does here is type a number, press Next, and type the next
 * one, with a stack of scripts in the other hand. Everything on the screen
 * serves that rhythm: one input per row, the keyboard never dismissed between
 * rows, a save that happens on Next rather than per keystroke, and a row that
 * says — in words, in the row — what did and did not reach the server.
 *
 * Typed work lives in the `PaperDraft` store, not in the rows: the list
 * windows its rows away, and a refetch (app resume) merges into the store
 * without overwriting anything the teacher has typed. The grid's `canEnter`
 * verdict is honoured up front, so a paper the caller cannot enter reads as
 * read-only with the honest reason instead of inputs that would refuse.
 */
export function PaperScreen() {
  const { examId = "", scheduleId = "" } = useLocalSearchParams<{
    examId: string;
    scheduleId: string;
  }>();
  const scope = useExamScope();
  const detail = useExamDetail(examId);
  const names = useClassSubjectNames();
  const sectionsQuery = useExamSections();
  const utils = trpc.useUtils();

  const paper = detail.data?.schedules.find((row) => row.id === scheduleId) ?? null;
  const exam = detail.data?.exam ?? null;
  const { pairs } = useMyPairs(paper ? [paper.classId] : []);

  const [pickedSection, setPickedSection] = useState<string | null>(null);
  const [sectionSheetOpen, setSectionSheetOpen] = useState(false);
  const [componentId, setComponentId] = useState<string | null>(null);
  const [filter, setFilter] = useState<{
    kind: PaperFilter;
    ids: ReadonlySet<string> | null;
  }>({ kind: "all", ids: null });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState<number | null>(null);
  const [pickedMode, setPickedMode] = useState<"enter" | "review" | null>(null);
  // Anything the grid cache already held when this screen mounted (the hub warms
  // it for reviewers) is older than the screen: only a read that STARTED after
  // mounting may load the draft, or a value that moved in between would be
  // flagged as changed under a reviewer who never saw the old one.
  const [mountedAt] = useState(() => Date.now());

  // -- section ---------------------------------------------------------------
  const sectionOptions = useMemo(
    () =>
      paper
        ? sectionsForPaper(paper, sectionsQuery.data ?? [], pairs)
        : [],
    [paper, sectionsQuery.data, pairs],
  );
  const onlySection = sectionOptions.length === 1 ? (sectionOptions[0]?.id ?? null) : null;
  // A section paper IS its section; a class-wide one needs the teacher's pick
  // (or the single section they may enter for).
  const advisorySection = paper?.sectionId ?? pickedSection ?? onlySection;

  // -- the grid ----------------------------------------------------------------
  const entryInput = {
    organizationId: scope.organizationId ?? "",
    ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
    examId,
    id: scheduleId,
    ...(advisorySection ? { sectionId: advisorySection } : {}),
  };
  const grid = trpc.exam.marks.entry.useQuery(
    entryInput,
    {
      enabled:
        scope.ready &&
        scope.canReadMarks &&
        Boolean(scope.organizationId) &&
        detail.isSuccess &&
        Boolean(paper),
      // A stale grid is how conflicts start: always read fresh, drop it on
      // leave, and re-read when the app returns to the foreground.
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: true,
      placeholderData: (previous) => previous,
    },
  );
  const data = grid.data ?? null;

  // -- the draft store -----------------------------------------------------------
  const effectiveSection = data?.sectionId ?? advisorySection;
  const [draft] = useState(
    () =>
      new PaperDraft({
        // Rebound from the effect below on every render, so the store always
        // saves against the section and paper the screen holds right now.
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
      organizationId: scope.organizationId,
      schoolId: scope.schoolId,
      examId,
      scheduleId,
      sectionId: effectiveSection,
      subjectId: data?.subjectId ?? paper?.subjectId ?? null,
      client: utils.client,
    };
    draft.bind({
      save: (input) => saveCell(context, input),
      // Any conflict (stale cell, entry closed, row locked) means the server
      // knows something the screen doesn't: re-read, merge, keep typed work.
      onConflict: () => void grid.refetch(),
    });
  });
  const version = useSyncExternalStore(draft.subscribe, draft.getVersion);

  useEffect(() => {
    if (!data || grid.dataUpdatedAt < mountedAt) return;
    draft.load(
      {
        maxByComponent: new Map(
          data.components.map((c) => [c.id, Number(c.maxMarks)]),
        ),
        isGradedOnly: data.isGradedOnly,
        allowNegative: data.allowsNegativeMarking,
      },
      data.roster.map((row) => row.studentId),
      data.components.map((c) => c.id),
      data.entries,
    );
  }, [data, draft, grid.dataUpdatedAt, mountedAt]);

  // -- eligibility (advisory badges) -----------------------------------------------
  const eligibility = trpc.exam.eligibility.list.useQuery(
    {
      organizationId: scope.organizationId ?? "",
      ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
      examId,
    },
    {
      enabled: scope.ready && scope.canRead && Boolean(scope.organizationId) && Boolean(examId),
      staleTime: 60_000,
    },
  );
  const barFlags = useMemo(() => {
    const map = new Map<string, "below" | "allowed">();
    for (const row of eligibility.data ?? []) {
      if (!row.isEligible) map.set(row.studentId, row.isOverridden ? "allowed" : "below");
    }
    return map;
  }, [eligibility.data]);

  // -- derived view ----------------------------------------------------------------
  const components: EntryComponent[] = useMemo(
    () =>
      [...(data?.components ?? [])]
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
        .map((c) => ({
          id: c.id,
          name: c.name,
          max: c.maxMarks,
          pass: Number(c.passMarks),
        })),
    [data],
  );
  const active = components.find((c) => c.id === componentId) ?? components[0] ?? null;
  const others = components.filter((c) => c.id !== active?.id);
  // The whole paper in roll order: a class-wide paper's is the whole class.
  const fullRoster: RosterStudent[] = useMemo(
    () => sortRosterByRoll(data?.roster ?? []),
    [data],
  );
  // Entry is addressed to ONE section, and the server accepts a mark only for a
  // student of that section (or one with no section yet), so a class-wide
  // paper's roster narrows to the section in hand. A student the enrollment read
  // does not show (a section teacher reads only her own section) is left out,
  // never guessed at; if the read fails the whole class shows and the server
  // remains the judge.
  const classWide = Boolean(paper) && !paper?.sectionId;
  const sectionMap = useSectionByStudent(paper?.classId ?? null, classWide);
  const roster: RosterStudent[] = useMemo(() => {
    if (!classWide || !effectiveSection || !sectionMap.sectionByStudent) {
      return fullRoster;
    }
    return partitionBySection(fullRoster, sectionMap.sectionByStudent, effectiveSection)
      .inScope;
  }, [classWide, effectiveSection, fullRoster, sectionMap.sectionByStudent]);
  const rosterIds = useMemo(() => roster.map((row) => row.studentId), [roster]);
  const visible = filter.ids
    ? roster.filter((row) => filter.ids?.has(row.studentId))
    : roster;

  const summary = summarizePaper(draft, rosterIds, components, active?.id ?? null, version);
  const status = draft.status(version);
  void version;

  const open = data ? isEntryOpen(data.examStatus) : false;
  const sectionNeeded = Boolean(data) && !data?.sectionId && !effectiveSection;
  const noSectionToEnter = sectionNeeded && sectionOptions.length === 0 && !sectionsQuery.isPending;
  const denied = data?.canEnter === false;
  const editable = open && !denied && Boolean(effectiveSection) && Boolean(active);

  // -- review (7B) ---------------------------------------------------------------------
  const reviewAvailable = data ? canReview(data.examStatus, scope.canVerify) : false;
  // A paper under verification opens in Review; during entry it opens in Enter
  // and a reviewer switches over.
  const mode: "enter" | "review" = reviewAvailable
    ? (pickedMode ?? (data?.examStatus === "under_verification" ? "review" : "enter"))
    : "enter";
  const storeLoaded = version >= 0 && draft.loaded;
  const reviewScope = useReviewScope({
    enabled: reviewAvailable,
    paper,
    roster: fullRoster,
    effectiveSection,
    sectionCount: sectionOptions.length,
  });
  const reviewActions = useReviewActions(draft);
  const componentIds = components.map((c) => c.id);

  useUnsavedChanges(status.total > 0, {
    title: copy.exams.paper.leaveTitle,
    body: copy.exams.paper.leaveBody,
    keepEditing: copy.exams.paper.keepEditing,
    discard: copy.exams.paper.leave,
  });

  // -- focus / navigation between rows ------------------------------------------------
  const listRef = useRef<FlatList<RosterStudent>>(null);

  const focusFrom = (fromId: string | null, step: 1 | -1) => {
    if (!active) return;
    const start = fromId ? visible.findIndex((row) => row.studentId === fromId) : -1;
    for (
      let i = start + step;
      i >= 0 && i < visible.length;
      i += step
    ) {
      const candidate = visible[i];
      if (!candidate) continue;
      const cell = draft.get(cellKey(candidate.studentId, active.id));
      if (!cell || cell.exempt || isLockedStatus(cell.base.status)) continue;
      setFocusId(candidate.studentId);
      listRef.current?.scrollToIndex({ index: i, viewPosition: 0.3, animated: true });
      return;
    }
    if (step === 1) {
      Keyboard.dismiss();
      setFocusId(null);
    }
  };

  const goToFirstBlank = () => {
    if (!active) return;
    const index = visible.findIndex((row) => {
      const cell = draft.get(cellKey(row.studentId, active.id));
      return cell && !cell.absent && !cell.exempt && cell.text.trim() === "" && !isLockedStatus(cell.base.status);
    });
    const target = visible[index];
    if (index === -1 || !target) {
      Alert.alert(copy.exams.paper.noBlank);
      return;
    }
    setFocusId(target.studentId);
    listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
  };

  // Once, when the grid first arrives: bring the teacher to where they left
  // off instead of the top of a long roster they already filled.
  const arrivedRef = useRef(false);
  useEffect(() => {
    if (arrivedRef.current || !editable || !active || visible.length < 8) return;
    arrivedRef.current = true;
    const index = visible.findIndex((row) => {
      const cell = draft.get(cellKey(row.studentId, active.id));
      return cell && cell.text.trim() === "" && !cell.absent && !cell.exempt;
    });
    if (index > 3) {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.15, animated: false });
    }
  }, [editable, active, visible, draft]);

  const selectFilter = (kind: PaperFilter) => {
    if (!active) return;
    setFilter({
      kind,
      ids:
        kind === "all"
          ? null
          : studentsMatching(draft, rosterIds, active.id, active.pass, kind),
    });
  };

  const onFailedPress = (studentId: string, compId: string) => {
    const cell = draft.get(cellKey(studentId, compId));
    if (!cell) return;
    Alert.alert(
      copy.exams.paper.failedTitle,
      cell.problem && "message" in cell.problem ? cell.problem.message : copy.exams.paper.notSaved,
      [
        { text: copy.exams.paper.keepEditing, style: "cancel" },
        {
          text: copy.exams.paper.useSaved,
          style: "destructive",
          onPress: () => draft.discard(studentId, compId),
        },
        {
          text: copy.exams.paper.tryAgain,
          onPress: () => draft.retry(studentId, compId),
        },
      ],
    );
  };

  /**
   * Re-reads the paper for the verify guard; rejects when it cannot. A direct
   * fetch (same key, so the screen's grid updates too) rather than
   * `grid.refetch()`: a reader sitting on a locked sheet should hear about a
   * dead connection after one deadline, not after the query's retry as well.
   */
  const refetchEntries = async () => {
    const result = await utils.exam.marks.entry.fetch(entryInput, {
      staleTime: 0,
      retry: false,
    });
    if (!result) throw new Error("no-data");
    return result.entries;
  };

  /** Reopen one student's verified marks (the student sheet's act). */
  const reopenStudent = async (studentId: string) => {
    if (!paper) return;
    const items = reopenItems(draft, [studentId], componentIds);
    if (items.length === 0) return;
    // A batch is addressed to the section the STUDENT sits in.
    const sectionId =
      paper.sectionId ?? reviewScope.sectionOf(studentId) ?? reviewScope.sectionId;
    if (!sectionId) throw new Error(copy.exams.paper.review.why.noSection);
    await reviewActions.unverify({
      rowIds: items.map((item) => item.rowId),
      sectionId,
      subjectId: paper.subjectId,
    });
  };

  // -- header pieces -----------------------------------------------------------------
  const subject = paper ? (names.subjectName(paper.subjectId) ?? "") : "";
  const klass = paper ? (names.className(paper.classId) ?? "") : "";
  const title = [klass, subject].filter(Boolean).join(" · ") || copy.exams.title;
  const totalMax = components.reduce((sum, c) => sum + Number(c.max), 0);
  // `data.passMarks` is the subject pass mark on the 0-100 weighted scale (7/20
  // arrives as 35); a teacher reads the paper's own scale, so sum the raw ones.
  const totalPass = components.reduce((sum, c) => sum + c.pass, 0);
  const meta =
    exam && data
      ? copy.exams.paper.meta(
          exam.name,
          displayMarks(String(totalMax)),
          displayMarks(String(totalPass)),
        )
      : (exam?.name ?? null);

  const filterOptions: readonly Chip<PaperFilter>[] = [
    { value: "all", label: `${copy.exams.paper.filters.all} ${summary.total}`, accessibilityLabel: copy.exams.paper.filterA11y(copy.exams.paper.filters.all, summary.total), testID: "paper-filter-all" },
    { value: "missing", label: `${copy.exams.paper.filters.missing} ${summary.missing}`, accessibilityLabel: copy.exams.paper.filterA11y(copy.exams.paper.filters.missing, summary.missing), testID: "paper-filter-missing" },
    { value: "absent", label: `${copy.exams.paper.filters.absent} ${summary.absent}`, accessibilityLabel: copy.exams.paper.filterA11y(copy.exams.paper.filters.absent, summary.absent), testID: "paper-filter-absent" },
    ...(data?.isGradedOnly
      ? []
      : [{ value: "below" as const, label: `${copy.exams.paper.filters.below} ${summary.below}`, accessibilityLabel: copy.exams.paper.filterA11y(copy.exams.paper.filters.below, summary.below), testID: "paper-filter-below" }]),
  ];

  const componentOptions: readonly SegmentOption<string>[] = components.map((c) => ({
    value: c.id,
    label: `${c.name} /${displayMarks(c.max)}`,
    testID: `paper-component-${c.id}`,
  }));

  const sectionLabel = (id: string | null) =>
    sectionOptions.find((row) => row.id === id)?.name ??
    sectionsQuery.data?.find((row) => row.id === id)?.name ??
    null;

  const showSectionRow =
    Boolean(data) && !data?.sectionId && (mode === "review" || (open && !denied));
  const sectionNode = data ? (
    showSectionRow ? (
      noSectionToEnter ? (
        <Notice tone="caution" title={copy.exams.paper.noSectionsTitle} message={copy.exams.paper.noSectionsBody} testID="paper-no-sections" />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${copy.exams.paper.sectionLabel}: ${sectionLabel(effectiveSection) ?? copy.exams.paper.sectionPlaceholder}`}
          onPress={() => setSectionSheetOpen(true)}
          style={({ pressed }) => [styles.section, sectionNeeded ? styles.sectionNeeded : null, pressed ? styles.pressed : null]}
          testID="paper-section"
        >
          <View style={styles.sectionText}>
            <ThemedText variant="meta">{copy.exams.paper.sectionLabel}</ThemedText>
            <ThemedText variant="name">
              {sectionLabel(effectiveSection) ?? copy.exams.paper.pickSectionTitle}
            </ThemedText>
          </View>
          <AppIcon name="chevronDown" size={20} color={colors.muted} />
        </Pressable>
      )
    ) : null
  ) : null;

  const modeSwitch = reviewAvailable ? (
    <SegmentBar
      label={copy.exams.paper.review.modeLabel}
      value={mode}
      options={[
        { value: "enter", label: copy.exams.paper.review.modeEnter, testID: "paper-mode-enter" },
        { value: "review", label: copy.exams.paper.review.modeReview, testID: "paper-mode-review" },
      ]}
      onChange={(next) => {
        // From now on, "changed" means changed since THIS moment.
        if (next === "review") draft.acknowledgeAll();
        setPickedMode(next);
      }}
    />
  ) : null;

  const header = data ? (
    <View style={styles.header}>
      {modeSwitch}
      {!open ? (
        <Notice tone="neutral" icon="info" title={copy.exams.paper.notOpenTitle} message={copy.exams.paper.notOpenBody} testID="paper-not-open" />
      ) : denied ? (
        <Notice
          tone="neutral"
          icon="lock"
          title={data.canEnterReason === "not-assigned" ? copy.exams.paper.notAssignedTitle : copy.exams.paper.noPermissionTitle}
          message={data.canEnterReason === "not-assigned" ? copy.exams.paper.notAssignedBody : copy.exams.paper.noPermissionBody}
          testID="paper-denied"
        />
      ) : null}

      {sectionNode}

      <Card>
        <View style={styles.progressTop}>
          <ThemedText variant="bodyStrong" accessibilityLabel={copy.exams.paper.progressA11y(summary.entered, summary.total)}>
            {copy.exams.paper.progress(summary.entered, summary.total)}
          </ThemedText>
        </View>
        <StatusMeter
          segments={[
            { key: "entered", value: summary.entered, tone: "positive" },
            { key: "rest", value: summary.total - summary.entered, tone: "neutral", opacity: 0.2 },
          ]}
          style={styles.meter}
          testID="paper-progress"
        />
      </Card>

      {components.length > 1 ? (
        components.length <= 3 ? (
          <SegmentBar
            label={copy.exams.paper.componentLabel}
            value={active?.id ?? ""}
            options={componentOptions}
            onChange={(next) => {
              setComponentId(next);
              setFilter({ kind: "all", ids: null });
            }}
          />
        ) : (
          <ChipRow
            label={copy.exams.paper.componentLabel}
            value={active?.id ?? ""}
            options={componentOptions}
            onChange={(next) => {
              setComponentId(next);
              setFilter({ kind: "all", ids: null });
            }}
          />
        )
      ) : null}

      {roster.length > 0 ? (
        <ChipRow label={copy.exams.paper.filterLabel} value={filter.kind} options={filterOptions} onChange={selectFilter} />
      ) : null}
    </View>
  ) : null;

  // -- states ---------------------------------------------------------------------------
  // Loading, failed and gone states carry no header: its progress card, tabs and
  // filters would count an empty store ("Entered 0 of 17") above the real state.
  const frame = (empty: ReactNode) => (
    <ListScreenFrame<RosterStudent>
      title={title}
      meta={meta}
      backAccessibilityLabel={copy.common.back}
      backTestID="paper-back"
      titleTestID="paper-title"
      data={[]}
      renderItem={() => null}
      keyExtractor={(row) => row.studentId}
      empty={empty}
    />
  );

  if (!scope.canReadMarks) {
    return frame(
      <EmptyState icon="lock" title={copy.exams.deniedTitle} message={copy.exams.deniedBody} testID="paper-denied-page" />,
    );
  }
  // The store is loaded only from a read that started after this screen mounted
  // (see `mountedAt`), so rows never render ahead of their cells.
  if (detail.isError || (grid.isError && !storeLoaded)) {
    return frame(
      <ErrorCard
        cause={detail.error ?? grid.error}
        onRetry={() => {
          void detail.refetch();
          void grid.refetch();
        }}
        testID="paper-error"
      />,
    );
  }
  const goneGrid = grid.isSuccess && !grid.isPlaceholderData && grid.data === null;
  if (detail.isSuccess && (!paper || goneGrid)) {
    return frame(
      <EmptyState icon="exams" title={copy.exams.gone} message={copy.exams.goneBody} testID="paper-gone" />,
    );
  }
  if (!scope.ready || detail.isPending || !storeLoaded || sectionMap.pending) {
    return frame(
      <View style={styles.skeletons} testID="paper-loading">
        <Skeleton height={72} />
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <Skeleton key={k} height={64} />
        ))}
      </View>,
    );
  }
  if (!paper || !data || !active) {
    return frame(
      <EmptyState icon="exams" title={copy.exams.gone} message={copy.exams.goneBody} testID="paper-gone" />,
    );
  }

  const failedBar =
    status.failed > 0 ? (
      <View style={styles.footerRow}>
        <View style={styles.footerText}>
          <AppIcon name="warning" size={18} color={colors.tone.caution.fg} />
          <ThemedText variant="bodyStrong" color={colors.tone.caution.fg} testID="paper-save-status">
            {copy.exams.paper.saveStatus.unsaved(status.failed)}
          </ThemedText>
        </View>
        <CapsuleButton title={copy.exams.paper.retryAll} size="mini" variant="secondary" onPress={() => draft.retryAll()} testID="paper-retry-all" />
      </View>
    ) : (
      <View style={styles.footerText}>
        {status.saving > 0 ? (
          <ThemedText variant="meta" testID="paper-save-status">{copy.exams.paper.saveStatus.saving}</ThemedText>
        ) : status.typing > 0 ? (
          <ThemedText variant="meta" testID="paper-save-status">{copy.exams.paper.saveStatus.typing}</ThemedText>
        ) : (
          <>
            <AppIcon name="check" size={18} color={colors.accentDeep} />
            <ThemedText variant="meta" testID="paper-save-status">{copy.exams.paper.saveStatus.saved}</ThemedText>
          </>
        )}
      </View>
    );

  const sheetOpen = sheetIndex !== null;

  return (
    <>
      {mode === "review" ? (
        <ReviewPanel
          // The undo banner, frozen filter and stale notice are all about one
          // section's batch; switching section starts the panel afresh.
          key={reviewScope.sectionId ?? "no-section"}
          title={title}
          meta={meta}
          topNodes={
            <>
              {modeSwitch}
              {sectionNode}
            </>
          }
          draft={draft}
          version={version}
          roster={fullRoster}
          components={components}
          graded={data.isGradedOnly}
          subjectId={paper.subjectId}
          scope={reviewScope}
          barFlags={barFlags}
          unsavedTotal={status.total}
          failed={status.failed}
          onRetryAll={() => draft.retryAll()}
          actions={reviewActions}
          refetchEntries={refetchEntries}
          sectionName={sectionLabel(reviewScope.sectionId)}
          onOpenSheet={(id) => {
            const index = roster.findIndex((row) => row.studentId === id);
            if (index !== -1) setSheetIndex(index);
          }}
          onGoToEntry={() => setPickedMode("enter")}
        />
      ) : (
        <ListScreenFrame<RosterStudent>
          title={title}
          meta={meta}
          backAccessibilityLabel={copy.common.back}
          backTestID="paper-back"
          titleTestID="paper-title"
          action={
            editable && summary.missing > 0
              ? {
                  label: copy.exams.paper.goToBlank,
                  icon: "marks",
                  onPress: goToFirstBlank,
                  testID: "paper-first-blank",
                }
              : undefined
          }
          header={header}
          data={visible}
          keyExtractor={(row) => row.studentId}
          extraData={[active.id, editable, focusId, barFlags, filter.kind]}
          renderItem={({ item }) => (
            <EntryRow
              draft={draft}
              student={item}
              component={active}
              otherComponents={others}
              graded={data.isGradedOnly}
              editable={editable}
              focused={focusId === item.studentId}
              barFlag={barFlags.get(item.studentId) ?? null}
              onFocusRow={setFocusId}
              onBlurRow={(id) => setFocusId((current) => (current === id ? null : current))}
              onNext={(id) => focusFrom(id, 1)}
              onOpenSheet={(id) => {
                const index = roster.findIndex((row) => row.studentId === id);
                if (index !== -1) setSheetIndex(index);
              }}
              onFailedPress={onFailedPress}
            />
          )}
          empty={
            roster.length === 0 ? (
              <EmptyState icon="students" title={copy.exams.paper.emptyTitle} message={copy.exams.paper.emptyBody} testID="paper-empty" />
            ) : (
              <EmptyState icon="filter" title={copy.exams.paper.filterEmptyTitle} message={copy.exams.paper.filterEmptyBody} testID="paper-filter-empty">
                <CapsuleButton title={copy.exams.paper.showAll} variant="secondary" size="compact" onPress={() => selectFilter("all")} />
              </EmptyState>
            )
          }
          footer={editable || status.failed > 0 ? failedBar : undefined}
          listRef={listRef}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            // The row is outside the rendered window: jump near it, then retry.
            listRef.current?.scrollToOffset({ offset: Math.max(0, averageItemLength * index), animated: false });
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
            }, 80);
          }}
          onRefresh={() => {
            void grid.refetch();
          }}
          refreshing={grid.isRefetching && !grid.isPlaceholderData}
          testID="paper-screen"
        />
      )}

      {sheetOpen && sheetIndex !== null ? (
        <StudentSheet
          draft={draft}
          students={roster}
          index={sheetIndex}
          components={components}
          graded={data.isGradedOnly}
          editable={editable}
          canVerify={scope.canVerify}
          canReopen={reviewAvailable}
          onReopen={reopenStudent}
          onIndexChange={setSheetIndex}
          onClose={() => setSheetIndex(null)}
        />
      ) : null}

      <ChoiceSheet
        visible={sectionSheetOpen}
        title={copy.exams.paper.sectionSheetTitle}
        options={sectionOptions.map((row) => ({ id: row.id, label: row.name }))}
        currentId={effectiveSection ?? ""}
        onSelect={(id) => {
          setSectionSheetOpen(false);
          setPickedSection(id);
        }}
        onDismiss={() => setSectionSheetOpen(false)}
        testIDPrefix="paper-section-option"
      />

      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={MARKS_ACCESSORY_ID}>
          <View style={styles.accessory}>
            <Pressable accessibilityRole="button" accessibilityLabel={copy.exams.paper.sheet.previous} onPress={() => focusFrom(focusId, -1)} style={styles.accessoryButton}>
              <AppIcon name="chevronLeft" size={20} color={colors.accentDeep} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={copy.exams.paper.next} onPress={() => focusFrom(focusId, 1)} style={styles.accessoryButton}>
              <AppIcon name="chevronRight" size={20} color={colors.accentDeep} />
            </Pressable>
            <View style={styles.accessoryGrow} />
            <Pressable accessibilityRole="button" accessibilityLabel={copy.exams.paper.done} onPress={() => Keyboard.dismiss()} style={styles.accessoryButton}>
              <ThemedText variant="bodyStrong" color={colors.accentDeep}>{copy.exams.paper.done}</ThemedText>
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
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  sectionNeeded: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  sectionText: {
    flex: 1,
  },
  pressed: {
    backgroundColor: colors.field,
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
