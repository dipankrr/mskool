import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { feesCopy } from "../../lib/fees-copy";
import { formatMoney, isPositiveMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";

/**
 * Where the dashboard's Collect button lands: find the student who is paying,
 * then collect. Search is the whole screen because the parent is standing there.
 */
export function CollectSearchScreen() {
  const { organizationId, academicYear, ready } = useActiveContext();
  const words = feesCopy.collectSearch;
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const list = trpc.fees.dashboard.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      search,
      show: "all",
      sort: "name",
      page: 1,
      pageSize: 20,
    },
    {
      enabled:
        ready && Boolean(organizationId) && Boolean(academicYear?.id) && search.length > 0,
    },
  );

  return (
    <ScreenFrame
      title={words.title}
      meta={words.meta}
      backAccessibilityLabel={copy.common.back}
      titleTestID="fees-collect-search-title"
    >
      <View style={styles.body}>
        <View style={styles.searchWrap}>
          <AppIcon name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={words.placeholder}
            placeholderTextColor={colors.muted}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel={words.placeholder}
            style={styles.searchInput}
            testID="fees-collect-search"
          />
        </View>

        {search.length === 0 ? (
          <ThemedText variant="meta" style={styles.prompt}>
            {words.prompt}
          </ThemedText>
        ) : list.isError ? (
          <ErrorCard
            cause={list.error}
            onRetry={() => void list.refetch()}
            testID="fees-collect-search-error"
          />
        ) : list.isPending ? (
          <Skeleton height={140} />
        ) : (list.data?.rows.length ?? 0) === 0 ? (
          <EmptyState icon="search" title={words.empty} testID="fees-collect-search-empty" />
        ) : (
          <Card padless>
            {list.data?.rows.map((row, index) => (
              <Pressable
                key={row.studentId}
                accessibilityRole="button"
                accessibilityLabel={`${row.studentName}. ${row.className}. ${formatMoney(row.dueNow)}`}
                onPress={() =>
                  router.replace({
                    pathname: "/fees/collect/[studentId]",
                    params: {
                      studentId: row.studentId,
                      studentName: row.studentName,
                      className: [row.className, row.sectionName].filter(Boolean).join(" · "),
                    },
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  index === 0 ? null : styles.divider,
                  pressed ? styles.pressed : null,
                ]}
                testID={`fees-collect-pick-${row.studentId}`}
              >
                <View style={styles.who}>
                  <ThemedText variant="name" numberOfLines={1}>
                    {row.studentName}
                  </ThemedText>
                  <ThemedText variant="meta" numberOfLines={1}>
                    {[row.className, row.sectionName, row.admissionNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  </ThemedText>
                </View>
                <ThemedText
                  variant="meta"
                  numberOfLines={1}
                  color={isPositiveMoney(row.dueNow) ? colors.ink : colors.tone.positive.fg}
                >
                  {isPositiveMoney(row.dueNow)
                    ? words.owes(formatMoney(row.dueNow))
                    : words.nothingDue}
                </ThemedText>
              </Pressable>
            ))}
          </Card>
        )}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
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
  searchInput: {
    flex: 1,
    color: colors.ink,
    paddingVertical: spacing.sm,
    fontSize: fontSize.callout,
    fontFamily: fontFamily.regular,
  },
  prompt: {
    paddingHorizontal: spacing.xs,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  who: {
    flex: 1,
    gap: 2,
  },
});
