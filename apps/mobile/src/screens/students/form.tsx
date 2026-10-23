import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { DateField } from "../../components/date-field";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
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
import { todayIso } from "../../lib/format";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import {
  isStudentFormDirty,
  normaliseStudentDigits,
  studentCreatePayload,
  studentFormFrom,
  studentFormHasErrors,
  studentUpdatePayload,
  validateStudentForm,
  type StudentBloodGroup,
  type StudentForm,
  type StudentFormField,
} from "./student-form";

type Student = inferRouterOutputs<AppRouter>["student"]["byId"];

const BLOOD_GROUPS = Object.keys(copy.studentForm.bloodGroups) as StudentBloodGroup[];

/**
 * Admit or edit a student (Step 2 chunk A). The route decides by `id`:
 * create mounts immediately, edit loads `student.byId` with `gcTime: 0` so a
 * cold deep link is the server's truth and a reopened form never mounts from
 * a stale cache (the chunk B walk lesson).
 *
 * The admission number is permanent — the contract refuses it on update — so
 * in edit mode it renders locked with the reason written out. Deactivation
 * lives here, at the bottom, behind a consequence notice and a confirm: it
 * needs the student named and the cost read before anyone reaches it.
 */
export function StudentFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();

  const editing = Boolean(id);
  const canCreate = has("student:create");
  const canUpdate = has("student:update");
  const canDelete = has("student:delete");
  const canRead = has("student:read");
  const allowed = editing ? canRead && canUpdate : canRead && canCreate;

  const studentQuery = trpc.student.byId.useQuery(
    { organizationId: organizationId ?? "", id: id ?? "" },
    {
      enabled: ready && Boolean(organizationId) && editing && canRead,
      gcTime: 0,
    },
  );

  const title = editing ? copy.studentForm.editTitle : copy.studentForm.addTitle;

  if (!ready) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="student-form-back"
      >
        <Skeleton height={220} />
      </ScreenFrame>
    );
  }

  if (!organizationId) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="student-form-back"
      >
        <EmptyState
          icon="students"
          title={copy.students.noOrgTitle}
          message={copy.students.noOrgBody}
        />
      </ScreenFrame>
    );
  }

  if (!allowed) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="student-form-back"
      >
        <EmptyState
          icon="shield"
          title={copy.denied.studentsWriteTitle}
          message={copy.denied.studentsWriteBody}
          testID="student-form-denied"
        />
      </ScreenFrame>
    );
  }

  if (editing && studentQuery.isPending) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="student-form-back"
      >
        <View
          style={styles.skeleton}
          accessibilityLabel={copy.studentForm.loading}
        >
          <Skeleton height={28} width="56%" />
          <Skeleton height={180} />
          <Skeleton height={180} />
        </View>
      </ScreenFrame>
    );
  }

  if (editing && studentQuery.isError) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="student-form-back"
      >
        <ErrorCard
          cause={studentQuery.error}
          onRetry={() => void studentQuery.refetch()}
          testID="student-form-error"
        />
      </ScreenFrame>
    );
  }

  if (editing && !studentQuery.data) {
    return (
      <ScreenFrame
        title={title}
        backAccessibilityLabel={copy.common.back}
        backTestID="student-form-back"
      >
        <ErrorCard
          cause={new Error(copy.errors.notFound)}
          onRetry={() => void studentQuery.refetch()}
          testID="student-form-missing"
        />
      </ScreenFrame>
    );
  }

  return (
    <StudentFormBody
      organizationId={organizationId}
      schoolId={schoolId}
      student={studentQuery.data ?? null}
      canWrite={editing ? canUpdate : canCreate}
      canDelete={editing && canDelete}
    />
  );
}

function StudentFormBody({
  organizationId,
  schoolId,
  student,
  canWrite,
  canDelete,
}: {
  organizationId: string;
  /** The active branch — a student is admitted INTO a school (create's address). */
  schoolId: string | null;
  student: Student | null;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const editing = Boolean(student);
  const [initial] = useState<StudentForm>(() => studentFormFrom(student));
  const [form, setForm] = useState<StudentForm>(initial);
  const [touched, setTouched] = useState<Set<StudentFormField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deactivateError, setDeactivateError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [deactivated, setDeactivated] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const errors = useMemo(() => validateStudentForm(form), [form]);
  const hasErrors = studentFormHasErrors(errors);
  const dirty = isStudentFormDirty(form, initial);
  useUnsavedChanges(dirty && !saved && !deactivated);

  // The guard must see `saved` first; navigating in the same tick as the state
  // change would still meet `dirty` and prompt after a successful write.
  useEffect(() => {
    if (saved) router.back();
  }, [saved]);
  // Deactivation leaves the record off the roster: landing back on its detail
  // would be a dead end, so the whole student stack dismisses to the roster.
  useEffect(() => {
    if (deactivated) router.dismissTo("/students");
  }, [deactivated]);

  const utils = trpc.useUtils();
  const create = trpc.student.create.useMutation();
  const update = trpc.student.update.useMutation();
  const deactivate = trpc.student.deactivate.useMutation();
  const pending = create.isPending || update.isPending || deactivate.isPending;

  const set = (field: StudentFormField, value: string | null) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };

  const touch = (field: StudentFormField) => {
    setTouched((current) => new Set(current).add(field));
  };

  const fieldError = (field: StudentFormField) =>
    touched.has(field) || submitted ? errors[field] : undefined;

  const submit = async () => {
    setSubmitted(true);
    setSaveError(null);
    if (hasErrors) return;

    try {
      if (student) {
        await update.mutateAsync({
          organizationId,
          id: student.id,
          data: studentUpdatePayload(form),
        });
        await Promise.all([
          utils.student.list.invalidate(),
          utils.student.byId.invalidate({ id: student.id }),
        ]);
      } else {
        if (!schoolId) {
          setSaveError(new Error(copy.students.noOrgBody));
          return;
        }
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: studentCreatePayload(form),
        });
        await utils.student.list.invalidate();
      }
      setSaved(true);
    } catch (error) {
      setSaveError(error);
    }
  };

  const confirmDeactivate = () => {
    if (!student) return;
    Alert.alert(
      copy.studentForm.deactivateConfirmTitle,
      copy.studentForm.deactivateConfirmBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.studentForm.deactivateConfirm,
          style: "destructive",
          onPress: () => void deactivateStudent(student.id),
        },
      ],
    );
  };

  const deactivateStudent = async (id: string) => {
    setDeactivateError(null);
    setDeactivating(true);
    try {
      await deactivate.mutateAsync({ organizationId, id });
      await utils.student.list.invalidate();
      setDeactivated(true);
    } catch (error) {
      setDeactivateError(error);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <ScreenFrame
      title={editing ? copy.studentForm.editTitle : copy.studentForm.addTitle}
      backAccessibilityLabel={copy.common.back}
      backTestID="student-form-back"
      footer={
        canWrite ? (
          <>
            {saveError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(saveError).message}
                testID="student-save-error"
              />
            ) : submitted && hasErrors ? (
              <Notice
                tone="critical"
                message={copy.forms.invalidSummary}
                testID="student-invalid"
              />
            ) : null}
            <CapsuleButton
              title={
                editing ? copy.studentForm.save : copy.studentForm.add
              }
              icon="check"
              onPress={() => void submit()}
              loading={update.isPending || create.isPending}
              disabled={pending}
              testID="student-save"
              style={styles.save}
            />
          </>
        ) : undefined
      }
    >
      {!canWrite ? (
        <Notice
          tone="neutral"
          message={copy.forms.readOnly}
          testID="student-read-only"
        />
      ) : null}

      <SectionLabel>{copy.studentForm.sections.basics}</SectionLabel>
      <Card style={styles.card}>
        {editing ? (
          <FormField
            label={copy.studentForm.fields.admissionNumber}
            value={form.admissionNumber}
            onChangeText={() => {}}
            help={copy.studentForm.admissionNote}
            editable={false}
            testID="student-admission-number"
          />
        ) : (
          <FormField
            label={copy.studentForm.fields.admissionNumber}
            value={form.admissionNumber}
            onChangeText={(admissionNumber) => set("admissionNumber", admissionNumber)}
            onBlur={() => touch("admissionNumber")}
            help={copy.studentForm.fields.admissionNumberHelp}
            error={fieldError("admissionNumber")}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={50}
            editable={canWrite}
            testID="student-admission-number"
          />
        )}
        <DateField
          label={copy.students.fields.admissionDate}
          value={form.admissionDate}
          onChange={(admissionDate) => set("admissionDate", admissionDate)}
          disabled={!canWrite}
          testID="student-admission-date"
        />
        <FormField
          label={copy.studentForm.fields.firstName}
          value={form.firstName}
          onChangeText={(firstName) => set("firstName", firstName)}
          onBlur={() => touch("firstName")}
          error={fieldError("firstName")}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-first-name"
        />
        <FormField
          label={copy.studentForm.fields.middleName}
          value={form.middleName}
          onChangeText={(middleName) => set("middleName", middleName)}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-middle-name"
        />
        <FormField
          label={copy.studentForm.fields.lastName}
          value={form.lastName}
          onChangeText={(lastName) => set("lastName", lastName)}
          onBlur={() => touch("lastName")}
          error={fieldError("lastName")}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-last-name"
        />
        <DateField
          label={copy.studentForm.fields.dateOfBirth}
          value={form.dateOfBirth}
          onChange={(dateOfBirth) => {
            set("dateOfBirth", dateOfBirth);
            touch("dateOfBirth");
          }}
          error={fieldError("dateOfBirth")}
          maximumDate={todayIso()}
          disabled={!canWrite}
          testID="student-dob"
        />
        <SelectField
          label={copy.studentForm.fields.gender}
          valueLabel={form.gender ? copy.studentForm.genders[form.gender] : null}
          placeholder={copy.studentForm.genderPlaceholder}
          options={(["male", "female", "other"] as const).map((gender) => ({
            id: gender,
            label: copy.studentForm.genders[gender],
          }))}
          currentId={form.gender ?? ""}
          onSelect={(gender) => {
            set("gender", (gender || null) as StudentForm["gender"]);
            touch("gender");
          }}
          error={fieldError("gender")}
          disabled={!canWrite}
          testID="student-gender"
        />
        <SelectField
          label={copy.studentForm.fields.bloodGroup}
          valueLabel={
            form.bloodGroup
              ? copy.studentForm.bloodGroups[form.bloodGroup]
              : copy.studentForm.bloodGroupNone
          }
          placeholder={copy.studentForm.bloodGroupNone}
          options={[
            { id: "", label: copy.studentForm.bloodGroupNone },
            ...BLOOD_GROUPS.map((group) => ({
              id: group,
              label: copy.studentForm.bloodGroups[group],
            })),
          ]}
          currentId={form.bloodGroup ?? ""}
          onSelect={(bloodGroup) =>
            set("bloodGroup", (bloodGroup || null) as StudentBloodGroup | null)
          }
          disabled={!canWrite}
          testID="student-blood-group"
        />
      </Card>

      <SectionLabel>{copy.studentForm.sections.contact}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.studentForm.fields.phone}
          value={form.phone}
          onChangeText={(phone) => set("phone", phone)}
          onBlur={() => touch("phone")}
          error={fieldError("phone")}
          keyboardType="phone-pad"
          maxLength={20}
          editable={canWrite}
          testID="student-phone"
        />
        <FormField
          label={copy.studentForm.fields.email}
          value={form.email}
          onChangeText={(email) => set("email", email)}
          onBlur={() => touch("email")}
          error={fieldError("email")}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={canWrite}
          testID="student-email"
        />
      </Card>

      <SectionLabel>{copy.studentForm.sections.background}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.studentForm.fields.nationality}
          value={form.nationality}
          onChangeText={(nationality) => set("nationality", nationality)}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-nationality"
        />
        <FormField
          label={copy.studentForm.fields.religion}
          value={form.religion}
          onChangeText={(religion) => set("religion", religion)}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-religion"
        />
        <FormField
          label={copy.studentForm.fields.category}
          value={form.category}
          onChangeText={(category) => set("category", category)}
          help={copy.studentForm.fields.categoryHelp}
          autoCapitalize="characters"
          editable={canWrite}
          testID="student-category"
        />
        <FormField
          label={copy.studentForm.fields.motherTongue}
          value={form.motherTongue}
          onChangeText={(motherTongue) => set("motherTongue", motherTongue)}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-mother-tongue"
        />
        <FormField
          label={copy.studentForm.fields.aadhaar}
          value={form.aadhaarNumber}
          onChangeText={(aadhaarNumber) =>
            set("aadhaarNumber", normaliseStudentDigits(aadhaarNumber))
          }
          onBlur={() => touch("aadhaarNumber")}
          help={copy.studentForm.fields.aadhaarHelp}
          error={fieldError("aadhaarNumber")}
          keyboardType="number-pad"
          maxLength={12}
          editable={canWrite}
          testID="student-aadhaar"
        />
      </Card>

      <SectionLabel>{copy.studentForm.sections.address}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.studentForm.fields.addressLine1}
          value={form.addressLine1}
          onChangeText={(addressLine1) => set("addressLine1", addressLine1)}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-address-1"
        />
        <FormField
          label={copy.studentForm.fields.addressLine2}
          value={form.addressLine2}
          onChangeText={(addressLine2) => set("addressLine2", addressLine2)}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-address-2"
        />
        <FormField
          label={copy.studentForm.fields.city}
          value={form.city}
          onChangeText={(city) => set("city", city)}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-city"
        />
        <FormField
          label={copy.studentForm.fields.state}
          value={form.state}
          onChangeText={(state) => set("state", state)}
          autoCapitalize="words"
          editable={canWrite}
          testID="student-state"
        />
        <FormField
          label={copy.studentForm.fields.pincode}
          value={form.pincode}
          onChangeText={(pincode) => set("pincode", normaliseStudentDigits(pincode))}
          onBlur={() => touch("pincode")}
          error={fieldError("pincode")}
          keyboardType="number-pad"
          maxLength={6}
          editable={canWrite}
          testID="student-pincode"
        />
      </Card>

      <SectionLabel>{copy.studentForm.sections.medical}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.studentForm.fields.medical}
          value={form.medicalConditions}
          onChangeText={(medicalConditions) =>
            set("medicalConditions", medicalConditions)
          }
          help={copy.studentForm.fields.medicalHelp}
          autoCapitalize="sentences"
          editable={canWrite}
          testID="student-medical"
        />
        <FormField
          label={copy.studentForm.fields.emergencyName}
          value={form.emergencyContactName}
          onChangeText={(emergencyContactName) =>
            set("emergencyContactName", emergencyContactName)
          }
          autoCapitalize="words"
          editable={canWrite}
          testID="student-emergency-name"
        />
        <FormField
          label={copy.studentForm.fields.emergencyPhone}
          value={form.emergencyContactPhone}
          onChangeText={(emergencyContactPhone) =>
            set("emergencyContactPhone", emergencyContactPhone)
          }
          onBlur={() => touch("emergencyContactPhone")}
          error={fieldError("emergencyContactPhone")}
          keyboardType="phone-pad"
          maxLength={20}
          editable={canWrite}
          testID="student-emergency-phone"
        />
      </Card>

      {student && canDelete ? (
        <View style={styles.deactivate}>
          <Notice
            tone="caution"
            title={copy.studentForm.deactivateNoticeTitle}
            message={copy.studentForm.deactivateNoticeBody}
          >
            <CapsuleButton
              title={copy.studentForm.deactivateAction}
              variant="destructive"
              size="compact"
              onPress={confirmDeactivate}
              loading={deactivating}
              disabled={pending}
              testID="student-deactivate"
            />
          </Notice>
          {deactivateError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(deactivateError).message}
              testID="student-deactivate-error"
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
  skeleton: {
    gap: spacing.md,
  },
  deactivate: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  deactivateError: {
    backgroundColor: colors.tone.critical.bg,
  },
});
