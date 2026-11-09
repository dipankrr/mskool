import { useState } from "react";
import { StyleSheet } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../../components/capsule-button";
import { DateField } from "../../../components/date-field";
import { FormField } from "../../../components/form-field";
import { FormSheet } from "../../../components/form-sheet";
import { Notice } from "../../../components/notice";
import { SelectField } from "../../../components/select-field";
import { ThemedText } from "../../../components/themed-text";
import { copy } from "../../../lib/copy";
import { toFriendlyError } from "../../../lib/errors";
import { todayIso } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { spacing } from "../../../theme/tokens";
import type { LeavingStatus } from "../people-logic";

/*
 * The profile's enrolment and leaving sheets, moved here unchanged from the old
 * profile screen when it was rebuilt (2026-11-09).
 */

/** How a student left: the last day and, if the desk wants to record it, why. */
export function LeavingSheet({
  organizationId,
  enrollmentId,
  enrollmentDate,
  firstName,
  to,
  onClose,
  onSaved,
}: {
  organizationId: string;
  enrollmentId: string;
  enrollmentDate: string;
  firstName: string;
  to: LeavingStatus;
  onClose: () => void;
  onSaved: () => void;
}) {
  const profile = copy.students.profile;
  const [leftOn, setLeftOn] = useState<string | null>(todayIso());
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState<unknown>(null);
  const utils = trpc.useUtils();
  const leave = trpc.enrollment.leave.useMutation();

  const save = async () => {
    setSaveError(null);
    try {
      await leave.mutateAsync({
        organizationId,
        id: enrollmentId,
        data: {
          to,
          ...(leftOn ? { leftOn } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      await utils.enrollment.list.invalidate();
      onSaved();
    } catch (error) {
      setSaveError(error);
    }
  };

  return (
    <FormSheet
      title={profile.leavingSheetTitle(firstName, profile.leavingReasons[to].label)}
      onClose={onClose}
      testIDPrefix="leaving-sheet"
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="leaving-sheet-error"
            />
          ) : null}
          <CapsuleButton
            title={profile.leavingConfirm}
            variant="destructive"
            onPress={() => void save()}
            loading={leave.isPending}
            disabled={leave.isPending}
            testID="leaving-sheet-save"
            style={styles.sheetSave}
          />
        </>
      }
    >
      <ThemedText variant="meta" style={styles.leavingBody}>
        {profile.leavingBody}
      </ThemedText>
      <DateField
        label={profile.leavingDate}
        value={leftOn}
        onChange={setLeftOn}
        minimumDate={enrollmentDate}
        maximumDate={todayIso()}
        testID="leaving-sheet-date"
      />
      <FormField
        label={profile.leavingReason}
        value={reason}
        onChangeText={setReason}
        autoCapitalize="sentences"
        maxLength={200}
        testID="leaving-sheet-reason"
      />
    </FormSheet>
  );
}

export function EnrollmentSheet({
  organizationId,
  schoolId,
  academicYearId,
  studentId,
  mode,
  existing,
  onClose,
  onSaved,
}: {
  organizationId: string;
  schoolId: string | null;
  academicYearId: string | null;
  studentId: string;
  mode: "create" | "assign" | "roll";
  existing: inferRouterOutputs<AppRouter>["enrollment"]["byId"] | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const visible = true;
  const classes = trpc.academic.class.list.useQuery(
    { organizationId, schoolId: schoolId ?? undefined },
    { enabled: visible },
  );
  const sections = trpc.academic.section.list.useQuery(
    { organizationId, schoolId: schoolId ?? undefined, academicYearId: academicYearId ?? "" },
    { enabled: visible && Boolean(academicYearId) },
  );
  const [classId, setClassId] = useState<string | null>(existing?.classId ?? null);
  const [sectionId, setSectionId] = useState<string | null>(existing?.sectionId ?? null);
  const [roll, setRoll] = useState(existing?.rollNumber ?? "");
  const [saveError, setSaveError] = useState<unknown>(null);

  const utils = trpc.useUtils();
  const create = trpc.enrollment.create.useMutation();
  const update = trpc.enrollment.update.useMutation();
  const assignSection = trpc.enrollment.assignSection.useMutation();
  const pending = create.isPending || update.isPending || assignSection.isPending;

  const sectionOptions = (sections.data ?? [])
    .filter((section) => section.classId === classId)
    .map((section) => ({ id: section.id, label: section.name }));

  const rollInvalid = roll.trim().length > 20;
  const classInvalid = mode === "create" && !classId;
  const sectionInvalid = mode === "assign" && !sectionId;

  const submit = async () => {
    setSaveError(null);
    if (rollInvalid || classInvalid || sectionInvalid) return;
    try {
      if (mode === "create") {
        if (!schoolId || !academicYearId) return;
        await create.mutateAsync({
          organizationId,
          schoolId,
          data: {
            studentId,
            academicYearId,
            classId: classId ?? "",
            ...(sectionId ? { sectionId } : {}),
            ...(roll.trim() ? { rollNumber: roll.trim() } : {}),
          },
        });
      } else if (mode === "assign" && existing) {
        if (!sectionId) return;
        await assignSection.mutateAsync({
          organizationId,
          id: existing.id,
          sectionId,
          ...(roll.trim() ? { rollNumber: roll.trim() } : {}),
        });
      } else if (existing) {
        await update.mutateAsync({
          organizationId,
          id: existing.id,
          data: roll.trim() ? { rollNumber: roll.trim() } : {},
        });
      }
      await utils.enrollment.list.invalidate();
      onSaved(
        mode === "assign"
          ? copy.rework.section
          : mode === "roll"
            ? copy.rework.roll
            : copy.rework.enrollment,
      );
    } catch (error) {
      setSaveError(error);
    }
  };

  const title =
    mode === "create"
      ? copy.people.enrollment.formTitle
      : mode === "assign"
        ? copy.people.enrollment.assignTitle
        : copy.people.enrollment.editRoll;

  return (
    <FormSheet
      visible
      title={title}
      onClose={onClose}
      testIDPrefix="enrollment-sheet"
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="enrollment-sheet-error"
            />
          ) : null}
          <CapsuleButton
            title={copy.people.enrollment.save}
            icon="check"
            onPress={() => void submit()}
            loading={pending}
            disabled={pending}
            testID="enrollment-sheet-save"
            style={styles.sheetSave}
          />
        </>
      }
    >
      {mode === "create" ? (
        <SelectField
          label={copy.people.enrollment.fields.class}
          valueLabel={
            classId
              ? (classes.data ?? []).find((candidate) => candidate.id === classId)?.name ?? null
              : null
          }
          placeholder={copy.people.enrollment.fields.class}
          options={(classes.data ?? []).map((candidate) => ({
            id: candidate.id,
            label: candidate.name,
          }))}
          currentId={classId ?? ""}
          onSelect={(next) => {
            setClassId(next || null);
            setSectionId(null);
          }}
          testID="enrollment-sheet-class"
        />
      ) : null}
      {mode !== "roll" ? (
        <SelectField
          label={copy.people.enrollment.fields.section}
          valueLabel={
            sectionId
              ? sectionOptions.find((option) => option.id === sectionId)?.label ?? null
              : null
          }
          placeholder={copy.people.enrollment.noSection}
          options={sectionOptions}
          currentId={sectionId ?? ""}
          onSelect={(next) => setSectionId(next || null)}
          help={mode === "create" ? copy.people.enrollment.fields.sectionHelp : undefined}
          testID="enrollment-sheet-section"
        />
      ) : null}
      <FormField
        label={copy.people.enrollment.fields.roll}
        value={roll}
        onChangeText={setRoll}
        help={copy.people.enrollment.fields.rollHelp}
        autoCapitalize="characters"
        autoFocus={mode === "roll"}
        maxLength={20}
        testID="enrollment-sheet-roll"
      />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  sheetSave: {
    alignSelf: "stretch",
  },
  leavingBody: {
    marginTop: spacing.sm,
  },
});
