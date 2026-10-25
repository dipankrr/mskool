import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { formatMarks } from "../../lib/homework";
import { ALL_QUESTION_TYPES } from "../../lib/homework-questions";
import type { QuestionType } from "../../lib/homework-questions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { difficultyLabel, questionTypeLabel } from "./meta";
import type { BankItemRow } from "./types";

/**
 * The school's question bank, seen by a teacher.
 *
 * The bank is a library, not a list of homework: every row can be attached to
 * any set for its subject, and attaching copies it. Rows are therefore scanned
 * by the question text first, with the type as the one tinted cue and the
 * subject/marks as quiet metadata.
 *
 * `bank.list` returns active items only, newest first, clipped to the caller's
 * school scope. Search and the two filters run here because the whole (capped)
 * list is already in hand — no round trip per keystroke, and the filter counts
 * stay true. Retiring lives on the detail screen: it needs a confirmation and a
 * permission (principal/VP) that most teachers do not hold.
 */
export function HomeworkBankScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("homework:read");
  const canCreate = has("homework:create");
  const canReadSubjects = has("subject:read");

  const list = trpc.homework.bank.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: ready && canRead && Boolean(organizationId) },
  );

  const subjects = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && canReadSubjects && Boolean(organizationId) },
  );

  const subjectNames = useMemo(
    () => new Map((subjects.data ?? []).map((row) => [row.id, row.name])),
    [subjects.data],
  );

  const rows = useMemo<BankItemRow[]>(() => list.data ?? [], [list.data]);

  const [query, setQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<QuestionType | null>(null);
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [typeSheet, setTypeSheet] = useState(false);

  const subjectOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { id: string; label: string }[] = [];
    for (const row of rows) {
      if (seen.has(row.subjectId)) continue;
      seen.add(row.subjectId);
      const label = subjectNames.get(row.subjectId);
      if (label) options.push({ id: row.subjectId, label });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, subjectNames]);

  const typeOptions = useMemo(() => {
    const present = new Set(rows.map((row) => row.questionType));
    return ALL_QUESTION_TYPES.filter((type) => present.has(type));
  }, [rows]);

  const term = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (subjectFilter && row.subjectId !== subjectFilter) return false;
        if (typeFilter && row.questionType !== typeFilter) return false;
        if (!term) return true;
        return [row.body, row.topic ?? "", row.explanation ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(term);
      }),
    [rows, subjectFilter, typeFilter, term],
  );

  const filtersActive = Boolean(term || subjectFilter || typeFilter);

  const clearFilters = () => {
    setQuery("");
    setSubjectFilter(null);
    setTypeFilter(null);
  };

  const newAction =
    canRead && canCreate
      ? {
          label: copy.homework.bank.new,
          icon: "add" as const,
          onPress: () => router.push("/homework/bank/new"),
          accessibilityHint: copy.homework.bank.newBody,
          testID: "homework-bank-new",
        }
      : undefined;

  const frame = (children: React.ReactNode) => (
    <ScreenFrame
      title={copy.homework.bank.title}
      meta={
        list.isSuccess ? copy.homework.bank.subtitle(rows.length) : null
      }
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-bank-back"
      titleTestID="homework-bank-title"
      action={newAction}
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.homework.bank.noAccessTitle}
        message={copy.homework.bank.noAccessBody}
        testID="homework-bank-denied"
      />,
    );
  }

  if (list.isPending) {
    return frame(
      <View
        style={styles.skeleton}
        accessibilityLabel={copy.homework.bank.title}
        accessibilityLiveRegion="polite"
      >
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} height={96} />
        ))}
      </View>,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="homework-bank-error"
      />,
    );
  }

  if (rows.length === 0) {
    return frame(
      <EmptyState
        icon="bank"
        title={copy.homework.bank.emptyTitle}
        message={copy.homework.bank.emptyBody}
        testID="homework-bank-empty"
      >
        {canCreate ? (
          <CapsuleButton
            title={copy.homework.bank.emptyAction}
            icon="add"
            onPress={() => router.push("/homework/bank/new")}
            testID="homework-bank-empty-add"
          />
        ) : null}
      </EmptyState>,
    );
  }

  return (
    <>
      {frame(
        <View style={styles.body}>
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
              placeholder={copy.homework.bank.searchPlaceholder}
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel={copy.homework.bank.searchPlaceholder}
              accessibilityHint={copy.homework.bank.searchHint}
              style={styles.searchInput}
              testID="homework-bank-search"
            />
            {query.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.homework.bank.clearSearch}
                hitSlop={8}
                onPress={() => setQuery("")}
                style={({ pressed }) => [pressed ? styles.pressed : null]}
                testID="homework-bank-search-clear"
              >
                <AppIcon name="closeCircle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.chips}>
            {subjectOptions.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${copy.homework.bank.filterSubject}: ${
                  subjectOptions.find((option) => option.id === subjectFilter)
                    ?.label ?? copy.homework.bank.allSubjects
                }`}
                onPress={() => setSubjectSheet(true)}
                style={({ pressed }) => [
                  styles.chip,
                  subjectFilter ? styles.chipOn : null,
                  pressed ? styles.pressed : null,
                ]}
                testID="homework-bank-subject-filter"
              >
                <ThemedText
                  variant="meta"
                  color={subjectFilter ? colors.accentDeep : colors.ink}
                  numberOfLines={1}
                >
                  {subjectOptions.find((option) => option.id === subjectFilter)
                    ?.label ?? copy.homework.bank.allSubjects}
                </ThemedText>
                <AppIcon
                  name="chevronDown"
                  size={14}
                  color={subjectFilter ? colors.accentDeep : colors.muted}
                />
              </Pressable>
            ) : null}

            {typeOptions.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${copy.homework.bank.filterType}: ${
                  typeFilter
                    ? questionTypeLabel(typeFilter)
                    : copy.homework.bank.allTypes
                }`}
                onPress={() => setTypeSheet(true)}
                style={({ pressed }) => [
                  styles.chip,
                  typeFilter ? styles.chipOn : null,
                  pressed ? styles.pressed : null,
                ]}
                testID="homework-bank-type-filter"
              >
                <ThemedText
                  variant="meta"
                  color={typeFilter ? colors.accentDeep : colors.ink}
                  numberOfLines={1}
                >
                  {typeFilter
                    ? questionTypeLabel(typeFilter)
                    : copy.homework.bank.allTypes}
                </ThemedText>
                <AppIcon
                  name="chevronDown"
                  size={14}
                  color={typeFilter ? colors.accentDeep : colors.muted}
                />
              </Pressable>
            ) : null}

            {filtersActive ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.homework.clearFilters}
                onPress={clearFilters}
                style={({ pressed }) => [
                  styles.chip,
                  pressed ? styles.pressed : null,
                ]}
                testID="homework-bank-clear-filters"
              >
                <AppIcon name="close" size={14} color={colors.muted} />
                <ThemedText variant="meta">
                  {copy.homework.clearFilters}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          {filtersActive ? (
            <ThemedText
              variant="meta"
              accessibilityLiveRegion="polite"
              testID="homework-bank-count"
            >
              {copy.homework.bank.showingCount(filtered.length, rows.length)}
            </ThemedText>
          ) : null}

          {filtered.length === 0 ? (
            <EmptyState
              icon="search"
              title={copy.homework.bank.filteredEmptyTitle}
              message={copy.homework.bank.filteredEmptyBody}
              testID="homework-bank-filtered-empty"
            >
              <CapsuleButton
                title={copy.homework.clearFilters}
                variant="secondary"
                size="compact"
                onPress={clearFilters}
                testID="homework-bank-filtered-clear"
              />
            </EmptyState>
          ) : (
            <View style={styles.rows}>
              {filtered.map((row) => (
                <BankRow
                  key={row.id}
                  row={row}
                  subjectName={subjectNames.get(row.subjectId) ?? null}
                  onPress={() =>
                    router.push({
                      pathname: "/homework/bank/[itemId]",
                      params: { itemId: row.id },
                    })
                  }
                />
              ))}
            </View>
          )}
        </View>,
      )}

      <ChoiceSheet
        visible={subjectSheet}
        title={copy.homework.bank.filterSubject}
        options={[
          { id: "", label: copy.homework.bank.allSubjects },
          ...subjectOptions,
        ]}
        currentId={subjectFilter ?? ""}
        onSelect={(id) => {
          setSubjectFilter(id.length > 0 ? id : null);
          setSubjectSheet(false);
        }}
        onDismiss={() => setSubjectSheet(false)}
        testIDPrefix="homework-bank-subject"
      />

      <ChoiceSheet
        visible={typeSheet}
        title={copy.homework.bank.filterType}
        options={[
          { id: "", label: copy.homework.bank.allTypes },
          ...typeOptions.map((type) => ({
            id: type,
            label: questionTypeLabel(type),
          })),
        ]}
        currentId={typeFilter ?? ""}
        onSelect={(id) => {
          setTypeFilter(
            id.length > 0 && ALL_QUESTION_TYPES.includes(id as QuestionType)
              ? (id as QuestionType)
              : null,
          );
          setTypeSheet(false);
        }}
        onDismiss={() => setTypeSheet(false)}
        testIDPrefix="homework-bank-type"
      />
    </>
  );
}

function BankRow({
  row,
  subjectName,
  onPress,
}: {
  row: BankItemRow;
  subjectName: string | null;
  onPress: () => void;
}) {
  const type = questionTypeLabel(row.questionType);
  const marks = formatMarks(row.defaultMarks) ?? row.defaultMarks;
  const meta = [subjectName, copy.homework.bank.meta(type, marks)]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.body}
      accessibilityHint={meta}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed ? styles.rowPressed : null,
      ]}
      testID={`homework-bank-row-${row.id}`}
    >
      <View style={styles.rowHead}>
        <View style={styles.typePill}>
          <ThemedText
            variant="caption"
            color={colors.accentDeep}
            numberOfLines={1}
          >
            {type}
          </ThemedText>
        </View>
        <ThemedText variant="caption" color={colors.muted} numberOfLines={1}>
          {difficultyLabel(row.difficulty)}
        </ThemedText>
        <AppIcon name="chevronRight" size={18} color={colors.chevron} />
      </View>

      <ThemedText variant="body" numberOfLines={3}>
        {row.body}
      </ThemedText>

      <ThemedText variant="meta" numberOfLines={1}>
        {meta}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeleton: {
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
  searchIcon: {
    marginTop: 1,
  },
  searchInput: {
    flex: 1,
    color: colors.ink,
    paddingVertical: spacing.sm,
    fontSize: fontSize.callout,
    fontFamily: fontFamily.regular,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  typePill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  pressed: {
    opacity: 0.6,
  },
});
