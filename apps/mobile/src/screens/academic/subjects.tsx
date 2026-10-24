import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { EntityCard } from "../../components/entity-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import { AcademicListFrame } from "./list-frame";

type SubjectRow = inferRouterOutputs<AppRouter>["subject"]["list"][number];

type SubjectForm = { name: string; shortName: string; code: string };

function subjectFormFrom(row: SubjectRow): SubjectForm {
  return {
    name: row.name,
    shortName: row.shortName ?? "",
    code: row.code ?? "",
  };
}

function validateSubjectForm(form: SubjectForm) {
  const errors: Partial<Record<keyof SubjectForm, string>> = {};
  const name = form.name.trim();
  if (name.length < 1 || name.length > 150) errors.name = copy.academic.subjects.errors.name;
  return errors;
}

function subjectPayload(form: SubjectForm) {
  const shortName = form.shortName.trim();
  const code = form.code.trim();
  return {
    name: form.name.trim(),
    ...(shortName ? { shortName } : {}),
    ...(code ? { code } : {}),
  };
}

/**
 * The school's subjects (Step 2 rework): add/edit in a bottom sheet, mounted
 * fresh per open with a saved banner on the way out.
 */
export function SubjectsScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("subject:read");
  const canCreate = has("subject:create");
  const canUpdate = has("subject:update");
  const canDelete = has("subject:delete");
  const canOpen = canUpdate || canDelete;

  const list = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );

  const [sheet, setSheet] = useState<string | "create" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  const subjects = list.data ?? [];
  const editing =
    sheet && sheet !== "create"
      ? subjects.find((row) => row.id === sheet) ?? null
      : null;

  const closeSheet = () => setSheet(null);
  const savedAndClosed = (message: string) => {
    setSheet(null);
    setSaved(message);
  };

  return (
    <AcademicListFrame
      title={copy.academic.subjects.title}
      meta={branchName}
      canRead={canRead}
      deniedTitle={copy.academic.denied.subjectsReadTitle}
      deniedPermission="subject:read"
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={list.isPending}
      error={list.error ?? null}
      onRetry={() => void list.refetch()}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      isEmpty={subjects.length === 0}
      emptyTitle={copy.academic.subjects.emptyTitle}
      emptyBody={copy.academic.subjects.emptyBody}
      emptyIcon="edit"
      emptyAction={
        canCreate ? (
          <CapsuleButton
            title={copy.academic.subjects.add}
            icon="add"
            onPress={() => setSheet("create")}
            testID="subjects-empty-add"
          />
        ) : null
      }
      action={
        canRead && canCreate
          ? {
              label: copy.academic.subjects.add,
              icon: "add" as const,
              onPress: () => setSheet("create"),
              accessibilityHint: copy.academic.subjects.addHint,
              testID: "subjects-add",
            }
          : undefined
      }
      titleTestID="subjects-title"
    >
      {saved ? (
        <Notice tone="positive" message={saved} testID="subjects-saved" />
      ) : null}
      {subjects.map((row) => (
        <EntityCard
          key={row.id}
          title={row.name}
          meta={[row.shortName, row.code].filter(Boolean).join(" · ") || null}
          icon="edit"
          onPress={canOpen ? () => setSheet(row.id) : undefined}
          accessibilityHint={canOpen ? copy.academic.subjects.openHint : undefined}
          testID={`subject-card-${row.id}`}
        />
      ))}

      {sheet !== null ? (
        <SubjectSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId}
          row={editing}
          canWrite={editing ? canUpdate : canCreate}
          canDelete={Boolean(editing) && canDelete}
          onClose={closeSheet}
          onSaved={savedAndClosed}
        />
      ) : null}
    </AcademicListFrame>
  );
}

function SubjectSheet({
  organizationId,
  schoolId,
  row,
  canWrite,
  canDelete,
  onClose,
  onSaved,
}: {
  organizationId: string;
  schoolId: string | null;
  row: SubjectRow | null;
  canWrite: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(row);
  const [form, setForm] = useState<SubjectForm>(() =>
    row ? subjectFormFrom(row) : { name: "", shortName: "", code: "" },
  );
  const [touched, setTouched] = useState<Set<keyof SubjectForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deactivating, setDeactivating] = useState(false);

  const errors = useMemo(() => validateSubjectForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  const set = (field: keyof SubjectForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };
  const touch = (field: keyof SubjectForm) =>
    setTouched((current) => new Set(current).add(field));
  const fieldError = (field: keyof SubjectForm) =>
    touched.has(field) || submitted ? errors[field] : undefined;

  const utils = trpc.useUtils();
  const create = trpc.subject.create.useMutation();
  const update = trpc.subject.update.useMutation();
  const deactivate = trpc.subject.deactivate.useMutation();

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors || !schoolId) return;
    try {
      if (row) {
        await update.mutateAsync({
          organizationId,
          id: row.id,
          data: subjectPayload(form),
        });
      } else {
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: subjectPayload(form),
        });
      }
      await utils.subject.list.invalidate();
      onSaved(copy.rework.subject);
    } catch (error) {
      setSaveError(error);
    }
  };

  const confirmDeactivate = () => {
    if (!row) return;
    Alert.alert(copy.academic.retire.confirmTitle, copy.academic.retire.confirmBody, [
      { text: copy.common.cancel, style: "cancel" },
      {
        text: copy.academic.retire.confirm,
        style: "destructive",
        onPress: () => void deactivateSubject(row.id),
      },
    ]);
  };

  const deactivateSubject = async (id: string) => {
    setSaveError(null);
    setDeactivating(true);
    try {
      await deactivate.mutateAsync({ organizationId, id });
      await utils.subject.list.invalidate();
      onSaved(copy.academic.retire.noticeTitle);
    } catch (error) {
      setSaveError(error);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <FormSheet
      title={editing ? copy.academic.subjects.editTitle : copy.academic.subjects.addTitle}
      onClose={onClose}
      testIDPrefix="subject-sheet"
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="subject-save-error"
            />
          ) : submitted && hasErrors ? (
            <Notice tone="critical" message={copy.forms.invalidSummary} />
          ) : null}
          {canWrite ? (
            <CapsuleButton
              title={editing ? copy.academic.save : copy.academic.subjects.add}
              icon="check"
              onPress={() => void submit()}
              loading={update.isPending || create.isPending}
              disabled={deactivating}
              testID="subject-save"
            />
          ) : null}
        </>
      }
    >
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

      {row && canDelete ? (
        <Notice
          tone="caution"
          title={`${copy.academic.retire.noticeTitle} — ${row.name}`}
          message={copy.academic.retire.noticeBody}
          style={styles.retire}
        >
          <CapsuleButton
            title={copy.academic.retire.action}
            variant="destructive"
            size="compact"
            onPress={confirmDeactivate}
            loading={deactivating}
            testID="subject-deactivate"
          />
        </Notice>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  retire: {
    marginTop: spacing.lg,
  },
});
