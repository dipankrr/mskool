import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { DateField } from "../../components/date-field";
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
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { formatReadableDate, todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import {
  addressBlock,
  ageInYears,
  hasLeft,
  leavingOptions,
  maskAadhaar,
  type EnrollmentStatus,
  type LeavingStatus,
} from "./people-logic";
import { PhotoSourceSheet, StudentPhotoView, useStudentPhoto } from "./student-photo";

type Guardian = inferRouterOutputs<AppRouter>["guardian"]["list"][number];

/** Opens the dialler; a phone without one gets told rather than ignored. */
function callNumber(phone: string) {
  Linking.openURL(`tel:${phone}`).catch(() =>
    Alert.alert(copy.students.profile.callFailed),
  );
}

/**
 * A student's profile, in the order a school reaches for it: who this is and
 * where they sit, then how to reach the family, then the file. The hero answers
 * "which class, which section, which roll" at a glance, and each of those fixes
 * itself in place when it's missing.
 *
 * Details never recorded stay absent, because a wall of dashes teaches nobody
 * anything. One row offers to fill them instead.
 */
export function StudentDetailScreen() {
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has, hasAny } = usePermissions();

  const canRead = has("student:read");
  const canUpdate = has("student:update");
  const canEnroll = has("enrollment:create");
  const canEnrollUpdate = has("enrollment:update");
  const canReadEnrollment = has("enrollment:read");
  const canSeePortal = has("portal_access:activate");
  const canSeeFees = hasAny("fee_report:read", "student_fee_assignment:read");

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
  const enrollmentsEnabled =
    ready && Boolean(organizationId) && canReadEnrollment && Boolean(academicYear?.id);
  const enrollmentsQuery = trpc.enrollment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      includeLeft: true,
    },
    { enabled: enrollmentsEnabled },
  );
  // Enrollments only carry ids, and a name is what anyone is looking for.
  const classesQuery = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: enrollmentsEnabled && has("class:read") },
  );
  const sectionsQuery = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      academicYearId: academicYear?.id ?? "",
    },
    { enabled: enrollmentsEnabled && has("section:read") },
  );

  const enrollment = (enrollmentsQuery.data ?? []).find(
    (row) => row.student.id === studentId,
  )?.enrollment;
  const status = enrollment?.enrollmentStatus as EnrollmentStatus | undefined;
  const className = classesQuery.data?.find((row) => row.id === enrollment?.classId)?.name;
  const sectionName = sectionsQuery.data?.find((row) => row.id === enrollment?.sectionId)?.name;

  const utils = trpc.useUtils();
  const rejoin = trpc.student.rejoin.useMutation();
  const [leavingOpen, setLeavingOpen] = useState(false);
  const [leavingTo, setLeavingTo] = useState<LeavingStatus | null>(null);
  const [rejoinError, setRejoinError] = useState<unknown>(null);

  const photo = useStudentPhoto(organizationId, studentId, ready && canRead);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [photoError, setPhotoError] = useState<unknown>(null);

  const [enrollSheet, setEnrollSheet] = useState<null | "create" | "assign" | "roll">(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const student = studentQuery.data;
  const name = student
    ? [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ")
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

  const refresh = () => {
    void studentQuery.refetch();
    void guardiansQuery.refetch();
    void photo.refetch();
    if (enrollmentsEnabled) void enrollmentsQuery.refetch();
  };

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={student ? name : copy.students.title}
      meta={student ? copy.students.meta(student.admissionNumber) : null}
      backAccessibilityLabel={copy.common.back}
      action={editAction}
      titleTestID="student-detail-title"
      onRefresh={student ? refresh : undefined}
      refreshing={studentQuery.isRefetching}
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

  const profile = copy.students.profile;
  const guardians = guardiansQuery.data ?? [];
  const firstContact = guardians.find((guardian) => guardian.isPrimary) ?? guardians[0];
  const age = ageInYears(student.dateOfBirth, todayIso());
  const left = student.status === "inactive" || (status ? hasLeft(status) : false);
  const canPlace = canEnrollUpdate && !left;
  const leaving = status && canEnrollUpdate ? leavingOptions(status) : [];
  const address = addressBlock(student);
  const hasContact = Boolean(student.phone || student.email || address);
  const hasHealth = Boolean(
    student.medicalConditions || student.emergencyContactName || student.emergencyContactPhone,
  );
  const background = (
    [
      { label: copy.students.fields.nationality, value: student.nationality },
      { label: copy.students.fields.religion, value: student.religion },
      { label: copy.students.fields.category, value: student.category },
      { label: copy.students.fields.motherTongue, value: student.motherTongue },
      {
        label: copy.students.fields.aadhaar,
        value: student.aadhaarNumber ? maskAadhaar(student.aadhaarNumber) : null,
      },
    ] as { label: string; value: string | null }[]
  ).filter((row) => row.value);
  const emptyGroups = [
    !student.phone && !student.email ? profile.groups.contact : null,
    !address ? profile.groups.address : null,
    !hasHealth && !student.bloodGroup ? profile.groups.health : null,
    background.length === 0 ? profile.groups.background : null,
  ].filter(Boolean);

  const rejoinStudent = async () => {
    if (!organizationId) return;
    setRejoinError(null);
    setSavedMsg(null);
    try {
      await rejoin.mutateAsync({ organizationId, id: student.id });
      await Promise.all([
        utils.enrollment.list.invalidate(),
        utils.student.byId.invalidate({ id: student.id }),
      ]);
    } catch (error) {
      setRejoinError(error);
    }
  };

  const confirmRemovePhoto = () =>
    Alert.alert(copy.profilePhoto.removeConfirmTitle, copy.profilePhoto.removeConfirmBody, [
      { text: copy.common.cancel, style: "cancel" },
      {
        text: copy.profilePhoto.removeConfirm,
        style: "destructive",
        onPress: () => void photo.remove().catch(setPhotoError),
      },
    ]);

  const photoLabel = photo.hasPhoto ? copy.profilePhoto.change : copy.profilePhoto.add;

  return frame(
    <View style={styles.body}>
      {savedMsg ? <Notice tone="positive" message={savedMsg} testID="student-saved" /> : null}

      <Card padless testID="student-hero">
        <View style={styles.heroTop}>
          <StudentPhotoView
            uri={photo.uri}
            name={name}
            size={84}
            busy={photo.busy}
            onPress={
              canUpdate
                ? () => {
                    setPhotoError(null);
                    setPhotoSheetOpen(true);
                  }
                : undefined
            }
            accessibilityLabel={photoLabel}
            accessibilityHint={copy.profilePhoto.changeHint}
            testID="student-photo-row"
          />
          <View style={styles.heroFacts}>
            <ThemedText variant="bodyStrong">
              {[age === null ? null : profile.age(age), copy.studentForm.genders[student.gender]]
                .filter(Boolean)
                .join(" · ")}
            </ThemedText>
            <ThemedText variant="meta">
              {profile.born(formatReadableDate(student.dateOfBirth))}
            </ThemedText>
            <View style={styles.pills}>
              {student.bloodGroup ? (
                <StatusPill
                  label={copy.studentForm.bloodGroups[student.bloodGroup]}
                  tone="neutral"
                  testID="student-blood-group-pill"
                />
              ) : null}
              {left ? (
                <StatusPill
                  label={status && hasLeft(status) ? copy.people.enrollment.statuses[status] : profile.gone}
                  tone={status === "graduated" ? "positive" : "critical"}
                  testID="student-left-pill"
                />
              ) : null}
            </View>
          </View>
        </View>

        {canReadEnrollment && academicYear ? (
          enrollmentsQuery.isPending ? (
            <View style={styles.placementLoading}>
              <Skeleton height={44} />
            </View>
          ) : enrollmentsQuery.isError ? (
            <View style={styles.enrollBlock}>
              <ThemedText variant="meta">{profile.enrollmentFailed}</ThemedText>
              <CapsuleButton
                title={copy.common.retry}
                variant="secondary"
                size="compact"
                onPress={() => void enrollmentsQuery.refetch()}
                testID="student-enrollment-retry"
                style={styles.alignStart}
              />
            </View>
          ) : enrollment ? (
            <View style={styles.placement} testID="student-placement">
              <PlacementCell
                label={copy.people.enrollment.classLabel}
                value={className ?? null}
                testID="student-class"
              />
              <PlacementCell
                label={copy.people.enrollment.sectionLabel}
                value={enrollment.sectionId ? (sectionName ?? null) : null}
                action={enrollment.sectionId ? undefined : profile.assign}
                onPress={
                  canPlace && !enrollment.sectionId ? () => setEnrollSheet("assign") : undefined
                }
                accessibilityHint={profile.assignHint}
                testID="student-section"
              />
              <PlacementCell
                label={copy.people.enrollment.rollLabel}
                value={enrollment.rollNumber}
                action={profile.add}
                onPress={canPlace && enrollment.sectionId ? () => setEnrollSheet("roll") : undefined}
                accessibilityHint={enrollment.rollNumber ? profile.editRollHint : profile.addRollHint}
                testID="student-roll"
              />
            </View>
          ) : left ? null : (
            <View style={styles.enrollBlock}>
              <ThemedText variant="bodyStrong">{profile.enrollTitle}</ThemedText>
              <ThemedText variant="meta">{profile.enrollBody}</ThemedText>
              {canEnroll ? (
                <CapsuleButton
                  title={copy.people.enrollment.enroll}
                  icon="add"
                  size="compact"
                  onPress={() => setEnrollSheet("create")}
                  testID="enrollment-start"
                  style={styles.alignStart}
                />
              ) : null}
            </View>
          )
        ) : null}
      </Card>

      {canUpdate && student.status === "inactive" && status !== "graduated" ? (
        <CapsuleButton
          title={profile.rejoin}
          icon="history"
          variant="secondary"
          size="compact"
          loading={rejoin.isPending}
          disabled={rejoin.isPending}
          onPress={() =>
            Alert.alert(profile.rejoinConfirmTitle(student.firstName), profile.rejoinConfirmBody, [
              { text: copy.common.cancel, style: "cancel" },
              { text: profile.rejoinConfirm, onPress: () => void rejoinStudent() },
            ])
          }
          testID="student-rejoin"
        />
      ) : null}
      {rejoinError ? (
        <Notice
          tone="critical"
          message={toFriendlyError(rejoinError).message}
          testID="student-rejoin-error"
        />
      ) : null}

      {photoError ? (
        <Notice
          tone="critical"
          message={toFriendlyError(photoError).message}
          testID="student-photo-error"
        />
      ) : null}

      {firstContact || canSeeFees ? (
        <View style={styles.quickActions}>
          {firstContact ? (
            <CapsuleButton
              title={profile.call(copy.students.relations[firstContact.relation])}
              icon="call"
              variant="secondary"
              size="compact"
              onPress={() => callNumber(firstContact.phone)}
              testID="student-call-first"
              style={styles.quickAction}
            />
          ) : null}
          {canSeeFees ? (
            <CapsuleButton
              title={profile.fees}
              icon="fees"
              variant="secondary"
              size="compact"
              onPress={() =>
                router.push({
                  pathname: "/fees/student/[studentId]",
                  params: { studentId: student.id },
                })
              }
              testID="student-fees"
              style={styles.quickAction}
            />
          ) : null}
        </View>
      ) : null}

      <SectionLabel>{profile.family}</SectionLabel>
      {guardiansQuery.isPending ? (
        <Card>
          <Skeleton height={20} width="40%" />
        </Card>
      ) : (
        <Card padless>
          {guardians.length === 0 ? (
            <ThemedText variant="meta" style={styles.emptyLine}>
              {copy.students.guardiansEmpty}
            </ThemedText>
          ) : null}
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
                        params: { studentId: student.id, guardianId: guardian.id },
                      })
                  : undefined
              }
            />
          ))}
          {canUpdate ? (
            <LinkRow
              title={copy.people.guardians.add}
              icon="add"
              onPress={() =>
                router.push({ pathname: "/guardian-form", params: { studentId: student.id } })
              }
              accessibilityHint={copy.people.guardians.addHint}
              first={guardians.length === 0}
              testID="guardian-add"
            />
          ) : null}
          {canSeePortal ? (
            <LinkRow
              title={profile.familyLogin}
              detail={profile.familyLoginDetail}
              icon="key"
              onPress={() =>
                router.push({ pathname: "/portal-access", params: { studentId: student.id } })
              }
              accessibilityHint={copy.people.portal.hint}
              first={guardians.length === 0 && !canUpdate}
              testID="student-portal-link"
            />
          ) : null}
        </Card>
      )}

      <SectionLabel>{profile.record}</SectionLabel>
      <Card padless>
        <FactRow
          label={copy.students.fields.admissionNumber}
          value={student.admissionNumber}
          first
          testID="student-fact-admission"
        />
        {student.admissionDate ? (
          <FactRow
            label={copy.students.fields.admissionDate}
            value={formatReadableDate(student.admissionDate)}
          />
        ) : null}
        {status ? (
          <FactRow
            label={copy.people.enrollment.statusLabel}
            value={copy.people.enrollment.statuses[status]}
            testID="student-status"
          />
        ) : null}
        {enrollment?.leftOn ? (
          <FactRow label={profile.leftOn} value={formatReadableDate(enrollment.leftOn)} />
        ) : null}
        {enrollment?.leavingReason ? (
          <FactRow label={profile.reason} value={enrollment.leavingReason} />
        ) : null}
        {leaving.length > 0 ? (
          <LinkRow
            title={profile.leaving}
            onPress={() => setLeavingOpen(true)}
            accessibilityHint={profile.leavingHint}
            testID="student-leaving"
          />
        ) : null}
      </Card>

      {hasContact ? (
        <>
          <SectionLabel>{profile.contact}</SectionLabel>
          <Card padless>
            {student.phone ? (
              <FactRow
                label={copy.students.fields.phone}
                value={student.phone}
                first
                onPress={() => callNumber(student.phone ?? "")}
                accessibilityHint={profile.callHint}
              />
            ) : null}
            {student.email ? (
              <FactRow
                label={copy.students.fields.email}
                value={student.email}
                first={!student.phone}
              />
            ) : null}
            {address ? (
              <ThemedText
                variant="body"
                style={[
                  styles.addressBlock,
                  student.phone || student.email ? styles.divided : null,
                ]}
                testID="student-address"
              >
                {address}
              </ThemedText>
            ) : null}
          </Card>
        </>
      ) : null}

      {hasHealth ? (
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
                first={!student.medicalConditions && !student.emergencyContactName}
                onPress={() => callNumber(student.emergencyContactPhone ?? "")}
                accessibilityHint={profile.callHint}
              />
            ) : null}
          </Card>
        </>
      ) : null}

      {background.length > 0 ? (
        <>
          <SectionLabel>{copy.students.sections.background}</SectionLabel>
          <Card padless>
            {background.map((row, index) => (
              <FactRow
                key={row.label}
                label={row.label}
                value={row.value ?? ""}
                first={index === 0}
              />
            ))}
          </Card>
        </>
      ) : null}

      {canUpdate && emptyGroups.length > 0 ? (
        <Card padless style={styles.moreToAdd}>
          <LinkRow
            first
            title={profile.moreToAdd}
            detail={profile.moreToAddDetail(emptyGroups.join(", "))}
            icon="edit"
            onPress={() =>
              router.push({ pathname: "/student-form", params: { id: student.id } })
            }
            accessibilityHint={profile.moreToAddHint}
            testID="student-more-to-add"
          />
        </Card>
      ) : null}

      <PhotoSourceSheet
        visible={photoSheetOpen}
        hasPhoto={photo.hasPhoto}
        onDismiss={() => setPhotoSheetOpen(false)}
        onPicked={(picked) => void photo.upload(picked).catch(setPhotoError)}
        onRemove={confirmRemovePhoto}
        onError={setPhotoError}
      />

      <ChoiceSheet
        visible={leavingOpen}
        title={profile.leavingTitle}
        options={leaving.map((to) => ({
          id: to,
          label: profile.leavingReasons[to].label,
          detail: profile.leavingReasons[to].detail,
        }))}
        currentId=""
        onSelect={(id) => {
          setLeavingOpen(false);
          setLeavingTo(id as LeavingStatus);
        }}
        onDismiss={() => setLeavingOpen(false)}
        testIDPrefix="student-leaving-option"
      />

      {leavingTo && enrollment ? (
        <LeavingSheet
          organizationId={organizationId ?? ""}
          enrollmentId={enrollment.id}
          enrollmentDate={enrollment.enrollmentDate}
          firstName={student.firstName}
          to={leavingTo}
          onClose={() => setLeavingTo(null)}
          onSaved={() => {
            setLeavingTo(null);
            setSavedMsg(null);
            void utils.student.byId.invalidate({ id: student.id });
          }}
        />
      ) : null}

      {enrollSheet ? (
        <EnrollmentSheet
          organizationId={organizationId ?? ""}
          schoolId={schoolId}
          academicYearId={academicYear?.id ?? null}
          studentId={student.id}
          mode={enrollSheet}
          existing={enrollment ?? null}
          onClose={() => setEnrollSheet(null)}
          onSaved={(message) => {
            setEnrollSheet(null);
            setSavedMsg(message);
          }}
        />
      ) : null}
    </View>,
  );
}

/** How a student left: the last day and, if the desk wants to record it, why. */
function LeavingSheet({
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

/** One of class, section and roll: the value, or the way to fill it in. */
function PlacementCell({
  label,
  value,
  action,
  onPress,
  accessibilityHint,
  testID,
}: {
  label: string;
  value: string | null;
  /** Shown in place of a missing value when it can be filled in here. */
  action?: string;
  onPress?: () => void;
  accessibilityHint?: string;
  testID: string;
}) {
  const showAction = !value && Boolean(onPress) && Boolean(action);
  const body = (
    <>
      <ThemedText variant="caption" color={colors.muted} numberOfLines={1}>
        {label}
      </ThemedText>
      {showAction ? (
        <View style={styles.cellAction}>
          <AppIcon name="add" size={16} color={colors.accentDeep} />
          <ThemedText variant="bodyStrong" color={colors.accentDeep} numberOfLines={1}>
            {action}
          </ThemedText>
        </View>
      ) : (
        <ThemedText
          variant="bodyStrong"
          color={value ? undefined : colors.muted}
          numberOfLines={2}
          testID={`${testID}-value`}
        >
          {value ?? copy.students.profile.notSet}
        </ThemedText>
      )}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.cell} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value ?? action ?? ""}`}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.cell, pressed ? styles.cellPressed : null]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

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
    guardian.phone,
    guardian.isPrimary ? copy.students.guardianPrimary : null,
    guardian.isEmergencyContact ? copy.students.guardianEmergency : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const name = [guardian.firstName, guardian.lastName].filter(Boolean).join(" ");
  return (
    <PersonRow
      name={name}
      meta={copy.students.guardianMeta(copy.students.relations[guardian.relation], flags)}
      first={first}
      onPress={onPress}
      accessibilityHint={onPress ? copy.students.openHint : undefined}
      testID={`student-guardian-${guardian.id}`}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.students.profile.callGuardian(name)}
          accessibilityHint={copy.students.profile.callHint}
          hitSlop={4}
          onPress={() => callNumber(guardian.phone)}
          style={({ pressed }) => [styles.callButton, pressed ? styles.callPressed : null]}
          testID={`student-guardian-call-${guardian.id}`}
        >
          <AppIcon name="call" size={18} color={colors.accentDeep} />
        </Pressable>
      }
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
  body: {
    gap: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.lg,
  },
  heroFacts: {
    flex: 1,
    gap: spacing.xxs,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  placement: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.canvas,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    overflow: "hidden",
  },
  placementLoading: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    gap: spacing.xxs,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cellPressed: {
    backgroundColor: colors.field,
  },
  cellAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  enrollBlock: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  alignStart: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
  },
  quickActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  quickAction: {
    flex: 1,
  },
  emptyLine: {
    padding: spacing.lg,
  },
  callButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  callPressed: {
    backgroundColor: colors.accentStrong,
  },
  addressBlock: {
    padding: spacing.lg,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  moreToAdd: {
    marginTop: spacing.lg,
  },
  sheetSave: {
    alignSelf: "stretch",
  },
  leavingBody: {
    marginTop: spacing.sm,
  },
});
