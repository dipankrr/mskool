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
import type { TermGradeCell, TermGradeDraft } from "../../lib/term-grade-draft";
import { GRADE_MAX } from "../../lib/term-grade-draft";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import type { TermGradeStudent } from "./use-term-grades";

/** The iOS keyboard accessory's anchor, one per entry screen mount. */
export const TERM_GRADE_ACCESSORY_ID = "term-grade-accessory";

type Props = {
  draft: TermGradeDraft;
  student: TermGradeStudent;
  /** The screen takes typing: permission, assignment and a chosen section. */
  editable: boolean;
  focused: boolean;
  onFocusRow: (studentId: string) => void;
  onBlurRow: (studentId: string) => void;
  onNext: (studentId: string) => void;
  onOpenSheet: (studentId: string) => void;
  onFailedPress: (studentId: string) => void;
};

/**
 * One student's term grade (chunk 7E) — the screen's hot path, built like the
 * marks row (7A): roll · name · one field · a glyph that only ever states what
 * the server confirmed. Typed work lives in the draft store, not the row, so a
 * row that scrolls out of the window never loses text.
 */
export const TermGradeRow = memo(function TermGradeRow({
  draft,
  student,
  editable,
  focused,
  onFocusRow,
  onBlurRow,
  onNext,
  onOpenSheet,
  onFailedPress,
}: Props) {
  const { studentId } = student;
  const inputRef = useRef<TextInput>(null);

  const subscribeCell = useCallback(
    (listener: () => void) => draft.subscribeCell(studentId, listener),
    [draft, studentId],
  );
  const cell = useSyncExternalStore(subscribeCell, () => draft.get(studentId));

  useEffect(() => {
    if (focused && editable) inputRef.current?.focus();
  }, [focused, editable]);

  if (!cell) return null;

  const glyph = glyphFor(cell, draft);
  const problemLine = lineFor(cell);

  return (
    <View
      style={[
        styles.row,
        cell.problem && cell.phase !== "failed" ? styles.rowInvalid : null,
        cell.phase === "failed" ? styles.rowFailed : null,
      ]}
      testID={`term-grade-row-${studentId}`}
    >
      <ThemedText variant="meta" style={styles.roll} numberOfLines={1}>
        {student.rollNumber?.trim() || "–"}
      </ThemedText>

      <Pressable
        style={styles.nameBlock}
        accessibilityRole="button"
        accessibilityLabel={copy.exams.termGrades.sheet.openLabel(student.name)}
        accessibilityHint={copy.exams.termGrades.sheet.openHint}
        onPress={() => onOpenSheet(studentId)}
        testID={`term-grade-name-${studentId}`}
      >
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {student.name}
        </ThemedText>
        {problemLine ? (
          <ThemedText
            variant="meta"
            numberOfLines={2}
            color={
              problemLine.tone === "critical"
                ? colors.tone.critical.fg
                : problemLine.tone === "caution"
                  ? colors.tone.caution.fg
                  : colors.muted
            }
            accessibilityLiveRegion="polite"
          >
            {problemLine.text}
          </ThemedText>
        ) : null}
      </Pressable>

      <TextInput
        ref={inputRef}
        testID={`term-grade-input-${studentId}`}
        value={cell.grade}
        editable={editable}
        onChangeText={(text) => draft.setGrade(studentId, text)}
        onFocus={() => onFocusRow(studentId)}
        onBlur={() => {
          draft.commit(studentId);
          onBlurRow(studentId);
        }}
        onSubmitEditing={() => {
          draft.commit(studentId);
          onNext(studentId);
        }}
        // Submit WITHOUT blurring: the keyboard stays up while focus hops to
        // the next row (RN docs: submitBehavior "submit").
        submitBehavior="submit"
        inputAccessoryViewID={
          Platform.OS === "ios" ? TERM_GRADE_ACCESSORY_ID : undefined
        }
        returnKeyType="next"
        keyboardType="default"
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        selectTextOnFocus
        maxLength={GRADE_MAX}
        maxFontSizeMultiplier={1.3}
        placeholder={editable ? copy.exams.termGrades.gradePlaceholder : "–"}
        placeholderTextColor={colors.chevron}
        accessibilityLabel={copy.exams.termGrades.gradeLabel(
          student.rollNumber,
          student.name,
        )}
        style={[
          styles.field,
          styles.input,
          focused ? styles.fieldFocused : null,
          cell.problem && cell.phase !== "failed" ? styles.fieldInvalid : null,
          !editable ? styles.fieldReadOnly : null,
        ]}
      />

      <View style={styles.glyph}>
        {glyph === "saving" ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : glyph === "failed" ? (
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={copy.exams.termGrades.notSaved}
            onPress={() => onFailedPress(studentId)}
            testID={`term-grade-retry-${studentId}`}
          >
            <AppIcon name="refresh" size={20} color={colors.tone.caution.fg} />
          </Pressable>
        ) : glyph === "invalid" ? (
          <AppIcon name="warningCircle" size={20} color={colors.tone.critical.fg} />
        ) : glyph === "saved" ? (
          <AppIcon name="check" size={20} color={colors.accentDeep} />
        ) : null}
      </View>
    </View>
  );
});

type Glyph = "saving" | "failed" | "invalid" | "saved" | null;

/** Tone is part of the line, not a guess made from the save phase. */
type RowLine = { text: string; tone: "critical" | "caution" | "muted" };

function glyphFor(cell: TermGradeCell, draft: TermGradeDraft): Glyph {
  if (cell.phase === "saving") return "saving";
  if (cell.phase === "failed") return "failed";
  if (cell.problem) return "invalid";
  // A tick means "the server has it AND nothing newer is typed".
  if (cell.base.grade !== null && !draft.isDirty(cell)) return "saved";
  return null;
}

/** A row's quiet second line: what is wrong, moved, or worth opening the sheet for. */
function lineFor(cell: TermGradeCell): RowLine | null {
  if (cell.phase === "failed") {
    return { text: copy.exams.termGrades.notSaved, tone: "caution" };
  }
  if (cell.problem) {
    return {
      text:
        cell.problem.kind === "empty"
          ? copy.exams.termGrades.emptyGrade
          : (cell.problem.message ?? copy.exams.termGrades.failedTitle),
      tone: "critical",
    };
  }
  if (cell.remoteChange) {
    return { text: copy.exams.termGrades.changedElsewhere, tone: "caution" };
  }
  // A remark is news, not a warning: painting it red read as an error (walk
  // 2026-10-28), so it takes the same quiet grey as any other secondary line.
  if (cell.remarks.trim() !== "") {
    return { text: copy.exams.termGrades.remarksHint, tone: "muted" };
  }
  return null;
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowInvalid: {
    borderWidth: 1,
    borderColor: colors.tone.critical.fg,
  },
  rowFailed: {
    borderWidth: 1,
    borderColor: colors.tone.caution.fg,
  },
  roll: {
    width: 30,
    textAlign: "right",
  },
  nameBlock: {
    flex: 1,
    gap: 2,
    paddingVertical: spacing.xs,
  },
  field: {
    minWidth: 64,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    textAlign: "center",
  },
  input: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.body,
    color: colors.ink,
  },
  fieldFocused: {
    borderWidth: 1,
    borderColor: colors.accent,
  },
  fieldInvalid: {
    borderWidth: 1,
    borderColor: colors.tone.critical.fg,
  },
  fieldReadOnly: {
    opacity: 0.7,
  },
  glyph: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
