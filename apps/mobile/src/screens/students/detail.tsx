import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";

import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { PersonRow } from "../../components/person-row";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { FactRow } from "../../components/fact-row";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { formatReadableDate } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";

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
  const { organizationId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("student:read");
  const canUpdate = has("student:update");

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
      <SectionLabel>{copy.students.sections.identity}</SectionLabel>
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

      <SectionLabel>{copy.students.sections.guardians}</SectionLabel>
      {guardiansQuery.isPending ? (
        <Card>
          <Skeleton height={20} width="40%" />
        </Card>
      ) : guardians.length > 0 ? (
        <Card padless>
          {guardians.map((guardian, index) => (
            <GuardianRow key={guardian.id} guardian={guardian} first={index === 0} />
          ))}
        </Card>
      ) : (
        <Card>
          <ThemedText variant="meta">{copy.students.guardiansEmpty}</ThemedText>
        </Card>
      )}
    </View>,
  );
}

function GuardianRow({ guardian, first }: { guardian: Guardian; first: boolean }) {
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
      testID={`student-guardian-${guardian.id}`}
    />
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
  },
});
