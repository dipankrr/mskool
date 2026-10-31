import { Pressable, StyleSheet, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { Card } from "../../components/card";
import { LinkRow } from "../../components/link-row";
import { ThemedText } from "../../components/themed-text";
import { useTabBarSpace } from "../../components/tab-bar";
import { useActiveContext, useBranchMeta } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { gutter, spacing } from "../../theme/tokens";

/**
 * Academic setup: the school's structure in one list, each row gated to its own
 * read permission and showing a live fact rather than a description.
 *
 * With no running session the list stays: Sessions is the way forward and is
 * first, Classes and Subjects work without one, and only the rows that truly
 * hang off a session lock and say so (ADR-047: the session is a fact, never a
 * picker). There is no dead end here.
 */
export function AcademicSetupScreen() {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const meta = useBranchMeta();
  const { has } = usePermissions();
  const tabSpace = useTabBarSpace();

  const orgReady = ready && Boolean(organizationId);
  const orgArgs = { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined };
  const yearArgs = {
    organizationId: organizationId ?? "",
    academicYearId: academicYear?.id ?? "",
  };
  const hasYear = Boolean(academicYear?.id);

  const classes = trpc.academic.class.list.useQuery(orgArgs, {
    enabled: orgReady && has("class:read"),
  });
  const sections = trpc.academic.section.list.useQuery(yearArgs, {
    enabled: orgReady && hasYear && has("section:read"),
  });
  const subjects = trpc.subject.list.useQuery(orgArgs, {
    enabled: orgReady && has("subject:read"),
  });
  const coverage = trpc.assignment.subjectMapping.coverage.useQuery(
    { organizationId: organizationId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: orgReady && hasYear && has("subject:read") },
  );
  const terms = trpc.academic.term.list.useQuery(yearArgs, {
    enabled: orgReady && hasYear && has("academic_year:read"),
  });

  const rowsCopy = copy.academic.rows;

  const rows: {
    key: string;
    title: string;
    detail: string;
    icon: AppIconName;
    can: boolean;
    route: string;
    locked?: boolean;
    testID: string;
  }[] = [
    {
      key: "sessions",
      title: rowsCopy.sessions,
      detail: academicYear ? rowsCopy.sessionRunning(academicYear.name) : rowsCopy.sessionNone,
      icon: "sessions",
      can: has("academic_year:read"),
      route: "/sessions",
      testID: "academic-sessions",
    },
    {
      key: "class-section",
      title: rowsCopy.classSection,
      detail: classes.data
        ? rowsCopy.classSectionFact(classes.data.length, sections.data?.length ?? null)
        : rowsCopy.classSectionDetail,
      icon: "stack",
      can: has("class:read"),
      route: "/class-section",
      testID: "academic-class-section",
    },
    {
      key: "subject-mapping",
      title: rowsCopy.subjectMapping,
      detail: subjects.data
        ? rowsCopy.subjectMappingFact(
            subjects.data.length,
            coverage.data && classes.data
              ? {
                  mapped: new Set(coverage.data.map((pair) => pair.classId)).size,
                  classes: classes.data.length,
                }
              : null,
          )
        : rowsCopy.subjectMappingDetail,
      icon: "subject",
      can: has("subject:read"),
      route: "/subject-mapping",
      testID: "academic-subject-mapping",
    },
    {
      key: "terms",
      title: rowsCopy.terms,
      detail: !hasYear
        ? rowsCopy.needsSession
        : terms.data
          ? rowsCopy.termsFact(terms.data.length)
          : rowsCopy.termsDetail,
      icon: "calendar",
      can: has("academic_year:read"),
      route: "/terms",
      locked: !hasYear,
      testID: "academic-terms",
    },
    {
      key: "assignments",
      title: rowsCopy.assignments,
      detail: hasYear ? rowsCopy.assignmentsDetail : rowsCopy.needsSession,
      icon: "person",
      can: has("teacher_assignment:read"),
      route: "/teacher-assignments",
      locked: !hasYear,
      testID: "academic-assignments",
    },
  ];
  const visible = rows.filter((row) => row.can);

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
          {meta ? (
            <ThemedText variant="meta" style={styles.org}>
              {meta}
            </ThemedText>
          ) : null}
        </View>

        {ready ? (
          <Card padless>
            {visible.map((row, index) => (
              <LinkRow
                key={row.key}
                title={row.title}
                detail={row.detail}
                icon={row.icon}
                locked={row.locked}
                onPress={() =>
                  router.push(row.route as Parameters<typeof router.push>[0])
                }
                first={index === 0}
                testID={row.testID}
              />
            ))}
          </Card>
        ) : null}
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
