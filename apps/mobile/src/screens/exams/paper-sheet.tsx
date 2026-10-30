import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { SegmentBar } from "../../components/segment-bar";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { samePaper } from "../../lib/exam-setup";
import type { PaperDraft, PartCopy } from "../../lib/exam-setup";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

export type SheetSection = { id: string; name: string };

type Mode = "all" | "per";

/**
 * One subject's paper(s) in a class, edited in one sheet. A class-wide paper
 * is one set of fields; "Different per section" shows a card per section —
 * date, time, minutes, venue, pass marks — plus a switch for the sections
 * that do not sit the subject at all. Switching shape never loses work: a
 * split copies the paper (parts included) into every section, a merge keeps
 * one section's settings for the class.
 */
export function PaperSheet({
  subjectName,
  examId,
  rows,
  classSections,
  focusSectionId,
  scheduleIdOf,
  partsCountOf,
  partsOf,
  onPatch,
  onSplit,
  onMerge,
  onSits,
  onClose,
}: {
  subjectName: string;
  examId: string;
  /** This subject's rows in the class: one class-wide row, or section rows. */
  rows: readonly PaperDraft[];
  classSections: readonly SheetSection[];
  /** The section the sheet opens on (the lens it was opened from). */
  focusSectionId: string | null;
  /** The server row's id — present once the papers batch has been saved. */
  scheduleIdOf: (row: PaperDraft) => string | null;
  partsCountOf: (row: PaperDraft) => number | null;
  partsOf: (row: PaperDraft) => readonly PartCopy[] | null;
  onPatch: (sectionId: string | null, patch: Partial<PaperDraft>) => void;
  onSplit: () => void;
  onMerge: (keepSectionId: string) => void;
  onSits: (sectionId: string, sits: boolean) => void;
  onClose: () => void;
}) {
  const mode: Mode = rows.some((row) => row.sectionId === null) ? "all" : "per";
  const canSplit = classSections.length >= 2;
  const [openId, setOpenId] = useState<string | null>(
    focusSectionId ?? rows[0]?.sectionId ?? null,
  );

  if (rows.length === 0) return null;

  const classWide = rows.find((row) => row.sectionId === null) ?? null;
  const firstSectionRow = rows.find((row) => row.sectionId !== null) ?? null;
  const firstSection = classSections.find(
    (section) => section.id === firstSectionRow?.sectionId,
  );

  const openParts = (scheduleId: string) => {
    onClose();
    router.push({
      pathname: "/exams/[examId]/setup/[scheduleId]",
      params: { examId, scheduleId },
    });
  };

  const classWideScheduleId = classWide ? scheduleIdOf(classWide) : null;

  return (
    <FormSheet
      title={subjectName}
      onClose={onClose}
      testIDPrefix="paper-sheet"
      footer={
        <>
          {mode === "all" ? (
            classWideScheduleId ? (
              <CapsuleButton
                title={copy.exams.setup.editParts}
                onPress={() => openParts(classWideScheduleId)}
                testID="paper-sheet-parts"
              />
            ) : (
              <ThemedText variant="meta" color={colors.muted}>
                {classWide?.partsFrom
                  ? copy.exams.setup.partsCopied
                  : copy.exams.setup.partsAfterSave}
              </ThemedText>
            )
          ) : null}
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
      {canSplit ? (
        <View style={styles.applies}>
          <ThemedText variant="caption">{copy.exams.setup.appliesTo}</ThemedText>
          <SegmentBar
            label={copy.exams.setup.appliesTo}
            value={mode}
            options={[
              {
                value: "all",
                label: copy.exams.setup.appliesAll,
                testID: "paper-sheet-applies-all",
              },
              {
                value: "per",
                label: copy.exams.setup.appliesPer,
                testID: "paper-sheet-applies-per",
              },
            ]}
            onChange={(next) => {
              if (next === mode) return;
              if (next === "per") {
                onSplit();
                setOpenId(focusSectionId ?? classSections[0]?.id ?? null);
              } else if (firstSectionRow?.sectionId) {
                onMerge(firstSectionRow.sectionId);
              }
            }}
          />
          <ThemedText variant="meta" color={colors.muted}>
            {mode === "all"
              ? copy.exams.setup.splitHelp
              : copy.exams.setup.mergeHelp(
                  copy.exams.hub.section(firstSection?.name ?? ""),
                )}
          </ThemedText>
        </View>
      ) : null}

      {mode === "all" && classWide ? (
        <PaperFields
          row={classWide}
          onChange={(patch) => onPatch(null, patch)}
          testPrefix="paper-sheet"
        />
      ) : (
        classSections.map((section) => {
          const row = rows.find((candidate) => candidate.sectionId === section.id) ?? null;
          const sectionLabel = copy.exams.hub.section(section.name);
          const open = row !== null && openId === section.id;
          const scheduleId = row ? scheduleIdOf(row) : null;
          const partsCount = row ? partsCountOf(row) : null;
          const same =
            row && firstSectionRow && row !== firstSectionRow
              ? samePaper(row, firstSectionRow, partsOf)
              : false;
          const summary = row
            ? same && firstSection
              ? copy.exams.setup.sameAs(copy.exams.hub.section(firstSection.name))
              : [row.examDate, row.startTime, `${row.durationMinutes} min`].join(" · ")
            : copy.exams.setup.notSat;
          return (
            <View
              key={section.id}
              style={styles.card}
              testID={`paper-sheet-section-${section.id}`}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${sectionLabel}, ${summary}`}
                disabled={row === null}
                onPress={() => setOpenId(open ? null : section.id)}
                style={styles.cardHead}
                testID={`paper-sheet-section-head-${section.id}`}
              >
                <View style={styles.cardTitle}>
                  <ThemedText variant="bodyStrong">{sectionLabel}</ThemedText>
                  <ThemedText variant="meta" color={colors.muted} numberOfLines={1}>
                    {summary}
                  </ThemedText>
                </View>
                {row ? (
                  <AppIcon
                    name={open ? "chevronDown" : "chevronRight"}
                    size={16}
                    color={colors.chevron}
                  />
                ) : null}
              </Pressable>

              {open && row ? (
                <PaperFields
                  row={row}
                  onChange={(patch) => onPatch(section.id, patch)}
                  testPrefix={`paper-sheet-${section.id}`}
                />
              ) : null}
              {open && row ? (
                scheduleId ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${copy.exams.setup.editParts}: ${copy.exams.setup.parts(partsCount ?? 0)}`}
                    onPress={() => openParts(scheduleId)}
                    style={styles.partsLink}
                    testID={`paper-sheet-parts-${section.id}`}
                  >
                    <ThemedText variant="meta" color={colors.accentDeep}>
                      {copy.exams.setup.parts(partsCount ?? 0)}
                    </ThemedText>
                    <AppIcon name="chevronRight" size={14} color={colors.accentDeep} />
                  </Pressable>
                ) : (
                  <ThemedText variant="meta" color={colors.muted}>
                    {row.partsFrom
                      ? copy.exams.setup.partsCopied
                      : copy.exams.setup.partsAfterSave}
                  </ThemedText>
                )
              ) : null}

              <SwitchRow
                label={copy.exams.setup.sitsLabel}
                value={row !== null}
                onChange={(sits) => onSits(section.id, sits)}
                disabled={row !== null && rows.length === 1}
                help={
                  row !== null && rows.length === 1
                    ? copy.exams.setup.sitsLast
                    : undefined
                }
                testID={`paper-sheet-sits-${section.id}`}
              />
            </View>
          );
        })
      )}
    </FormSheet>
  );
}

/** The five timing fields of one paper. */
function PaperFields({
  row,
  onChange,
  testPrefix,
}: {
  row: PaperDraft;
  onChange: (patch: Partial<PaperDraft>) => void;
  testPrefix: string;
}) {
  return (
    <>
      <FormField
        label={copy.exams.setup.dateLabel}
        value={row.examDate}
        onChangeText={(next) => onChange({ examDate: next })}
        placeholder="YYYY-MM-DD"
        testID={`${testPrefix}-date`}
      />
      <FormField
        label={copy.exams.setup.timeLabel}
        value={row.startTime}
        onChangeText={(next) => onChange({ startTime: next })}
        placeholder="09:30"
        testID={`${testPrefix}-time`}
      />
      <FormField
        label={copy.exams.setup.durationLabel}
        value={String(row.durationMinutes)}
        onChangeText={(next) => onChange({ durationMinutes: Number(next) || 0 })}
        keyboardType="number-pad"
        testID={`${testPrefix}-duration`}
      />
      <FormField
        label={copy.exams.setup.venueLabel}
        value={row.venue}
        onChangeText={(next) => onChange({ venue: next })}
        placeholder={copy.exams.setup.venuePlaceholder}
        testID={`${testPrefix}-venue`}
      />
      <FormField
        label={copy.exams.setup.passLabel}
        value={row.passMarks ?? ""}
        onChangeText={(next) => onChange({ passMarks: next.trim() === "" ? null : next.trim() })}
        help={copy.exams.setup.passHelp}
        keyboardType="numbers-and-punctuation"
        testID={`${testPrefix}-pass`}
      />
    </>
  );
}

const styles = StyleSheet.create({
  applies: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    gap: spacing.sm,
  },
  cardTitle: {
    flex: 1,
    gap: spacing.xxs,
  },
  partsLink: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xxs,
    minHeight: 44,
  },
});
