import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { formatMarks } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { questionTypeLabel } from "./meta";
import type { BankItemRow } from "./types";

/**
 * The bridge between the bank and one homework. It lists ACTIVE questions for
 * the assignment's subject and copies the chosen rows into the set; the copy is
 * the whole point (ADR-039's snapshot), so the sheet says so in words.
 *
 * A question already attached is shown disabled rather than hidden: the teacher
 * can see the bank is not empty, and attaching the same snapshot twice is never
 * a useful accident. Selection is local until Attach; the parent appends and
 * closes, and the set is still unsaved until the set screen's Save runs.
 */
export function HomeworkBankPickerSheet({
  subjectId,
  subjectName,
  attachedIds,
  onAttach,
  onClose,
  onOpenBank,
}: {
  subjectId: string;
  subjectName: string;
  attachedIds: readonly string[];
  onAttach: (items: BankItemRow[]) => void;
  onClose: () => void;
  onOpenBank: () => void;
}) {
  const { organizationId, ready } = useActiveContext();
  const text = copy.homework.questions;

  const list = trpc.homework.bank.list.useQuery(
    { organizationId: organizationId ?? "", subjectId },
    { enabled: ready && Boolean(organizationId) },
  );

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const attached = useMemo(() => new Set(attachedIds), [attachedIds]);

  const term = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      (list.data ?? []).filter((row) =>
        term.length === 0
          ? true
          : [row.body, row.topic ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(term),
      ),
    [list.data, term],
  );

  const chosen = (list.data ?? []).filter((row) => selected.has(row.id));

  const toggle = (id: string) => {
    if (attached.has(id)) return;
    void Haptics.selectionAsync();
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const footer = (
    <CapsuleButton
      title={
        chosen.length > 0
          ? text.bankPickerAttach(chosen.length)
          : text.add
      }
      icon="add"
      disabled={chosen.length === 0}
      onPress={() => onAttach(chosen)}
      testID="homework-bank-picker-attach"
    />
  );

  return (
    <FormSheet
      title={text.bankPickerTitle}
      onClose={onClose}
      footer={footer}
      testIDPrefix="homework-bank-picker"
    >
      <View style={styles.body}>
        <ThemedText variant="meta">{text.bankPickerBody(subjectName)}</ThemedText>

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
            testID="homework-bank-picker-search"
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.homework.bank.clearSearch}
              hitSlop={8}
              onPress={() => setQuery("")}
              style={({ pressed }) => [pressed ? styles.pressed : null]}
              testID="homework-bank-picker-clear"
            >
              <AppIcon name="closeCircle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {list.isPending ? (
          <View style={styles.skeleton}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </View>
        ) : list.isError ? (
          <ErrorCard
            cause={list.error}
            onRetry={() => void list.refetch()}
            testID="homework-bank-picker-error"
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="bank"
            title={text.bankPickerEmptyTitle}
            message={
              term.length > 0
                ? copy.homework.bank.filteredEmptyBody
                : text.bankPickerEmptyBody
            }
            testID="homework-bank-picker-empty"
          >
            {term.length > 0 ? (
              <CapsuleButton
                title={copy.homework.filteredEmptyTitle}
                variant="secondary"
                size="compact"
                onPress={() => setQuery("")}
                testID="homework-bank-picker-clear-filters"
              />
            ) : (
              <CapsuleButton
                title={text.bankPickerEmptyAction}
                variant="secondary"
                size="compact"
                onPress={onOpenBank}
                testID="homework-bank-picker-open-bank"
              />
            )}
          </EmptyState>
        ) : (
          <>
            <ThemedText variant="meta">
              {text.bankPickerCount(selected.size, rows.length)}
            </ThemedText>
            <View style={styles.rows}>
              {rows.map((row) => (
                <BankPickerRow
                  key={row.id}
                  row={row}
                  selected={selected.has(row.id)}
                  already={attached.has(row.id)}
                  onPress={() => toggle(row.id)}
                />
              ))}
            </View>
            <Notice
              tone="neutral"
              message={text.composerHint}
              testID="homework-bank-picker-note"
            />
          </>
        )}
      </View>
    </FormSheet>
  );
}

function BankPickerRow({
  row,
  selected,
  already,
  onPress,
}: {
  row: BankItemRow;
  selected: boolean;
  already: boolean;
  onPress: () => void;
}) {
  const text = copy.homework.questions;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: already || selected, disabled: already }}
      accessibilityLabel={row.body}
      accessibilityHint={
        already ? text.attached : copy.homework.bank.attachHint
      }
      disabled={already}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowOn : null,
        pressed && !already ? styles.pressed : null,
        already ? styles.rowDisabled : null,
      ]}
      testID={`homework-bank-picker-row-${row.id}`}
    >
      <View
        style={[
          styles.check,
          selected || already ? styles.checkOn : null,
        ]}
      >
        {selected || already ? (
          <AppIcon name="check" size={14} color={colors.accentDeep} />
        ) : null}
      </View>
      <View style={styles.rowText}>
        <ThemedText variant="body" numberOfLines={3}>
          {row.body}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {[
            questionTypeLabel(row.questionType),
            text.bankPickerMarks(formatMarks(row.defaultMarks) ?? "1"),
            already ? text.attached : row.topic,
          ]
            .filter(Boolean)
            .join(" · ")}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    paddingBottom: spacing.md,
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
  skeleton: {
    gap: spacing.sm,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  rowOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  check: {
    width: 24,
    height: 24,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  checkOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  pressed: {
    opacity: 0.65,
  },
});
