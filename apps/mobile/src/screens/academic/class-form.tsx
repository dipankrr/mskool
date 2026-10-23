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
  classFormFrom,
  classPayload,
  isFormDirty,
  validateClassForm,
  type ClassForm,
} from "./form-logic";
import { AcademicFormGates } from "./form-frame";

type ClassRow = inferRouterOutputs<AppRouter>["academic"]["class"]["byId"];

/**
 * Add or edit a class. The order field is the list's sort key; negatives are
 * pre-primary (Nursery −3, LKG −2, UKG −1). Closing is one-way in this UI —
 * `class.list` is active-only — which the retire notice says.
 */
export function ClassFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(id);
  const canRead = has("class:read");
  const canWrite = editing ? has("class:update") : has("class:create");
  const canDelete = editing && has("class:delete");
  const allowed = canRead && (canWrite || canDelete);

  const classQuery = trpc.academic.class.byId.useQuery(
    { organizationId: organizationId ?? "", id: id ?? "" },
    { enabled: ready && Boolean(organizationId) && editing && canRead, gcTime: 0 },
  );

  return (
    <AcademicFormGates
      title={editing ? copy.academic.classes.editTitle : copy.academic.classes.addTitle}
      ready={ready}
      hasOrg={Boolean(organizationId)}
      allowed={allowed}
      deniedTitle={copy.academic.denied.classesWriteTitle}
      deniedPermission={editing ? "class:update" : "class:create"}
      editing={editing}
      editPending={classQuery.isPending}
      editError={classQuery.error ?? null}
      editMissing={editing && !classQuery.isPending && !classQuery.data}
      onRetryEdit={() => void classQuery.refetch()}
      backTestID="class-form-back"
    >
      <ClassFormBody
        organizationId={organizationId ?? ""}
        schoolId={schoolId}
        row={classQuery.data ?? null}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    </AcademicFormGates>
  );
}

function ClassFormBody({
  organizationId,
  schoolId,
  row,
  canWrite,
  canDelete,
}: {
  organizationId: string;
  /** Create's addressed parent — a class hangs off a school. */
  schoolId: string | null;
  row: ClassRow | null;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const editing = Boolean(row);
  const [initial] = useState<ClassForm>(() =>
    row ? classFormFrom(row) : { name: "", order: "", description: "" },
  );
  const [form, setForm] = useState<ClassForm>(initial);
  const [touched, setTouched] = useState<Set<keyof ClassForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deactivateError, setDeactivateError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [deactivated, setDeactivated] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const errors = useMemo(() => validateClassForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = isFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved && !deactivated);

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);
  useEffect(() => {
    if (deactivated) router.dismissTo("/classes");
  }, [deactivated]);

  const utils = trpc.useUtils();
  const create = trpc.academic.class.create.useMutation();
  const update = trpc.academic.class.update.useMutation();
  const deactivate = trpc.academic.class.deactivate.useMutation();
  const pending = create.isPending || update.isPending || deactivate.isPending;

  const set = (field: keyof ClassForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: keyof ClassForm) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: keyof ClassForm) =>
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
          data: classPayload(form),
        });
      } else {
        if (!schoolId) {
          setSaveError(new Error(copy.students.noOrgBody));
          return;
        }
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: classPayload(form),
        });
      }
      await utils.academic.class.list.invalidate();
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
          onPress: () => void deactivateClass(row.id),
        },
      ],
    );
  };

  const deactivateClass = async (id: string) => {
    setDeactivateError(null);
    setDeactivating(true);
    try {
      await deactivate.mutateAsync({ organizationId, id });
      await utils.academic.class.list.invalidate();
      setDeactivated(true);
    } catch (error) {
      setDeactivateError(error);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <ScreenFrame
      title={editing ? copy.academic.classes.editTitle : copy.academic.classes.addTitle}
      backAccessibilityLabel={copy.common.back}
      backTestID="class-form-back"
      footer={
        canWrite ? (
          <>
            {saveError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(saveError).message}
                testID="class-save-error"
              />
            ) : submitted && hasErrors ? (
              <Notice
                tone="critical"
                message={copy.forms.invalidSummary}
                testID="class-invalid"
              />
            ) : null}
            <CapsuleButton
              title={editing ? copy.academic.save : copy.academic.classes.add}
              icon="check"
              onPress={() => void submit()}
              loading={update.isPending || create.isPending}
              disabled={pending}
              testID="class-save"
              style={styles.save}
            />
          </>
        ) : undefined
      }
    >
      <SectionLabel>{copy.academic.classes.title}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.academic.classes.fields.name}
          value={form.name}
          onChangeText={(name) => set("name", name)}
          onBlur={() => touch("name")}
          help={copy.academic.classes.fields.nameHelp}
          error={fieldError("name")}
          autoCapitalize="words"
          editable={canWrite}
          testID="class-name"
        />
        <FormField
          label={copy.academic.classes.fields.order}
          value={form.order}
          onChangeText={(order) => set("order", order.replace(/[^\d-]/g, ""))}
          onBlur={() => touch("order")}
          help={copy.academic.classes.fields.orderHelp}
          error={fieldError("order")}
          autoCorrect={false}
          maxLength={4}
          editable={canWrite}
          testID="class-order"
        />
        <FormField
          label={copy.academic.classes.fields.description}
          value={form.description}
          onChangeText={(description) => set("description", description)}
          autoCapitalize="sentences"
          editable={canWrite}
          testID="class-description"
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
              testID="class-deactivate"
            />
          </Notice>
          {deactivateError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(deactivateError).message}
              testID="class-deactivate-error"
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
