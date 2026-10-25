import { useState } from "react";

import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import {
  checkQuestionDraft,
  emptyQuestionDraft,
} from "../../lib/homework-questions";
import type { QuestionDraft } from "../../lib/homework-questions";
import { spacing } from "../../theme/tokens";
import { QuestionFields } from "./question-fields";

/**
 * The one question sheet: a fresh mount per open (the FormSheet contract),
 * which is what makes editing another question start from that question's
 * truth. The fields live in `QuestionFields`, shared with the bank's full-screen
 * authoring form, so the two surfaces cannot drift.
 *
 * Nothing is saved to the homework until the parent's save runs; the sheet says
 * so. The parent decides whether the draft becomes a new snapshot row or
 * replaces an existing one.
 */
export function QuestionComposerSheet({
  initial,
  mode,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  initial?: QuestionDraft;
  mode: "add" | "edit";
  submitting: boolean;
  error: unknown;
  onSubmit: (draft: QuestionDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(
    () => initial ?? emptyQuestionDraft("mcq_single"),
  );
  const [touched, setTouched] = useState(false);

  const check = checkQuestionDraft(draft);
  const text = copy.homework.questions;

  const save = () => {
    setTouched(true);
    if (!check.valid) return;
    onSubmit(draft);
  };

  const footer = (
    <>
      {touched && !check.valid ? (
        <Notice
          tone="caution"
          title={text.composerErrorTitle}
          message={Object.values(check.errors)[0]}
          testID="homework-question-check"
        />
      ) : null}
      {error ? (
        <Notice
          tone="critical"
          title={text.saveError}
          message={errorMessage(error)}
          testID="homework-question-error"
        />
      ) : null}
      <CapsuleButton
        title={mode === "edit" ? text.composerSave : text.composerAdd}
        icon="check"
        onPress={save}
        loading={submitting}
        disabled={submitting}
        testID="homework-question-save"
      />
    </>
  );

  return (
    <FormSheet
      title={mode === "edit" ? text.composerEditTitle : text.composerAddTitle}
      onClose={onClose}
      footer={footer}
      testIDPrefix="homework-question"
    >
      <ThemedText variant="meta" style={{ marginBottom: spacing.md }}>
        {text.composerHint}
      </ThemedText>
      <QuestionFields
        draft={draft}
        onChange={setDraft}
        submitting={submitting}
        touched={touched}
      />
    </FormSheet>
  );
}
