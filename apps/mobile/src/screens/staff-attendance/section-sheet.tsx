import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import * as Haptics from "expo-haptics";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@expo/ui/community/bottom-sheet";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { fontFamily, radius, spacing } from "../../theme/tokens";

export type SectionOption = {
  id: string;
  label: string;
  className?: string | null;
  sectionName?: string;
  classOrder?: number;
};

/** Past this many sections the sheet opens with a class search box. */
const SEARCH_FROM = 12;

type Group = { key: string; name: string; order: number; sections: SectionOption[] };

/**
 * The attendance tab's section picker (owner, 2026-11-15: "10+ sections are
 * hard to choose"). One row per class, its sections as big chips — "Class 5
 * · A B C" — so a whole school fits on one screen instead of a long list of
 * "Class 5 · A, Class 5 · B…". A class search box appears once there are more
 * than twelve sections. Selecting applies immediately, like the old sheet.
 */
export function SectionSheet({
  visible,
  options,
  currentId,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  options: SectionOption[];
  currentId: string;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const words = copy.attendance.section;

  useEffect(() => {
    if (visible) {
      ref.current?.present();
    } else {
      ref.current?.dismiss();
    }
  }, [visible]);

  const groups = useMemo(() => groupByClass(options), [options]);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? groups.filter((group) => group.name.toLowerCase().includes(needle))
    : groups;
  const searchable = options.length > SEARCH_FROM;

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={() => {
        setQuery("");
        onDismiss();
      }}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetScrollView
        style={{ maxHeight: Math.round(height * 0.8) }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={searchable ? [1] : undefined}
      >
        <View style={styles.head}>
          <ThemedText variant="title">{words.sheetTitle}</ThemedText>
          <ThemedText variant="meta">{words.count(options.length)}</ThemedText>
        </View>
        {searchable ? (
          <View style={styles.searchWrap}>
            <View style={styles.search}>
              <AppIcon name="search" size={18} color={colors.muted} />
              <BottomSheetTextInput
                testID="section-search"
                value={query}
                onChangeText={setQuery}
                placeholder={words.search}
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel={words.search}
              />
              {query ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={words.clearSearch}
                  hitSlop={10}
                  onPress={() => setQuery("")}
                >
                  <AppIcon name="closeCircle" size={18} color={colors.chevron} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {shown.length === 0 ? (
          <ThemedText variant="meta" style={styles.empty}>
            {words.noMatch(query.trim())}
          </ThemedText>
        ) : (
          <View style={styles.groups}>
            {shown.map((group, index) => {
              const holdsCurrent = group.sections.some((section) => section.id === currentId);
              return (
                <View
                  key={group.key}
                  style={[styles.group, index > 0 ? styles.groupSeparated : null]}
                >
                  <ThemedText
                    variant="bodyStrong"
                    color={holdsCurrent ? colors.accentDeep : colors.ink}
                    numberOfLines={2}
                    style={styles.className}
                  >
                    {group.name}
                  </ThemedText>
                  <View style={styles.chips}>
                    {group.sections.map((section) => {
                      const selected = section.id === currentId;
                      return (
                        <Pressable
                          key={section.id}
                          testID={`section-option-${section.id}`}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={section.label}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            onSelect(section.id);
                          }}
                          style={({ pressed }) => [
                            styles.chip,
                            selected ? styles.chipOn : null,
                            pressed && !selected ? styles.chipPressed : null,
                          ]}
                        >
                          <ThemedText
                            variant="bodyStrong"
                            color={selected ? colors.onAccent : colors.ink}
                            numberOfLines={1}
                            style={styles.chipText}
                          >
                            {section.sectionName ?? section.label}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function groupByClass(options: readonly SectionOption[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const option of options) {
    const name = option.className ?? copy.attendance.section.otherClass;
    const key = option.className ?? "\u0000other";
    const group = byKey.get(key) ?? {
      key,
      name,
      order: option.classOrder ?? Number.MAX_SAFE_INTEGER,
      sections: [],
    };
    group.sections.push(option);
    byKey.set(key, group);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...byKey.values()]
    .sort((a, b) => a.order - b.order || collator.compare(a.name, b.name))
    .map((group) => ({
      ...group,
      sections: [...group.sections].sort((a, b) =>
        collator.compare(a.sectionName ?? a.label, b.sectionName ?? b.label),
      ),
    }));
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.huge,
  },
  head: { gap: spacing.xxs, marginBottom: spacing.sm },
  searchWrap: { backgroundColor: colors.surface, paddingBottom: spacing.sm },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.sm,
    fontFamily: fontFamily.regular,
    fontSize: 16,
    color: colors.ink,
  },
  empty: { textAlign: "center", marginTop: spacing.lg },
  groups: {},
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  groupSeparated: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  className: { width: 92 },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    minWidth: 48,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  chipOn: { backgroundColor: colors.accent },
  chipPressed: { backgroundColor: colors.accentTint },
  chipText: { fontVariant: ["tabular-nums"] },
});
