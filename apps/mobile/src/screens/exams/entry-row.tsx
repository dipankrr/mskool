import { memo, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import {
  cellKey,
  hasSavedValue,
  isBelowPass,
  isLockedStatus,
} from "../../lib/exam-draft";
import type { Cell, PaperDraft } from "../../lib/exam-draft";
import { displayMarks, fullName } from "../../lib/exams";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import type { RosterStudent } from "./types";

/** The iOS accessory bar's id (decimal pads have no return key on iOS). */
export const MARKS_ACCESSORY_ID = "marks-accessory";

export type EntryComponent = {
  id: string;
  name: string;
  /** Printed as "out of {max}" and the placeholder. */
  max: string;
  pass: number;
};

type BarFlag = "below" | "allowed" | null;

type Props = {
  draft: PaperDraft;
  student: RosterStudent;
  component: EntryComponent;
  /** Every component's id, for the "other components" line on multi papers. */
  otherComponents: readonly EntryComponent[];
  graded: boolean;
  /** The paper accepts typing (stage open, caller allowed, section chosen). */
  editable: boolean;
  focused: boolean;
  barFlag: BarFlag;
  onFocusRow: (studentId: string) => void;
  onBlurRow: (studentId: string) => void;
  onNext: (studentId: string) => void;
  onOpenSheet: (studentId: string) => void;
  onFailedPress: (studentId: string, componentId: string) => void;
};

/**
 * One student in the entry list — the screen's hot path.
 *
 * The row subscribes to its own cell (an immutable object the draft store
 * replaces on change), so a keystroke re-renders this row and nothing else.
 * Typed work lives in the store, not in this component: FlatList drops row
 * state when a row leaves the window.
 *
 * Anatomy, left to right: roll · name (+ one status line) · AB chip · field ·
 * state glyph. The glyph only ever says what the server confirmed: a tick
 * appears after a save lands, never while it is in flight.
 */
export const EntryRow = memo(function EntryRow({
  draft,
  student,
  component,
  otherComponents,
  graded,
  editable,
  focused,
  barFlag,
  onFocusRow,
  onBlurRow,
  onNext,
  onOpenSheet,
  onFailedPress,
}: Props) {
  const { studentId } = student;
  const key = cellKey(studentId, component.id);
  const inputRef = useRef<TextInput>(null);

  const subscribeCell = useCallback(
    (listener: () => void) => draft.subscribeCell(key, listener),
    [draft, key],
  );
  const cell = useSyncExternalStore(subscribeCell, () => draft.get(key));

  // The "other components" line needs the student's other cells.
  const subscribeStudent = useCallback(
    (listener: () => void) => draft.subscribeStudent(studentId, listener),
    [draft, studentId],
  );
  const studentRev = useSyncExternalStore(subscribeStudent, () =>
    draft.studentSignature(studentId),
  );

  const locked = cell ? isLockedStatus(cell.base.status) : false;
  const canEdit = editable && !locked;

  useEffect(() => {
    if (focused && canEdit) inputRef.current?.focus();
  }, [focused, canEdit]);

  if (!cell) return null;

  const name = fullName(student);
  const multi = otherComponents.length > 0;
  const below = !graded && isBelowPass(cell, component.pass);
  const problemLine = problemText(cell, component.max);
  const otherLine = multi
    ? summarizeOthers(draft, studentId, otherComponents, graded, studentRev)
    : null;

  const glyph = glyphFor(cell, locked);

  return (
    <View
      style={[
        styles.row,
        cell.absent ? styles.rowAbsent : null,
        cell.problem && cell.phase !== "failed" ? styles.rowInvalid : null,
        cell.phase === "failed" ? styles.rowFailed : null,
      ]}
      testID={`entry-row-${studentId}`}
    >
      <ThemedText variant="meta" style={styles.roll} numberOfLines={1}>
        {copy.exams.paper.roll(student.rollNumber)}
      </ThemedText>

      <Pressable
        style={styles.nameBlock}
        accessibilityRole="button"
        accessibilityLabel={`${name}. ${copy.exams.paper.exemptHint}`}
        onPress={() => onOpenSheet(studentId)}
        testID={`entry-name-${studentId}`}
      >
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {name}
        </ThemedText>
        {problemLine ? (
          <ThemedText
            variant="meta"
            numberOfLines={2}
            color={
              cell.phase === "failed"
                ? colors.tone.caution.fg
                : colors.tone.critical.fg
            }
            accessibilityLiveRegion="polite"
          >
            {problemLine}
          </ThemedText>
        ) : locked ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {copy.exams.paper.verified}
          </ThemedText>
        ) : barFlag ? (
          <ThemedText
            variant="meta"
            numberOfLines={2}
            color={
              barFlag === "below" ? colors.tone.caution.fg : colors.muted
            }
          >
            {barFlag === "below"
              ? copy.exams.paper.belowBar
              : copy.exams.paper.belowBarAllowed}
          </ThemedText>
        ) : otherLine ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {otherLine}
          </ThemedText>
        ) : null}
      </Pressable>

      {canEdit && !cell.exempt ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: cell.absent }}
          accessibilityLabel={
            cell.absent ? copy.exams.paper.absentOn : copy.exams.paper.absentOff
          }
          hitSlop={4}
          onPress={() => draft.setAbsent(studentId, component.id, !cell.absent)}
          style={({ pressed }) => [
            styles.chip,
            cell.absent ? styles.chipOn : null,
            pressed ? styles.chipPressed : null,
          ]}
          testID={`entry-absent-${studentId}`}
        >
          <ThemedText
            variant="caption"
            color={cell.absent ? colors.tone.caution.fg : colors.muted}
            maxFontSizeMultiplier={1.2}
          >
            {copy.exams.paper.absentChip}
          </ThemedText>
        </Pressable>
      ) : (
        <View style={styles.chipSpacer} />
      )}

      {cell.exempt ? (
        <Pressable
          onPress={() => onOpenSheet(studentId)}
          accessibilityRole="button"
          accessibilityLabel={`${copy.exams.paper.exemptChip}. ${copy.exams.paper.exemptHint}`}
          style={[styles.field, styles.fieldStatic]}
        >
          <ThemedText variant="caption" color={colors.tone.neutral.fg}>
            {copy.exams.paper.exemptChip}
          </ThemedText>
        </Pressable>
      ) : (
        <TextInput
          ref={inputRef}
          testID={`entry-input-${studentId}`}
          value={cell.text}
          editable={canEdit}
          onChangeText={(text) => draft.setText(studentId, component.id, text)}
          onFocus={() => onFocusRow(studentId)}
          onBlur={() => {
            draft.commit(studentId, component.id);
            onBlurRow(studentId);
          }}
          onSubmitEditing={() => {
            draft.commit(studentId, component.id);
            onNext(studentId);
          }}
          // Submit WITHOUT blurring: the keyboard stays up while focus hops to
          // the next row (RN docs: submitBehavior "submit").
          submitBehavior="submit"
          returnKeyType="next"
          keyboardType={graded ? "default" : "decimal-pad"}
          autoCapitalize={graded ? "characters" : "none"}
          autoCorrect={false}
          selectTextOnFocus
          maxFontSizeMultiplier={1.3}
          placeholder={
            !canEdit
              ? "–"
              : cell.absent
                ? copy.exams.paper.absentChip
                : graded
                  ? copy.exams.paper.gradePlaceholder
                  : `/${displayMarks(component.max)}`
          }
          placeholderTextColor={
            cell.absent ? colors.tone.caution.fg : colors.chevron
          }
          accessibilityLabel={
            graded
              ? copy.exams.paper.gradeLabel(student.rollNumber, name)
              : copy.exams.paper.rowLabel(
                  student.rollNumber,
                  name,
                  multi ? component.name : null,
                  displayMarks(component.max),
                  cell.text,
                )
          }
          inputAccessoryViewID={
            Platform.OS === "ios" ? MARKS_ACCESSORY_ID : undefined
          }
          style={[
            styles.field,
            styles.input,
            focused ? styles.fieldFocused : null,
            cell.problem && cell.phase !== "failed" ? styles.fieldInvalid : null,
            below ? styles.fieldBelow : null,
            !canEdit ? styles.fieldReadOnly : null,
          ]}
        />
      )}

      <View style={styles.glyph}>
        {glyph === "saving" ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : glyph === "failed" ? (
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={copy.exams.paper.notSaved}
            onPress={() => onFailedPress(studentId, component.id)}
            testID={`entry-retry-${studentId}`}
          >
            <AppIcon name="refresh" size={20} color={colors.tone.caution.fg} />
          </Pressable>
        ) : glyph === "invalid" ? (
          <AppIcon name="warningCircle" size={20} color={colors.tone.critical.fg} />
        ) : glyph === "locked" ? (
          <AppIcon name="lock" size={18} color={colors.chevron} />
        ) : glyph === "saved" ? (
          <AppIcon name="check" size={20} color={colors.accentDeep} />
        ) : null}
      </View>
    </View>
  );
});

type Glyph = "saving" | "failed" | "invalid" | "locked" | "saved" | null;

function glyphFor(cell: Cell, locked: boolean): Glyph {
  if (cell.phase === "saving") return "saving";
  if (cell.phase === "failed") return "failed";
  if (cell.problem) return "invalid";
  if (locked) return "locked";
  // A tick means "the server has it AND nothing newer is typed".
  if (hasSavedValue(cell) && cell.text === savedText(cell)) return "saved";
  return null;
}

function savedText(cell: Cell): string {
  return cell.base.grade !== null && cell.base.grade !== ""
    ? cell.base.grade
    : displayMarks(cell.base.marks);
}

/**
 * "Practical: 18 · Oral: –" for a multi-component paper. `rev` is the
 * student's by-value signature: it is unused in the body on purpose — passing
 * it makes the dependency explicit, so a render that sees a new signature
 * recomputes the line instead of reusing a stale one.
 */
function summarizeOthers(
  draft: PaperDraft,
  studentId: string,
  others: readonly EntryComponent[],
  graded: boolean,
  rev: string,
): string {
  void rev;
  return others
    .map((other) => {
      const value = otherValue(draft.get(cellKey(studentId, other.id)), graded);
      return `${other.name}: ${value || "–"}`;
    })
    .join(" · ");
}

function otherValue(cell: Cell | undefined, graded: boolean): string {
  if (!cell) return "";
  if (cell.exempt) return copy.exams.paper.exemptChip;
  if (cell.absent) return copy.exams.paper.absentChip;
  return graded ? cell.text : cell.text.trim();
}

function problemText(cell: Cell, max: string): string | null {
  if (cell.phase === "failed") {
    // A conflict says WHAT happened (someone else saved); any other failed
    // save is "not saved, tap to retry" — the full friendly sentence is one
    // tap away in the retry dialog, and two truncated lines help nobody.
    return cell.problem?.kind === "conflict"
      ? cell.problem.message
      : copy.exams.paper.notSaved;
  }
  if (!cell.problem) return null;
  switch (cell.problem.kind) {
    case "range":
      return copy.exams.paper.outOfMax(displayMarks(max));
    case "format":
      return copy.exams.paper.enterNumber;
    case "negative":
      return copy.exams.paper.noNegative;
    default:
      return "message" in cell.problem ? cell.problem.message : null;
  }
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    marginBottom: spacing.sm - spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowAbsent: {
    backgroundColor: colors.tone.caution.bg,
  },
  rowInvalid: {
    backgroundColor: colors.tone.critical.bg,
  },
  rowFailed: {
    backgroundColor: colors.tone.caution.bg,
  },
  roll: {
    width: 26,
    textAlign: "left",
  },
  nameBlock: {
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    gap: spacing.xxs,
  },
  chip: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.field,
  },
  chipOn: {
    backgroundColor: colors.tone.caution.bg,
    borderWidth: 1,
    borderColor: colors.tone.caution.fg,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipSpacer: {
    width: 40,
  },
  field: {
    width: 72,
    minHeight: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldStatic: {
    backgroundColor: colors.tone.neutral.bg,
  },
  input: {
    paddingHorizontal: spacing.sm,
    textAlign: "right",
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.callout,
    fontVariant: ["tabular-nums"],
    color: colors.ink,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  fieldFocused: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
  },
  fieldInvalid: {
    backgroundColor: colors.surface,
    borderColor: colors.tone.critical.fg,
  },
  fieldBelow: {
    color: colors.tone.caution.fg,
  },
  fieldReadOnly: {
    backgroundColor: "transparent",
  },
  glyph: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
