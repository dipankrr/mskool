import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { isEntryOpen } from "../../lib/exams";
import {
  DEFAULT_COMPONENT,
  collapsibleSubject,
  mergeToClassWide,
  newPaper,
  paperAddChoices,
  paperSubjects,
  paperKey,
  schedulePartitionViolations,
  sectionLens,
  splitClassWide,
  subjectOrder,
  subjectShape,
} from "../../lib/exam-setup";
import type { MappingRow, PaperDraft, PartCopy } from "../../lib/exam-setup";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ConfirmSheet } from "../homework/confirm-sheet";
import { ChipRow } from "./chip-row";
import { PaperSheet } from "./paper-sheet";
import { useClassMappings, useSetupActions, useSubjectTypes } from "./use-setup";
import {
  useClassSubjectNames,
  useExamDetail,
  useExamScope,
  useExamSections,
} from "./use-exam-data";
import { trpc } from "../../lib/trpc";

/** The row's identity — the same triple the server's schedule sync keys on. */
const rowKey = (subjectId: string, sectionId: string | null) =>
  paperKey(subjectId, sectionId);

const LENS_ALL = "all";
const ADD_CLASS_CHIP = "__add_class__";

/**
 * The blueprint screen (chunk 7D, D17): one class at a time (class chips),
 * "Add class" generating rows from the mapped counted subjects (D18) with
 * the web's prefilled defaults, per-paper edits in a sheet, removal behind a
 * confirm, and one Save that batches the class grids. From marks entry the
 * screen is read-only with the server's freeze line (D6) — no dialog fights
 * the freeze, the acts just disappear.
 *
 * Sections (ADR-052): a paper is class-wide until the office says otherwise.
 * A class with two or more sections shows a section lens — All sections, or
 * one section's own view where an inherited paper reads "Same as all" and a
 * change made there splits that subject for that section only. Papers that
 * end up identical in every section are saved back as one class paper.
 */
export function ExamSetupScreen() {
  const { examId = "" } = useLocalSearchParams<{ examId: string }>();
  const scope = useExamScope();
  const detail = useExamDetail(examId);
  const names = useClassSubjectNames();
  const types = useSubjectTypes();
  const actions = useSetupActions(examId);
  const utils = trpc.useUtils();

  const exam = detail.data?.exam ?? null;
  const frozen = exam !== null && (isEntryOpen(exam.status) || exam.status === "ongoing" || exam.status === "published" || exam.status === "locked");

  const [drafts, setDrafts] = useState<Record<string, PaperDraft[]>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [classSheetOpen, setClassSheetOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingPaper, setRemovingPaper] = useState<{
    classId: string;
    subjectId: string;
    name: string;
  } | null>(null);
  const [addingPaperFor, setAddingPaperFor] = useState<string | null>(null);
  const [addingSectionFor, setAddingSectionFor] = useState<{
    classId: string;
    subjectId: string;
  } | null>(null);
  const [editingRow, setEditingRow] = useState<{
    classId: string;
    subjectId: string;
    /** The section the sheet opens on — the lens it was opened from. */
    focusSectionId: string | null;
  } | null>(null);
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [lensByClass, setLensByClass] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sections = useExamSections();
  const typeById = useMemo(
    () => new Map((types.data ?? []).map((row) => [row.id, row])),
    [types.data],
  );

  const serverPapers = useMemo(() => detail.data?.schedules ?? [], [detail.data]);
  const classesIds = useMemo(() => {
    const ids = new Set(serverPapers.map((row) => row.classId));
    for (const classId of Object.keys(drafts)) ids.add(classId);
    for (const classId of removed) ids.delete(classId);
    return [...ids];
  }, [serverPapers, drafts, removed]);

  const activeId =
    activeClass && classesIds.includes(activeClass)
      ? activeClass
      : (classesIds[0] ?? null);
  // The active class's mappings decide whether "Add paper" has anything left
  // to offer (the same cached read the add-paper sheet uses).
  const activeMappings = useClassMappings(activeId, !frozen);

  // Dirty is a real diff against the server rows, not a "was touched" flag:
  // a teacher who adds a class and then removes it (or edits a field back to
  // its original value) has nothing pending and must be able to leave. A
  // draft row without a server twin is either new this session or the twin
  // vanished under us — either way, unsaved. A SERVER row missing from a
  // class's draft snapshot is a per-paper removal — unsaved too.
  const dirty = useMemo(() => {
    if (removed.length > 0) return true;
    return Object.entries(drafts).some(([classId, rows]) => {
      const serverRows = serverPapers.filter((row) => row.classId === classId);
      const draftKeys = new Set(rows.map((row) => rowKey(row.subjectId, row.sectionId)));
      const removedRow = serverRows.some(
        (row) => !draftKeys.has(rowKey(row.subjectId, row.sectionId)),
      );
      const changedRow = rows.some((row) => {
        const server = serverRows.find(
          (candidate) =>
            candidate.subjectId === row.subjectId &&
            (candidate.sectionId ?? null) === row.sectionId,
        );
        if (!server) return true;
        return (
          row.examDate !== server.examDate.slice(0, 10) ||
          row.startTime !== server.startTime.slice(0, 5) ||
          row.durationMinutes !== server.durationMinutes ||
          row.venue !== (server.venue ?? "") ||
          row.passMarks !==
            (server.passMarks && server.passMarks !== "0.00"
              ? server.passMarks
              : null)
        );
      });
      return removedRow || changedRow;
    });
  }, [drafts, removed, serverPapers]);
  useUnsavedChanges(dirty && !frozen, {
    title: copy.exams.setup.unsavedTitle,
    body: copy.exams.setup.unsavedBody,
    keepEditing: copy.exams.setup.keepEditing,
    discard: copy.exams.setup.leave,
  });

  // The drafts for one class: the server rows first (as editable drafts),
  // then the rows added this session. Once a class is in drafts, its list is
  // the FULL intended grid — a server row left out of it is a removal.
  const rowsOf = (classId: string): PaperDraft[] => {
    const added = drafts[classId];
    if (added) return added;
    return serverPapers
      .filter((row) => row.classId === classId)
      .map((row) => ({
        subjectId: row.subjectId,
        sectionId: row.sectionId ?? null,
        examDate: row.examDate.slice(0, 10),
        startTime: row.startTime.slice(0, 5),
        durationMinutes: row.durationMinutes,
        venue: row.venue ?? "",
        passMarks: row.passMarks && row.passMarks !== "0.00" ? row.passMarks : null,
        isNew: false,
        partsFrom: null,
      }));
  };

  /** Replaces a class's whole draft grid (the snapshot a save sends). */
  const setRows = (classId: string, rows: PaperDraft[]) => {
    setDrafts((current) => ({ ...current, [classId]: rows }));
  };

  const sectionsOf = (classId: string) =>
    (sections.data ?? []).filter((row) => row.classId === classId);

  /** The server's saved paper behind a draft row, if the row has one. */
  const scheduleOf = (classId: string, row: PaperDraft) =>
    serverPapers.find(
      (candidate) =>
        candidate.classId === classId &&
        candidate.subjectId === row.subjectId &&
        (candidate.sectionId ?? null) === row.sectionId,
    );

  /**
   * The parts a row stands for: the ones queued to be copied onto it when
   * it is new, else the ones the server holds. Null = the default part.
   */
  const partsOfRow = (classId: string, row: PaperDraft): readonly PartCopy[] | null => {
    if (row.isNew) return row.partsFrom;
    const saved = scheduleOf(classId, row);
    if (!saved || saved.components.length === 0) return null;
    return saved.components.map((part, index) => ({
      name: part.name,
      maxMarks: part.maxMarks,
      passMarks: part.passMarks,
      weightagePercentage: part.weightagePercentage,
      isMandatoryPass: part.isMandatoryPass,
      sequenceNumber: part.sequenceNumber ?? index,
    }));
  };

  const changedFromServer = (classId: string, row: PaperDraft): boolean => {
    if (row.isNew) return true;
    const server = scheduleOf(classId, row);
    if (!server) return true;
    return (
      row.examDate !== server.examDate.slice(0, 10) ||
      row.startTime !== server.startTime.slice(0, 5) ||
      row.durationMinutes !== server.durationMinutes ||
      row.venue !== (server.venue ?? "") ||
      row.passMarks !==
        (server.passMarks && server.passMarks !== "0.00" ? server.passMarks : null)
    );
  };

  const addClass = async (classId: string) => {
    setClassSheetOpen(false);
    setBanner(null);
    try {
      const mappings = await utils.assignment.subjectMapping.list.fetch({
        organizationId: scope.organizationId ?? "",
        ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
        academicYearId: scope.academicYear?.id ?? "",
        classId,
      });
      if (mappings.length === 0) {
        setBanner(copy.exams.setup.noMappingsBody);
        return;
      }
      generate(classId, mappings);
    } catch {
      setBanner(copy.exams.setup.loadError);
    }
  };

  const generate = (
    classId: string,
    mappings: readonly MappingRow[],
  ) => {
    const existing = new Set([
      ...serverPapers
        .filter((row) => row.classId === classId)
        .map((row) => row.subjectId),
      ...(drafts[classId] ?? []).map((row) => row.subjectId),
    ]);
    const generated = paperSubjects({
      mappings,
      typeById,
      existingSubjectIds: existing,
    });
    const startIndex = rowsOf(classId).length;
    const rows = generated.map((mapping, index) => {
      const paper = newPaper({
        classId,
        subjectId: mapping.subjectId,
        index: startIndex + index,
      });
      return {
        subjectId: paper.subjectId,
        sectionId: paper.sectionId,
        examDate: paper.examDate,
        startTime: paper.startTime,
        durationMinutes: paper.durationMinutes,
        venue: "",
        passMarks: null,
        isNew: true,
        partsFrom: null,
      } satisfies PaperDraft;
    });
    setDrafts((current) => ({ ...current, [classId]: [...rowsOf(classId), ...rows] }));
    setActiveClass(classId);
    if (generated.length === 0) setBanner(copy.exams.setup.allMapped);
  };

  const updateRow = (
    classId: string,
    subjectId: string,
    sectionId: string | null,
    patch: Partial<PaperDraft>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [classId]: rowsOf(classId).map((row) =>
        rowKey(row.subjectId, row.sectionId) === rowKey(subjectId, sectionId)
          ? { ...row, ...patch }
          : row,
      ),
    }));
  };

  /** Removes a SUBJECT's paper(s) from the class — every section's row. The
   * class's draft snapshot drops them, and the save's identity sync deletes
   * them (with their parts) on the server. */
  const removeSubject = (classId: string, subjectId: string) => {
    setDrafts((current) => {
      const rows = rowsOf(classId).filter((row) => row.subjectId !== subjectId);
      const next = { ...current };
      if (rows.length > 0) next[classId] = rows;
      else delete next[classId];
      return next;
    });
    setRemovingPaper(null);
  };

  /** Class-wide → one paper per section (parts copied across on save). */
  const splitSubject = (classId: string, subjectId: string) => {
    const rows = rowsOf(classId);
    const source = rows.find(
      (row) => row.subjectId === subjectId && row.sectionId === null,
    );
    if (!source) return;
    setRows(
      classId,
      splitClassWide(
        rows,
        subjectId,
        sectionsOf(classId).map((row) => row.id),
        partsOfRow(classId, source),
      ),
    );
  };

  /** Per-section → one class paper, keeping one section's settings. */
  const mergeSubject = (classId: string, subjectId: string, keepSectionId: string) => {
    setRows(
      classId,
      mergeToClassWide(rowsOf(classId), subjectId, keepSectionId, (row) =>
        partsOfRow(classId, row),
      ),
    );
  };

  /**
   * One section stops or starts sitting a subject. Stopping splits a
   * class-wide paper first (the other sections keep it), then drops that
   * section's row; starting copies the subject's first paper.
   */
  const setSits = (
    classId: string,
    subjectId: string,
    sectionId: string,
    sits: boolean,
  ) => {
    let rows = rowsOf(classId);
    if (!sits) {
      if (rows.some((row) => row.subjectId === subjectId && row.sectionId === null)) {
        const source = rows.find(
          (row) => row.subjectId === subjectId && row.sectionId === null,
        );
        rows = splitClassWide(
          rows,
          subjectId,
          sectionsOf(classId).map((row) => row.id),
          source ? partsOfRow(classId, source) : null,
        );
      }
      setRows(
        classId,
        rows.filter(
          (row) => !(row.subjectId === subjectId && row.sectionId === sectionId),
        ),
      );
      return;
    }
    const template = rows.find((row) => row.subjectId === subjectId);
    if (!template || rows.some((row) => row.subjectId === subjectId && row.sectionId === sectionId)) {
      return;
    }
    const at = rows.map((row) => row.subjectId).lastIndexOf(subjectId);
    setRows(classId, [
      ...rows.slice(0, at + 1),
      {
        ...template,
        sectionId,
        isNew: true,
        partsFrom: partsOfRow(classId, template),
      },
      ...rows.slice(at + 1),
    ]);
  };

  /** Adds ONE paper (the "Add paper" sheet's answer) with prefilled timing. */
  const addPaper = (
    classId: string,
    subjectId: string,
    sectionId: string | null,
  ) => {
    const paper = newPaper({
      classId,
      subjectId,
      index: rowsOf(classId).length,
    });
    const row: PaperDraft = {
      subjectId: paper.subjectId,
      sectionId,
      examDate: paper.examDate,
      startTime: paper.startTime,
      durationMinutes: paper.durationMinutes,
      venue: "",
      passMarks: null,
      isNew: true,
      partsFrom: null,
    };
    setDrafts((current) => ({
      ...current,
      [classId]: [...rowsOf(classId), row],
    }));
    setAddingPaperFor(null);
    setAddingSectionFor(null);
  };

  const removeClass = (classId: string) => {
    const hasServerRows = serverPapers.some((row) => row.classId === classId);
    setRemoved((current) =>
      hasServerRows && !current.includes(classId)
        ? [...current, classId]
        : current,
    );
    setDrafts((current) => {
      const next = { ...current };
      delete next[classId];
      return next;
    });
    setRemoving(null);
  };

  const save = () => {
    setBanner(null);
    setError(null);
    // Papers that end up identical in EVERY section are one class paper, not
    // a pile of copies: the save folds them back (only subjects touched this
    // session, so a legacy grid is never rewritten behind the office's back).
    const folded: string[] = [];
    const grids = classesIds.map((classId) => {
      let rows = rowsOf(classId);
      const sectionIds = sectionsOf(classId).map((row) => row.id);
      for (const subjectId of subjectOrder(rows)) {
        const own = rows.filter((row) => row.subjectId === subjectId);
        if (!own.some((row) => changedFromServer(classId, row))) continue;
        const keep = collapsibleSubject(rows, subjectId, sectionIds, (row) =>
          partsOfRow(classId, row),
        );
        if (!keep) continue;
        rows = mergeToClassWide(rows, subjectId, keep, (row) => partsOfRow(classId, row));
        folded.push(names.subjectName(subjectId) ?? copy.exams.hub.classChipsLabel);
      }
      return { classId, rows };
    });
    const seeds = new Map<string, readonly PartCopy[]>();
    for (const { classId, rows } of grids) {
      for (const row of rows) {
        if (row.partsFrom) {
          seeds.set(`${classId}|${rowKey(row.subjectId, row.sectionId)}`, row.partsFrom);
        }
      }
    }
    const schedules = grids.flatMap(({ classId, rows }) =>
      rows.map((row) => ({
        classId,
        subjectId: row.subjectId,
        // Null = one paper for the whole class; a uuid = that section only.
        sectionId: row.sectionId,
        examDate: row.examDate,
        startTime: row.startTime,
        durationMinutes: row.durationMinutes,
        ...(row.venue.trim() ? { venue: row.venue.trim() } : {}),
        ...(row.passMarks ? { passMarks: row.passMarks } : {}),
      })),
    );
    const invalid = schedules.some(
      (row) => !/^\d{4}-\d{2}-\d{2}$/.test(row.examDate) || row.startTime.length < 4,
    );
    if (invalid) {
      setError(copy.exams.components.errors.format);
      return;
    }
    // The partition rule (ADR-052), checked here so the refusal names the
    // subject before the server does — the add sheet filters by construction,
    // so reaching this means a stale overlap slipped past the offers.
    // Per CLASS: the same subject in two classes is two separate shapes.
    const violations = grids.flatMap(({ rows }) =>
      schedulePartitionViolations(
        rows.map((row) => ({ subjectId: row.subjectId, sectionId: row.sectionId })),
      ),
    );
    if (violations.length > 0) {
      const subjectNames = [
        ...new Set(
          violations.map((v) => names.subjectName(v.subjectId) ?? copy.exams.hub.classChipsLabel),
        ),
      ].join(", ");
      setError(copy.exams.setup.partitionRefuse(subjectNames));
      return;
    }
    void actions
      .saveSchedules({ schedules, removeClassIds: removed })
      .then(async () => {
        // D19 kept honest: a paper saved without parts carries the CBSE
        // default part immediately, so scheduling never trips the
        // empty-paper refusal for papers the office never opened. A paper
        // born from a split or a merge takes the parts of the paper it came
        // from instead (the server deleted the old row's parts with it).
        const { data } = await detail.refetch();
        const bare = (data?.schedules ?? []).filter(
          (row) => row.components.length === 0,
        );
        for (const row of bare) {
          const seed = seeds.get(
            `${row.classId}|${rowKey(row.subjectId, row.sectionId ?? null)}`,
          );
          await actions.saveComponents({
            scheduleId: row.id,
            components: seed
              ? seed.map((part, index) => ({ ...part, sequenceNumber: index }))
              : [{ ...DEFAULT_COMPONENT, sequenceNumber: 1 }],
          });
        }
        setDrafts({});
        setRemoved([]);
        setBanner(
          folded.length > 0
            ? copy.exams.setup.savedMerged(folded.join(", "))
            : copy.exams.setup.saved,
        );
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
  };

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <ScreenFrame
      title={copy.exams.setup.title}
      meta={exam?.name ?? undefined}
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-setup-back"
      titleTestID="exam-setup-title"
      onRefresh={() => void detail.refetch()}
      refreshing={detail.isRefetching}
      footer={footer}
    >
      {children}
    </ScreenFrame>
  );

  // The "Add paper" chain: which subjects may still take a paper in this
  // class (mapped + counted + a shape the partition allows), and for the
  // chosen subject, which section shapes remain. The add offers only valid
  // shapes, so the partition refusal on save means a stale overlap. The
  // mappings are fetched at press time — an all-mapped class answers with
  // the banner instead of an empty sheet.
  const [addPaperMappings, setAddPaperMappings] = useState<MappingRow[] | null>(null);

  /** The section a class's lens is on, or "all". A stale pick falls back to all. */
  const lensOf = (classId: string): string => {
    const picked = lensByClass[classId];
    return picked && sectionsOf(classId).some((row) => row.id === picked)
      ? picked
      : LENS_ALL;
  };

  const addPaperOptions = (
    classId: string | null,
    mappings: readonly MappingRow[],
  ): { id: string; label: string }[] => {
    if (!classId) return [];
    const classSectionCount = sectionsOf(classId).length;
    const lens = lensOf(classId);
    const options: { id: string; label: string }[] = [];
    for (const mapping of paperSubjects({
      mappings,
      typeById,
      existingSubjectIds: new Set(),
    })) {
      const rows = rowsOf(classId).filter((row) => row.subjectId === mapping.subjectId);
      const choices = paperAddChoices(rows);
      const untaken = classSectionCount - choices.takenSections.size;
      // On a section's lens a paper is added for THAT section: it must be one
      // the section does not already have.
      const addable =
        rows.length === 0 ||
        (choices.canAddSections &&
          (lens === LENS_ALL ? untaken > 0 : !choices.takenSections.has(lens)));
      if (addable) {
        options.push({
          id: mapping.subjectId,
          label: names.subjectName(mapping.subjectId) ?? mapping.subjectId,
        });
      }
    }
    return options;
  };

  const openAddPaper = async (classId: string) => {
    setBanner(null);
    try {
      const mappings = await utils.assignment.subjectMapping.list.fetch({
        organizationId: scope.organizationId ?? "",
        ...(scope.schoolId ? { schoolId: scope.schoolId } : {}),
        academicYearId: scope.academicYear?.id ?? "",
        classId,
      });
      if (addPaperOptions(classId, mappings).length === 0) {
        setBanner(copy.exams.setup.allMapped);
        return;
      }
      setAddPaperMappings(mappings);
      setAddingPaperFor(classId);
    } catch {
      setBanner(copy.exams.setup.loadError);
    }
  };

  const addSectionOptions = (
    state: { classId: string; subjectId: string } | null,
  ): { id: string; label: string }[] => {
    if (!state) return [];
    const choices = paperAddChoices(
      rowsOf(state.classId)
        .filter((row) => row.subjectId === state.subjectId)
        .map((row) => ({ subjectId: row.subjectId, sectionId: row.sectionId })),
    );
    const options: { id: string; label: string }[] = [];
    if (choices.canAddClassWide) {
      options.push({ id: "all", label: copy.exams.setup.sectionAll });
    }
    for (const section of (sections.data ?? []).filter(
      (row) => row.classId === state.classId,
    )) {
      if (!choices.takenSections.has(section.id)) {
        options.push({ id: section.id, label: copy.exams.hub.section(section.name) });
      }
    }
    return options;
  };

  const addPaperSectionTitle = addingSectionFor
    ? copy.exams.setup.addPaperSectionTitle(
        names.subjectName(addingSectionFor.subjectId) ?? copy.exams.hub.classChipsLabel,
      )
    : "";

  if (!scope.canUpdate) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="exam-setup-denied"
      />,
    );
  }

  if (!scope.ready || detail.isPending) {
    return frame(
      <View style={styles.body} testID="exam-setup-loading">
        <Skeleton height={64} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>,
    );
  }

  if (detail.isError) {
    return frame(
      <Notice
        tone="critical"
        title={copy.exams.setup.loadError}
        message={errorMessage(detail.error)}
        icon="info"
        testID="exam-setup-error"
      />,
    );
  }

  if (!exam) {
    return frame(
      <EmptyState
        icon="exams"
        title={copy.exams.gone}
        message={copy.exams.goneBody}
        testID="exam-setup-gone"
      />,
    );
  }

  const classOptions = (names.classes.data ?? [])
    .filter((row) => !classesIds.includes(row.id))
    .map((row) => ({
      value: row.id,
      label: row.name,
      testID: `setup-class-${row.id}`,
    }));

  const footer =
    !frozen && classesIds.length > 0 ? (
      <CapsuleButton
        title={actions.schedulesPending ? copy.exams.setup.saving : copy.exams.setup.save}
        onPress={save}
        loading={actions.schedulesPending}
        disabled={actions.schedulesPending}
        testID="exam-setup-save"
        style={styles.cta}
      />
    ) : undefined;

  /**
   * One subject's row in a class, as the current lens sees it. On "All
   * sections" it is the subject's scope (one class paper, or a line per
   * section). On a section's lens it is what THAT section sits: its own
   * paper, the class-wide paper it inherits (tap to change it for this
   * section only, which splits the subject), or "Not sat".
   */
  const renderSubject = (classId: string, subjectId: string, lens: string) => {
    const rows = rowsOf(classId);
    const own = rows.filter((row) => row.subjectId === subjectId);
    const classSections = sectionsOf(classId);
    const subject = names.subjectName(subjectId) ?? "—";
    const sectionLabel = (id: string | null): string => {
      const found = classSections.find((row) => row.id === id);
      return found ? copy.exams.hub.section(found.name) : "";
    };
    const timing = (row: PaperDraft) =>
      [row.examDate, row.startTime, `${row.durationMinutes} min`].join(" · ");

    let tag: { label: string; tone: TagTone } | null = null;
    let lines: string[] = [];
    let representative: PaperDraft | null = own[0] ?? null;
    let state: "classWide" | "split" | "own" | "inherited" | "notSat" = "classWide";

    if (lens === LENS_ALL) {
      const shape = subjectShape(
        own,
        classSections.map((row) => row.id),
      );
      if (shape.kind === "classWide") {
        tag = { label: copy.exams.setup.tagAll, tone: "neutral" };
        lines = representative ? [timing(representative)] : [];
      } else {
        state = "split";
        tag =
          shape.kind === "subset"
            ? {
                label: copy.exams.setup.tagOnly(
                  shape.sectionIds
                    .map((id) => classSections.find((row) => row.id === id)?.name ?? "")
                    .join(", "),
                ),
                tone: "neutral",
              }
            : { label: copy.exams.setup.tagDiffers, tone: "accent" };
        lines = own.map((row) => `${sectionLabel(row.sectionId)} · ${timing(row)}`);
      }
    } else {
      const lensed = sectionLens(rows, subjectId, lens);
      representative = lensed.row;
      state = lensed.state;
      if (lensed.state === "notSat") {
        tag = { label: copy.exams.setup.notSat, tone: "critical" };
      } else if (lensed.row) {
        lines = [timing(lensed.row)];
        tag =
          lensed.state === "own"
            ? {
                label: copy.exams.setup.tagOnly(
                  classSections.find((row) => row.id === lens)?.name ?? "",
                ),
                tone: "accent",
              }
            : { label: copy.exams.setup.tagSameAsAll, tone: "neutral" };
      }
    }

    const saved = representative ? scheduleOf(classId, representative) : undefined;
    const lensLabel = sectionLabel(lens);
    const key = rowKey(
      subjectId,
      state === "split" ? "sections" : (representative?.sectionId ?? null),
    );
    const partsChip = state === "classWide" || state === "own";
    const dim = state === "notSat";

    const open = () => {
      if (state === "notSat") {
        setSits(classId, subjectId, lens, true);
        return;
      }
      if (state === "inherited") splitSubject(classId, subjectId);
      setEditingRow({
        classId,
        subjectId,
        focusSectionId: lens === LENS_ALL ? null : lens,
      });
    };

    return (
      <View key={subjectId} style={styles.rowLine} testID={`exam-setup-paper-${key}`}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[subject, tag?.label, ...lines].filter(Boolean).join(", ")}
          disabled={frozen}
          onPress={open}
          style={({ pressed }) => [
            styles.nameBlock,
            pressed && !frozen ? styles.rowPressed : null,
          ]}
        >
          <View style={styles.titleLine}>
            <ThemedText
              variant="bodyStrong"
              numberOfLines={1}
              color={dim ? colors.muted : undefined}
              style={[styles.subjectName, dim ? styles.struck : null]}
            >
              {subject}
            </ThemedText>
            {tag ? <Tag label={tag.label} tone={tag.tone} /> : null}
          </View>
          {dim ? (
            <ThemedText variant="meta" color={colors.accentDeep}>
              {copy.exams.setup.addBack(lensLabel)}
            </ThemedText>
          ) : (
            lines.map((line) => (
              <ThemedText key={line} variant="meta" color={colors.muted} numberOfLines={1}>
                {line}
              </ThemedText>
            ))
          )}
        </Pressable>
        {partsChip && representative ? (
          saved ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.exams.setup.editParts}: ${copy.exams.setup.parts(saved.components.length)}`}
              onPress={() =>
                router.push({
                  pathname: "/exams/[examId]/setup/[scheduleId]",
                  params: { examId, scheduleId: saved.id },
                })
              }
              style={styles.partsChip}
              testID={`exam-setup-parts-${key}`}
            >
              <ThemedText variant="meta" color={colors.accentDeep}>
                {copy.exams.setup.parts(saved.components.length)}
              </ThemedText>
              <AppIcon name="chevronRight" size={14} color={colors.accentDeep} />
            </Pressable>
          ) : (
            <ThemedText
              variant="meta"
              color={colors.chevron}
              style={styles.partsChip}
              numberOfLines={1}
            >
              {copy.exams.setup.partsNew}
            </ThemedText>
          )
        ) : state === "split" || state === "inherited" ? (
          <AppIcon name="chevronRight" size={16} color={colors.chevron} />
        ) : null}
        {!frozen && state !== "notSat" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              lens === LENS_ALL
                ? copy.exams.setup.removePaperTitle(subject, null)
                : copy.exams.setup.notSatLabel(lensLabel)
            }
            onPress={() =>
              lens === LENS_ALL
                ? setRemovingPaper({ classId, subjectId, name: subject })
                : setSits(classId, subjectId, lens, false)
            }
            style={styles.paperRemove}
            testID={`exam-setup-paper-remove-${key}`}
          >
            <AppIcon name="close" size={16} color={colors.tone.critical.fg} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  /** Add paper only shows while the class has a subject left to take one. */
  const canAddPaper = (classId: string): boolean =>
    activeMappings.data !== undefined &&
    addPaperOptions(classId, activeMappings.data).length > 0;

  const renderClass = (classId: string) => {
    const rows = rowsOf(classId);
    const className = names.className(classId) ?? copy.exams.hub.classChipsLabel;
    const classSections = sectionsOf(classId);
    const lens = lensOf(classId);
    const lensSection = classSections.find((row) => row.id === lens);
    return (
      <Card key={classId} padless testID={`exam-setup-class-${classId}`}>
        {classSections.length >= 2 ? (
          <View style={styles.lens}>
            <ChoicePills<string>
              label={copy.exams.setup.lensLabel}
              value={lens}
              options={[
                { value: LENS_ALL, label: copy.exams.setup.lensAll },
                ...classSections.map((row) => ({ value: row.id, label: row.name })),
              ]}
              onChange={(next) =>
                setLensByClass((current) => ({ ...current, [classId]: next }))
              }
              help={
                lensSection
                  ? copy.exams.setup.lensHint(copy.exams.hub.section(lensSection.name))
                  : undefined
              }
              testIDPrefix={`exam-setup-lens-${classId}`}
            />
          </View>
        ) : null}
        {subjectOrder(rows).map((subjectId) => renderSubject(classId, subjectId, lens))}
        {!frozen && canAddPaper(classId) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.exams.setup.addPaper}
            onPress={() => void openAddPaper(classId)}
            style={styles.addRow}
            testID={`exam-setup-add-paper-${classId}`}
          >
            <AppIcon name="add" size={16} color={colors.accentDeep} />
            <ThemedText variant="meta" color={colors.accentDeep}>
              {copy.exams.setup.addPaper}
            </ThemedText>
          </Pressable>
        ) : null}
        {!frozen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.exams.setup.removeClassTitle(className)}
            onPress={() => setRemoving(classId)}
            style={styles.removeClassRow}
            testID={`exam-setup-remove-${classId}`}
          >
            <AppIcon name="close" size={16} color={colors.tone.critical.fg} />
            <ThemedText variant="meta" color={colors.tone.critical.fg}>
              {copy.exams.setup.removeClassAction(className)}
            </ThemedText>
          </Pressable>
        ) : null}
      </Card>
    );
  };

  return frame(
    <View style={styles.body}>
      {frozen ? (
        <Notice
          tone="caution"
          title={copy.exams.setup.frozen}
          icon="lock"
          testID="exam-setup-frozen"
        />
      ) : null}
      {banner ? (
        <Notice tone="positive" title={banner} icon="checkCircle" testID="exam-setup-banner" />
      ) : null}
      {error ? (
        <Notice
          tone="critical"
          title={copy.exams.setup.failed}
          message={error}
          icon="info"
          testID="exam-setup-error"
        />
      ) : null}

      {classesIds.length > 1 || (!frozen && classOptions.length > 0) ? (
        <ChipRow
          label={copy.exams.setup.classChipsLabel}
          value={activeId ?? ""}
          options={[
            ...classesIds.map((id) => ({
              value: id,
              label: names.className(id) ?? copy.exams.hub.classChipsLabel,
              testID: `exam-setup-chip-${id}`,
            })),
            ...(!frozen && classOptions.length > 0
              ? [
                  {
                    value: ADD_CLASS_CHIP,
                    label: `+ ${copy.exams.setup.addClass}`,
                    testID: "exam-setup-add-class",
                  },
                ]
              : []),
          ]}
          onChange={(next) => {
            if (next === ADD_CLASS_CHIP) {
              setBanner(null);
              setClassSheetOpen(true);
              return;
            }
            setActiveClass(next);
          }}
        />
      ) : null}

      {activeId === null ? (
        <EmptyState
          icon="exams"
          title={copy.exams.setup.noPapersTitle}
          message={copy.exams.setup.noPapersBody}
          testID="exam-setup-empty"
        />
      ) : (
        renderClass(activeId)
      )}

      {editingRow ? (
        <PaperSheet
          key={`${editingRow.classId}-${editingRow.subjectId}`}
          subjectName={
            names.subjectName(editingRow.subjectId) ?? copy.exams.hub.classChipsLabel
          }
          examId={examId}
          rows={rowsOf(editingRow.classId).filter(
            (row) => row.subjectId === editingRow.subjectId,
          )}
          classSections={sectionsOf(editingRow.classId).map((row) => ({
            id: row.id,
            name: row.name,
          }))}
          focusSectionId={editingRow.focusSectionId}
          scheduleIdOf={(row) => scheduleOf(editingRow.classId, row)?.id ?? null}
          partsCountOf={(row) =>
            scheduleOf(editingRow.classId, row)?.components.length ?? null
          }
          partsOf={(row) => partsOfRow(editingRow.classId, row)}
          onPatch={(sectionId, patch) =>
            updateRow(editingRow.classId, editingRow.subjectId, sectionId, patch)
          }
          onSplit={() => splitSubject(editingRow.classId, editingRow.subjectId)}
          onMerge={(keep) =>
            mergeSubject(editingRow.classId, editingRow.subjectId, keep)
          }
          onSits={(sectionId, sits) =>
            setSits(editingRow.classId, editingRow.subjectId, sectionId, sits)
          }
          onClose={() => setEditingRow(null)}
        />
      ) : null}

      <ChoiceSheet
        visible={classSheetOpen}
        title={copy.exams.setup.classSheetTitle}
        options={classOptions.map((option) => ({
          id: option.value,
          label: option.label,
        }))}
        currentId=""
        onSelect={(id) => void addClass(id)}
        onDismiss={() => setClassSheetOpen(false)}
        testIDPrefix="exam-setup-add"
      />

      <ChoiceSheet
        visible={addingPaperFor !== null && addPaperMappings !== null}
        title={copy.exams.setup.addPaperSubjectTitle}
        options={addPaperOptions(addingPaperFor, addPaperMappings ?? []).map((option) => ({
          id: option.id,
          label: option.label,
        }))}
        currentId=""
        onSelect={(subjectId) => {
          if (!addingPaperFor) return;
          // On a section's lens the paper is for that section — no second
          // question; on "All sections" the add asks which sections sit it.
          const lens = lensOf(addingPaperFor);
          if (lens !== LENS_ALL) {
            addPaper(addingPaperFor, subjectId, lens);
            return;
          }
          setAddingSectionFor({ classId: addingPaperFor, subjectId });
        }}
        onDismiss={() => setAddingPaperFor(null)}
        testIDPrefix="exam-setup-add-paper"
      />

      <ChoiceSheet
        visible={addingSectionFor !== null}
        title={addPaperSectionTitle}
        options={addSectionOptions(addingSectionFor).map((option) => ({
          id: option.id,
          label: option.label,
        }))}
        currentId=""
        onSelect={(sectionChoice) => {
          if (!addingSectionFor) return;
          addPaper(
            addingSectionFor.classId,
            addingSectionFor.subjectId,
            sectionChoice === "all" ? null : sectionChoice,
          );
        }}
        onDismiss={() => setAddingSectionFor(null)}
        testIDPrefix="exam-setup-add-paper-section"
      />

      {removing ? (
        <ConfirmSheet
          title={copy.exams.setup.removeClassTitle(
            names.className(removing) ?? copy.exams.hub.classChipsLabel,
          )}
          body={copy.exams.setup.removeClassBody}
          confirmLabel={copy.exams.setup.removeConfirm}
          keepLabel={copy.exams.setup.removeKeep}
          tone="destructive"
          submitting={false}
          error={null}
          onConfirm={() => removeClass(removing)}
          onClose={() => setRemoving(null)}
          testIDPrefix="exam-setup-remove"
        />
      ) : null}

      {removingPaper ? (
        <ConfirmSheet
          title={copy.exams.setup.removePaperTitle(removingPaper.name, null)}
          body={copy.exams.setup.removePaperBody}
          confirmLabel={copy.exams.setup.removeConfirm}
          keepLabel={copy.exams.setup.removeKeep}
          tone="destructive"
          submitting={false}
          error={null}
          onConfirm={() => removeSubject(removingPaper.classId, removingPaper.subjectId)}
          onClose={() => setRemovingPaper(null)}
          testIDPrefix="exam-setup-remove-paper"
        />
      ) : null}
    </View>,
    footer,
  );
}

type TagTone = "neutral" | "accent" | "critical";

/** A small status pill on a paper row: its scope ("All sections", "Only B"). */
function Tag({ label, tone }: { label: string; tone: TagTone }) {
  const palette =
    tone === "accent"
      ? { bg: colors.accentTint, fg: colors.accentDeep }
      : tone === "critical"
        ? { bg: colors.tone.critical.bg, fg: colors.tone.critical.fg }
        : { bg: colors.field, fg: colors.muted };
  return (
    <View style={[styles.tag, { backgroundColor: palette.bg }]}>
      <ThemedText variant="meta" color={palette.fg} numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}


const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  classHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  removeClassRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: 44,
    marginBottom: spacing.xs,
  },
  rowLine: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    paddingRight: spacing.sm,
  },
  lens: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: spacing.sm,
    rowGap: spacing.xxs,
  },
  subjectName: {
    flexShrink: 1,
  },
  struck: {
    textDecorationLine: "line-through",
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.sm,
    flexShrink: 1,
  },
  nameBlock: {
    flex: 1,
    gap: spacing.xxs,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    justifyContent: "center",
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  partsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    flexShrink: 1,
    minWidth: 64,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  paperRemove: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    marginLeft: spacing.xxs,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    margin: spacing.md,
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cta: {
    alignSelf: "stretch",
  },
});
