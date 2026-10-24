import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";
import * as ImagePicker from "expo-image-picker";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { LinkRow } from "../../components/link-row";
import { Notice } from "../../components/notice";
import { PersonRow } from "../../components/person-row";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { FactRow } from "../../components/fact-row";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { env } from "../../env";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { formatReadableDate } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { ENROLLMENT_TRANSITIONS, type EnrollmentStatus } from "./people-logic";
import { photoToWireBase64 } from "./photo-matching";

type Guardian = inferRouterOutputs<AppRouter>["guardian"]["list"][number];

/**
 * A student's record (Step 2 chunk A). Every stored fact the school recorded,
 * grouped the way the form groups it, plus the guardians of record. Editing
 * is the header action, gated `student:update` — the server re-checks.
 *
 * Facts that were never recorded are simply absent: an em-dash wall teaches
 * nobody anything. The identity section always renders because it always has
 * content.
 */
export function StudentDetailScreen() {
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("student:read");
  const canUpdate = has("student:update");
  const canEnroll = has("enrollment:create");
  const canEnrollUpdate = has("enrollment:update");
  const canSeePortal = has("portal_access:activate");

  const studentQuery = trpc.student.byId.useQuery(
    { organizationId: organizationId ?? "", id: studentId ?? "" },
    { enabled: ready && Boolean(organizationId) && canRead },
  );
  const guardiansQuery = trpc.guardian.list.useQuery(
    { organizationId: organizationId ?? "", id: studentId ?? "" },
    {
      enabled: ready && Boolean(organizationId) && canRead && Boolean(studentId),
      placeholderData: (previous) => previous,
    },
  );
  const enrollmentsQuery = trpc.enrollment.list.useQuery(
    { organizationId: organizationId ?? "", academicYearId: academicYear?.id ?? "" },
    {
      enabled:
        ready &&
        Boolean(organizationId) &&
        has("enrollment:read") &&
        Boolean(academicYear?.id),
    },
  );

  const enrollment = (enrollmentsQuery.data ?? []).find(
    (row) => row.student.id === studentId,
  );
  const transitions = enrollment
    ? ENROLLMENT_TRANSITIONS[
        enrollment.enrollment.enrollmentStatus as EnrollmentStatus
      ] ?? []
    : [];

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionError, setTransitionError] = useState<unknown>(null);
  const utils = trpc.useUtils();
  const transition = trpc.enrollment.transition.useMutation();
  const uploadPhoto = trpc.student.uploadPhoto.useMutation();
  const removePhotoMutation = trpc.student.removePhoto.useMutation();
  const moveAlong = async (to: EnrollmentStatus) => {
    if (!enrollment || !organizationId) return;
    setTransitionError(null);
    try {
      await transition.mutateAsync({
        organizationId,
        id: enrollment.enrollment.id,
        to,
      });
      await utils.enrollment.list.invalidate();
    } catch (error) {
      setTransitionError(error);
    }
  };

  // The student's own photo (Step 2 rework): viewed through the stable
  // storage route, set from the gallery, removed behind a confirm — all
  // through the ordinary student.photo/uploadPhoto/removePhoto seam.
  const photoQuery = trpc.student.photo.useQuery(
    { organizationId: organizationId ?? "", id: studentId ?? "" },
    { enabled: ready && Boolean(organizationId) && canRead && Boolean(studentId) },
  );
  const photoObjectId = photoQuery.data?.objectId ?? null;
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<unknown>(null);

  const loadPhoto = useCallback(async (objectId: string) => {
    try {
      const response = await fetch(`${env.EXPO_PUBLIC_API_URL}/api/storage/${objectId}`, {
        credentials: "include",
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = () => setPhotoUri(String(reader.result));
      reader.readAsDataURL(blob);
    } catch {
      // A failed render keeps the initials avatar — never a broken image.
    }
  }, []);

  const pickPhoto = async () => {
    setPhotoError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        exif: false,
      });
      if (result.canceled || !studentId || !organizationId) return;
      const asset = result.assets[0];
      setPhotoBusy(true);
      const base64 = await photoToWireBase64(asset.uri, asset.width, asset.height);
      if (!base64) {
        setPhotoError(new Error(copy.photos.tooLarge));
        return;
      }
      await uploadPhoto.mutateAsync({
        organizationId,
        id: studentId,
        data: { contentType: "image/jpeg", dataBase64: base64 },
      });
      const objectId = await utils.student.photo.fetch({
        organizationId,
        id: studentId,
      });
      if (objectId?.objectId) await loadPhoto(objectId.objectId);
      setPhotoSheetOpen(false);
    } catch (error) {
      setPhotoError(error);
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = () => {
    if (!studentId || !organizationId) return;
    Alert.alert(
      copy.profilePhoto.removeConfirmTitle,
      copy.profilePhoto.removeConfirmBody,
      [
        { text: copy.common.cancel, style: "cancel" },
        {
          text: copy.profilePhoto.removeConfirm,
          style: "destructive",
          onPress: () => {
            setPhotoBusy(true);
            removePhotoMutation
              .mutateAsync({ organizationId, id: studentId })
              .then(() => {
                setPhotoUri(null);
                setPhotoSheetOpen(false);
              })
              .catch((error: unknown) => setPhotoError(error))
              .finally(() => setPhotoBusy(false));
          },
        },
      ],
    );
  };

  // The stored photo renders through a fetched data URI (RN's Image does not
  // ride the session cookie the storage route requires).
  useEffect(() => {
    if (photoObjectId) void loadPhoto(photoObjectId);
  }, [photoObjectId, loadPhoto]);

  // Enrollment sheets (Step 2 rework): a two-field act never leaves the
  // record — create, assign-section, and roll edit open here, not on a
  // pushed screen.
  const [enrollSheet, setEnrollSheet] = useState<
    null | "create" | "assign" | "roll"
  >(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const student = studentQuery.data;
  const name = student
    ? [student.firstName, student.middleName, student.lastName]
        .filter(Boolean)
        .join(" ")
    : "";

  const editAction =
    student && canUpdate
      ? {
          label: copy.students.edit,
          icon: "edit" as const,
          onPress: () =>
            router.push({ pathname: "/student-form", params: { id: student.id } }),
          accessibilityHint: copy.students.editHint,
          testID: "student-detail-edit",
        }
      : undefined;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={student ? name : copy.students.title}
      meta={student ? copy.students.meta(student.admissionNumber) : null}
      backAccessibilityLabel={copy.common.back}
      action={editAction}
      titleTestID="student-detail-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.denied.studentsReadTitle}
        message={copy.denied.studentsReadBody}
        testID="student-detail-denied"
      />,
    );
  }

  if (!ready || (organizationId && studentQuery.isPending)) {
    return frame(
      <View style={styles.skeleton} accessibilityLabel={copy.students.loading}>
        <Skeleton height={28} width="52%" />
        <Skeleton height={180} />
        <Skeleton height={120} />
      </View>,
    );
  }

  if (studentQuery.isError) {
    return frame(
      <ErrorCard
        cause={studentQuery.error}
        onRetry={() => void studentQuery.refetch()}
        testID="student-detail-error"
      />,
    );
  }

  if (!student) {
    return frame(
      <ErrorCard
        cause={new Error(copy.errors.notFound)}
        onRetry={() => void studentQuery.refetch()}
        testID="student-detail-missing"
      />,
    );
  }

  const guardians = guardiansQuery.data ?? [];

  return frame(
    <View style={styles.body}>
      {savedMsg ? (
        <Notice tone="positive" message={savedMsg} testID="student-saved" />
      ) : null}
      <SectionLabel>{copy.students.sections.identity}</SectionLabel>
      <Card padless>
        <Pressable
          accessibilityRole={canUpdate ? "button" : undefined}
          accessibilityLabel={
            photoUri
              ? copy.profilePhoto.change
              : copy.profilePhoto.change
          }
          accessibilityHint={canUpdate ? copy.profilePhoto.changeHint : undefined}
          onPress={canUpdate ? () => setPhotoSheetOpen(true) : undefined}
          style={({ pressed }) => [
            styles.photoRow,
            pressed && canUpdate ? styles.photoPressed : null,
          ]}
          testID="student-photo-row"
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoEmpty]}>
              <ThemedText variant="name" color={colors.muted}>
                {student.firstName.charAt(0)}
                {student.lastName.charAt(0)}
              </ThemedText>
            </View>
          )}
          <View style={styles.photoText}>
            <ThemedText variant="bodyStrong" numberOfLines={1}>
              {photoUri ? copy.profilePhoto.change : copy.profilePhoto.change}
            </ThemedText>
            <ThemedText variant="meta" numberOfLines={1}>
              {student.admissionNumber}
            </ThemedText>
          </View>
          {canUpdate ? (
            <AppIcon name="chevronRight" size={18} color={colors.chevron} />
          ) : null}
        </Pressable>
        <FactRow
          label={copy.students.fields.admissionNumber}
          value={student.admissionNumber}
          testID="student-fact-admission"
        />
        {student.admissionDate ? (
          <FactRow
            label={copy.students.fields.admissionDate}
            value={formatReadableDate(student.admissionDate)}
          />
        ) : null}
        <FactRow
          label={copy.students.fields.dateOfBirth}
          value={formatReadableDate(student.dateOfBirth)}
        />
        <FactRow
          label={copy.students.fields.gender}
          value={copy.studentForm.genders[student.gender]}
        />
        {student.bloodGroup ? (
          <FactRow
            label={copy.students.fields.bloodGroup}
            value={copy.studentForm.bloodGroups[student.bloodGroup]}
          />
        ) : null}
      </Card>

      {(student.phone || student.email) && (
        <>
          <SectionLabel>{copy.students.sections.contact}</SectionLabel>
          <Card padless>
            {student.phone ? (
              <FactRow
                label={copy.students.fields.phone}
                value={student.phone}
                first
              />
            ) : null}
            {student.email ? (
              <FactRow
                label={copy.students.fields.email}
                value={student.email}
                first={!student.phone}
              />
            ) : null}
          </Card>
        </>
      )}

      {(student.nationality ||
        student.religion ||
        student.category ||
        student.motherTongue ||
        student.aadhaarNumber) && (
        <>
          <SectionLabel>{copy.students.sections.background}</SectionLabel>
          <Card padless>
            {(
              [
                { key: "nationality", value: student.nationality },
                { key: "religion", value: student.religion },
                { key: "category", value: student.category },
                { key: "motherTongue", value: student.motherTongue },
                { key: "aadhaar", value: student.aadhaarNumber },
              ] as { key: string; value: string | null }[]
            )
              .flatMap((row) =>
                row.value ? [{ key: row.key, value: row.value }] : [],
              )
              .map((row, index) => (
                <FactRow
                  key={row.key}
                  label={
                    copy.students.fields[
                      row.key as keyof typeof copy.students.fields
                    ]
                  }
                  value={row.value}
                  first={index === 0}
                />
              ))}
          </Card>
        </>
      )}

      {(student.addressLine1 ||
        student.addressLine2 ||
        student.city ||
        student.state ||
        student.pincode) && (
        <>
          <SectionLabel>{copy.students.sections.address}</SectionLabel>
          <Card padless>
            {(
              [
                { key: "addressLine1", value: student.addressLine1 },
                { key: "addressLine2", value: student.addressLine2 },
                { key: "city", value: student.city },
                { key: "state", value: student.state },
                { key: "pincode", value: student.pincode },
              ] as { key: string; value: string | null }[]
            )
              .flatMap((row) =>
                row.value ? [{ key: row.key, value: row.value }] : [],
              )
              .map((row, index) => (
                <FactRow
                  key={row.key}
                  label={
                    copy.students.fields[
                      row.key as keyof typeof copy.students.fields
                    ]
                  }
                  value={row.value}
                  first={index === 0}
                />
              ))}
          </Card>
        </>
      )}

      {(student.medicalConditions ||
        student.emergencyContactName ||
        student.emergencyContactPhone) && (
        <>
          <SectionLabel>{copy.students.sections.medical}</SectionLabel>
          <Card padless>
            {student.medicalConditions ? (
              <FactRow
                label={copy.students.fields.medical}
                value={student.medicalConditions}
                first
              />
            ) : null}
            {student.emergencyContactName ? (
              <FactRow
                label={copy.students.fields.emergencyName}
                value={student.emergencyContactName}
                first={!student.medicalConditions}
              />
            ) : null}
            {student.emergencyContactPhone ? (
              <FactRow
                label={copy.students.fields.emergencyPhone}
                value={student.emergencyContactPhone}
                first={
                  !student.medicalConditions && !student.emergencyContactName
                }
              />
            ) : null}
          </Card>
        </>
      )}

      <SectionLabel>{copy.people.enrollmentLabel}</SectionLabel>
      {enrollmentsQuery.isPending ? (
        <Card>
          <Skeleton height={20} width="40%" />
        </Card>
      ) : enrollment ? (
        <Card padless>
          <FactRow
            label={copy.people.enrollment.statusLabel}
            value={
              copy.people.enrollment.statuses[
                enrollment.enrollment.enrollmentStatus as EnrollmentStatus
              ] ?? enrollment.enrollment.enrollmentStatus
            }
            first
          />
          {enrollment.enrollment.rollNumber ? (
            <FactRow
              label={copy.people.enrollment.rollLabel}
              value={
                canEnrollUpdate
                  ? `${enrollment.enrollment.rollNumber} · Edit`
                  : enrollment.enrollment.rollNumber
              }
              onPress={
                canEnrollUpdate
                  ? () =>
                      setEnrollSheet(enrollment.enrollment.sectionId === null ? "assign" : "roll")
                  : undefined
              }
              accessibilityHint={copy.people.enrollment.editRoll}
            />
          ) : null}
          {canEnrollUpdate && enrollment.enrollment.sectionId === null ? (
            <FactRow
              label={copy.people.enrollment.sectionLabel}
              value={copy.people.enrollment.noSection}
              onPress={() =>
                setEnrollSheet(enrollment.enrollment.sectionId === null ? "assign" : "roll")
              }
              accessibilityHint={copy.people.enrollment.assignHint}
            />
          ) : null}
          {canEnrollUpdate && transitions.length > 0 ? (
            <FactRow
              label={copy.people.enrollment.moveAlong}
              value={copy.people.enrollment.statuses[
                transitions[0] as EnrollmentStatus
              ]}
              onPress={() => setTransitionOpen(true)}
              accessibilityHint={copy.people.enrollment.moveAlongHint}
            />
          ) : null}
        </Card>
      ) : (
        <Card>
          <ThemedText variant="meta">
            {copy.people.enrollment.notEnrolledTitle} —{" "}
            {copy.people.enrollment.notEnrolledBody}
          </ThemedText>
          {canEnroll ? (
            <CapsuleButton
              title={copy.people.enrollment.enroll}
              icon="add"
              onPress={() =>
                setEnrollSheet("create")
              }
              testID="enrollment-start"
              style={styles.enrollButton}
            />
          ) : null}
        </Card>
      )}
      {transitionError ? (
        <Notice
          tone="critical"
          message={toFriendlyError(transitionError).message}
          testID="enrollment-transition-error"
        />
      ) : null}

      <SectionLabel>{copy.students.sections.guardians}</SectionLabel>
      {guardiansQuery.isPending ? (
        <Card>
          <Skeleton height={20} width="40%" />
        </Card>
      ) : guardians.length > 0 ? (
        <Card padless>
          {guardians.map((guardian, index) => (
            <GuardianRow
              key={guardian.id}
              guardian={guardian}
              first={index === 0}
              onPress={
                canUpdate
                  ? () =>
                      router.push({
                        pathname: "/guardian-form",
                        params: { studentId: studentId ?? "", guardianId: guardian.id },
                      })
                  : undefined
              }
            />
          ))}
        </Card>
      ) : (
        <Card>
          <ThemedText variant="meta">{copy.students.guardiansEmpty}</ThemedText>
        </Card>
      )}
      {canUpdate ? (
        <Card padless>
          <LinkRow
            title={copy.people.guardians.add}
            detail={copy.people.guardians.addRowDetail}
            icon="add"
            onPress={() =>
              router.push({
                pathname: "/guardian-form",
                params: { studentId: studentId ?? "" },
              })
            }
            accessibilityHint={copy.people.guardians.addHint}
            first
            testID="guardian-add"
          />
        </Card>
      ) : null}

      {canSeePortal ? (
        <>
          <SectionLabel>{copy.people.portal.title}</SectionLabel>
          <Card padless>
            <LinkRow
              title={copy.people.portal.title}
              detail={copy.people.portal.detail}
              icon="key"
              onPress={() =>
                router.push({
                  pathname: "/portal-access",
                  params: { studentId: studentId ?? "" },
                })
              }
              accessibilityHint={copy.people.portal.hint}
              first
              testID="student-portal-link"
            />
          </Card>
        </>
      ) : null}

      <ChoiceSheet
        visible={transitionOpen}
        title={copy.people.enrollment.transitions.sheetTitle}
        options={transitions.map((to) => ({
          id: to,
          label: copy.people.enrollment.statuses[to],
        }))}
        currentId=""
        onSelect={(to) => {
          setTransitionOpen(false);
          Alert.alert(
            copy.people.enrollment.transitions.confirmTitle,
            copy.people.enrollment.transitions.confirmBody,
            [
              { text: copy.common.cancel, style: "cancel" },
              {
                text: copy.people.enrollment.transitions.confirm,
                style: "destructive",
                onPress: () => void moveAlong(to as EnrollmentStatus),
              },
            ],
          );
        }}
        onDismiss={() => setTransitionOpen(false)}
        testIDPrefix="enrollment-transition"
      />

      {enrollSheet ? (
        <EnrollmentSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId}
          academicYearId={academicYear?.id ?? null}
          studentId={studentId ?? ""}
          mode={enrollSheet}
          existing={enrollment?.enrollment ?? null}
          onClose={() => setEnrollSheet(null)}
          onSaved={(message) => {
            setEnrollSheet(null);
            setSavedMsg(message);
          }}
        />
      ) : null}

      {photoSheetOpen ? (
      <FormSheet
        title={copy.profilePhoto.sheetTitle}
        onClose={() => setPhotoSheetOpen(false)}
        testIDPrefix="student-photo-sheet"
        footer={
          <>
            {photoError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(photoError).message}
                testID="student-photo-error"
              />
            ) : null}
            {canUpdate ? (
              <>
                <CapsuleButton
                  title={copy.profilePhoto.change}
                  icon="add"
                  onPress={() => void pickPhoto()}
                  loading={photoBusy}
                  disabled={photoBusy}
                  testID="student-photo-pick"
                />
                {photoObjectId ? (
                  <CapsuleButton
                    title={copy.profilePhoto.remove}
                    icon="close"
                    variant="destructive"
                    onPress={removePhoto}
                    disabled={photoBusy}
                    testID="student-photo-remove"
                  />
                ) : null}
              </>
            ) : null}
          </>
        }
      >
        <View style={styles.photoSheetPreview}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoEmpty]}>
              <ThemedText variant="name" color={colors.muted}>
                {student ? student.firstName.charAt(0) : ""}
                {student ? student.lastName.charAt(0) : ""}
              </ThemedText>
            </View>
          )}
          <ThemedText variant="meta">{copy.profilePhoto.changeHint}</ThemedText>
        </View>
      </FormSheet>
      ) : null}
    </View>,
  );}

function GuardianRow({
  guardian,
  first,
  onPress,
}: {
  guardian: Guardian;
  first: boolean;
  onPress?: () => void;
}) {
  const flags = [
    guardian.isPrimary ? copy.students.guardianPrimary : null,
    guardian.isEmergencyContact ? copy.students.guardianEmergency : null,
    guardian.canAccessPortal ? copy.students.guardianPortal : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const name = [guardian.firstName, guardian.lastName].filter(Boolean).join(" ");
  return (
    <PersonRow
      name={name}
      meta={copy.students.guardianMeta(
        copy.students.relations[guardian.relation],
        flags || null,
      )}
      first={first}
      onPress={onPress}
      accessibilityHint={onPress ? copy.students.openHint : undefined}
      testID={`student-guardian-${guardian.id}`}
    />
  );
}


function EnrollmentSheet({
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
    .filter((section) => (mode === "create" && classId ? section.classId === classId : true))
    .map((section) => {
      const sectionClassName =
        (classes.data ?? []).find((candidate) => candidate.id === section.classId)?.name ?? "";
      return {
        id: section.id,
        label: [sectionClassName, section.name].filter(Boolean).join(" · "),
      };
    });

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
        maxLength={20}
        testID="enrollment-sheet-roll"
      />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
  },
  enrollButton: {
    alignSelf: "stretch",
    marginTop: spacing.sm,
  },
  photoRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  photoPressed: {
    backgroundColor: colors.field,
  },
  photo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.field,
  },
  photoEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  photoText: {
    flex: 1,
    gap: spacing.xxs,
  },
  photoSheetPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
