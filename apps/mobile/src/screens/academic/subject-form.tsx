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
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import {
  isFormDirty,
  subjectFormFrom,
  subjectPayload,
  validateSubjectForm,
  type SubjectForm,
} from "./form-logic";
import { AcademicFormGates } from "./form-frame";

type SubjectRow = inferRouterOutputs<AppRouter>["subject"]["byId"];

/** Add or edit a subject. */
export function SubjectFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(id);
  const canRead = has("subject:read");
  const canWrite = editing ? has("subject:update") : has("subject:create");
  const canDelete = editing && has("subject:delete");
  const allowed = canRead && (canWrite || canDelete);

  const subjectQuery = trpc.subject.byId.useQuery(
    { organizationId: organizationId ?? "", id: id ?? "" },
    { enabled: ready && Boolean(organizationId) && editing && canRead, gcTime: 0 },
  );

  return (
    <AcademicFormGates
      title={editing ? copy.academic.subjects.editTitle : copy.academic.subjects.addTitle}
      ready={ready}
      hasOrg={Boolean(organizationId)}
      allowed={allowed}
      deniedTitle={copy.academic.denied.subjectsWriteTitle}
      deniedPermission={editing ? "subject:update" : "subject:create"}
      editing={editing}
      editPending={subjectQuery.isPending}
      editError={subjectQuery.error ?? null}
      editMissing={editing && !subjectQuery.isPending && !subjectQuery.data}
      onRetryEdit={() => void subjectQuery.refetch()}
      backTestID="subject-form-back"
    >
      <SubjectFormBody
        organizationId={organizationId ?? ""}
        schoolId={schoolId}
        row={subjectQuery.data ?? null}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    </AcademicFormGates>
  );
}

function SubjectFormBody({
  organizationId,
  schoolId,
  row,
  canWrite,
  canDelete,
}: {
  organizationId: string;
  schoolId: string | null;
  row: SubjectRow | null;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const editing = Boolean(row);
  const [initial] = useState<SubjectForm>(() =>
    row ? subjectFormFrom(row) : { name: "", shortName: "", code: "" },
  );
  const [form, setForm] = useState<SubjectForm>(initial);
  const [touched, setTouched] = useState<Set<keyof SubjectForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deactivateError, setDeactivateError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [deactivated, setDeactivated] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const errors = useMemo(() => validateSubjectForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = isFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved && !deactivated);

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);
  useEffect(() => {
    if (deactivated) router.dismissTo("/subjects");
  }, [deactivated]);

  const utils = trpc.useUtils();
  const create = trpc.subject.create.useMutation();
  const update = trpc.subject.update.useMutation();
  const deactivate = trpc.subject.deactivate.useMutation();
  const pending = create.isPending || update.isPending || deactivate.isPending;

  const set = (field: keyof SubjectForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: keyof SubjectForm) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: keyof SubjectForm) =>
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
          data: subjectPayload(form),
        });
      } else {
        if (!schoolId) {
          setSaveError(new Error(copy.students.noOrgBody));
          return;
        }
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: subjectPayload(form),
        });
      }
      await utils.subject.list.invalidate();
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
          onPress: () => void deactivateSubject(row.id),
        },
      ],
    );
  };

  const deactivateSubject = async (id: string) => {
    setDeactivateError(null);
    setDeactivating(true);
    try {
      await deactivate.mutateAsync({ organizationId, id });
      await utils.subject.list.invalidate();
      setDeactivated(true);
    } catch (error) {
      setDeactivateError(error);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <ScreenFrame
      title={editing ? copy.academic.subjects.editTitle : copy.academic.subjects.addTitle}
      backAccessibilityLabel={copy.common.back}
      backTestID="subject-form-back"
      footer={
        canWrite ? (
          <>
            {saveError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(saveError).message}
                testID="subject-save-error"
              />
            ) : submitted && hasErrors ? (
              <Notice
                tone="critical"
                message={copy.forms.invalidSummary}
                testID="subject-invalid"
              />
            ) : null}
            <CapsuleButton
              title={editing ? copy.academic.save : copy.academic.subjects.add}
              icon="check"
              onPress={() => void submit()}
              loading={update.isPending || create.isPending}
              disabled={pending}
              testID="subject-save"
              style={styles.save}
            />
          </>
        ) : undefined
      }
    >
      <SectionLabel>{copy.academic.subjects.title}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.academic.subjects.fields.name}
          value={form.name}
          onChangeText={(name) => set("name", name)}
          onBlur={() => touch("name")}
          help={copy.academic.subjects.fields.nameHelp}
          error={fieldError("name")}
          autoCapitalize="words"
          editable={canWrite}
          testID="subject-name"
        />
        <FormField
          label={copy.academic.subjects.fields.shortName}
          value={form.shortName}
          onChangeText={(shortName) => set("shortName", shortName)}
          help={copy.academic.subjects.fields.shortNameHelp}
          autoCapitalize="words"
          maxLength={20}
          editable={canWrite}
          testID="subject-short-name"
        />
        <FormField
          label={copy.academic.subjects.fields.code}
          value={form.code}
          onChangeText={(code) => set("code", code)}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          editable={canWrite}
          testID="subject-code"
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
              testID="subject-deactivate"
            />
          </Notice>
          {deactivateError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(deactivateError).message}
              testID="subject-deactivate-error"
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
