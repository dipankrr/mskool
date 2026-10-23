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
  assignmentPayload,
  emptyAssignmentForm,
  isFormDirty,
  validateAssignmentForm,
  type AssignmentForm,
  type AssignmentRole,
} from "./form-logic";
import { AcademicFormGates } from "./form-frame";

type AssignmentRow = inferRouterOutputs<
  AppRouter
>["assignment"]["teacherAssignment"]["byId"];

const ROLES: AssignmentRole[] = [
  "class_teacher",
  "subject_teacher",
  "co_teacher",
  "activity_teacher",
];

/**
 * Assign a teacher to a section, or end the assignment. The role/subject
 * pairing is the database's rule — a subject teacher carries exactly one
 * subject, every other role none — and the form mirrors it live. Ending
 * stamps today; a hand-over to a successor is not on the phone yet, which the
 * confirm says outright.
 */
export function TeacherAssignmentFormScreen() {
  const { id, sectionId } = useLocalSearchParams<{
    id?: string;
    sectionId?: string;
  }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(id);
  const canRead = has("teacher_assignment:read");
  const canWrite = editing ? has("teacher_assignment:update") : has("teacher_assignment:create");
  const canEnd = editing && has("teacher_assignment:update");
  const allowed = canRead && (canWrite || canEnd);

  const assignmentQuery = trpc.assignment.teacherAssignment.byId.useQuery(
    { organizationId: organizationId ?? "", id: id ?? "" },
    { enabled: ready && Boolean(organizationId) && editing && canRead, gcTime: 0 },
  );

  return (
    <AcademicFormGates
      title={
        editing
          ? copy.academic.assignments.editTitle
          : copy.academic.assignments.addTitle
      }
      ready={ready}
      hasOrg={Boolean(organizationId)}
      allowed={allowed}
      deniedTitle={copy.academic.denied.assignmentsWriteTitle}
      deniedPermission={editing ? "teacher_assignment:update" : "teacher_assignment:create"}
      editing={editing}
      editPending={assignmentQuery.isPending}
      editError={assignmentQuery.error ?? null}
      editMissing={editing && !assignmentQuery.isPending && !assignmentQuery.data}
      onRetryEdit={() => void assignmentQuery.refetch()}
      backTestID="assignment-form-back"
    >
      <AssignmentFormBody
        organizationId={organizationId ?? ""}
        schoolId={schoolId}
        academicYearId={academicYear?.id ?? null}
        sectionId={assignmentQuery.data?.sectionId ?? sectionId ?? null}
        row={assignmentQuery.data ?? null}
        canWrite={canWrite}
        canEnd={canEnd}
      />
    </AcademicFormGates>
  );
}

function AssignmentFormBody({
  organizationId,
  schoolId,
  academicYearId,
  sectionId,
  row,
  canWrite,
  canEnd,
}: {
  organizationId: string;
  /** Create's addressed parent — the gate covers `teacher_assignment:create` here. */
  schoolId: string | null;
  academicYearId: string | null;
  sectionId: string | null;
  row: AssignmentRow | null;
  canWrite: boolean;
  canEnd: boolean;
}) {
  const editing = Boolean(row);
  const [initial] = useState<AssignmentForm>(() =>
    row
      ? {
          userId: row.userId,
          role: row.role as AssignmentRole,
          subjectId: row.subjectId ?? null,
        }
      : emptyAssignmentForm(),
  );
  const [form, setForm] = useState<AssignmentForm>(initial);
  const [touched, setTouched] = useState<Set<keyof AssignmentForm>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [endError, setEndError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [ended, setEnded] = useState(false);
  const [ending, setEnding] = useState(false);

  const errors = useMemo(() => validateAssignmentForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = isFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved && !ended);

  useEffect(() => {
    if (saved) router.back();
  }, [saved]);
  useEffect(() => {
    if (ended)
      router.dismissTo({
        pathname: "/teacher-assignments",
        params: { sectionId: sectionId ?? "" },
      });
  }, [ended, sectionId]);

  const directory = trpc.assignment.teacherDirectory.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) },
  );
  const subjects = trpc.subject.list.useQuery(
    { organizationId },
    { enabled: Boolean(organizationId) },
  );

  const utils = trpc.useUtils();
  const create = trpc.assignment.teacherAssignment.create.useMutation();
  const end = trpc.assignment.teacherAssignment.end.useMutation();
  const pending = create.isPending || end.isPending;

  const set = (field: keyof AssignmentForm, value: AssignmentForm[keyof AssignmentForm]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: keyof AssignmentForm) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: keyof AssignmentForm) =>
    touched.has(field) || submitted ? errors[field] : undefined;

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors) return;
    try {
      if (!academicYearId || !sectionId || !schoolId) {
        setSaveError(
          new Error(schoolId ? copy.academic.noSessionBody : copy.students.noOrgBody),
        );
        return;
      }
      await create.mutateAsync({
        organizationId,
        schoolId,
        ...assignmentPayload(form, sectionId, academicYearId),
      });
      await utils.assignment.teacherAssignment.list.invalidate();
      setSaved(true);
    } catch (error) {
      setSaveError(error);
    }
  };

  const confirmEnd = () => {
    if (!row) return;
    Alert.alert(
      copy.academic.assignments.endConfirmTitle,
      copy.academic.assignments.endConfirmBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.academic.assignments.endConfirm,
          style: "destructive",
          onPress: () => void endAssignment(row.id),
        },
      ],
    );
  };

  const endAssignment = async (id: string) => {
    setEndError(null);
    setEnding(true);
    try {
      await end.mutateAsync({ organizationId, id });
      await utils.assignment.teacherAssignment.list.invalidate();
      setEnded(true);
    } catch (error) {
      setEndError(error);
    } finally {
      setEnding(false);
    }
  };

  return (
    <ScreenFrame
      title={
        editing ? copy.academic.assignments.editTitle : copy.academic.assignments.addTitle
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="assignment-form-back"
      footer={
        canWrite && !editing ? (
          <>
            {saveError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(saveError).message}
                testID="assignment-save-error"
              />
            ) : submitted && hasErrors ? (
              <Notice
                tone="critical"
                message={copy.forms.invalidSummary}
                testID="assignment-invalid"
              />
            ) : null}
            <CapsuleButton
              title={copy.academic.assignments.add}
              icon="check"
              onPress={() => void submit()}
              loading={create.isPending}
              disabled={pending}
              testID="assignment-save"
              style={styles.save}
            />
          </>
        ) : undefined
      }
    >
      <SectionLabel>{copy.academic.assignments.title}</SectionLabel>
      <Card style={styles.card}>
        <SelectField
          label={copy.academic.assignments.fields.teacher}
          valueLabel={
            form.userId
              ? (directory.data ?? []).find((row) => row.userId === form.userId)
                  ?.name ?? form.userId
              : null
          }
          placeholder={copy.academic.assignments.fields.teacher}
          options={(directory.data ?? []).map((teacher) => ({
            id: teacher.userId,
            label: teacher.name,
          }))}
          currentId={form.userId ?? ""}
          onSelect={(userId) => {
            set("userId", userId || null);
            touch("userId");
          }}
          error={fieldError("userId")}
          disabled={!canWrite || editing}
          testID="assignment-teacher"
        />
        {editing ? (
          <FormField
            label={copy.academic.assignments.fields.role}
            value={copy.academic.assignments.roles[initial.role]}
            onChangeText={() => {}}
            editable={false}
            testID="assignment-role"
          />
        ) : (
          <SelectField
            label={copy.academic.assignments.fields.role}
            valueLabel={copy.academic.assignments.roles[form.role]}
            placeholder={copy.academic.assignments.roles.subject_teacher}
            options={ROLES.map((role) => ({
              id: role,
              label: copy.academic.assignments.roles[role],
            }))}
            currentId={form.role}
            onSelect={(role) => {
              set("role", role as AssignmentRole);
              set("subjectId", role === "subject_teacher" ? form.subjectId : null);
              touch("role");
            }}
            error={fieldError("role")}
            disabled={!canWrite || editing}
            testID="assignment-role"
          />
        )}
        {form.role === "subject_teacher" ? (
          <SelectField
            label={copy.academic.assignments.fields.subject}
            valueLabel={
              form.subjectId
                ? (subjects.data ?? []).find((candidate) => candidate.id === form.subjectId)
                    ?.name ?? null
                : null
            }
            placeholder={copy.academic.assignments.fields.subject}
            options={(subjects.data ?? []).map((candidate) => ({
              id: candidate.id,
              label: candidate.name,
            }))}
            currentId={form.subjectId ?? ""}
            onSelect={(subjectId) => {
              set("subjectId", subjectId || null);
              touch("subjectId");
            }}
            help={copy.academic.assignments.subjectHelp}
            error={fieldError("subjectId")}
            disabled={!canWrite || editing}
            testID="assignment-subject"
          />
        ) : null}
        {!editing && (directory.data ?? []).length === 0 && !directory.isPending ? (
          <Notice
            tone="caution"
            title={copy.academic.assignments.noTeachersTitle}
            message={copy.academic.assignments.noTeachersBody}
            testID="assignment-no-teachers"
          />
        ) : null}
      </Card>

      {row && canEnd ? (
        <View style={styles.retire}>
          <Notice
            tone="caution"
            title={copy.academic.assignments.endNoticeTitle}
            message={copy.academic.assignments.endNoticeBody}
          >
            <CapsuleButton
              title={copy.academic.assignments.endAction}
              variant="destructive"
              size="compact"
              onPress={confirmEnd}
              loading={ending}
              disabled={pending}
              testID="assignment-end"
            />
          </Notice>
          {endError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(endError).message}
              testID="assignment-end-error"
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
