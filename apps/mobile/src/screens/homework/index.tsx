import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { dueLine, sectionLabel, type HomeworkSummary } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { gutter, radius, spacing } from "../../theme/tokens";
import { GivenToast } from "./given-toast";

const text = copy.homework;

const KIND_ICON: Record<HomeworkSummary["kind"], AppIconName> = {
  homework: "homework",
  practice: "practice",
  project: "project",
  reading: "reading",
  quiz: "quiz",
};

/** `6A, 6B` for a homework's sections. */
function sectionsOf(hw: HomeworkSummary): string {
  return hw.sections.map((s) => sectionLabel(s.className, s.sectionName)).join(", ");
}

/** The progress line under an out-now homework, by how it comes back. */
function progressOf(hw: HomeworkSummary): string {
  const total = hw.sections.reduce((n, s) => n + s.total, 0);
  const submitted = hw.sections.reduce((n, s) => n + s.submitted + s.checked, 0);
  if (hw.comesBack === "tick") return text.home.progress.ticked(submitted, total);
  if (hw.comesBack === "sent") return text.home.progress.sent(submitted, total);
  return text.home.progress.given(total);
}

/**
 * The Homework tab's Home (frames 1 and 2): what to check now, then what is
 * out, then drafts, with Give always one tap away. Everything comes from one
 * read (`homework.home`), already narrowed to the caller's own classes.
 */
export function HomeworkScreen() {
  const { organizationId, schoolId, academicYear, yearPending } = useActiveContext();
  const { has } = usePermissions();
  const canGive = has("homework:create");
  const tabSpace = useTabBarSpace();
  const params = useLocalSearchParams<{ given?: string; labels?: string; draft?: string }>();
  // Give hands back what it did through the route; the toast lives as long as the params.
  const toast = params.given
    ? { id: params.given, labels: params.labels ?? "", draft: params.draft === "1" }
    : null;

  const home = trpc.homework.home.useQuery(
    { organizationId: organizationId ?? "", ...(schoolId ? { schoolId } : {}) },
    { enabled: Boolean(organizationId), staleTime: 30_000 },
  );
  const data = home.data;
  const nothing =
    data &&
    data.toCheck.length === 0 &&
    data.quizzes.length === 0 &&
    data.outNow.length === 0 &&
    data.drafts.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace + 72 }]}
        refreshControl={
          <RefreshControl refreshing={home.isRefetching} onRefresh={() => void home.refetch()} />
        }
      >
        <ThemedText variant="title" style={styles.title}>
          {text.title}
        </ThemedText>

        {!academicYear && !yearPending ? (
          <EmptyState icon="calendarOff" title={text.home.noYearTitle} message={text.home.noYearBody} />
        ) : home.isPending ? (
          <View style={styles.cards}>
            <Skeleton height={88} testID="homework-loading-1" />
            <Skeleton height={88} testID="homework-loading-2" />
          </View>
        ) : home.isError ? (
          <ErrorCard cause={home.error} onRetry={() => void home.refetch()} testID="homework-error" />
        ) : nothing ? (
          <EmptyState
            icon="homework"
            title={text.home.emptyTitle}
            message={text.home.emptyBody}
            testID="homework-empty"
          />
        ) : data ? (
          <>
            <SectionLabel style={styles.label}>{text.home.toCheck}</SectionLabel>
            {data.toCheck.length === 0 ? (
              <Card testID="homework-all-checked">
                <View style={styles.row}>
                  <AppIcon name="checkCircle" size={22} color={colors.accent} />
                  <View style={styles.grow}>
                    <ThemedText variant="bodyStrong">{text.home.allCheckedTitle}</ThemedText>
                    <ThemedText variant="meta">{text.home.allCheckedBody}</ThemedText>
                  </View>
                </View>
              </Card>
            ) : (
              <View style={styles.cards}>
                {data.toCheck.map((item) => (
                  <Card key={`${item.homework.id}:${item.sectionId}`} testID={`homework-check-${item.homework.id}`}>
                    <View style={styles.row}>
                      <KindTile kind={item.homework.kind} />
                      <View style={styles.grow}>
                        <ThemedText variant="name" numberOfLines={1}>
                          {sectionLabel(item.className, item.sectionName)} · {item.homework.subjectName}
                        </ThemedText>
                        <ThemedText variant="body" numberOfLines={1}>
                          {item.homework.title}
                        </ThemedText>
                        <ThemedText variant="meta" numberOfLines={1}>
                          {dueLine(item.homework.dueAt)} · {text.comesBackShort[item.homework.comesBack]}
                        </ThemedText>
                      </View>
                    </View>
                    <CapsuleButton
                      title={`${text.home.checkNow} · ${text.home.toCheckCount(item.toCheck)}`}
                      size="compact"
                      onPress={() =>
                        router.push({
                          pathname: "/homework/check",
                          params: {
                            id: item.homework.id,
                            sectionId: item.sectionId,
                            subjectId: item.homework.subjectId,
                          },
                        } as unknown as Href)
                      }
                      testID={`homework-check-now-${item.homework.id}-${item.sectionId}`}
                      style={styles.cardAction}
                    />
                  </Card>
                ))}
              </View>
            )}

            {data.quizzes.length > 0 ? (
              <>
                <SectionLabel style={styles.label}>{text.home.quizzes}</SectionLabel>
                <View style={styles.cards}>
                  {data.quizzes.map((hw) => (
                    <HomeworkRow key={hw.id} hw={hw} meta={text.home.quizLater} />
                  ))}
                </View>
              </>
            ) : null}

            {data.outNow.length > 0 ? (
              <>
                <SectionLabel style={styles.label}>{text.home.outNow}</SectionLabel>
                <View style={styles.cards}>
                  {data.outNow.map((hw) => (
                    <HomeworkRow key={hw.id} hw={hw} meta={`${dueLine(hw.dueAt)} · ${progressOf(hw)}`} />
                  ))}
                </View>
              </>
            ) : null}

            {data.drafts.length > 0 ? (
              <>
                <SectionLabel style={styles.label}>{text.home.drafts}</SectionLabel>
                <View style={styles.cards}>
                  {data.drafts.map((hw) => (
                    <HomeworkRow key={hw.id} hw={hw} meta={text.home.draftMeta} />
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {canGive && academicYear ? (
        <View style={[styles.fab, { bottom: tabSpace + spacing.md }]} pointerEvents="box-none">
          {toast ? (
            <GivenToast
              key={toast.id}
              homeworkId={toast.id}
              labels={toast.labels}
              draft={toast.draft}
              onDone={() => router.setParams({ given: undefined, labels: undefined, draft: undefined })}
            />
          ) : null}
          <CapsuleButton
            title={text.give.button}
            icon="add"
            onPress={() => router.push("/homework/give" as Href)}
            testID="homework-give"
            style={styles.fabButton}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function KindTile({ kind }: { kind: HomeworkSummary["kind"] }) {
  return (
    <View style={styles.kindTile}>
      <AppIcon name={KIND_ICON[kind]} size={20} color={colors.accentDeep} />
    </View>
  );
}

function HomeworkRow({ hw, meta }: { hw: HomeworkSummary; meta: string }) {
  return (
    <Card testID={`homework-row-${hw.id}`}>
      <View style={styles.row}>
        <KindTile kind={hw.kind} />
        <View style={styles.grow}>
          <ThemedText variant="name" numberOfLines={1}>
            {sectionsOf(hw)} · {hw.subjectName}
          </ThemedText>
          <ThemedText variant="body" numberOfLines={1}>
            {hw.book ? `${hw.book} · ${hw.title}` : hw.title}
          </ThemedText>
          <ThemedText variant="meta" numberOfLines={1}>
            {meta}
          </ThemedText>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.lg,
  },
  title: {
    marginBottom: spacing.sm,
  },
  label: {
    marginTop: spacing.xl,
  },
  cards: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  grow: {
    flex: 1,
    gap: spacing.xxs,
  },
  kindTile: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  cardAction: {
    marginTop: spacing.md,
  },
  fab: {
    position: "absolute",
    left: gutter,
    right: gutter,
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  fabButton: {
    minWidth: 120,
  },
});

