import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { isEntryOpen } from "../../lib/exams";
import { DEFAULT_COMPONENT, newPaper, paperSubjects } from "../../lib/exam-setup";
import type { MappingRow } from "../../lib/exam-setup";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ConfirmSheet } from "../homework/confirm-sheet";
import { useSetupActions, useSubjectTypes } from "./use-setup";
import {
  useClassSubjectNames,
  useExamDetail,
  useExamScope,
} from "./use-exam-data";
import { trpc } from "../../lib/trpc";

type PaperDraft = {
  subjectId: string;
  examDate: string;
  startTime: string;
  durationMinutes: number;
  venue: string;
  passMarks: string | null;
  /** A row the server has not seen yet. */
  isNew: boolean;
};

/**
 * The blueprint screen (chunk 7D, D17): one scroll of every class's papers,
 * "Add class" generating rows from the mapped counted subjects (D18) with
 * the web's prefilled defaults, per-paper edits in a sheet, removal behind a
 * confirm, and one Save that batches the class grids. From marks entry the
 * screen is read-only with the server's freeze line (D6) — no dialog fights
 * the freeze, the acts just disappear.
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
  const [touched, setTouched] = useState(false);
  const [classSheetOpen, setClassSheetOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<{
    classId: string;
    subjectId: string;
  } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const dirty =
    touched ||
    removed.length > 0 ||
    Object.values(drafts).some((rows) =>
      rows.some((row) => row.isNew || row.passMarks !== null),
    );
  useUnsavedChanges(dirty && !frozen, {
    title: copy.exams.setup.unsavedTitle,
    body: copy.exams.setup.unsavedBody,
    keepEditing: copy.exams.setup.keepEditing,
    discard: copy.exams.setup.leave,
  });

  // The drafts for one class: the server rows first (as editable drafts),
  // then the rows added this session.
  const rowsOf = (classId: string): PaperDraft[] => {
    const added = drafts[classId];
    if (added) return added;
    return serverPapers
      .filter((row) => row.classId === classId)
      .map((row) => ({
        subjectId: row.subjectId,
        examDate: row.examDate.slice(0, 10),
        startTime: row.startTime.slice(0, 5),
        durationMinutes: row.durationMinutes,
        venue: row.venue ?? "",
        passMarks: row.passMarks && row.passMarks !== "0.00" ? row.passMarks : null,
        isNew: false,
      }));
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
        examDate: paper.examDate,
        startTime: paper.startTime,
        durationMinutes: paper.durationMinutes,
        venue: "",
        passMarks: null,
        isNew: true,
      } satisfies PaperDraft;
    });
    setDrafts((current) => ({ ...current, [classId]: [...rowsOf(classId), ...rows] }));
    setTouched(true);
    if (generated.length === 0) setBanner(copy.exams.setup.allMapped);
  };

  const updateRow = (
    classId: string,
    subjectId: string,
    patch: Partial<PaperDraft>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [classId]: rowsOf(classId).map((row) =>
        row.subjectId === subjectId ? { ...row, ...patch } : row,
      ),
    }));
    setTouched(true);
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
    setTouched(true);
    setRemoving(null);
  };

  const save = () => {
    setBanner(null);
    setError(null);
    const schedules = classesIds.flatMap((classId) =>
      rowsOf(classId).map((row) => ({
        classId,
        subjectId: row.subjectId,
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
    void actions
      .saveSchedules({ schedules, removeClassIds: removed })
      .then(async () => {
        // D19 kept honest: a paper saved without parts carries the CBSE
        // default part immediately, so scheduling never trips the
        // empty-paper refusal for papers the office never opened.
        const { data } = await detail.refetch();
        const bare = (data?.schedules ?? []).filter(
          (row) => row.components.length === 0,
        );
        for (const row of bare) {
          await actions.saveComponents({
            scheduleId: row.id,
            components: [{ ...DEFAULT_COMPONENT, sequenceNumber: 1 }],
          });
        }
        setDrafts({});
        setRemoved([]);
        setTouched(false);
        setBanner(copy.exams.setup.saved);
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

      {classesIds.length === 0 ? (
        <EmptyState
          icon="exams"
          title={copy.exams.setup.noPapersTitle}
          message={copy.exams.setup.noPapersBody}
          testID="exam-setup-empty"
        />
      ) : (
        classesIds.map((classId) => {
          const rows = rowsOf(classId);
          const className = names.className(classId) ?? copy.exams.hub.classChipsLabel;
          return (
            <Card key={classId} padless testID={`exam-setup-class-${classId}`}>
              <View style={styles.classHead}>
                <ThemedText variant="bodyStrong">{className}</ThemedText>
                {!frozen ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copy.exams.setup.removeClass}
                    onPress={() => setRemoving(classId)}
                    style={styles.classRemove}
                    testID={`exam-setup-remove-${classId}`}
                  >
                    <AppIcon name="close" size={18} color={colors.tone.critical.fg} />
                  </Pressable>
                ) : null}
              </View>
              {rows.map((row) => {
                const schedule = serverPapers.find(
                  (candidate) =>
                    candidate.classId === classId &&
                    candidate.subjectId === row.subjectId,
                );
                return (
                  <Pressable
                    key={row.subjectId}
                    accessibilityRole="button"
                    accessibilityLabel={`${names.subjectName(row.subjectId) ?? ""}, ${row.examDate}, ${row.startTime}`}
                    accessibilityHint={copy.exams.setup.editParts}
                    disabled={frozen}
                    onPress={() =>
                      setEditingRow({ classId, subjectId: row.subjectId })
                    }
                    style={({ pressed }) => [
                      styles.row,
                      pressed && !frozen ? styles.rowPressed : null,
                    ]}
                    testID={`exam-setup-paper-${row.subjectId}`}
                  >
                    <View style={styles.nameBlock}>
                      <ThemedText variant="bodyStrong" numberOfLines={1}>
                        {names.subjectName(row.subjectId) ?? "—"}
                      </ThemedText>
                      <ThemedText variant="meta" color={colors.muted} numberOfLines={1}>
                        {[
                          row.examDate,
                          row.startTime,
                          `${row.durationMinutes} min`,
                          schedule
                            ? copy.exams.setup.parts(schedule.components.length)
                            : row.isNew
                              ? copy.exams.components.title("")
                              : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </ThemedText>
                    </View>
                    {schedule ? (
                      <AppIcon name="chevronRight" size={20} color={colors.chevron} />
                    ) : (
                      <ThemedText variant="meta" color={colors.accentDeep}>
                        {copy.exams.setup.editParts}
                      </ThemedText>
                    )}
                  </Pressable>
                );
              })}
            </Card>
          );
        })
      )}

      {!frozen ? (
        <CapsuleButton
          title={copy.exams.setup.addClass}
          variant="secondary"
          onPress={() => {
            setBanner(null);
            setClassSheetOpen(true);
          }}
          disabled={classOptions.length === 0}
          testID="exam-setup-add-class"
        />
      ) : null}
      {!frozen && classOptions.length === 0 && classesIds.length > 0 ? (
        <ThemedText variant="meta" color={colors.muted}>
          {copy.exams.setup.allMapped}
        </ThemedText>
      ) : null}

      {editingRow ? (
        <PaperSheet
          key={`${editingRow.classId}-${editingRow.subjectId}`}
          row={rowsOf(editingRow.classId).find(
            (candidate) => candidate.subjectId === editingRow.subjectId,
          )}
          subjectName={
            names.subjectName(editingRow.subjectId) ?? copy.exams.hub.classChipsLabel
          }
          examId={examId}
          scheduleId={
            serverPapers.find(
              (candidate) =>
                candidate.classId === editingRow.classId &&
                candidate.subjectId === editingRow.subjectId,
            )?.id ?? null
          }
          onChange={(patch) =>
            updateRow(editingRow.classId, editingRow.subjectId, patch)
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
    </View>,
    footer,
  );
}

/** One paper's editable fields in a sheet (D2's per-row edit). */
function PaperSheet({
  row,
  subjectName,
  examId,
  scheduleId,
  onChange,
  onClose,
}: {
  row: PaperDraft | undefined;
  subjectName: string;
  examId: string;
  /** The server row's id — present once the papers batch has been saved. */
  scheduleId: string | null;
  onChange: (patch: Partial<PaperDraft>) => void;
  onClose: () => void;
}) {
  if (!row) return null;
  return (
    <FormSheet
      title={subjectName}
      onClose={onClose}
      testIDPrefix="paper-sheet"
      footer={
        <>
          {scheduleId ? (
            <CapsuleButton
              title={copy.exams.setup.editParts}
              onPress={() => {
                onClose();
                router.push({
                  pathname: "/exams/[examId]/setup/[scheduleId]",
                  params: { examId, scheduleId },
                });
              }}
              testID="paper-sheet-parts"
            />
          ) : (
            <ThemedText variant="meta" color={colors.muted}>
              {copy.exams.setup.partsAfterSave}
            </ThemedText>
          )}
          <CapsuleButton
            title={copy.exams.paper.sheet.doneAction}
            variant="secondary"
            size="compact"
            onPress={onClose}
            testID="paper-sheet-done"
          />
        </>
      }
    >
      <FormField
        label={copy.exams.setup.dateLabel}
        value={row.examDate}
        onChangeText={(next) => onChange({ examDate: next })}
        placeholder="YYYY-MM-DD"
        testID="paper-sheet-date"
      />
      <FormField
        label={copy.exams.setup.timeLabel}
        value={row.startTime}
        onChangeText={(next) => onChange({ startTime: next })}
        placeholder="09:30"
        testID="paper-sheet-time"
      />
      <FormField
        label={copy.exams.setup.durationLabel}
        value={String(row.durationMinutes)}
        onChangeText={(next) => onChange({ durationMinutes: Number(next) || 0 })}
        keyboardType="number-pad"
        testID="paper-sheet-duration"
      />
      <FormField
        label={copy.exams.setup.venueLabel}
        value={row.venue}
        onChangeText={(next) => onChange({ venue: next })}
        placeholder={copy.exams.setup.venuePlaceholder}
        testID="paper-sheet-venue"
      />
      <FormField
        label={copy.exams.setup.passLabel}
        value={row.passMarks ?? ""}
        onChangeText={(next) => onChange({ passMarks: next.trim() === "" ? null : next.trim() })}
        help={copy.exams.setup.passHelp}
        keyboardType="numbers-and-punctuation"
        testID="paper-sheet-pass"
      />
    </FormSheet>
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
  classRemove: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  nameBlock: {
    flex: 1,
    gap: spacing.xxs,
  },
  cta: {
    alignSelf: "stretch",
  },
});
