import { useCallback, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { FormSheet } from "../../components/form-sheet";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { cellKey, isLockedStatus } from "../../lib/exam-draft";
import type { Cell, ExemptionType, PaperDraft } from "../../lib/exam-draft";
import { displayMarks, fullName } from "../../lib/exams";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import type { EntryComponent } from "./entry-row";
import type { RosterStudent } from "./types";

const TYPES: readonly ExemptionType[] = [
  "medical",
  "disability",
  "board_approved",
  "other",
];

/**
 * One student, all components (Step 7A). Reached by tapping a name in the
 * entry list. It is a second VIEW of the same draft store, not a second copy:
 * a value typed here is the value the row shows, and it saves through the same
 * queue. The arrows move between students without closing, so a teacher can
 * fix three kids' practical marks in one visit.
 *
 * Exemption lives here because it is rare and needs a required reason (the
 * type); absent is mirrored from the row's chip for the whole paper.
 */
export function StudentSheet({
  draft,
  students,
  index,
  components,
  graded,
  editable,
  canVerify,
  canReopen,
  onReopen,
  onIndexChange,
  onClose,
}: {
  draft: PaperDraft;
  students: readonly RosterStudent[];
  index: number;
  components: readonly EntryComponent[];
  graded: boolean;
  editable: boolean;
  /** The caller holds `marks:verify` (a hint; the server decides). */
  canVerify: boolean;
  /** Review is available here (entry stage), so a verified row can be reopened. */
  canReopen: boolean;
  /** Reopens this student's verified marks; rejects with the server's refusal. */
  onReopen: (studentId: string) => Promise<void>;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const student = students[index];
  if (!student) return null;

  const commitAll = () => {
    for (const component of components) {
      draft.commit(student.studentId, component.id);
    }
  };
  const go = (next: number) => {
    commitAll();
    onIndexChange(next);
  };
  const close = () => {
    commitAll();
    onClose();
  };

  return (
    <FormSheet
      title={fullName(student)}
      onClose={close}
      testIDPrefix="student-sheet"
      footer={
        <View style={styles.footer}>
          <View style={styles.arrows}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.exams.paper.sheet.previous}
              disabled={index === 0}
              onPress={() => go(index - 1)}
              style={[styles.arrow, index === 0 ? styles.arrowOff : null]}
              testID="student-sheet-prev"
            >
              <AppIcon name="chevronLeft" size={22} color={colors.ink} />
            </Pressable>
            <ThemedText variant="meta" style={styles.position}>
              {copy.exams.paper.sheet.position(index + 1, students.length)}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.exams.paper.sheet.next}
              disabled={index >= students.length - 1}
              onPress={() => go(index + 1)}
              style={[
                styles.arrow,
                index >= students.length - 1 ? styles.arrowOff : null,
              ]}
              testID="student-sheet-next"
            >
              <AppIcon name="chevronRight" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <CapsuleButton
            title={copy.exams.paper.sheet.doneAction}
            onPress={close}
            size="compact"
            testID="student-sheet-done"
            style={styles.done}
          />
        </View>
      }
    >
      <StudentBody
        key={student.studentId}
        draft={draft}
        student={student}
        components={components}
        graded={graded}
        editable={editable}
        reviewer={canVerify && canReopen}
        onReopen={onReopen}
      />
    </FormSheet>
  );
}

function StudentBody({
  draft,
  student,
  components,
  graded,
  editable,
  reviewer,
  onReopen,
}: {
  draft: PaperDraft;
  student: RosterStudent;
  components: readonly EntryComponent[];
  graded: boolean;
  editable: boolean;
  reviewer: boolean;
  onReopen: (studentId: string) => Promise<void>;
}) {
  const { studentId } = student;
  const subscribe = useCallback(
    (listener: () => void) => draft.subscribeStudent(studentId, listener),
    [draft, studentId],
  );
  const rev = useSyncExternalStore(subscribe, () =>
    draft.studentSignature(studentId),
  );
  const cells = readCells(draft, studentId, components, rev);

  const allAbsent = cells.length > 0 && cells.every((cell) => cell.absent);
  const allExempt = cells.length > 0 && cells.every((cell) => cell.exempt);
  const anyLocked = cells.some((cell) => isLockedStatus(cell.base.status));
  const canEdit = editable && !anyLocked;
  const verified = cells.some((cell) => cell.base.status === "verified");
  const sealed = cells.some(
    (cell) => cell.base.status === "published" || cell.base.status === "locked",
  );
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<unknown>(null);

  const reopen = async () => {
    setReopening(true);
    setReopenError(null);
    try {
      await onReopen(studentId);
      setConfirming(false);
    } catch (cause) {
      setReopenError(cause);
    } finally {
      setReopening(false);
    }
  };

  // Showing the type picker is local UI state: a saved exemption's type is not
  // in the grid, so the pills start unselected; turning the switch ON only
  // reveals them, and nothing is sent until a type is chosen.
  const [exemptOpen, setExemptOpen] = useState(allExempt);
  const [exemptType, setExemptType] = useState<ExemptionType | null>(null);

  return (
    <View style={styles.body}>
      <ThemedText variant="meta">
        {copy.exams.paper.sheet.rollAdmission(
          student.rollNumber,
          student.admissionNumber,
        )}
      </ThemedText>

      {anyLocked ? (
        <ThemedText variant="meta" color={colors.tone.caution.fg} testID="student-sheet-locked">
          {sealed
            ? copy.exams.paper.sheet.lockedSealed
            : reviewer
              ? copy.exams.paper.sheet.lockedReviewer
              : copy.exams.paper.sheet.lockedTeacher}
        </ThemedText>
      ) : null}

      {verified && !sealed && reviewer ? (
        confirming ? (
          <View style={styles.reopenPanel} testID="student-sheet-reopen-panel">
            <ThemedText variant="name">{copy.exams.paper.sheet.reopenTitle}</ThemedText>
            <ThemedText variant="meta">{copy.exams.paper.sheet.reopenBody}</ThemedText>
            {reopenError ? (
              <View style={styles.reopenError} accessibilityLiveRegion="polite">
                <ThemedText variant="meta" color={colors.tone.critical.fg}>
                  {copy.exams.paper.sheet.reopenFailed}
                </ThemedText>
                <ThemedText variant="meta" color={colors.tone.critical.fg}>
                  {errorMessage(reopenError)}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.reopenActions}>
              <CapsuleButton
                title={copy.exams.paper.sheet.reopenConfirm}
                size="compact"
                onPress={() => void reopen()}
                loading={reopening}
                disabled={reopening}
                testID="student-sheet-reopen-confirm"
              />
              <CapsuleButton
                title={copy.exams.paper.sheet.reopenKeep}
                size="compact"
                variant="secondary"
                onPress={() => setConfirming(false)}
                disabled={reopening}
                testID="student-sheet-reopen-cancel"
              />
            </View>
          </View>
        ) : (
          <CapsuleButton
            title={copy.exams.paper.sheet.reopenAction}
            size="compact"
            variant="secondary"
            onPress={() => {
              setReopenError(null);
              setConfirming(true);
            }}
            testID="student-sheet-reopen"
            style={styles.reopenButton}
          />
        )
      ) : null}

      <View style={styles.fields}>
        {components.map((component) => {
          const cell = cells.find((row) => row.componentId === component.id);
          if (!cell) return null;
          return (
            <View key={component.id} style={styles.fieldRow}>
              <ThemedText variant="bodyStrong" style={styles.fieldLabel}>
                {graded
                  ? copy.exams.paper.gradePlaceholder
                  : `${component.name} / ${displayMarks(component.max)}`}
              </ThemedText>
              <TextInput
                testID={`student-sheet-input-${component.id}`}
                value={cell.exempt || cell.absent ? "" : cell.text}
                editable={canEdit && !cell.exempt}
                onChangeText={(text) =>
                  draft.setText(studentId, component.id, text)
                }
                onBlur={() => draft.commit(studentId, component.id)}
                keyboardType={graded ? "default" : "decimal-pad"}
                autoCapitalize={graded ? "characters" : "none"}
                autoCorrect={false}
                selectTextOnFocus
                maxFontSizeMultiplier={1.3}
                placeholder={
                  cell.absent
                    ? copy.exams.paper.absentChip
                    : cell.exempt
                      ? copy.exams.paper.exemptChip
                      : "–"
                }
                placeholderTextColor={colors.chevron}
                accessibilityLabel={`${component.name}, ${cell.text || "empty"}`}
                style={styles.input}
              />
              {cell.problem ? (
                <ThemedText
                  variant="meta"
                  color={colors.tone.critical.fg}
                  style={styles.problem}
                >
                  {cell.problem.kind === "range"
                    ? copy.exams.paper.outOfMax(displayMarks(component.max))
                    : cell.problem.kind === "format"
                      ? copy.exams.paper.enterNumber
                      : cell.problem.kind === "negative"
                        ? copy.exams.paper.noNegative
                        : cell.problem.message}
                </ThemedText>
              ) : null}
            </View>
          );
        })}
      </View>

      {canEdit ? (
        <>
          <SwitchRow
            label={copy.exams.paper.sheet.absent}
            value={allAbsent}
            onChange={(next) => {
              for (const component of components) {
                draft.setAbsent(studentId, component.id, next);
              }
              if (next) setExemptOpen(false);
            }}
            disabled={allExempt}
            testID="student-sheet-absent"
          />
          <SwitchRow
            label={copy.exams.paper.sheet.exempt}
            value={exemptOpen || allExempt}
            onChange={(next) => {
              setExemptOpen(next);
              if (!next) {
                setExemptType(null);
                for (const component of components) {
                  const cell = draft.get(cellKey(studentId, component.id));
                  if (cell?.exempt) {
                    draft.setExempt(studentId, component.id, false, null);
                  }
                }
              }
            }}
            disabled={allAbsent}
            testID="student-sheet-exempt"
          />
          {exemptOpen || allExempt ? (
            <>
              <ChoicePills<ExemptionType>
                label={copy.exams.paper.sheet.exemptType}
                value={exemptType}
                options={TYPES.map((type) => ({
                  value: type,
                  label: copy.exams.paper.sheet.types[type],
                }))}
                onChange={(type) => {
                  setExemptType(type);
                  for (const component of components) {
                    draft.setExempt(studentId, component.id, true, type);
                  }
                }}
                help={allExempt ? copy.exams.paper.sheet.exemptTypeNote : undefined}
                testIDPrefix="student-sheet-type"
              />
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * The student's cells in component order. `rev` is the by-value signature the
 * caller subscribed to; it is unused here on purpose — it makes the dependency
 * explicit so a new signature recomputes the list.
 */
function readCells(
  draft: PaperDraft,
  studentId: string,
  components: readonly EntryComponent[],
  rev: string,
): Cell[] {
  void rev;
  const cells: Cell[] = [];
  for (const component of components) {
    const cell = draft.get(cellKey(studentId, component.id));
    if (cell) cells.push(cell);
  }
  return cells;
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  fields: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  fieldRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.md,
  },
  fieldLabel: {
    flex: 1,
    minWidth: 120,
  },
  input: {
    width: 96,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    textAlign: "right",
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.callout,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
  },
  problem: {
    width: "100%",
    textAlign: "right",
  },
  reopenButton: {
    alignSelf: "flex-start",
  },
  reopenPanel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  reopenActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  reopenError: {
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.tone.critical.bg,
    gap: spacing.xs,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  arrows: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  arrow: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  arrowOff: {
    opacity: 0.35,
  },
  position: {
    minWidth: 56,
    textAlign: "center",
  },
  done: {
    minWidth: 120,
  },
});
