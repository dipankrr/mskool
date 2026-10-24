import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { PersonRow } from "../../components/person-row";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { trpc } from "../../lib/trpc";
import { AcademicListFrame } from "./list-frame";

type AssignmentRow = inferRouterOutputs<
  AppRouter
>["assignment"]["teacherAssignment"]["list"][number];

/**
 * A section's open teacher assignments (Step 2 chunk B). The section is the
 * address — the picker rides the route (`sectionId`) — and teacher names come
 * from the directory, the same read the picker uses.
 */
export function TeacherAssignmentsScreen() {
  const { sectionId } = useLocalSearchParams<{ sectionId?: string }>();
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("teacher_assignment:read");
  const canCreate = has("teacher_assignment:create");
  const canOpen = has("teacher_assignment:update");

  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedSectionId = sectionId ?? null;

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );
  const sections = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      academicYearId: academicYear?.id ?? "",
    },
    {
      enabled:
        ready && Boolean(organizationId) && canRead && Boolean(academicYear?.id),
    },
  );
  const directory = trpc.assignment.teacherDirectory.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );
  const subjects = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );

  const list = trpc.assignment.teacherAssignment.list.useQuery(
    { organizationId: organizationId ?? "", sectionId: selectedSectionId ?? "" },
    {
      enabled:
        ready && Boolean(organizationId) && canRead && Boolean(selectedSectionId),
    },
  );

  const teacherName = (userId: string) =>
    (directory.data ?? []).find((row) => row.userId === userId)?.name ?? null;
  const subjectName = (id: string | null) =>
    id
      ? (subjects.data ?? []).find((row) => row.id === id)?.name ?? null
      : null;
  const sectionLabel = (id: string | null) => {
    if (!id) return null;
    const section = (sections.data ?? []).find((row) => row.id === id);
    if (!section) return null;
    const className =
      (classes.data ?? []).find((row) => row.id === section.classId)?.name ?? "";
    return `${className} · ${section.name}`.replace(/^ · /, "");
  };

  const hasSection = Boolean(selectedSectionId);

  return (
    <AcademicListFrame
      title={copy.academic.assignments.title}
      meta={[branchName, sectionLabel(selectedSectionId)].filter(Boolean).join(" · ") || null}
      canRead={canRead}
      deniedTitle={copy.academic.denied.assignmentsReadTitle}
      deniedPermission="teacher_assignment:read"
      needsSession
      academicYear={Boolean(academicYear)}
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={hasSection && list.isPending}
      error={hasSection ? (list.error ?? null) : null}
      onRetry={() => void list.refetch()}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      isEmpty={!hasSection || (list.data ?? []).length === 0}
      isFilteredEmpty={hasSection}
      emptyTitle={copy.academic.assignments.emptyTitle}
      emptyBody={copy.academic.assignments.emptyBody}
      filteredEmptyTitle={copy.academic.assignments.emptyTitle}
      filteredEmptyBody={copy.academic.assignments.emptyBody}
      emptyIcon="person"
      titleTestID="assignments-title"
      header={
        <View style={styles.filterWrap}>
          <Card style={styles.filterCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.academic.sections.title}, ${sectionLabel(selectedSectionId) ?? ""}`}
              accessibilityHint={copy.academic.assignments.sectionPickerTitle}
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [
                styles.filter,
                pressed ? styles.filterPressed : null,
              ]}
              testID="assignments-section-filter"
            >
              <ThemedText
                variant="bodyStrong"
                numberOfLines={1}
                style={styles.filterText}
              >
                {`Section: ${sectionLabel(selectedSectionId) ?? copy.academic.assignments.sectionPickerTitle}`}
              </ThemedText>
              <AppIcon name="chevronDown" size={16} color={colors.muted} />
            </Pressable>
          </Card>
          {hasSection && canCreate ? (
            <Card style={styles.filterCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.academic.assignments.add}
                onPress={() =>
                  router.push({
                    pathname: "/teacher-assignment-form",
                    params: { sectionId: selectedSectionId ?? "" },
                  })
                }
                style={({ pressed }) => [
                  styles.filter,
                  pressed ? styles.filterPressed : null,
                ]}
                testID="assignments-add"
              >
                <AppIcon name="add" size={18} color={colors.accentDeep} />
                <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                  {copy.academic.assignments.add}
                </ThemedText>
              </Pressable>
            </Card>
          ) : null}
          <ChoiceSheet
            visible={pickerOpen}
            title={copy.academic.assignments.sectionPickerTitle}
            options={(sections.data ?? []).map((section) => ({
              id: section.id,
              label: sectionLabel(section.id) ?? section.name,
            }))}
            currentId={selectedSectionId ?? ""}
            onSelect={(id) => {
              setPickerOpen(false);
              if (id && id !== selectedSectionId) {
                router.setParams({ sectionId: id });
              }
            }}
            onDismiss={() => setPickerOpen(false)}
            testIDPrefix="assignments-section"
          />
        </View>
      }
    >
      {(list.data ?? []).map((row: AssignmentRow) => (
        <PersonRow
          key={row.id}
          name={teacherName(row.userId) ?? row.userId}
          meta={[
            copy.academic.assignments.roles[row.role],
            subjectName(row.subjectId ?? null),
          ]
            .filter(Boolean)
            .join(" · ")}
          trailing={
            canOpen ? (
              <AppIcon name="chevronRight" size={18} color={colors.chevron} />
            ) : null
          }
          onPress={
            canOpen
              ? () =>
                  router.push({
                    pathname: "/teacher-assignment-form",
                    params: { id: row.id, sectionId: selectedSectionId ?? "" },
                  })
              : undefined
          }
          accessibilityHint={canOpen ? copy.academic.assignments.openHint : undefined}
          testID={`assignment-row-${row.id}`}
        />
      ))}
    </AcademicListFrame>
  );
}

const styles = StyleSheet.create({
  filterWrap: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  filterCard: {
    paddingVertical: spacing.xs,
  },
  filter: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  filterPressed: {
    backgroundColor: colors.field,
  },
  filterText: {
    flex: 1,
  },
});
