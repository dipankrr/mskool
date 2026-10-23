import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { keepPreviousData } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { PersonRow } from "../../components/person-row";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

/**
 * The student roster (Step 2 chunk A). Read is every staff member's grant;
 * admit appears with `student:create`. The search is server-side (`q`) and
 * debounced, and `keepPreviousData` holds the previous rows while the next
 * page loads so typing never blanks the list.
 */
export function StudentsScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("student:read");
  const canCreate = has("student:create");

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const list = trpc.student.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      q: search.length > 0 ? search : undefined,
    },
    {
      enabled: ready && Boolean(organizationId) && canRead,
      placeholderData: keepPreviousData,
    },
  );

  const addAction =
    canRead && canCreate
      ? {
          label: copy.students.add,
          icon: "add" as const,
          onPress: () => router.push("/student-form"),
          accessibilityHint: copy.students.addHint,
          testID: "students-add",
        }
      : undefined;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.students.title}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      action={addAction}
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="students-title"
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
        testID="students-denied"
      />,
    );
  }

  if (!ready || (organizationId && list.isPending && !list.data)) {
    return frame(
      <View
        style={styles.list}
        accessibilityLabel={copy.students.loading}
        accessibilityLiveRegion="polite"
      >
        <Skeleton height={48} />
        {[0, 1, 2, 3].map((key) => (
          <Card key={key} style={styles.skeletonCard}>
            <View style={styles.skeletonRow}>
              <Skeleton width={40} height={40} />
              <View style={styles.skeletonText}>
                <Skeleton width="52%" height={16} />
                <Skeleton width="34%" height={12} />
              </View>
            </View>
          </Card>
        ))}
      </View>,
    );
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="students"
        title={copy.students.noOrgTitle}
        message={copy.students.noOrgBody}
        testID="students-no-org"
      />,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="students-error"
      />,
    );
  }

  const students = list.data ?? [];
  const searching = search.length > 0;

  return frame(
    <View style={styles.list}>
      <View style={styles.searchWrap}>
        <AppIcon
          name="search"
          size={18}
          color={colors.muted}
          style={styles.searchIcon}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={copy.students.searchPlaceholder}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          accessibilityLabel={copy.students.searchPlaceholder}
          accessibilityHint={copy.students.searchHint}
          style={styles.searchInput}
          testID="students-search"
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.students.clearSearch}
            hitSlop={8}
            onPress={() => setQuery("")}
            style={({ pressed }) => [pressed ? styles.pressed : null]}
            testID="students-search-clear"
          >
            <AppIcon name="closeCircle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {students.length > 0 ? (
        <>
          <Card padless>
            {students.map((student, index) => (
              <PersonRow
                key={student.id}
                name={[student.firstName, student.lastName].filter(Boolean).join(" ")}
                meta={copy.students.meta(student.admissionNumber)}
                trailing={
                  <AppIcon name="chevronRight" size={18} color={colors.chevron} />
                }
                first={index === 0}
                onPress={() =>
                  router.push({
                    pathname: "/students/[studentId]",
                    params: { studentId: student.id },
                  })
                }
                accessibilityHint={copy.students.openHint}
                testID={`student-row-${student.id}`}
              />
            ))}
          </Card>
        </>
      ) : searching ? (
        <EmptyState
          icon="search"
          title={copy.students.noResultsTitle}
          message={copy.students.noResultsBody}
          testID="students-no-results"
        />
      ) : (
        <EmptyState
          icon="students"
          title={copy.students.emptyTitle}
          message={copy.students.emptyBody}
          testID="students-empty"
        >
          {canCreate ? (
            <CapsuleButton
              title={copy.students.add}
              icon="add"
              onPress={() => router.push("/student-form")}
              testID="students-empty-add"
            />
          ) : null}
        </EmptyState>
      )}
    </View>,
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  searchWrap: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    color: colors.ink,
    paddingVertical: spacing.sm,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.6,
  },
  skeletonCard: {
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  skeletonText: {
    flex: 1,
    gap: spacing.sm,
  },
});
