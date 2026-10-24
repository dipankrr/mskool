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

type ClassRow = inferRouterOutputs<AppRouter>["academic"]["class"]["list"][number];

type ClassForm = { name: string; order: string; description: string };

function classFormFrom(row: ClassRow): ClassForm {
  return {
    name: row.name,
    order: String(row.numericOrder),
    description: row.description ?? "",
  };
}

const CLASS_ERRORS = copy.academic.classes.errors;

function validateClassForm(form: ClassForm): Partial<Record<keyof ClassForm, string>> {
  const errors: Partial<Record<keyof ClassForm, string>> = {};
  const name = form.name.trim();
  if (name.length < 1 || name.length > 100) errors.name = CLASS_ERRORS.name;
  const order = form.order.trim();
  if (!/^-?\d+$/.test(order) || Number(order) < -10 || Number(order) > 20) {
    errors.order = CLASS_ERRORS.order;
  }
  return errors;
}

function classPayload(form: ClassForm) {
  const description = form.description.trim();
  return {
    name: form.name.trim(),
    numericOrder: Number(form.order.trim()),
    ...(description ? { description } : {}),
  };
}

/**
 * The school's classes (Step 2 rework): add and edit live in a bottom sheet —
 * a three-field form never earns a pushed screen — with a saved banner on the
 * way out. The sheet body mounts fresh per open, so its initialisers always
 * read the row's current truth.
 */
export function ClassesScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("class:read");
  const canCreate = has("class:create");
  const canUpdate = has("class:update");
  const canDelete = has("class:delete");
  const canOpen = canUpdate || canDelete;

  const list = trpc.academic.class.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
    },
    { enabled: ready && Boolean(organizationId) && canRead },
  );

  // null = closed; "create" = new row; otherwise the row's id.
  const [sheet, setSheet] = useState<string | "create" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  const classes = list.data ?? [];
  const editing =
    sheet && sheet !== "create"
      ? classes.find((row) => row.id === sheet) ?? null
      : null;

  const closeSheet = () => setSheet(null);
  const savedAndClosed = (message: string) => {
    setSheet(null);
    setSaved(message);
  };

  const addAction =
    canRead && canCreate
      ? {
          label: copy.academic.classes.add,
          icon: "add" as const,
          onPress: () => setSheet("create"),
          accessibilityHint: copy.academic.classes.addHint,
          testID: "classes-add",
        }
      : undefined;

  return (
    <AcademicListFrame
      title={copy.academic.classes.title}
      meta={branchName}
      canRead={canRead}
      deniedTitle={copy.academic.denied.classesReadTitle}
      deniedPermission="class:read"
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={list.isPending}
      error={list.error ?? null}
      onRetry={() => void list.refetch()}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      isEmpty={classes.length === 0}
      emptyTitle={copy.academic.classes.emptyTitle}
      emptyBody={copy.academic.classes.emptyBody}
      emptyIcon="stack"
      emptyAction={
        canCreate ? (
          <CapsuleButton
            title={copy.academic.classes.add}
            icon="add"
            onPress={() => setSheet("create")}
            testID="classes-empty-add"
          />
        ) : null
      }
      action={addAction}
      titleTestID="classes-title"
    >
      {saved ? (
        <Notice tone="positive" message={saved} testID="classes-saved" />
      ) : null}
      {classes.map((row) => (
        <EntityCard
          key={row.id}
          title={row.name}
          meta={[copy.academic.classes.meta(row.numericOrder), row.description]
            .filter(Boolean)
            .join(" · ")}
          icon="stack"
          onPress={canOpen ? () => setSheet(row.id) : undefined}
          accessibilityHint={canOpen ? copy.academic.classes.openHint : undefined}
          testID={`class-card-${row.id}`}
        />
      ))}

      {sheet !== null ? (
        <ClassSheetBody
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

function ClassSheetBody({
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
  row: ClassRow | null;
  canWrite: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(row);
  const [form, setForm] = useState<ClassForm>(() =>
    row ? classFormFrom(row) : { name: "", order: "", description: "" },
  );
  const [touched, setTouched] = useState<Set<keyof ClassForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deactivating, setDeactivating] = useState(false);

  const errors = useMemo(() => validateClassForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  const utils = trpc.useUtils();
  const create = trpc.academic.class.create.useMutation();
  const update = trpc.academic.class.update.useMutation();
  const deactivate = trpc.academic.class.deactivate.useMutation();
  const pending = create.isPending || update.isPending || deactivating;

  const set = (field: keyof ClassForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };
  const touch = (field: keyof ClassForm) =>
    setTouched((current) => new Set(current).add(field));
  const fieldError = (field: keyof ClassForm) =>
    touched.has(field) || submitted ? errors[field] : undefined;

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors || !schoolId) return;
    try {
      if (row) {
        await update.mutateAsync({
          organizationId,
          id: row.id,
          data: classPayload(form),
        });
      } else {
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: classPayload(form),
        });
      }
      await utils.academic.class.list.invalidate();
      onSaved(copy.rework.class);
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
        onPress: () => void deactivateClass(row.id),
      },
    ]);
  };

  const deactivateClass = async (id: string) => {
    setSaveError(null);
    setDeactivating(true);
    try {
      await deactivate.mutateAsync({ organizationId, id });
      await utils.academic.class.list.invalidate();
      onSaved(copy.academic.retire.noticeTitle);
    } catch (error) {
      setSaveError(error);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <FormSheet
      title={editing ? copy.academic.classes.editTitle : copy.academic.classes.addTitle}
      onClose={onClose}
      testIDPrefix="class-sheet"
      scroll={
        <>
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
                disabled={pending}
                testID="class-deactivate"
              />
            </Notice>
          ) : null}
        </>
      }
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="class-save-error"
            />
          ) : submitted && hasErrors ? (
            <Notice tone="critical" message={copy.forms.invalidSummary} />
          ) : null}
          {canWrite ? (
            <CapsuleButton
              title={editing ? copy.academic.save : copy.academic.classes.add}
              icon="check"
              onPress={() => void submit()}
              loading={update.isPending || create.isPending}
              disabled={pending}
              testID="class-save"
            />
          ) : null}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  retire: {
    marginTop: spacing.lg,
  },
});
