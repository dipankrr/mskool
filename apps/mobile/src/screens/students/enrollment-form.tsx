import { useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
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
import { Skeleton } from "../../components/skeleton";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import {
  emptyEnrollmentForm,
  enrollmentCreatePayload,
  enrollmentLabelsPayload,
  validateEnrollmentForm,
  type EnrollmentForm,
} from "./people-logic";

type EnrollmentRow = inferRouterOutputs<AppRouter>["enrollment"]["byId"];

/**
 * Enroll a student in the running session, assign a section to an admitted
 * enrollment, or correct a roll number — three modes of one form, chosen by
 * the route. The status itself is the server's machine: creation derives it
 * and the transitions sheet on the record moves it (never this form).
 */
export function EnrollmentFormScreen() {
  const { studentId, enrollmentId } = useLocalSearchParams<{
    studentId?: string;
    enrollmentId?: string;
  }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(enrollmentId);
  const canRead = has("enrollment:read");
  const canCreate = has("enrollment:create");
  const canUpdate = has("enrollment:update");
  const allowed = editing ? canRead && canUpdate : canRead && canCreate;

  const rowQuery = trpc.enrollment.byId.useQuery(
    { organizationId: organizationId ?? "", id: enrollmentId ?? "" },
    {
      enabled: ready && Boolean(organizationId) && editing && canRead,
      gcTime: 0,
    },
  );

  const row = rowQuery.data ?? null;
  // Assign mode: an admitted enrollment waiting for its section.
  const mode: "create" | "assign" | "labels" = editing
    ? row && !row.sectionId
      ? "assign"
      : "labels"
    : "create";
  const title =
    mode === "create"
      ? copy.people.enrollment.formTitle
      : mode === "assign"
        ? copy.people.enrollment.assignTitle
        : copy.people.enrollment.editRoll;

  const gated = (
    <ScreenFrame
      title={title}
      backAccessibilityLabel={copy.common.back}
      backTestID="enrollment-form-back"
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
        backTestID="enrollment-form-back"
      >
        <Notice
          tone="caution"
          title={copy.people.deniedEnrollmentReadTitle}
          message={copy.forms.readOnly}
          testID="enrollment-form-denied"
        />
      </ScreenFrame>
    );
  }
  if (editing && rowQuery.isPending) return gated;
  if (editing && (rowQuery.isError || !row)) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="enrollment-form-back"
      >
        <Notice
          tone="critical"
          message={toFriendlyError(
            rowQuery.error ?? new Error(copy.errors.notFound),
          ).message}
          testID="enrollment-form-error"
        />
      </ScreenFrame>
    );
  }

  return (
    <EnrollmentFormBody
      organizationId={organizationId}
      schoolId={schoolId}
      academicYearId={academicYear?.id ?? null}
      studentId={studentId ?? null}
      row={row}
      mode={mode}
    />
  );
}

function EnrollmentFormBody({
  organizationId,
  schoolId,
  academicYearId,
  studentId,
  row,
  mode,
}: {
  organizationId: string;
  schoolId: string | null;
  academicYearId: string | null;
  studentId: string | null;
  row: EnrollmentRow | null;
  mode: "create" | "assign" | "labels";
}) {
  const [initial] = useState<EnrollmentForm>(() =>
    row
      ? {
          classId: row.classId,
          sectionId: row.sectionId ?? null,
          rollNumber: row.rollNumber ?? "",
        }
      : emptyEnrollmentForm(),
  );
  const [form, setForm] = useState<EnrollmentForm>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const errors = useMemo(() => validateEnrollmentForm(form, mode), [form, mode]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = form !== initial;
  useUnsavedChanges(dirty && !saved);

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  const classes = trpc.academic.class.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) },
  );
  const sections = trpc.academic.section.list.useQuery(
    { organizationId, academicYearId: academicYearId ?? "" },
    { enabled: Boolean(organizationId) && Boolean(academicYearId) },
  );

  const sectionOptions = (sections.data ?? [])
    .filter((section) =>
      mode === "create" && form.classId
        ? section.classId === form.classId
        : true,
    )
    .map((section) => {
      const className =
        (classes.data ?? []).find((candidate) => candidate.id === section.classId)
          ?.name ?? "";
      return {
        id: section.id,
        label: `${className} · ${section.name}`.replace(/^ · /, ""),
      };
    });

  const utils = trpc.useUtils();
  const create = trpc.enrollment.create.useMutation();
  const update = trpc.enrollment.update.useMutation();
  const assignSection = trpc.enrollment.assignSection.useMutation();
  const pending = create.isPending || update.isPending || assignSection.isPending;

  const set = (field: keyof EnrollmentForm, value: string | null) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors) return;
    try {
      if (mode === "create") {
        if (!schoolId || !academicYearId || !studentId) {
          setSaveError(
            new Error(
              schoolId ? copy.academic.noSessionBody : copy.students.noOrgBody,
            ),
          );
          return;
        }
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: enrollmentCreatePayload(form, {
            studentId,
            academicYearId,
          }),
        });
      } else if (mode === "assign" && row) {
        if (!form.sectionId) return;
        await assignSection.mutateAsync({
          organizationId,
          id: row.id,
          sectionId: form.sectionId,
          ...(form.rollNumber.trim()
            ? { rollNumber: form.rollNumber.trim() }
            : {}),
        });
      } else if (row) {
        await update.mutateAsync({
          organizationId,
          id: row.id,
          data: enrollmentLabelsPayload(form),
        });
      }
      await utils.enrollment.list.invalidate();
      setSaved(true);
    } catch (error) {
      setSaveError(error);
    }
  };

  const fieldError = (field: keyof EnrollmentForm) =>
    submitted ? errors[field] : undefined;

  return (
    <ScreenFrame
      title={
        mode === "create"
          ? copy.people.enrollment.formTitle
          : mode === "assign"
            ? copy.people.enrollment.assignTitle
            : copy.people.enrollment.editRoll
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="enrollment-form-back"
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="enrollment-save-error"
            />
          ) : submitted && hasErrors ? (
            <Notice
              tone="critical"
              message={copy.forms.invalidSummary}
              testID="enrollment-invalid"
            />
          ) : null}
          <CapsuleButton
            title={copy.people.enrollment.save}
            icon="check"
            onPress={() => void submit()}
            loading={pending}
            disabled={pending}
            testID="enrollment-save"
            style={styles.save}
          />
        </>
      }
    >
      <SectionLabel>{copy.people.enrollmentLabel}</SectionLabel>
      <Card style={styles.card}>
        {mode === "create" ? (
          <>
            <SelectField
              label={copy.people.enrollment.fields.class}
              valueLabel={
                form.classId
                  ? (classes.data ?? []).find((candidate) => candidate.id === form.classId)
                      ?.name ?? null
                  : null
              }
              placeholder={copy.people.enrollment.fields.class}
              options={(classes.data ?? []).map((candidate) => ({
                id: candidate.id,
                label: candidate.name,
              }))}
              currentId={form.classId ?? ""}
              onSelect={(classId) => {
                set("classId", classId || null);
                set("sectionId", null);
              }}
              error={fieldError("classId")}
              testID="enrollment-class"
            />
            <SelectField
              label={copy.people.enrollment.fields.section}
              valueLabel={
                form.sectionId
                  ? (sectionOptions.find((option) => option.id === form.sectionId)
                      ?.label ?? null)
                  : null
              }
              placeholder={copy.people.enrollment.noSection}
              options={sectionOptions}
              currentId={form.sectionId ?? ""}
              onSelect={(sectionId) => set("sectionId", sectionId || null)}
              help={copy.people.enrollment.fields.sectionHelp}
              error={fieldError("sectionId")}
              testID="enrollment-section"
            />
          </>
        ) : mode === "assign" ? (
          <>
            <Notice
              tone="neutral"
              message={copy.people.enrollment.assignNote}
              testID="enrollment-assign-note"
            />
            <SelectField
              label={copy.people.enrollment.fields.section}
              valueLabel={
                form.sectionId
                  ? (sectionOptions.find((option) => option.id === form.sectionId)
                      ?.label ?? null)
                  : null
              }
              placeholder={copy.people.enrollment.fields.section}
              options={sectionOptions}
              currentId={form.sectionId ?? ""}
              onSelect={(sectionId) => set("sectionId", sectionId || null)}
              error={fieldError("sectionId")}
              testID="enrollment-section"
            />
          </>
        ) : null}
        <FormField
          label={copy.people.enrollment.fields.roll}
          value={form.rollNumber}
          onChangeText={(rollNumber) => set("rollNumber", rollNumber)}
          help={copy.people.enrollment.fields.rollHelp}
          error={fieldError("rollNumber")}
          autoCapitalize="characters"
          maxLength={20}
          testID="enrollment-roll"
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
