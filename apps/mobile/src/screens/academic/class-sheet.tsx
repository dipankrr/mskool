import { useMemo, useState } from "react";
import { Alert, StyleSheet } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";

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
 * Add or edit a class: a three-field form in a bottom sheet. The body mounts
 * fresh per open, so its initialisers always read the row's current truth.
 */
export function ClassSheetBody({
  organizationId,
  schoolId,
  row,
  suggestedOrder,
  canWrite,
  canDelete,
  onClose,
  onSaved,
}: {
  organizationId: string;
  schoolId: string | null;
  row: ClassRow | null;
  suggestedOrder: string;
  canWrite: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(row);
  const [form, setForm] = useState<ClassForm>(() =>
    row ? classFormFrom(row) : { name: "", order: suggestedOrder, description: "" },
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
