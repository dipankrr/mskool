import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { copy } from "../../lib/copy";
import { spacing } from "../../theme/tokens";
import { ChipRow } from "./chip-row";
import type { Chip } from "./chip-row";
import { TermGradeEntry } from "./term-grade-entry";
import {
  useTermGradeSections,
  useTermGradeSubjects,
  useTermGradeTerms,
} from "./use-term-grades";
import { useClassSubjectNames, useExamScope, useMyPairs } from "./use-exam-data";

/**
 * TERM GRADES (chunk 7E) — the term_grade pipeline's entry screen. Areas such
 * as Art, Music or Value Education never sit a paper; at term end each student
 * gets a grade and (rarely) a remark.
 *
 * The screen is a context stack, not a form: term → class → section → subject,
 * each a chip row that hides when there is only one choice. The section is the
 * deliberate exception — with more than one it is never preselected, because a
 * grade written to the wrong section is silent corruption. The roster itself
 * lives in `TermGradeEntry`, remounted per (term, subject) so a fresh draft
 * store starts from the rows the server just returned.
 */
export function TermGradesScreen() {
  const { termId: termParam = "" } = useLocalSearchParams<{ termId?: string }>();
  const scope = useExamScope();
  const names = useClassSubjectNames();
  const termsQuery = useTermGradeTerms();

  const [pickedTerm, setPickedTerm] = useState<string | null>(termParam || null);
  const [pickedClass, setPickedClass] = useState<string | null>(null);
  const [pickedSection, setPickedSection] = useState<string | null>(null);
  const [pickedSubject, setPickedSubject] = useState<string | null>(null);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  // The entry owns the draft and therefore the unsaved-work verdict. Switching
  // any context remounts it (a fresh draft per term/mapping/section), so the
  // chips ask that live store before they throw typed work away.
  const guardRef = useRef<((apply: () => void) => void) | null>(null);
  const switchContext = (apply: () => void) => {
    if (guardRef.current) guardRef.current(apply);
    else apply();
  };

  // -- terms -----------------------------------------------------------------
  const terms = useMemo(
    () =>
      [...(termsQuery.data ?? [])].sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber,
      ),
    [termsQuery.data],
  );
  const termIds = terms.map((term) => term.id);
  const termOfToday = terms.find(
    (term) => term.startDate <= today && today <= term.endDate,
  );
  const activeTermId =
    pickedTerm && termIds.includes(pickedTerm)
      ? pickedTerm
      : terms.length === 1
        ? (terms[0]?.id ?? null)
        : (termOfToday?.id ?? null);

  // -- classes ---------------------------------------------------------------
  const classRows = useMemo(
    () =>
      [...(names.classes.data ?? [])].sort(
        (a, b) => a.numericOrder - b.numericOrder || a.name.localeCompare(b.name),
      ),
    [names.classes.data],
  );
  const classIds = classRows.map((row) => row.id);
  const activeClassId =
    pickedClass && classIds.includes(pickedClass)
      ? pickedClass
      : (classIds[0] ?? null);

  // -- sections --------------------------------------------------------------
  const sections = useTermGradeSections(activeClassId);
  const sectionIds = sections.rows.map((row) => row.id);
  const activeSectionId =
    pickedSection && sectionIds.includes(pickedSection)
      ? pickedSection
      : sections.rows.length === 1
        ? (sections.rows[0]?.id ?? null)
        : null;

  // -- subjects (term_grade areas only) --------------------------------------
  const subjects = useTermGradeSubjects(activeClassId);
  const activeSubject =
    subjects.rows.find((row) => row.subjectId === pickedSubject) ??
    subjects.rows[0] ??
    null;

  // -- the caller's own (section, subject) pairs ------------------------------
  const { pairs, pending: pairsPending } = useMyPairs(
    activeClassId ? [activeClassId] : [],
  );
  const assigned: boolean | null = pairsPending
    ? null
    : pairs === null
      ? true
      : activeSectionId && activeSubject
        ? pairs.some(
            (pair) =>
              pair.sectionId === activeSectionId &&
              pair.subjectId === activeSubject.subjectId,
          )
        : null;

  // -- names -------------------------------------------------------------------
  const termName = terms.find((term) => term.id === activeTermId)?.name ?? null;
  const className = activeClassId ? names.className(activeClassId) : null;
  const sectionName =
    sections.rows.find((row) => row.id === activeSectionId)?.name ?? null;
  const subjectName = activeSubject
    ? names.subjectName(activeSubject.subjectId)
    : null;
  const meta = copy.exams.termGrades.meta(
    termName,
    className,
    sectionName,
    subjectName,
  );

  const pickers: ReactNode = (
    <TermGradePickers
      terms={terms}
      termId={activeTermId}
      onTerm={(id) => {
        switchContext(() => {
          setPickedTerm(id);
          setPickedClass(null);
          setPickedSection(null);
          setPickedSubject(null);
        });
      }}
      classes={classRows.map((row) => ({ id: row.id, label: row.name }))}
      classId={activeClassId}
      onClass={(id) => {
        switchContext(() => {
          setPickedClass(id);
          setPickedSection(null);
          setPickedSubject(null);
        });
      }}
      sections={sections.rows.map((row) => ({
        id: row.id,
        // Bare "A" / "B" chips say nothing on their own: this row is the one
        // that decides where a write lands, so it names itself.
        label: copy.exams.termGrades.sectionChip(row.name),
      }))}
      sectionId={activeSectionId}
      onSection={(id) => {
        switchContext(() => {
          setPickedSection(id);
          setPickedSubject(null);
        });
      }}
      subjects={subjects.rows.map((row) => ({
        id: row.subjectId,
        label: names.subjectName(row.subjectId) ?? copy.exams.termGrades.subjectLabel,
      }))}
      subjectId={activeSubject?.subjectId ?? null}
      onSubject={(id) => switchContext(() => setPickedSubject(id))}
    />
  );

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.termGrades.title}
      meta={meta || copy.exams.termGrades.rowBody}
      backAccessibilityLabel={copy.common.back}
      backTestID="term-grades-back"
      titleTestID="term-grades-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="term-grades-denied"
      />,
    );
  }

  if (!scope.ready || scope.yearPending) {
    return frame(
      <View style={styles.body} testID="term-grades-loading">
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={120} />
      </View>,
    );
  }

  if (!scope.organizationId || !scope.schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.exams.noBranchTitle}
        message={copy.exams.noBranchBody}
        testID="term-grades-no-branch"
      />,
    );
  }

  if (!scope.academicYear) {
    return frame(
      <EmptyState
        icon="calendarOff"
        title={copy.exams.noYearTitle}
        message={copy.exams.noYearBody}
        testID="term-grades-no-year"
      />,
    );
  }

  if (names.classes.isPending || termsQuery.isPending) {
    return frame(
      <View style={styles.body} testID="term-grades-loading">
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={120} />
      </View>,
    );
  }

  if (names.classes.isError || termsQuery.isError) {
    return frame(
      <ErrorCard
        cause={names.classes.error ?? termsQuery.error}
        onRetry={() => {
          void names.classes.refetch();
          void termsQuery.refetch();
        }}
        testID="term-grades-error"
      />,
    );
  }

  if (classRows.length === 0) {
    return frame(
      <EmptyState
        icon="students"
        title={copy.exams.termGrades.noClassesTitle}
        message={copy.exams.termGrades.noClassesBody}
        testID="term-grades-no-classes"
      />,
    );
  }

  if (terms.length === 0) {
    return frame(
      <EmptyState
        icon="calendarOff"
        title={copy.exams.termGrades.noTermsTitle}
        message={copy.exams.termGrades.noTermsBody}
        testID="term-grades-no-terms"
      />,
    );
  }

  if (!activeTermId) {
    return frame(
      <View style={styles.body}>
        {pickers}
        <EmptyState
          icon="calendar"
          title={copy.exams.termGrades.pickTermTitle}
          message={copy.exams.termGrades.pickTermBody}
          testID="term-grades-pick-term"
        />
      </View>,
    );
  }

  if (sections.pending || subjects.pending) {
    return frame(
      <View style={styles.body} testID="term-grades-loading">
        {pickers}
        <Skeleton height={120} />
        <Skeleton height={64} />
      </View>,
    );
  }

  if (sections.isError || subjects.isError) {
    return frame(
      <ErrorCard
        cause={sections.error ?? subjects.error}
        onRetry={() => {
          void sections.refetch();
          void subjects.refetch();
        }}
        testID="term-grades-context-error"
      />,
    );
  }

  if (sections.rows.length === 0) {
    return frame(
      <View style={styles.body}>
        {pickers}
        <EmptyState
          icon="students"
          title={copy.exams.termGrades.noSectionsTitle}
          message={copy.exams.termGrades.noSectionsBody}
          testID="term-grades-no-sections"
        />
      </View>,
    );
  }

  if (!activeSectionId) {
    return frame(
      <View style={styles.body}>
        {pickers}
        <EmptyState
          icon="students"
          title={copy.exams.termGrades.pickSectionTitle}
          message={copy.exams.termGrades.pickSectionBody}
          testID="term-grades-pick-section"
        />
      </View>,
    );
  }

  if (subjects.rows.length === 0) {
    return frame(
      <View style={styles.body}>
        {pickers}
        <EmptyState
          icon="exams"
          title={copy.exams.termGrades.noSubjectsTitle}
          message={copy.exams.termGrades.noSubjectsBody}
          testID="term-grades-no-subjects"
        />
      </View>,
    );
  }

  if (!activeSubject) {
    // Unreachable while `rows.length > 0`; kept so the entry never mounts
    // without a mapping id.
    return frame(
      <View style={styles.body}>
        {pickers}
        <EmptyState
          icon="exams"
          title={copy.exams.termGrades.noSubjectsTitle}
          message={copy.exams.termGrades.noSubjectsBody}
          testID="term-grades-no-subjects"
        />
      </View>,
    );
  }

  return (
    <TermGradeEntry
      // A fresh draft per term + subject: the rows, the saves and the leave
      // guard all belong to one subject's sheet.
      key={`${activeTermId}:${activeSubject.mappingId}:${activeSectionId}`}
      organizationId={scope.organizationId}
      schoolId={scope.schoolId}
      termId={activeTermId}
      sectionId={activeSectionId}
      subjectId={activeSubject.subjectId}
      mappingId={activeSubject.mappingId}
      subjectName={subjectName}
      meta={meta}
      pickers={pickers}
      guardRef={guardRef}
      canEnter={scope.canEnter}
      assigned={assigned}
      pairsPending={pairsPending}
    />
  );
}

/**
 * The context chips. A row is hidden when there is one choice (it is a fact,
 * not a decision, and the title line already names it); the class row hides
 * when the caller's scope shows one class.
 */
function TermGradePickers({
  terms,
  termId,
  onTerm,
  classes,
  classId,
  onClass,
  sections,
  sectionId,
  onSection,
  subjects,
  subjectId,
  onSubject,
}: {
  terms: readonly { id: string; name: string }[];
  termId: string | null;
  onTerm: (id: string) => void;
  classes: readonly { id: string; label: string }[];
  classId: string | null;
  onClass: (id: string) => void;
  sections: readonly { id: string; label: string }[];
  sectionId: string | null;
  onSection: (id: string) => void;
  subjects: readonly { id: string; label: string }[];
  subjectId: string | null;
  onSubject: (id: string) => void;
}) {
  const termChips: readonly Chip<string>[] = terms.map((term) => ({
    value: term.id,
    label: term.name,
    testID: `term-grade-term-${term.id}`,
  }));
  const classChips: readonly Chip<string>[] = classes.map((row) => ({
    value: row.id,
    label: row.label,
    testID: `term-grade-class-${row.id}`,
  }));
  const sectionChips: readonly Chip<string>[] = sections.map((row) => ({
    value: row.id,
    label: row.label,
    testID: `term-grade-section-${row.id}`,
  }));
  const subjectChips: readonly Chip<string>[] = subjects.map((row) => ({
    value: row.id,
    label: row.label,
    testID: `term-grade-subject-${row.id}`,
  }));

  return (
    <View style={styles.pickers}>
      {terms.length > 1 ? (
        <ChipRow
          label={copy.exams.termGrades.termLabel}
          value={termId ?? ""}
          options={termChips}
          onChange={onTerm}
        />
      ) : null}
      {classes.length > 1 ? (
        <ChipRow
          label={copy.exams.termGrades.classLabel}
          value={classId ?? ""}
          options={classChips}
          onChange={onClass}
        />
      ) : null}
      {sections.length > 1 ? (
        <ChipRow
          label={copy.exams.termGrades.sectionLabel}
          value={sectionId ?? ""}
          options={sectionChips}
          onChange={onSection}
        />
      ) : null}
      {subjects.length > 1 ? (
        <ChipRow
          label={copy.exams.termGrades.subjectLabel}
          value={subjectId ?? ""}
          options={subjectChips}
          onChange={onSubject}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  pickers: {
    gap: spacing.md,
  },
});
