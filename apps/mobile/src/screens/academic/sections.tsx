import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
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

type SectionRow = inferRouterOutputs<AppRouter>["academic"]["section"]["list"][number];

/**
 * The running session's sections (Step 2 chunk B). Sections re-create every
 * year, so the list is the current session's, optionally narrowed to one
 * class. Creating or editing one lands here — the class filter keeps the
 * picker deep in the form honest too.
 */
export function SectionsScreen() {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("section:read");
  const canCreate = has("section:create");
  const canOpen = has("section:update") || has("section:delete");

  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );

  const list = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      ...(classFilter ? { classId: classFilter } : {}),
    },
    {
      enabled:
        ready && Boolean(organizationId) && canRead && Boolean(academicYear?.id),
    },
  );

  const className = (id: string) =>
    (classes.data ?? []).find((row) => row.id === id)?.name ?? null;

  const filterLabel = classFilter
    ? className(classFilter) ?? copy.academic.sections.allClasses
    : copy.academic.sections.allClasses;

  return (
    <AcademicListFrame
      title={copy.academic.sections.title}
      meta={branchName}
      canRead={canRead}
      deniedTitle={copy.academic.denied.sectionsReadTitle}
      deniedPermission="section:read"
      needsSession
      academicYear={Boolean(academicYear)}
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={list.isPending}
      error={list.error ?? null}
      onRetry={() => void list.refetch()}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      isEmpty={(list.data ?? []).length === 0}
      isFilteredEmpty={Boolean(classFilter)}
      emptyTitle={copy.academic.sections.emptyTitle}
      emptyBody={copy.academic.sections.emptyBody}
      filteredEmptyTitle={copy.academic.sections.filteredEmptyTitle}
      filteredEmptyBody={copy.academic.sections.filteredEmptyBody}
      emptyIcon="school"
      emptyAction={
        canCreate ? (
          <CapsuleButton
            title={copy.academic.sections.add}
            icon="add"
            onPress={() => router.push("/section-form")}
            testID="sections-empty-add"
          />
        ) : null
      }
      action={
        canRead && canCreate
          ? {
              label: copy.academic.sections.add,
              icon: "add" as const,
              onPress: () => router.push("/section-form"),
              accessibilityHint: copy.academic.sections.addHint,
              testID: "sections-add",
            }
          : undefined
      }
      titleTestID="sections-title"
      header={
        <View style={styles.filterWrap}>
          <Card style={styles.filterCard}>
            <ClassFilterRow
              label={filterLabel}
              onPress={() => setPickerOpen(true)}
            />
          </Card>
          <ChoiceSheet
            visible={pickerOpen}
            title={copy.academic.mappings.classPickerTitle}
            options={[
              { id: "", label: copy.academic.sections.allClasses },
              ...(classes.data ?? []).map((row) => ({
                id: row.id,
                label: row.name,
              })),
            ]}
            currentId={classFilter ?? ""}
            onSelect={(id) => {
              setClassFilter(id || null);
              setPickerOpen(false);
            }}
            onDismiss={() => setPickerOpen(false)}
            testIDPrefix="sections-class-filter"
          />
        </View>
      }
    >
      {(list.data ?? []).map((row: SectionRow) => (
        <EntityCard
          key={row.id}
          title={`${className(row.classId) ?? ""} · ${row.name}`.replace(/^ · /, "")}
          meta={
            [
              row.shift ? copy.academic.sections.shifts[row.shift] : null,
              row.roomNumber,
              row.maxStudents
                ? copy.attendance.studentsCount(row.maxStudents)
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || null
          }
          icon="school"
          onPress={
            canOpen
              ? () =>
                  router.push({
                    pathname: "/section-form",
                    params: { id: row.id },
                  })
              : undefined
          }
          accessibilityHint={canOpen ? copy.academic.sections.openHint : undefined}
          testID={`section-card-${row.id}`}
        />
      ))}
    </AcademicListFrame>
  );
}

function ClassFilterRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${copy.academic.sections.classFilterLabel}, ${label}`}
      accessibilityHint={copy.academic.mappings.classPickerTitle}
      onPress={onPress}
      style={({ pressed }) => [styles.filter, pressed ? styles.filterPressed : null]}
      testID="sections-class-filter"
    >
      <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.filterText}>
        {`${copy.academic.sections.classFilterLabel}: ${label}`}
      </ThemedText>
      <AppIcon name="chevronDown" size={16} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterWrap: {
    marginTop: spacing.xs,
  },
  filterCard: {
    paddingVertical: spacing.xs,
  },
  filter: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  filterPressed: {
    backgroundColor: colors.field,
  },
  filterText: {
    flex: 1,
  },
});
