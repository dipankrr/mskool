import { useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { DateField } from "../../components/date-field";
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
import { spacing } from "../../theme/tokens";
import {
  emptyTermForm,
  isFormDirty,
  termFormFrom,
  termPayload,
  termUpdatePayload,
  validateTermForm,
  type TermForm,
  type TermResultMode,
} from "./form-logic";
import { AcademicFormGates } from "./form-frame";

type TermRow = inferRouterOutputs<AppRouter>["academic"]["term"]["byId"];

const RESULT_MODES = ["cumulative", "terminal"] as const;

/**
 * Add or edit a term of the running session. The term's year is not patchable
 * (every exam schedule, attendance day and fee installment hangs off it), and
 * the database trigger keeps the dates inside the year — a refusal there
 * surfaces with the server's wording.
 */
export function TermFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(id);
  const canRead = has("academic_year:read");
  const canWrite = editing ? has("academic_year:update") : has("academic_year:create");
  const allowed = canRead && canWrite;

  const termQuery = trpc.academic.term.byId.useQuery(
    { organizationId: organizationId ?? "", id: id ?? "" },
    { enabled: ready && Boolean(organizationId) && editing && canRead, gcTime: 0 },
  );

  return (
    <AcademicFormGates
      title={editing ? copy.academic.terms.editTitle : copy.academic.terms.addTitle}
      ready={ready}
      hasOrg={Boolean(organizationId)}
      allowed={allowed}
      deniedTitle={copy.academic.denied.termsWriteTitle}
      deniedPermission={editing ? "academic_year:update" : "academic_year:create"}
      editing={editing}
      editPending={termQuery.isPending}
      editError={termQuery.error ?? null}
      editMissing={editing && !termQuery.isPending && !termQuery.data}
      onRetryEdit={() => void termQuery.refetch()}
      backTestID="term-form-back"
    >
      <TermFormBody
        organizationId={organizationId ?? ""}
        schoolId={schoolId}
        academicYearId={academicYear?.id ?? null}
        row={termQuery.data ?? null}
        canWrite={canWrite}
      />
    </AcademicFormGates>
  );
}

function TermFormBody({
  organizationId,
  schoolId,
  academicYearId,
  row,
  canWrite,
}: {
  organizationId: string;
  schoolId: string | null;
  academicYearId: string | null;
  row: TermRow | null;
  canWrite: boolean;
}) {
  const editing = Boolean(row);
  const [initial] = useState<TermForm>(() =>
    row ? termFormFrom(row) : emptyTermForm(),
  );
  const [form, setForm] = useState<TermForm>(initial);
  const [touched, setTouched] = useState<Set<keyof TermForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const errors = useMemo(() => validateTermForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = isFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved);

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  const utils = trpc.useUtils();
  const create = trpc.academic.term.create.useMutation();
  const update = trpc.academic.term.update.useMutation();
  const pending = create.isPending || update.isPending;

  const set = (field: keyof TermForm, value: TermForm[keyof TermForm]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: keyof TermForm) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: keyof TermForm) =>
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
          data: termUpdatePayload(form),
        });
      } else {
        if (!academicYearId || !schoolId) {
          setSaveError(new Error(copy.academic.noSessionBody));
          return;
        }
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: termPayload(form, academicYearId),
        });
      }
      await utils.academic.term.list.invalidate();
      setSaved(true);
    } catch (error) {
      setSaveError(error);
    }
  };

  return (
    <ScreenFrame
      title={editing ? copy.academic.terms.editTitle : copy.academic.terms.addTitle}
      backAccessibilityLabel={copy.common.back}
      backTestID="term-form-back"
      footer={
        canWrite ? (
          <>
            {saveError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(saveError).message}
                testID="term-save-error"
              />
            ) : submitted && hasErrors ? (
              <Notice
                tone="critical"
                message={copy.forms.invalidSummary}
                testID="term-invalid"
              />
            ) : null}
            <CapsuleButton
              title={editing ? copy.academic.save : copy.academic.terms.add}
              icon="check"
              onPress={() => void submit()}
              loading={pending}
              disabled={pending}
              testID="term-save"
              style={styles.save}
            />
          </>
        ) : undefined
      }
    >
      <SectionLabel>{copy.academic.terms.title}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.academic.terms.fields.name}
          value={form.name}
          onChangeText={(name) => set("name", name)}
          onBlur={() => touch("name")}
          error={fieldError("name")}
          autoCapitalize="words"
          editable={canWrite}
          testID="term-name"
        />
        <FormField
          label={copy.academic.terms.fields.sequence}
          value={form.sequence}
          onChangeText={(sequence) => set("sequence", sequence.replace(/\D/g, ""))}
          onBlur={() => touch("sequence")}
          help={copy.academic.terms.fields.sequenceHelp}
          error={fieldError("sequence")}
          keyboardType="number-pad"
          maxLength={2}
          editable={canWrite}
          testID="term-sequence"
        />
        <DateField
          label={copy.academic.terms.fields.startDate}
          value={form.startDate}
          onChange={(startDate) => {
            set("startDate", startDate);
            touch("startDate");
          }}
          error={fieldError("startDate")}
          disabled={!canWrite}
          testID="term-start"
        />
        <DateField
          label={copy.academic.terms.fields.endDate}
          value={form.endDate}
          onChange={(endDate) => {
            set("endDate", endDate);
            touch("endDate");
          }}
          error={fieldError("endDate")}
          disabled={!canWrite}
          testID="term-end"
        />
        <SelectField
          label={copy.academic.terms.fields.resultMode}
          valueLabel={copy.academic.terms.resultModes[form.resultMode]}
          placeholder={copy.academic.terms.resultModes.cumulative}
          options={RESULT_MODES.map((mode) => ({
            id: mode,
            label: copy.academic.terms.resultModes[mode],
          }))}
          currentId={form.resultMode}
          onSelect={(mode) => set("resultMode", mode as TermResultMode)}
          disabled={!canWrite}
          testID="term-result-mode"
        />
        <FormField
          label={copy.academic.terms.fields.weightage}
          value={form.weightage}
          onChangeText={(weightage) =>
            set("weightage", weightage.replace(/[^\d.]/g, ""))
          }
          onBlur={() => touch("weightage")}
          help={copy.academic.terms.fields.weightageHelp}
          error={fieldError("weightage")}
          keyboardType="decimal-pad"
          maxLength={6}
          editable={canWrite}
          testID="term-weightage"
        />
      </Card>
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
});
