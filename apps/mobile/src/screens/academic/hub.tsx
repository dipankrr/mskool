import { Pressable, StyleSheet, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { LinkRow } from "../../components/link-row";
import { EmptyState } from "../../components/empty-state";
import { ThemedText } from "../../components/themed-text";
import { useTabBarSpace } from "../../components/tab-bar";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { gutter, spacing } from "../../theme/tokens";

/**
 * Academic setup (Step 2 chunk B) — the six structural surfaces behind one
 * hub, each row gated to its own read permission. The surfaces bind to the
 * branch's running session; with none set, the hub says so instead of listing
 * doors that lead nowhere (ADR-047: the session is a fact, never a picker).
 */
export function AcademicSetupScreen() {
  const { academicYear, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();
  const tabSpace = useTabBarSpace();

  const rows = [
    {
      key: "classes",
      title: copy.academic.rows.classes,
      detail: copy.academic.rows.classesDetail,
      icon: "stack" as const,
      can: has("class:read"),
      route: "/classes",
      testID: "academic-classes",
    },
    {
      key: "sections",
      title: copy.academic.rows.sections,
      detail: copy.academic.rows.sectionsDetail,
      icon: "school" as const,
      can: has("section:read"),
      route: "/sections",
      testID: "academic-sections",
    },
    {
      key: "subjects",
      title: copy.academic.rows.subjects,
      detail: copy.academic.rows.subjectsDetail,
      icon: "edit" as const,
      can: has("subject:read"),
      route: "/subjects",
      testID: "academic-subjects",
    },
    {
      key: "terms",
      title: copy.academic.rows.terms,
      detail: copy.academic.rows.termsDetail,
      icon: "calendar" as const,
      can: has("academic_year:read"),
      route: "/terms",
      testID: "academic-terms",
    },
    {
      key: "mappings",
      title: copy.academic.rows.mappings,
      detail: copy.academic.rows.mappingsDetail,
      icon: "sort" as const,
      can: has("subject_mapping:read"),
      route: "/subject-mappings",
      testID: "academic-mappings",
    },
    {
      key: "assignments",
      title: copy.academic.rows.assignments,
      detail: copy.academic.rows.assignmentsDetail,
      icon: "person" as const,
      can: has("teacher_assignment:read"),
      route: "/teacher-assignments",
      testID: "academic-assignments",
    },
  ].filter((row) => row.can);

  const needsSession = [
    "sections",
    "terms",
    "mappings",
    "assignments",
  ].some((key) => rows.some((row) => row.key === key));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
      >
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.common.back}
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.back, pressed ? styles.backPressed : null]}
            testID="academic-back"
          >
            <AppIcon name="chevronLeft" size={22} color={colors.ink} />
          </Pressable>
          <ThemedText variant="title">{copy.academic.title}</ThemedText>
          {branchName ? (
            <ThemedText variant="meta" style={styles.org}>
              {branchName}
            </ThemedText>
          ) : null}
        </View>

        {!ready ? null : needsSession && !academicYear ? (
          <EmptyState
            icon="sessions"
            title={copy.academic.noSessionTitle}
            message={copy.academic.noSessionBody}
            testID="academic-no-session"
          />
        ) : (
          <Card padless>
            {rows.map((row, index) => (
              <LinkRow
                key={row.key}
                title={row.title}
                detail={row.detail}
                icon={row.icon}
                onPress={() =>
                  router.push(row.route as Parameters<typeof router.push>[0])
                }
                first={index === 0}
                testID={row.testID}
              />
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  back: {
    width: 44,
    height: 44,
    marginLeft: -spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  backPressed: {
    backgroundColor: colors.field,
  },
  org: {
    marginTop: spacing.xxs,
  },
});
