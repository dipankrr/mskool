import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { SelectField } from "../../components/select-field";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { startingSubjectTypeId } from "../../lib/subject-types";

type MappingRow = inferRouterOutputs<
  AppRouter
>["assignment"]["subjectMapping"]["list"][number];
type SubjectType = inferRouterOutputs<AppRouter>["exam"]["subjectTypes"]["list"][number];

// ---------------------------------------------------------------- bulk sheet

export function BulkMapSheet({
  onClose,
  organizationId,
  schoolId,
  academicYearId,
  classId,
  candidates,
  subjectTypes,
  showTypes,
  canReadTypes,
  onSaved,
}: {
  onClose: () => void;
  organizationId: string;
  schoolId: string | null;
  academicYearId: string | null;
  classId: string | null;
  candidates: { id: string; name: string }[];
  subjectTypes: SubjectType[];
  showTypes: boolean;
  canReadTypes: boolean;
  onSaved: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Null until the person picks; derived so a list that loads late still counts.
  const [pickedTypeId, setPickedTypeId] = useState<string | null>(null);
  const typeId = pickedTypeId ?? startingSubjectTypeId(subjectTypes);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(0);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = trpc.assignment.subjectMapping.create.useMutation();
  const utils = trpc.useUtils();

  const mapSelected = async (targets: Set<string>) => {
    if (!schoolId || !academicYearId || !classId || !typeId) return;
    setWorking(true);
    setError(null);
    try {
      const list = candidates.filter((candidate) => targets.has(candidate.id));
      let completed = 0;
      const failures = new Set<string>();
      for (const candidate of list) {
        try {
          await create.mutateAsync({
            organizationId,
            schoolId,
            academicYearId,
            classId,
            subjectId: candidate.id,
            data: {
              academicYearId,
              classId,
              subjectId: candidate.id,
              isElective: false,
              subjectTypeId: typeId,
            },
          });
          completed += 1;
        } catch {
          failures.add(candidate.id);
        }
      }
      await Promise.all([
        utils.assignment.subjectMapping.list.invalidate(),
        utils.assignment.subjectMapping.coverage.invalidate(),
      ]);
      setDone(completed);
      setFailedIds(failures);
      if (failures.size === 0) {
        onSaved(copy.rework.mappings(completed));
      }
    } finally {
      setWorking(false);
    }
  };

  const pending = selected.size - failedIds.size;
  const typeOptions = subjectTypes.map((row) => ({ id: row.id, label: row.name }));

  return (
    <FormSheet
      title={copy.bulkMapping.add}
      onClose={onClose}
      testIDPrefix="bulk-map"
      footer={
        <>
          {error ? (
            <Notice
              tone="critical"
              message={toFriendlyError(error).message}
              testID="bulk-map-error"
            />
          ) : null}
          {failedIds.size > 0 ? (
            <CapsuleButton
              title={copy.bulkMapping.failed(failedIds.size)}
              icon="history"
              onPress={() => void mapSelected(failedIds)}
              testID="bulk-map-retry"
            />
          ) : null}
          <CapsuleButton
            title={copy.bulkMapping.confirm(selected.size)}
            icon="check"
            onPress={() => void mapSelected(selected)}
            loading={working}
            disabled={working || pending === 0 || !typeId}
            testID="bulk-map-confirm"
          />
        </>
      }
    >
      <ThemedText variant="meta">{copy.bulkMapping.sheetHint}</ThemedText>
      {candidates.length === 0 ? (
        <Notice
          tone="neutral"
          title={copy.bulkMapping.emptyTitle}
          message={copy.bulkMapping.emptyBody}
          testID="bulk-map-empty"
        />
      ) : (
        <Card padless style={styles.candidateCard}>
          {candidates.map((candidate) => {
            const on = selected.has(candidate.id);
            return (
              <Pressable
                key={candidate.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={candidate.name}
                onPress={() => toggle(candidate.id)}
                style={({ pressed }) => [
                  styles.candidateRow,
                  on ? styles.candidateOn : null,
                  pressed ? styles.candidatePressed : null,
                ]}
                testID={`bulk-map-option-${candidate.id}`}
              >
                <View style={styles.rowText}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {candidate.name}
                  </ThemedText>
                </View>
                <View style={[styles.checkbox, on ? styles.checkboxOn : null]}>
                  {on ? (
                    <AppIcon name="check" size={14} color="#FFFFFF" />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}
      {working ? (
        <ThemedText variant="meta" style={styles.progress}>
          {copy.bulkMapping.mapping(done, selected.size)}
        </ThemedText>
      ) : null}
      {showTypes && candidates.length > 0 ? (
        <SelectField
          label={copy.bulkMapping.typeLabel}
          valueLabel={typeId ? typeOptions.find((o) => o.id === typeId)?.label ?? null : null}
          placeholder={copy.bulkMapping.typePlaceholder}
          options={typeOptions}
          currentId={typeId ?? ""}
          onSelect={setPickedTypeId}
          help={copy.bulkMapping.typeHelp}
          testID="bulk-map-type"
        />
      ) : candidates.length > 0 && !canReadTypes ? (
        <Notice
          tone="caution"
          message={copy.bulkMapping.typesHiddenBody}
          style={styles.retire}
          testID="bulk-map-types-hidden"
        />
      ) : candidates.length > 0 ? (
        <Notice
          tone="caution"
          message={copy.bulkMapping.noTypesBody}
          style={styles.retire}
          testID="bulk-map-no-types"
        >
          <CapsuleButton
            title={copy.bulkMapping.noTypesAction}
            size="compact"
            onPress={() => {
              onClose();
              router.push("/exams/setup/subject-types");
            }}
            testID="bulk-map-add-type"
          />
        </Notice>
      ) : null}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- edit sheet

export function EditMappingSheet({
  row,
  onClose,
  organizationId,
  className,
  subjectName,
  subjectTypes,
  showTypes,
  canUpdate,
  canEnd,
  onSaved,
}: {
  row: MappingRow | null;
  onClose: () => void;
  organizationId: string;
  className: string | null;
  subjectName: string | null;
  subjectTypes: SubjectType[];
  showTypes: boolean;
  canUpdate: boolean;
  canEnd: boolean;
  onSaved: (message: string) => void;
}) {
  const [isElective, setIsElective] = useState(row?.isElective ?? false);
  const [sequence, setSequence] = useState(String(row?.sequenceNumber ?? 0));
  const [pickedTypeId, setPickedTypeId] = useState<string | null>(null);
  // An older row with no type starts on the school's default: Save fixes it.
  const typeId =
    pickedTypeId ?? row?.subjectTypeId ?? startingSubjectTypeId(subjectTypes);
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [endError, setEndError] = useState<unknown>(null);
  const [ending, setEnding] = useState(false);

  const invalidSequence = !/^\d+$/.test(sequence.trim());

  const utils = trpc.useUtils();
  const update = trpc.assignment.subjectMapping.update.useMutation();
  const end = trpc.assignment.subjectMapping.end.useMutation();

  const save = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (invalidSequence || !row) return;
    try {
      await update.mutateAsync({
        organizationId,
        id: row.id,
        data: {
          isElective,
          sequenceNumber: Number(sequence.trim()),
          ...(typeId ? { subjectTypeId: typeId } : {}),
        },
      });
      await utils.assignment.subjectMapping.list.invalidate();
      onSaved(copy.rework.mapping);
    } catch (error) {
      setSaveError(error);
    }
  };

  const confirmEnd = () => {
    if (!row) return;
    Alert.alert(copy.academic.mappings.endConfirmTitle, copy.academic.mappings.endConfirmBody, [
      { text: copy.common.cancel, style: "cancel" },
      {
        text: copy.academic.mappings.endConfirm,
        style: "destructive",
        onPress: () => void endMapping(row.id),
      },
    ]);
  };

  const endMapping = async (id: string) => {
    setEndError(null);
    setEnding(true);
    try {
      await end.mutateAsync({ organizationId, id });
      await Promise.all([
        utils.assignment.subjectMapping.list.invalidate(),
        utils.assignment.subjectMapping.coverage.invalidate(),
      ]);
      onSaved(copy.academic.mappings.endNoticeTitle);
    } catch (error) {
      setEndError(error);
    } finally {
      setEnding(false);
    }
  };

  const typeOptions = subjectTypes.map((typeRow) => ({
    id: typeRow.id,
    label: typeRow.name,
  }));

  return (
    <FormSheet
      title={copy.academic.mappings.editTitle}
      onClose={onClose}
      testIDPrefix="mapping-sheet"
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="mapping-save-error"
            />
          ) : null}
          {submitted && invalidSequence ? (
            <Notice
              tone="critical"
              message={copy.academic.mappings.errors.sequence}
              testID="mapping-invalid"
            />
          ) : null}
          {canUpdate ? (
            <CapsuleButton
              title={copy.academic.save}
              icon="check"
              onPress={() => void save()}
              loading={update.isPending}
              disabled={ending}
              testID="mapping-save"
            />
          ) : null}
        </>
      }
    >
      <FormField
        label={copy.academic.sections.fields.class}
        value={className ?? ""}
        onChangeText={() => {}}
        editable={false}
        testID="mapping-class"
      />
      <FormField
        label={copy.academic.subjects.title.replace(/s$/, "")}
        value={subjectName ?? ""}
        onChangeText={() => {}}
        help={copy.academic.mappings.subjectLockedNote}
        editable={false}
        testID="mapping-subject"
      />
      {showTypes ? (
        <SelectField
          label={copy.bulkMapping.typeLabel}
          valueLabel={typeId ? typeOptions.find((o) => o.id === typeId)?.label ?? null : null}
          placeholder={copy.bulkMapping.typePlaceholder}
          options={typeOptions}
          currentId={typeId ?? ""}
          onSelect={setPickedTypeId}
          help={copy.bulkMapping.typeHelp}
          disabled={!canUpdate}
          testID="mapping-type"
        />
      ) : null}
      <SwitchRow
        label={copy.academic.mappings.elective}
        value={isElective}
        onChange={(next) => {
          setIsElective(next);
          setTouched(true);
        }}
        help={copy.academic.mappings.electiveHelp}
        disabled={!canUpdate}
        testID="mapping-elective"
      />
      <FormField
        label={copy.academic.mappings.sequence}
        value={sequence}
        onChangeText={(next) => setSequence(next.replace(/[^\d]/g, ""))}
        onBlur={() => setTouched(true)}
        help={copy.academic.mappings.sequenceHelp}
        error={touched || submitted ? (invalidSequence ? copy.academic.mappings.errors.sequence : undefined) : undefined}
        keyboardType="number-pad"
        maxLength={3}
        editable={canUpdate}
        testID="mapping-sequence"
      />

      {row && canEnd ? (
        <Notice
          tone="caution"
          title={copy.academic.mappings.endNoticeTitle}
          message={copy.academic.mappings.endNoticeBody}
          style={styles.retire}
        >
          <CapsuleButton
            title={copy.academic.mappings.endAction}
            variant="destructive"
            size="compact"
            onPress={confirmEnd}
            loading={ending}
            disabled={update.isPending}
            testID="mapping-end"
          />
        </Notice>
      ) : null}
      {endError ? (
        <Notice
          tone="critical"
          message={toFriendlyError(endError).message}
          testID="mapping-end-error"
        />
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  filterWrap: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  filterCard: {
    paddingVertical: spacing.xs,
  },
  filter: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  filterPressed: {
    backgroundColor: colors.field,
  },
  filterText: {
    flex: 1,
  },
  candidateCard: {
    marginTop: spacing.sm,
  },
  candidateRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  candidateOn: {
    backgroundColor: colors.accentTint,
  },
  candidatePressed: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  progress: {
    marginTop: spacing.sm,
  },
  retire: {
    marginTop: spacing.lg,
  },
});
