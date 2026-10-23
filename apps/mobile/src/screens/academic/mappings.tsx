import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EntityCard } from "../../components/entity-card";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { trpc } from "../../lib/trpc";
import { AcademicListFrame } from "./list-frame";

type MappingRow = inferRouterOutputs<
  AppRouter
>["assignment"]["subjectMapping"]["list"][number];

/**
 * A class's curriculum for the running session (Step 2 chunk B). The class is
 * the address — mappings exist only per (year, class) — so the picker sits on
 * the list and rides the route (`classId`), surviving deep links.
 */
export function SubjectMappingsScreen() {
  const { classId } = useLocalSearchParams<{ classId?: string }>();
  const { organizationId, academicYear, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("subject_mapping:read");
  const canCreate = has("subject_mapping:create");
  const canOpen = has("subject_mapping:update") || has("subject_mapping:delete");

  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedClassId = classId ?? null;

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: ready && Boolean(organizationId) && canRead },
  );
  const subjects = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: ready && Boolean(organizationId) && canRead },
  );

  const list = trpc.assignment.subjectMapping.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      classId: selectedClassId ?? "",
    },
    {
      enabled:
        ready &&
        Boolean(organizationId) &&
        canRead &&
        Boolean(academicYear?.id) &&
        Boolean(selectedClassId),
    },
  );

  const subjectName = (id: string) =>
    (subjects.data ?? []).find((row) => row.id === id)?.name ?? null;
  const className = selectedClassId
    ? (classes.data ?? []).find((row) => row.id === selectedClassId)?.name ?? null
    : null;

  const hasClass = Boolean(selectedClassId);

  return (
    <AcademicListFrame
      title={copy.academic.mappings.title}
      meta={[branchName, className].filter(Boolean).join(" · ") || null}
      canRead={canRead}
      deniedTitle={copy.academic.denied.mappingsReadTitle}
      deniedPermission="subject_mapping:read"
      needsSession
      academicYear={Boolean(academicYear)}
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={hasClass && list.isPending}
      // No class chosen yet is the list's resting state, not an error.
      error={hasClass ? (list.error ?? null) : null}
      onRetry={() => void list.refetch()}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      isEmpty={!hasClass || (list.data ?? []).length === 0}
      isFilteredEmpty={hasClass}
      emptyTitle={copy.academic.mappings.emptyTitle}
      emptyBody={copy.academic.mappings.emptyBody}
      filteredEmptyTitle={copy.academic.mappings.emptyTitle}
      filteredEmptyBody={copy.academic.mappings.emptyBody}
      emptyIcon="sort"
      titleTestID="mappings-title"
      header={
        <View style={styles.filterWrap}>
          <Card style={styles.filterCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.academic.sections.classFilterLabel}, ${className ?? ""}`}
              accessibilityHint={copy.academic.mappings.classPickerTitle}
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => [
                styles.filter,
                pressed ? styles.filterPressed : null,
              ]}
              testID="mappings-class-filter"
            >
              <ThemedText
                variant="bodyStrong"
                numberOfLines={1}
                style={styles.filterText}
              >
                {`${copy.academic.sections.classFilterLabel}: ${className ?? copy.academic.sections.allClasses}`}
              </ThemedText>
              <AppIcon name="chevronDown" size={16} color={colors.muted} />
            </Pressable>
          </Card>
          {hasClass && canCreate ? (
            <Card style={styles.filterCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.academic.mappings.add}
                onPress={() =>
                  router.push({
                    pathname: "/subject-mapping-form",
                    params: { classId: selectedClassId ?? "" },
                  })
                }
                style={({ pressed }) => [
                  styles.filter,
                  pressed ? styles.filterPressed : null,
                ]}
                testID="mappings-add"
              >
                <AppIcon name="add" size={18} color={colors.accentDeep} />
                <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                  {copy.academic.mappings.add}
                </ThemedText>
              </Pressable>
            </Card>
          ) : null}
          <ChoiceSheet
            visible={pickerOpen}
            title={copy.academic.mappings.classPickerTitle}
            options={(classes.data ?? []).map((row) => ({
              id: row.id,
              label: row.name,
            }))}
            currentId={selectedClassId ?? ""}
            onSelect={(id) => {
              setPickerOpen(false);
              if (id && id !== selectedClassId) {
                router.setParams({ classId: id });
              }
            }}
            onDismiss={() => setPickerOpen(false)}
            testIDPrefix="mappings-class"
          />
        </View>
      }
    >
      {(list.data ?? []).map((row: MappingRow) => (
        <EntityCard
          key={row.id}
          title={subjectName(row.subjectId) ?? row.subjectId}
          meta={copy.academic.mappings.meta(row.isElective, row.sequenceNumber)}
          icon="sort"
          onPress={
            canOpen
              ? () =>
                  router.push({
                    pathname: "/subject-mapping-form",
                    params: { id: row.id, classId: selectedClassId ?? "" },
                  })
              : undefined
          }
          accessibilityHint={canOpen ? copy.academic.mappings.openHint : undefined}
          testID={`mapping-card-${row.id}`}
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
