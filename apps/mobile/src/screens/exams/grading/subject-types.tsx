import { useState } from "react";
import type { ReactNode } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { ChoicePills } from "../../../components/choice-pills";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { FormField } from "../../../components/form-field";
import { FormSheet } from "../../../components/form-sheet";
import { Notice } from "../../../components/notice";
import { ScreenFrame } from "../../../components/screen-frame";
import { Skeleton } from "../../../components/skeleton";
import { StatusPill } from "../../../components/status-pill";
import { SwitchRow } from "../../../components/switch-row";
import { ThemedText } from "../../../components/themed-text";
import { copy } from "../../../lib/copy";
import { errorMessage } from "../../../lib/errors";
import {
  checkSubjectType,
  flagSentence,
  hasSubjectTypeErrors,
  subjectTypeCreatePayload,
  subjectTypeDraft,
  subjectTypeDirty,
  subjectTypeSummary,
  subjectTypeUpdatePayload,
  termGradeCaution,
} from "../../../lib/subject-types";
import type { SubjectTypeDraft } from "../../../lib/subject-types";
import { colors } from "../../../theme/brand-admin";
import { spacing, touch } from "../../../theme/tokens";
import { useBranchMeta } from "../../../hooks/use-active-context";
import { useExamScope } from "../use-exam-data";
import { QuietChip, SectionHead } from "./ui";
import { useSubjectTypeActions, useSubjectTypesAdmin } from "./use-grading";

type SubjectTypeRow = inferRouterOutputs<AppRouter>["exam"]["subjectTypes"]["list"][number];

/**
 * SUBJECT TYPES (chunk 7F) — how each kind of subject is entered, shown and
 * counted. A list of types; the edit is a sheet because it is five fields and
 * one plain sentence.
 *
 * The flags lock forever the first time a mark or term grade exists against
 * the type. The list says "In use" and the sheet leaves name and card order
 * editable, disables the three behaviour controls, and states why.
 */
export function SubjectTypesScreen() {
  const scope = useExamScope();
  const branchName = useBranchMeta();
  const types = useSubjectTypesAdmin();
  const actions = useSubjectTypeActions();

  const [sheet, setSheet] = useState<
    { mode: "create" } | { mode: "edit"; row: SubjectTypeRow } | null
  >(null);
  const [notice, setNotice] = useState<
    { tone: "positive" | "critical"; message: string } | null
  >(null);

  const rows = types.data ?? [];
  const canAdd = scope.canCreate;

  const preset = () => {
    Alert.alert(
      copy.exams.grading.types.presetTitle,
      copy.exams.grading.types.presetBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.exams.grading.types.presetConfirm,
          onPress: () => {
            void (async () => {
              setNotice(null);
              try {
                const added = await actions.applyPreset();
                setNotice({
                  tone: "positive",
                  message: copy.exams.grading.types.presetAdded(
                    Array.isArray(added) ? added.length : 0,
                  ),
                });
              } catch (cause) {
                setNotice({
                  tone: "critical",
                  message: errorMessage(cause),
                });
              }
            })();
          },
        },
      ],
    );
  };

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.grading.types.title}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      backTestID="subject-types-back"
      titleTestID="subject-types-title"
      action={
        canAdd
          ? {
              label: copy.exams.grading.types.add,
              icon: "add",
              onPress: () => setSheet({ mode: "create" }),
              testID: "subject-types-add",
            }
          : undefined
      }
      onRefresh={
        scope.canRead && scope.addressable
          ? () => void types.refetch()
          : undefined
      }
      refreshing={types.isRefetching}
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
        testID="subject-types-denied"
      />,
    );
  }

  if (!scope.ready || types.isPending) {
    return frame(
      <View style={styles.skeletons} testID="subject-types-loading">
        <Skeleton height={64} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>,
    );
  }

  if (!scope.organizationId || !scope.schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.exams.grading.noBranchTitle}
        message={copy.exams.grading.noBranchBody}
        testID="subject-types-no-branch"
      />,
    );
  }

  if (types.isError) {
    return frame(
      <ErrorCard
        cause={types.error}
        onRetry={() => void types.refetch()}
        testID="subject-types-error"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      {notice ? (
        <Notice
          tone={notice.tone}
          icon={notice.tone === "positive" ? "checkCircle" : "warning"}
          message={notice.message}
          testID="subject-types-notice"
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="subject"
          title={copy.exams.grading.types.emptyTitle}
          message={copy.exams.grading.types.emptyBody}
          testID="subject-types-empty"
        >
          {canAdd ? (
            <>
              <CapsuleButton
                title={copy.exams.grading.types.add}
                icon="add"
                size="compact"
                onPress={() => setSheet({ mode: "create" })}
                testID="subject-types-empty-add"
              />
              <CapsuleButton
                title={copy.exams.grading.types.preset}
                variant="secondary"
                size="compact"
                onPress={preset}
                disabled={actions.pending}
                testID="subject-types-empty-preset"
              />
            </>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <SectionHead
            title={copy.exams.grading.types.title}
            hint={copy.exams.grading.types.meta(rows.length)}
          />
          <Card padless testID="subject-types-list">
            {rows.map((row, index) => (
              <TypeRow
                key={row.id}
                row={row}
                first={index === 0}
                onPress={
                  scope.canUpdate
                    ? () => setSheet({ mode: "edit", row })
                    : undefined
                }
              />
            ))}
          </Card>
          {canAdd ? (
            <View style={styles.preset}>
              <CapsuleButton
                title={copy.exams.grading.types.preset}
                variant="secondary"
                size="compact"
                onPress={preset}
                loading={actions.pending}
                testID="subject-types-preset"
              />
              <ThemedText variant="meta">
                {copy.exams.grading.types.presetHelp}
              </ThemedText>
            </View>
          ) : null}
        </>
      )}

      {sheet ? (
        <TypeSheet
          key={sheet.mode === "edit" ? sheet.row.id : "new"}
          row={sheet.mode === "edit" ? sheet.row : null}
          canRetire={scope.canUpdate}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setSheet(null);
            setNotice({ tone: "positive", message });
          }}
        />
      ) : null}
    </View>,
  );
}

function TypeRow({
  row,
  first,
  onPress,
}: {
  row: SubjectTypeRow;
  first: boolean;
  onPress?: () => void;
}) {
  const sentence = [
    flagSentence(row),
    row.isDefault ? copy.exams.grading.types.defaultChip : null,
  ]
    .filter(Boolean)
    .join(". ");
  const body = (
    <>
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {row.name}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={2}>
          {flagSentence(row)}
        </ThemedText>
      </View>
      {row.isDefault ? (
        <StatusPill label={copy.exams.grading.types.defaultChip} tone="positive" />
      ) : null}
      {row.hasAssessmentData ? (
        <QuietChip
          label={copy.exams.grading.types.inUseChip}
          testID={`subject-type-in-use-${row.id}`}
        />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[styles.row, first ? null : styles.divider]}
        accessible
        accessibilityLabel={`${row.name}. ${sentence}${
          row.hasAssessmentData
            ? `. ${copy.exams.grading.types.inUseChip}`
            : ""
        }`}
        testID={`subject-type-row-${row.id}`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={`subject-type-row-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${row.name}. ${sentence}${
        row.hasAssessmentData
          ? `. ${copy.exams.grading.types.inUseChip}`
          : ""
      }`}
      accessibilityHint={copy.exams.grading.types.editTitle}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.rowPressed : null,
      ]}
    >
      {body}
    </Pressable>
  );
}

function TypeSheet({
  row,
  canRetire,
  onClose,
  onDone,
}: {
  row: SubjectTypeRow | null;
  canRetire: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const actions = useSubjectTypeActions();
  const [draft, setDraft] = useState<SubjectTypeDraft>(() =>
    subjectTypeDraft(row),
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const locked = row?.hasAssessmentData ?? false;
  const errors = submitted ? checkSubjectType(draft) : {};
  const dirty = row ? subjectTypeDirty(draft, row) : true;
  const caution = termGradeCaution(draft);

  const set = <K extends keyof SubjectTypeDraft>(
    key: K,
    value: SubjectTypeDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    setSubmitted(true);
    setError(null);
    if (hasSubjectTypeErrors(checkSubjectType(draft))) return;

    void (async () => {
      try {
        if (!row) {
          await actions.create(subjectTypeCreatePayload(draft));
          onDone(copy.exams.grading.types.created);
          return;
        }
        if (!dirty) {
          onClose();
          return;
        }
        const payload = subjectTypeUpdatePayload(draft, row);
        if (Object.keys(payload).length > 0) {
          await actions.update(row.id, payload);
        }
        onDone(copy.exams.grading.types.updated);
      } catch (cause) {
        setError(cause);
      }
    })();
  };

  const makeDefault = () => {
    if (!row) return;
    setError(null);
    void (async () => {
      try {
        await actions.makeDefault(row.id);
        onDone(copy.exams.grading.types.madeDefault);
      } catch (cause) {
        setError(cause);
      }
    })();
  };

  const retire = () => {
    if (!row) return;
    Alert.alert(
      copy.exams.grading.types.retireTitle(row.name),
      copy.exams.grading.types.retireBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.exams.grading.types.retireConfirm,
          style: "destructive",
          onPress: () => {
            void (async () => {
              setError(null);
              try {
                await actions.deactivate(row.id);
                onDone(copy.exams.grading.types.retired);
              } catch (cause) {
                setError(cause);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <FormSheet
      title={
        row
          ? copy.exams.grading.types.editTitle
          : copy.exams.grading.types.createTitle
      }
      onClose={onClose}
      testIDPrefix="subject-type-sheet"
      footer={
        <View style={styles.footer}>
          {error ? (
            <Notice
              tone="critical"
              message={errorMessage(error)}
              testID="subject-type-sheet-error"
            />
          ) : null}
          <View style={styles.footerRow}>
            {row && canRetire ? (
              <CapsuleButton
                title={copy.exams.grading.types.retireAction}
                variant="destructive"
                size="compact"
                onPress={retire}
                disabled={actions.pending}
                testID="subject-type-retire"
              />
            ) : null}
            <CapsuleButton
              title={copy.exams.grading.types.save}
              icon="check"
              size="compact"
              loading={actions.pending}
              disabled={Boolean(row) && !dirty}
              onPress={submit}
              testID="subject-type-save"
            />
          </View>
        </View>
      }
    >
      <Notice
        tone="neutral"
        icon="info"
        message={subjectTypeSummary(draft)}
        testID="subject-type-summary"
      />

      {locked ? (
        <Notice
          tone="neutral"
          icon="lock"
          title={copy.exams.grading.types.lockedTitle}
          message={copy.exams.grading.types.lockedBody}
          style={styles.notice}
          testID="subject-type-locked"
        />
      ) : null}

      <FormField
        label={copy.exams.grading.types.nameLabel}
        value={draft.name}
        onChangeText={(next) => set("name", next)}
        placeholder={copy.exams.grading.types.namePlaceholder}
        maxLength={100}
        error={errors.name}
        testID="subject-type-name"
      />

      {/**
       * A locked type shows no dead controls: the summary above already
       * states how it is assessed, shown and counted, and the lock notice
       * says those flags cannot move. Only the two editable facts remain.
       */}
      {locked ? null : (
        <>
          <ChoicePills
            label={copy.exams.grading.types.modeLabel}
            value={draft.assessmentMode}
            options={[
              {
                value: "exam",
                label: copy.exams.grading.types.modes.exam,
              },
              {
                value: "term_grade",
                label: copy.exams.grading.types.modes.term_grade,
              },
            ]}
            onChange={(next) => set("assessmentMode", next)}
            help={copy.exams.grading.types.modeHelp}
            testIDPrefix="subject-type-mode"
          />

          <SwitchRow
            label={copy.exams.grading.types.countsLabel}
            value={draft.countsTowardResult}
            onChange={(next) => set("countsTowardResult", next)}
            help={copy.exams.grading.types.countsHelp}
            testID="subject-type-counts"
          />

          <SwitchRow
            label={copy.exams.grading.types.gradedLabel}
            value={draft.isGradedOnly}
            onChange={(next) => set("isGradedOnly", next)}
            help={copy.exams.grading.types.gradedHelp}
            testID="subject-type-graded"
          />

          {caution ? (
            <Notice
              tone="caution"
              message={caution}
              style={styles.notice}
              testID="subject-type-caution"
            />
          ) : null}
        </>
      )}

      <FormField
        label={copy.exams.grading.types.sequenceLabel}
        value={draft.sequence}
        onChangeText={(next) => set("sequence", next.replace(/[^0-9]/g, ""))}
        help={copy.exams.grading.types.sequenceHelp}
        keyboardType="number-pad"
        maxLength={3}
        error={errors.sequence}
        testID="subject-type-sequence"
      />

      {row?.isDefault ? (
        <Notice
          tone="positive"
          icon="checkCircle"
          message={copy.exams.grading.types.defaultNote}
          style={styles.notice}
          testID="subject-type-default-note"
        />
      ) : row && canRetire ? (
        <View style={styles.preset}>
          <CapsuleButton
            title={copy.exams.grading.types.makeDefault}
            variant="secondary"
            size="compact"
            onPress={makeDefault}
            disabled={actions.pending}
            testID="subject-type-make-default"
          />
          <ThemedText variant="meta">
            {copy.exams.grading.types.defaultNote}
          </ThemedText>
        </View>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  skeletons: {
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    minHeight: touch.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  preset: {
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  notice: {
    marginTop: spacing.md,
  },
  footer: {
    gap: spacing.sm,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
