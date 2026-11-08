import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import type { Href } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { dueLine, sectionLabel, type HomeworkSummary } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors, type Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { InfoChip, KindTile, type Kind } from "./ui";

const text = copy.homework.all;
const PAGE = 30;
const KINDS: Kind[] = ["homework", "practice", "project", "reading", "quiz"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const STATUS: Partial<Record<HomeworkSummary["status"], { label: string; tone: Tone }>> = {
  draft: { label: text.statusDraft, tone: "neutral" },
  scheduled: { label: text.statusScheduled, tone: "neutral" },
  closed: { label: text.statusClosed, tone: "caution" },
  cancelled: { label: text.statusCancelled, tone: "critical" },
};

/**
 * Every homework the teacher may see, newest given first, grouped by month:
 * search by title or book, filter by type, and page back in time.
 */
export function AllHomeworkScreen() {
  const { organizationId, schoolId } = useActiveContext();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const term = search.trim();

  const query = useInfiniteQuery({
    queryKey: ["homework-all", organizationId, schoolId, kind, term],
    enabled: Boolean(organizationId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      utils.client.homework.list.query({
        organizationId: organizationId ?? "",
        ...(schoolId ? { schoolId } : {}),
        ...(kind ? { kind } : {}),
        ...(term ? { search: term } : {}),
        ...(pageParam ? { before: pageParam } : {}),
        limit: PAGE,
      }),
    getNextPageParam: (last) =>
      last.length < PAGE ? undefined : new Date(last[last.length - 1]!.createdAt).toISOString(),
  });

  const items = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const months = useMemo(() => {
    const out: { key: string; label: string; items: HomeworkSummary[] }[] = [];
    for (const hw of items) {
      const d = new Date(hw.publishedAt ?? hw.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      let group = out[out.length - 1];
      if (!group || group.key !== key) {
        group = { key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, items: [] };
        out.push(group);
      }
      group.items.push(hw);
    }
    return out;
  }, [items]);

  return (
    <ScreenFrame
      title={text.title}
      backAccessibilityLabel={copy.common.back}
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      stickyHeader={
        <View style={styles.header}>
          <View style={styles.search}>
            <AppIcon name="search" size={18} color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={text.search}
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              style={styles.searchInput}
              testID="hw-all-search"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            <Filter label={text.filterAll} on={kind === null} onPress={() => setKind(null)} />
            {KINDS.map((k) => (
              <Filter key={k} label={copy.homework.give.kinds[k]} on={kind === k} onPress={() => setKind(k)} />
            ))}
          </ScrollView>
        </View>
      }
    >
      {query.isPending ? (
        <View style={styles.stack}>
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : query.isError ? (
        <ErrorCard cause={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="homework" title={term || kind ? text.empty : text.emptyAll} />
      ) : (
        <>
          {months.map((m) => (
            <View key={m.key}>
              <SectionLabel style={styles.label}>{m.label}</SectionLabel>
              <Card padless>
                {m.items.map((hw, i) => (
                  <Pressable
                    key={hw.id}
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: "/homework/[id]", params: { id: hw.id } } as unknown as Href)}
                    style={({ pressed }) => [styles.row, i > 0 ? styles.divider : null, pressed ? styles.pressed : null]}
                    testID={`hw-all-${hw.id}`}
                  >
                    <KindTile kind={hw.kind} />
                    <View style={styles.grow}>
                      <ThemedText variant="name" numberOfLines={1}>
                        {hw.book ? `${hw.book} · ${hw.title}` : hw.title}
                      </ThemedText>
                      <ThemedText variant="meta" numberOfLines={1}>
                        {`${hw.subjectName} · ${hw.sections.map((s) => sectionLabel(s.className, s.sectionName)).join(", ")} · ${dueLine(hw.dueAt)}`}
                      </ThemedText>
                    </View>
                    {STATUS[hw.status] ? <InfoChip label={STATUS[hw.status]!.label} tone={STATUS[hw.status]!.tone} /> : null}
                  </Pressable>
                ))}
              </Card>
            </View>
          ))}
          {query.hasNextPage ? (
            <CapsuleButton
              title={text.loadMore}
              variant="secondary"
              onPress={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
              style={styles.more}
              testID="hw-all-more"
            />
          ) : null}
        </>
      )}
    </ScreenFrame>
  );
}

function Filter({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.filter, on ? styles.filterOn : null]}
    >
      <ThemedText variant="chip" color={on ? colors.onAccent : colors.ink}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  searchInput: { flex: 1, color: colors.ink, fontSize: 16 },
  filters: { gap: spacing.xs },
  filter: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.full, justifyContent: "center", backgroundColor: colors.chip },
  filterOn: { backgroundColor: colors.accent },
  stack: { gap: spacing.md, marginTop: spacing.md },
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  pressed: { opacity: 0.85 },
  grow: { flex: 1, gap: spacing.xxs },
  more: { alignSelf: "center", marginTop: spacing.lg },
});
