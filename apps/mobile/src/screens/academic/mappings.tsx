import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EntityCard } from "../../components/entity-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { SelectField } from "../../components/select-field";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { AcademicListFrame } from "./list-frame";

type MappingRow = inferRouterOutputs<
  AppRouter
>["assignment"]["subjectMapping"]["list"][number];
type SubjectType = inferRouterOutputs<AppRouter>["exam"]["subjectTypes"]["list"][number];

/**
 * A class's curriculum for the running session (Step 2 rework). Mapping one
 * subject is a two-field act, so it lives in a bottom sheet — and onboarding
 * a class never repeats it ten times: "Add subjects" bulk-maps a checked
 * selection in one pass, each row carrying the school's Result type
 * (subjectTypeId — the report-card facts from ADR-032). The class picker
 * rides the route so deep links land on the same class.
 */
export function SubjectMappingsScreen() {
  const { classId } = useLocalSearchParams<{ classId?: string }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("subject_mapping:read");
  const canCreate = has("subject_mapping:create");
  const canOpen = has("subject_mapping:update") || has("subject_mapping:delete");

  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedClassId = classId ?? null;

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );
  const subjects = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );
  // ADR-032's Result types — the report-card facts a mapping carries. Held by
  // exam:read; a caller without it simply loses the type column and picker.
  const subjectTypes = trpc.exam.subjectTypes.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    {
      enabled: ready && Boolean(organizationId) && has("exam:read"),
      retry: false,
    },
  );

  const list = trpc.assignment.subjectMapping.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      classId: selectedClassId ?? "",
    },
    {
      enabled:
        ready &&
        Boolean(organizationId) &&
        canRead &&
        Boolean(academicYear?.id) &&
        Boolean(selectedClassId),
    },
  );

  const subjectName = (id: string) =>
    (subjects.data ?? []).find((row) => row.id === id)?.name ?? null;
  const typeName = (id: string | null) =>
    id
      ? (subjectTypes.data ?? []).find((row) => row.id === id)?.name ?? null
      : null;
  const className = selectedClassId
    ? (classes.data ?? []).find((row) => row.id === selectedClassId)?.name ?? null
    : null;

  const [editSheetId, setEditSheetId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  const mappings = list.data ?? [];
  const mappedSubjectIds = new Set(mappings.map((row) => row.subjectId));
  const unmapped = (subjects.data ?? []).filter(
    (row) => !mappedSubjectIds.has(row.id),
  );
  const editRow = editSheetId
    ? mappings.find((row) => row.id === editSheetId) ?? null
    : null;

  const hasClass = Boolean(selectedClassId);

  return (
    <AcademicListFrame
      title={copy.academic.mappings.title}
      meta={[branchName, className].filter(Boolean).join(" · ") || null}
      canRead={canRead}
      deniedTitle={copy.academic.denied.mappingsReadTitle}
      deniedPermission="subject_mapping:read"
      needsSession
      academicYear={Boolean(academicYear)}
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={hasClass && list.isPending}
      error={hasClass ? (list.error ?? null) : null}
      onRetry={() => void list.refetch()}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      isEmpty={!hasClass || mappings.length === 0}
      isFilteredEmpty={hasClass}
      emptyTitle={copy.academic.mappings.emptyTitle}
      emptyBody={copy.academic.mappings.emptyBody}
      filteredEmptyTitle={copy.academic.mappings.emptyTitle}
      filteredEmptyBody={copy.academic.mappings.emptyBody}
      emptyIcon="sort"
      titleTestID="mappings-title"
      header={
        <View style={styles.filterWrap}>
          <Card style={styles.filterCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.academic.sections.classFilterLabel}, ${className ?? ""}`}
              accessibilityHint={copy.academic.mappings.classPickerTitle}
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [
                styles.filter,
                pressed ? styles.filterPressed : null,
              ]}
              testID="mappings-class-filter"
            >
              <ThemedText
                variant="bodyStrong"
                numberOfLines={1}
                style={styles.filterText}
              >
                {`${copy.academic.sections.classFilterLabel}: ${className ?? copy.academic.sections.allClasses}`}
              </ThemedText>
              <AppIcon name="chevronDown" size={16} color={colors.muted} />
            </Pressable>
          </Card>
          {hasClass && canCreate ? (
            <Card style={styles.filterCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.bulkMapping.add}
                accessibilityHint={copy.bulkMapping.addHint}
                onPress={() => setBulkOpen(true)}
                style={({ pressed }) => [
                  styles.filter,
                  pressed ? styles.filterPressed : null,
                ]}
                testID="mappings-bulk-add"
              >
                <AppIcon name="add" size={18} color={colors.accentDeep} />
                <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                  {copy.bulkMapping.add}
                </ThemedText>
              </Pressable>
            </Card>
          ) : null}
          {saved ? (
            <Notice tone="positive" message={saved} testID="mappings-saved" />
          ) : null}
        </View>
      }
    >
      {mappings.map((row) => (
        <EntityCard
          key={row.id}
          title={subjectName(row.subjectId) ?? row.subjectId}
          meta={[
            typeName(row.subjectTypeId ?? null),
            copy.academic.mappings.meta(row.isElective, row.sequenceNumber),
          ]
            .filter(Boolean)
            .join(" · ")}
          icon="sort"
          onPress={
            canOpen
              ? () =>
                  setEditSheetId(row.id)
              : undefined
          }
          accessibilityHint={canOpen ? copy.academic.mappings.openHint : undefined}
          testID={`mapping-card-${row.id}`}
        />
      ))}

      {bulkOpen ? (
      <BulkMapSheet
        onClose={() => setBulkOpen(false)}
        organizationId={organizationId ?? ""}
        schoolId={schoolId}
        academicYearId={academicYear?.id ?? null}
        classId={selectedClassId}
        candidates={unmapped.map((row) => ({ id: row.id, name: row.name }))}
        subjectTypes={subjectTypes.data ?? []}
        showTypes={Boolean(subjectTypes.data && subjectTypes.data.length > 0)}
        onSaved={(message) => {
          setBulkOpen(false);
          setSaved(message);
        }}
      />
      ) : null}

      {editSheetId !== null ? (
      <EditMappingSheet
        row={editRow}
        onClose={() => setEditSheetId(null)}
        organizationId={organizationId ?? ""}
        className={className}
        subjectName={editRow ? subjectName(editRow.subjectId) : null}
        subjectTypes={subjectTypes.data ?? []}
        showTypes={Boolean(subjectTypes.data && subjectTypes.data.length > 0)}
        canUpdate={has("subject_mapping:update")}
        canEnd={has("subject_mapping:delete")}
        onSaved={(message) => {
          setEditSheetId(null);
          setSaved(message);
        }}
      />
      ) : null}

      <ChoiceSheet
        visible={pickerOpen}
        title={copy.academic.mappings.classPickerTitle}
        options={(classes.data ?? []).map((row) => ({ id: row.id, label: row.name }))}
        currentId={selectedClassId ?? ""}
        onSelect={(id) => {
          setPickerOpen(false);
          if (id && id !== selectedClassId) {
            router.setParams({ classId: id });
          }
        }}
        onDismiss={() => setPickerOpen(false)}
        testIDPrefix="mappings-class"
      />
    </AcademicListFrame>
  );
}

// ---------------------------------------------------------------- bulk sheet

function BulkMapSheet({
  onClose,
  organizationId,
  schoolId,
  academicYearId,
  classId,
  candidates,
  subjectTypes,
  showTypes,
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
  onSaved: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typeId, setTypeId] = useState<string | null>(null);
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
    if (!schoolId || !academicYearId || !classId) return;
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
              ...(typeId ? { subjectTypeId: typeId } : {}),
            },
          });
          completed += 1;
        } catch {
          failures.add(candidate.id);
        }
      }
      await utils.assignment.subjectMapping.list.invalidate();
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
            disabled={working || pending === 0}
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
          placeholder={copy.bulkMapping.typeNone}
          options={[{ id: "", label: copy.bulkMapping.typeNone }, ...typeOptions]}
          currentId={typeId ?? ""}
          onSelect={(id) => setTypeId(id || null)}
          help={copy.bulkMapping.typeHelp}
          testID="bulk-map-type"
        />
      ) : null}
    </FormSheet>
  );
}

// ---------------------------------------------------------------- edit sheet

function EditMappingSheet({
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
  const [isElective, setIsElective] = useState(false);
  const [sequence, setSequence] = useState("0");
  const [typeId, setTypeId] = useState<string | null>(null);
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
          ...(typeId ? { subjectTypeId: typeId } : { subjectTypeId: null }),
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
      await utils.assignment.subjectMapping.list.invalidate();
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
          placeholder={copy.bulkMapping.typeNone}
          options={[{ id: "", label: copy.bulkMapping.typeNone }, ...typeOptions]}
          currentId={typeId ?? ""}
          onSelect={(id) => setTypeId(id || null)}
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
