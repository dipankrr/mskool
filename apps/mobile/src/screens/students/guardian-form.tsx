import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { GuardianView } from "@repo/contracts";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import {
  GUARDIAN_RELATIONS,
  emptyGuardianForm,
  guardianFormFrom,
  guardianPayload,
  validateGuardianForm,
  type GuardianForm,
} from "./people-logic";

/**
 * Add, correct, or detach a guardian (Step 2 chunk C). Saving a portal-enabled
 * phone ensures the family's link server-side — the UI never calls the portal
 * endpoints for this, and never sees a password (ADR-037).
 */
export function GuardianFormScreen() {
  const { studentId, guardianId } = useLocalSearchParams<{
    studentId?: string;
    guardianId?: string;
  }>();
  const { organizationId, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(guardianId);
  const canRead = has("student:read");
  const canWrite = has("student:update");
  const allowed = canRead && canWrite;

  const guardiansQuery = trpc.guardian.list.useQuery(
    { organizationId: organizationId ?? "", id: studentId ?? "" },
    {
      enabled: ready && Boolean(organizationId) && editing && canRead,
      gcTime: 0,
    },
  );
  const row = editing
    ? (guardiansQuery.data ?? []).find(
        (candidate) => candidate.id === guardianId,
      ) ?? null
    : null;

  const title = editing
    ? copy.people.guardians.editTitle
    : copy.people.guardians.addTitle;

  const gated = (
    <ScreenFrame
      title={title}
      backAccessibilityLabel={copy.common.back}
      backTestID="guardian-form-back"
    >
      <Skeleton height={220} />
    </ScreenFrame>
  );

  if (!ready || !organizationId) return gated;
  if (!allowed) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="guardian-form-back"
      >
        <EmptyState
          icon="shield"
          title={copy.denied.studentsWriteTitle}
          message={copy.denied.studentsWriteBody}
          testID="guardian-form-denied"
        />
      </ScreenFrame>
    );
  }
  if (editing && guardiansQuery.isPending) return gated;
  if (editing && !row) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="guardian-form-back"
      >
        <Notice
          tone="critical"
          message={copy.errors.notFound}
          testID="guardian-form-missing"
        />
      </ScreenFrame>
    );
  }

  return (
    <GuardianFormBody
      organizationId={organizationId}
      studentId={studentId ?? null}
      guardianId={guardianId ?? null}
      row={row}
    />
  );
}

// Imported with the components above; the gate ladder stays readable.

function GuardianFormBody({
  organizationId,
  studentId,
  guardianId,
  row,
}: {
  organizationId: string;
  studentId: string | null;
  guardianId: string | null;
  row: GuardianView | null;
}) {
  const editing = Boolean(row);
  const view = row;
  const [initial] = useState<GuardianForm>(() =>
    view ? guardianFormFrom(view) : emptyGuardianForm(),
  );
  const [form, setForm] = useState<GuardianForm>(initial);
  const [touched, setTouched] = useState<Set<keyof GuardianForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [detachError, setDetachError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [detached, setDetached] = useState(false);
  const [detaching, setDetaching] = useState(false);

  const errors = useMemo(() => validateGuardianForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = form !== initial;
  useUnsavedChanges((dirty && !saved) && !detached);

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);
  useEffect(() => {
    if (detached) router.dismissTo("/students");
  }, [detached]);

  const utils = trpc.useUtils();
  const add = trpc.guardian.add.useMutation();
  const update = trpc.guardian.update.useMutation();
  const detach = trpc.guardian.detach.useMutation();
  const pending = add.isPending || update.isPending || detach.isPending;

  const set = (field: keyof GuardianForm, value: GuardianForm[keyof GuardianForm]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: keyof GuardianForm) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: keyof GuardianForm) =>
    touched.has(field) || submitted ? errors[field] : undefined;

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors || !studentId) return;
    try {
      if (view) {
        await update.mutateAsync({
          organizationId,
          id: studentId,
          guardianId: view.id,
          ...guardianPayload(form),
        });
      } else {
        await add.mutateAsync({
          organizationId,
          id: studentId,
          ...guardianPayload(form),
        });
      }
      await utils.guardian.list.invalidate({ id: studentId });
      setSaved(true);
    } catch (error) {
      setSaveError(error);
    }
  };

  const confirmDetach = () => {
    if (!view || !studentId) return;
    Alert.alert(
      copy.people.guardians.detachConfirmTitle,
      copy.people.guardians.detachConfirmBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.people.guardians.detachConfirm,
          style: "destructive",
          onPress: () => void detachGuardian(view.id),
        },
      ],
    );
  };

  const detachGuardian = async (id: string) => {
    if (!studentId) return;
    setDetachError(null);
    setDetaching(true);
    try {
      await detach.mutateAsync({ organizationId, id: studentId, guardianId: id });
      await utils.guardian.list.invalidate({ id: studentId });
      setDetached(true);
    } catch (error) {
      setDetachError(error);
    } finally {
      setDetaching(false);
    }
  };

  return (
    <ScreenFrame
      title={editing ? copy.people.guardians.editTitle : copy.people.guardians.addTitle}
      backAccessibilityLabel={copy.common.back}
      backTestID="guardian-form-back"
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="guardian-save-error"
            />
          ) : submitted && hasErrors ? (
            <Notice
              tone="critical"
              message={copy.forms.invalidSummary}
              testID="guardian-invalid"
            />
          ) : null}
          <CapsuleButton
            title={editing ? copy.people.guardians.save : copy.people.guardians.add}
            icon="check"
            onPress={() => void submit()}
            loading={add.isPending || update.isPending}
            disabled={pending}
            testID="guardian-save"
            style={styles.save}
          />
        </>
      }
    >
      <SectionLabel>{copy.people.guardians.formTitle}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.people.guardians.fields.firstName}
          value={form.firstName}
          onChangeText={(firstName) => set("firstName", firstName)}
          onBlur={() => touch("firstName")}
          error={fieldError("firstName")}
          autoCapitalize="words"
          testID="guardian-first-name"
        />
        <FormField
          label={copy.people.guardians.fields.lastName}
          value={form.lastName}
          onChangeText={(lastName) => set("lastName", lastName)}
          autoCapitalize="words"
          testID="guardian-last-name"
        />
        <SelectField
          label={copy.people.guardians.fields.relation}
          valueLabel={form.relation ? copy.students.relations[form.relation] : null}
          placeholder={copy.people.guardians.fields.relation}
          options={GUARDIAN_RELATIONS.map((relation) => ({
            id: relation,
            label: copy.students.relations[relation],
          }))}
          currentId={form.relation ?? ""}
          onSelect={(relation) => {
            set("relation", (relation || null) as GuardianForm["relation"]);
            touch("relation");
          }}
          error={fieldError("relation")}
          testID="guardian-relation"
        />
        <FormField
          label={copy.people.guardians.fields.phone}
          value={form.phone}
          onChangeText={(phone) => set("phone", phone.replace(/\D/g, ""))}
          onBlur={() => touch("phone")}
          help={copy.people.guardians.fields.phoneHelp}
          error={fieldError("phone")}
          keyboardType="phone-pad"
          maxLength={10}
          testID="guardian-phone"
        />
        <SelectField
          label={copy.people.guardians.fields.primary}
          valueLabel={form.isPrimary ? "Yes" : "No"}
          placeholder="No"
          options={[
            { id: "no", label: "No" },
            { id: "yes", label: "Yes" },
          ]}
          currentId={form.isPrimary ? "yes" : "no"}
          onSelect={(choice) => set("isPrimary", choice === "yes")}
          testID="guardian-primary"
        />
        <SelectField
          label={copy.people.guardians.fields.emergency}
          valueLabel={form.isEmergencyContact ? "Yes" : "No"}
          placeholder="No"
          options={[
            { id: "no", label: "No" },
            { id: "yes", label: "Yes" },
          ]}
          currentId={form.isEmergencyContact ? "yes" : "no"}
          onSelect={(choice) => set("isEmergencyContact", choice === "yes")}
          testID="guardian-emergency"
        />
        <SelectField
          label={copy.people.guardians.fields.portal}
          valueLabel={form.canAccessPortal ? "Yes" : "No"}
          placeholder="Yes"
          options={[
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ]}
          currentId={form.canAccessPortal ? "yes" : "no"}
          onSelect={(choice) => set("canAccessPortal", choice === "yes")}
          help={copy.people.guardians.fields.portalHelp}
          testID="guardian-portal"
        />
      </Card>

      {view ? (
        <View style={styles.detach}>
          <Notice
            tone="caution"
            title={copy.people.guardians.detachTitle}
            message={copy.people.guardians.detachBody}
          >
            <CapsuleButton
              title={copy.people.guardians.detachAction}
              variant="destructive"
              size="compact"
              onPress={confirmDetach}
              loading={detaching}
              disabled={pending}
              testID="guardian-detach"
            />
          </Notice>
          {detachError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(detachError).message}
              testID="guardian-detach-error"
              style={styles.detachError}
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
  detach: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  detachError: {
    backgroundColor: colors.tone.critical.bg,
  },
});
