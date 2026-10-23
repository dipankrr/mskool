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
  emptySectionForm,
  isFormDirty,
  sectionFormFrom,
  sectionPayload,
  sectionUpdatePayload,
  validateSectionForm,
  type SectionForm,
  type SectionShift,
} from "./form-logic";
import { AcademicFormGates } from "./form-frame";

type SectionRow = inferRouterOutputs<AppRouter>["academic"]["section"]["byId"];

const SHIFTS = ["morning", "day", "evening"] as const;

/**
 * Add or edit a section of the running session. The section's class and
 * session are not patchable — moving one would relocate every student,
 * attendance record and result attached to it (ADR-015) — so edit shows the
 * class locked with that reason.
 */
export function SectionFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(id);
  const canRead = has("section:read");
  const canWrite = editing ? has("section:update") : has("section:create");
  const canDelete = editing && has("section:delete");
  const allowed = canRead && (canWrite || canDelete);

  const sectionQuery = trpc.academic.section.byId.useQuery(
    { organizationId: organizationId ?? "", id: id ?? "" },
    { enabled: ready && Boolean(organizationId) && editing && canRead, gcTime: 0 },
  );

  return (
    <AcademicFormGates
      title={editing ? copy.academic.sections.editTitle : copy.academic.sections.addTitle}
      ready={ready}
      hasOrg={Boolean(organizationId)}
      allowed={allowed}
      deniedTitle={copy.academic.denied.sectionsWriteTitle}
      deniedPermission={editing ? "section:update" : "section:create"}
      editing={editing}
      editPending={sectionQuery.isPending}
      editError={sectionQuery.error ?? null}
      editMissing={editing && !sectionQuery.isPending && !sectionQuery.data}
      onRetryEdit={() => void sectionQuery.refetch()}
      backTestID="section-form-back"
    >
      <SectionFormBody
        organizationId={organizationId ?? ""}
        schoolId={schoolId}
        academicYearId={academicYear?.id ?? null}
        row={sectionQuery.data ?? null}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    </AcademicFormGates>
  );
}

function SectionFormBody({
  organizationId,
  schoolId,
  academicYearId,
  row,
  canWrite,
  canDelete,
}: {
  organizationId: string;
  /** Create's addressed parent — the gate covers `section:create` at this node. */
  schoolId: string | null;
  academicYearId: string | null;
  row: SectionRow | null;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const editing = Boolean(row);
  const [initial] = useState<SectionForm>(() =>
    row
      ? sectionFormFrom(row)
      : emptySectionForm(),
  );
  const [form, setForm] = useState<SectionForm>(initial);
  const [touched, setTouched] = useState<Set<keyof SectionForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deactivateError, setDeactivateError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [deactivated, setDeactivated] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const errors = useMemo(() => validateSectionForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = isFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved && !deactivated);

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);
  useEffect(() => {
    if (deactivated) router.dismissTo("/sections");
  }, [deactivated]);

  const classes = trpc.academic.class.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) },
  );
  const className = (id: string) =>
    (classes.data ?? []).find((candidate) => candidate.id === id)?.name ?? null;

  const utils = trpc.useUtils();
  const create = trpc.academic.section.create.useMutation();
  const update = trpc.academic.section.update.useMutation();
  const deactivate = trpc.academic.section.deactivate.useMutation();
  const pending = create.isPending || update.isPending || deactivate.isPending;

  const set = (field: keyof SectionForm, value: SectionForm[keyof SectionForm]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: keyof SectionForm) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: keyof SectionForm) =>
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
          data: sectionUpdatePayload(form),
        });
      } else {
        if (!academicYearId || !schoolId) {
          setSaveError(
            new Error(schoolId ? copy.academic.noSessionBody : copy.students.noOrgBody),
          );
          return;
        }
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: sectionPayload(form, academicYearId),
        });
      }
      await utils.academic.section.list.invalidate();
      setSaved(true);
    } catch (error) {
      setSaveError(error);
    }
  };

  const confirmDeactivate = () => {
    if (!row) return;
    Alert.alert(
      copy.academic.retire.confirmTitle,
      copy.academic.retire.confirmBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.academic.retire.confirm,
          style: "destructive",
          onPress: () => void deactivateSection(row.id),
        },
      ],
    );
  };

  const deactivateSection = async (id: string) => {
    setDeactivateError(null);
    setDeactivating(true);
    try {
      await deactivate.mutateAsync({ organizationId, id });
      await utils.academic.section.list.invalidate();
      setDeactivated(true);
    } catch (error) {
      setDeactivateError(error);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <ScreenFrame
      title={editing ? copy.academic.sections.editTitle : copy.academic.sections.addTitle}
      backAccessibilityLabel={copy.common.back}
      backTestID="section-form-back"
      footer={
        canWrite ? (
          <>
            {saveError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(saveError).message}
                testID="section-save-error"
              />
            ) : submitted && hasErrors ? (
              <Notice
                tone="critical"
                message={copy.forms.invalidSummary}
                testID="section-invalid"
              />
            ) : null}
            <CapsuleButton
              title={editing ? copy.academic.save : copy.academic.sections.add}
              icon="check"
              onPress={() => void submit()}
              loading={update.isPending || create.isPending}
              disabled={pending}
              testID="section-save"
              style={styles.save}
            />
          </>
        ) : undefined
      }
    >
      <SectionLabel>{copy.academic.sections.title}</SectionLabel>
      <Card style={styles.card}>
        {editing ? (
          <>
            <FormField
              label={copy.academic.sections.fields.class}
              value={(row ? className(row.classId) : null) ?? ""}
              onChangeText={() => {}}
              help={copy.academic.sections.classLockedNote}
              editable={false}
              testID="section-class"
            />
          </>
        ) : (
          <SelectField
            label={copy.academic.sections.fields.class}
            valueLabel={
              form.classId ? className(form.classId) : null
            }
            placeholder={copy.academic.sections.fields.class}
            options={(classes.data ?? []).map((candidate) => ({
              id: candidate.id,
              label: candidate.name,
            }))}
            currentId={form.classId ?? ""}
            onSelect={(classId) => {
              set("classId", classId || null);
              touch("classId");
            }}
            error={fieldError("classId")}
            disabled={!canWrite}
            testID="section-class"
          />
        )}
        <FormField
          label={copy.academic.sections.fields.name}
          value={form.name}
          onChangeText={(name) => set("name", name)}
          onBlur={() => touch("name")}
          help={copy.academic.sections.fields.nameHelp}
          error={fieldError("name")}
          autoCapitalize="characters"
          editable={canWrite}
          testID="section-name"
        />
        <SelectField
          label={copy.academic.sections.fields.shift}
          valueLabel={form.shift ? copy.academic.sections.shifts[form.shift] : null}
          placeholder={copy.academic.sections.shifts.none}
          options={[
            { id: "", label: copy.academic.sections.shifts.none },
            ...SHIFTS.map((shift) => ({
              id: shift,
              label: copy.academic.sections.shifts[shift],
            })),
          ]}
          currentId={form.shift ?? ""}
          onSelect={(shift) => set("shift", (shift || null) as SectionShift | null)}
          disabled={!canWrite}
          testID="section-shift"
        />
        <FormField
          label={copy.academic.sections.fields.room}
          value={form.roomNumber}
          onChangeText={(roomNumber) => set("roomNumber", roomNumber)}
          autoCapitalize="characters"
          maxLength={20}
          editable={canWrite}
          testID="section-room"
        />
        <FormField
          label={copy.academic.sections.fields.maxStudents}
          value={form.maxStudents}
          onChangeText={(maxStudents) =>
            set("maxStudents", maxStudents.replace(/\D/g, ""))
          }
          onBlur={() => touch("maxStudents")}
          error={fieldError("maxStudents")}
          keyboardType="number-pad"
          maxLength={3}
          editable={canWrite}
          testID="section-capacity"
        />
        <FormField
          label={copy.academic.sections.fields.stream}
          value={form.stream}
          onChangeText={(stream) => set("stream", stream)}
          autoCapitalize="words"
          maxLength={50}
          editable={canWrite}
          testID="section-stream"
        />
        <FormField
          label={copy.academic.sections.fields.house}
          value={form.house}
          onChangeText={(house) => set("house", house)}
          autoCapitalize="words"
          maxLength={50}
          editable={canWrite}
          testID="section-house"
        />
      </Card>

      {row && canDelete ? (
        <View style={styles.retire}>
          <Notice
            tone="caution"
            title={`${copy.academic.retire.noticeTitle} — ${row.name}`}
            message={copy.academic.retire.noticeBody}
          >
            <CapsuleButton
              title={copy.academic.retire.action}
              variant="destructive"
              size="compact"
              onPress={confirmDeactivate}
              loading={deactivating}
              disabled={pending}
              testID="section-deactivate"
            />
          </Notice>
          {deactivateError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(deactivateError).message}
              testID="section-deactivate-error"
              style={styles.deactivateError}
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
  deactivateError: {
    backgroundColor: colors.tone.critical.bg,
  },
});
