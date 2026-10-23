import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { SelectField } from "../../components/select-field";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import {
  emptyMappingForm,
  isFormDirty,
  mappingCreatePayload,
  mappingFormFrom,
  mappingUpdatePayload,
  validateMappingForm,
  type MappingForm,
} from "./form-logic";
import { AcademicFormGates } from "./form-frame";

type MappingRow = inferRouterOutputs<AppRouter>["assignment"]["subjectMapping"]["byId"];

/**
 * Map a subject onto a class, or correct one. Creating names the subject;
 * editing locks it — a mapping cannot move subjects (fix a wrong one by
 * ending it) — and only elective/sequence are patchable. Ending lives at the
 * bottom behind a consequence confirm (ADR-033).
 */
export function SubjectMappingFormScreen() {
  const { id, classId } = useLocalSearchParams<{
    id?: string;
    classId?: string;
  }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(id);
  const canRead = has("subject_mapping:read");
  const canWrite = editing ? has("subject_mapping:update") : has("subject_mapping:create");
  const canEnd = editing && has("subject_mapping:delete");
  const allowed = canRead && (canWrite || canEnd);

  const mappingQuery = trpc.assignment.subjectMapping.byId.useQuery(
    { organizationId: organizationId ?? "", id: id ?? "" },
    { enabled: ready && Boolean(organizationId) && editing && canRead, gcTime: 0 },
  );

  return (
    <AcademicFormGates
      title={
        editing ? copy.academic.mappings.editTitle : copy.academic.mappings.addTitle
      }
      ready={ready}
      hasOrg={Boolean(organizationId)}
      allowed={allowed}
      deniedTitle={copy.academic.denied.mappingsWriteTitle}
      deniedPermission={editing ? "subject_mapping:update" : "subject_mapping:create"}
      editing={editing}
      editPending={mappingQuery.isPending}
      editError={mappingQuery.error ?? null}
      editMissing={editing && !mappingQuery.isPending && !mappingQuery.data}
      onRetryEdit={() => void mappingQuery.refetch()}
      backTestID="mapping-form-back"
    >
      <MappingFormBody
        organizationId={organizationId ?? ""}
        schoolId={schoolId}
        academicYearId={academicYear?.id ?? null}
        classId={mappingQuery.data?.classId ?? classId ?? null}
        row={mappingQuery.data ?? null}
        canWrite={canWrite}
        canEnd={canEnd}
      />
    </AcademicFormGates>
  );
}

function MappingFormBody({
  organizationId,
  schoolId,
  academicYearId,
  classId,
  row,
  canWrite,
  canEnd,
}: {
  organizationId: string;
  /** Create's addressed parent — the gate covers `subject_mapping:create` here. */
  schoolId: string | null;
  academicYearId: string | null;
  classId: string | null;
  row: MappingRow | null;
  canWrite: boolean;
  canEnd: boolean;
}) {
  const editing = Boolean(row);
  const [initial] = useState<MappingForm>(() =>
    row ? mappingFormFrom(row) : emptyMappingForm(),
  );
  const [form, setForm] = useState<MappingForm>(initial);
  const [touched, setTouched] = useState<Set<keyof MappingForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [endError, setEndError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [ended, setEnded] = useState(false);
  const [ending, setEnding] = useState(false);

  const errors = useMemo(() => validateMappingForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = isFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved && !ended);

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);
  useEffect(() => {
    if (ended) router.dismissTo({ pathname: "/subject-mappings", params: { classId: classId ?? "" } });
  }, [ended, classId]);

  const classes = trpc.academic.class.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) },
  );
  const subjects = trpc.subject.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) },
  );
  const subjectName = (id: string) =>
    (subjects.data ?? []).find((candidate) => candidate.id === id)?.name ?? null;
  const className = (id: string) =>
    (classes.data ?? []).find((candidate) => candidate.id === id)?.name ?? null;

  const utils = trpc.useUtils();
  const create = trpc.assignment.subjectMapping.create.useMutation();
  const update = trpc.assignment.subjectMapping.update.useMutation();
  const end = trpc.assignment.subjectMapping.end.useMutation();
  const pending = create.isPending || update.isPending || end.isPending;

  const set = (field: keyof MappingForm, value: MappingForm[keyof MappingForm]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: keyof MappingForm) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: keyof MappingForm) =>
    touched.has(field) || submitted ? errors[field] : undefined;

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors) return;
    try {
      if (row) {
        await update.mutateAsync({
          organizationId,
          id: row.id,
          data: mappingUpdatePayload(form),
        });
      } else {
        if (!academicYearId || !classId || !schoolId) {
          setSaveError(
            new Error(schoolId ? copy.academic.noSessionBody : copy.students.noOrgBody),
          );
          return;
        }
        await create.mutateAsync({
          organizationId,
          schoolId,
          ...mappingCreatePayload(form, { academicYearId, classId }),
        });
      }
      await utils.assignment.subjectMapping.list.invalidate();
      setSaved(true);
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
      setEnded(true);
    } catch (error) {
      setEndError(error);
    } finally {
      setEnding(false);
    }
  };

  return (
    <ScreenFrame
      title={editing ? copy.academic.mappings.editTitle : copy.academic.mappings.addTitle}
      backAccessibilityLabel={copy.common.back}
      backTestID="mapping-form-back"
      footer={
        canWrite ? (
          <>
            {saveError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(saveError).message}
                testID="mapping-save-error"
              />
            ) : submitted && hasErrors ? (
              <Notice
                tone="critical"
                message={copy.forms.invalidSummary}
                testID="mapping-invalid"
              />
            ) : null}
            <CapsuleButton
              title={editing ? copy.academic.save : copy.academic.mappings.add}
              icon="check"
              onPress={() => void submit()}
              loading={update.isPending || create.isPending}
              disabled={pending}
              testID="mapping-save"
              style={styles.save}
            />
          </>
        ) : undefined
      }
    >
      <SectionLabel>{copy.academic.mappings.title}</SectionLabel>
      <Card style={styles.card}>
        {editing ? (
          <>
            <FormField
              label={copy.academic.sections.fields.class}
              value={(row ? className(row.classId) : null) ?? ""}
              onChangeText={() => {}}
              editable={false}
              testID="mapping-class"
            />
            <FormField
              label={copy.academic.subjects.title.replace(/s$/, "")}
              value={(row ? subjectName(row.subjectId) : null) ?? ""}
              onChangeText={() => {}}
              help={copy.academic.mappings.subjectLockedNote}
              editable={false}
              testID="mapping-subject"
            />
          </>
        ) : (
          <>
            <FormField
              label={copy.academic.sections.fields.class}
              value={classId ? (className(classId) ?? "") : ""}
              onChangeText={() => {}}
              editable={false}
              testID="mapping-class"
            />
            <SelectField
              label={copy.academic.subjects.title.replace(/s$/, "")}
              valueLabel={form.subjectId ? subjectName(form.subjectId) : null}
              placeholder={copy.academic.mappings.errors.subject.replace(
                ".",
                "",
              )}
              options={(subjects.data ?? []).map((candidate) => ({
                id: candidate.id,
                label: candidate.name,
              }))}
              currentId={form.subjectId ?? ""}
              onSelect={(subjectId) => {
                set("subjectId", subjectId || null);
                touch("subjectId");
              }}
              error={fieldError("subjectId")}
              disabled={!canWrite}
              testID="mapping-subject"
            />
          </>
        )}
        <SelectField
          label={copy.academic.mappings.elective}
          valueLabel={form.isElective ? "Yes" : "No"}
          placeholder="No"
          options={[
            { id: "no", label: "No" },
            { id: "yes", label: "Yes" },
          ]}
          currentId={form.isElective ? "yes" : "no"}
          onSelect={(choice) => set("isElective", choice === "yes")}
          help={copy.academic.mappings.electiveHelp}
          disabled={!canWrite}
          testID="mapping-elective"
        />
        <FormField
          label={copy.academic.mappings.sequence}
          value={form.sequence}
          onChangeText={(sequence) => set("sequence", sequence.replace(/[^\d]/g, ""))}
          onBlur={() => touch("sequence")}
          help={copy.academic.mappings.sequenceHelp}
          error={fieldError("sequence")}
          keyboardType="number-pad"
          maxLength={3}
          editable={canWrite}
          testID="mapping-sequence"
        />
      </Card>

      {row && canEnd ? (
        <View style={styles.retire}>
          <Notice
            tone="caution"
            title={copy.academic.mappings.endNoticeTitle}
            message={copy.academic.mappings.endNoticeBody}
          >
            <CapsuleButton
              title={copy.academic.mappings.endAction}
              variant="destructive"
              size="compact"
              onPress={confirmEnd}
              loading={ending}
              disabled={pending}
              testID="mapping-end"
            />
          </Notice>
          {endError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(endError).message}
              testID="mapping-end-error"
              style={styles.endError}
            />
          ) : null}
        </View>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  save: {
    alignSelf: "stretch",
  },
  retire: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  endError: {
    backgroundColor: colors.tone.critical.bg,
  },
});
