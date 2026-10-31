import { useEffect, useState } from "react";
import {
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { router } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { Notice } from "../../components/notice";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useBranchMeta } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import {
  classesWithoutSection,
  nextClassOrder,
  nextSectionName,
  sectionsByClass,
} from "../../lib/class-section";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { gutter, motion, radius, spacing, touch } from "../../theme/tokens";
import { ClassSheetBody } from "./class-sheet";
import type { SectionShift } from "./form-logic";
import { AcademicListFrame } from "./list-frame";
import { SectionSheet } from "./section-sheet";

type ClassRow = inferRouterOutputs<AppRouter>["academic"]["class"]["list"][number];
type SectionRow = inferRouterOutputs<AppRouter>["academic"]["section"]["list"][number];

type ViewMode = "expanded" | "compact";

const VIEW_KEY = "mskool.class-section.view";

const CARD_PADDING = spacing.lg;
const CHIP_GAP = spacing.sm;
const CHIP_HEIGHT = 52;
const ADD_WIDTH = touch.min;
/** How much of the next chip shows when there are more than two. */
const PEEK = 24;
const MIN_CHIP_WIDTH = 96;

const SHIFT_ICONS: Record<SectionShift, AppIconName> = {
  morning: "shiftMorning",
  day: "shiftDay",
  evening: "shiftEvening",
};

const layoutMotion = LinearTransition.duration(motion.base);
const chipEntering = FadeIn.duration(motion.base);

/**
 * Classes and their sections on one screen, because a section only means
 * something inside its class. Classes are permanent; sections belong to the
 * running session, so with no session the classes still work and sections wait.
 *
 * The section row never wraps: two equal columns with "+" pinned at the right,
 * and anything beyond two scrolls sideways under it. So every open card is the
 * same height, the columns line up down the list, and larger text scrolls
 * rather than dropping "+" onto a line of its own.
 *
 * Expanded is the default. The toggle beside the summary switches every class
 * to names and counts, and each card can also fold itself.
 */
export function ClassSectionScreen() {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const meta = useBranchMeta();
  const { has } = usePermissions();

  const canRead = has("class:read");
  const canCreateClass = has("class:create");
  const canEditClass = has("class:update") || has("class:delete");
  const canReadSections = has("section:read");
  const canAddSection = has("section:create") && Boolean(academicYear);
  const canEditSection = has("section:update") || has("section:delete");

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );
  const sectionsEnabled =
    ready && Boolean(organizationId) && canReadSections && Boolean(academicYear?.id);
  const sections = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
    },
    { enabled: sectionsEnabled },
  );

  const [view, setView] = useState<ViewMode>("expanded");
  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY)
      .then((stored) => {
        if (stored === "compact") setView("compact");
      })
      .catch(() => {});
  }, []);
  // Expanded view: the cards folded by hand. Compact view: the one opened.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  const [sheet, setSheet] = useState<
    | { kind: "class"; row: ClassRow | null }
    | { kind: "section"; classRow: ClassRow; row: SectionRow | null }
    | null
  >(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  const classRows = classes.data ?? [];
  const grouped = sectionsByClass(
    classRows.map((row) => row.id),
    sectionsEnabled ? (sections.data ?? []) : [],
  );
  const sectionCount = sectionsEnabled ? (sections.data ?? []).length : 0;
  const gaps = sectionsEnabled ? classesWithoutSection(grouped) : 0;
  const showSections = sectionsEnabled;

  const switchView = () => {
    const next: ViewMode = view === "expanded" ? "compact" : "expanded";
    void Haptics.selectionAsync();
    setView(next);
    setFolded(new Set());
    setOpenId(null);
    void AsyncStorage.setItem(VIEW_KEY, next).catch(() => {});
  };

  const toggleFold = (id: string) => {
    void Haptics.selectionAsync();
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openSectionSheet = (classRow: ClassRow, row: SectionRow | null) =>
    setSheet({ kind: "section", classRow, row });

  const card = (row: ClassRow) => {
    const list = grouped.get(row.id) ?? [];
    return {
      name: row.name,
      count: showSections ? list.length : null,
      onEdit: canEditClass ? () => setSheet({ kind: "class", row }) : undefined,
      sectionRow: showSections ? (
        <SectionsLine
          sections={list}
          canAdd={canAddSection}
          canEdit={canEditSection}
          onAdd={() => openSectionSheet(row, null)}
          onOpen={(section) => openSectionSheet(row, section)}
        />
      ) : null,
    };
  };

  const closeSheet = () => setSheet(null);
  const savedAndClosed = (message: string) => {
    setSheet(null);
    setSaved(message);
  };

  return (
    <AcademicListFrame
      title={copy.academic.classSection.title}
      meta={meta}
      canRead={canRead}
      deniedTitle={copy.academic.denied.classesReadTitle}
      deniedPermission="class:read"
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={classes.isPending || (sectionsEnabled && sections.isPending)}
      error={classes.error ?? (sectionsEnabled ? sections.error : null) ?? null}
      onRetry={() => {
        void classes.refetch();
        if (sectionsEnabled) void sections.refetch();
      }}
      onRefresh={() => {
        void classes.refetch();
        if (sectionsEnabled) void sections.refetch();
      }}
      refreshing={classes.isRefetching || sections.isRefetching}
      isEmpty={classRows.length === 0}
      emptyTitle={copy.academic.classes.emptyTitle}
      emptyBody={copy.academic.classSection.emptyBody}
      emptyIcon="stack"
      emptyAction={
        canCreateClass ? (
          <CapsuleButton
            title={copy.academic.classes.add}
            icon="add"
            onPress={() => setSheet({ kind: "class", row: null })}
            testID="class-section-empty-add"
          />
        ) : null
      }
      action={
        canRead && canCreateClass
          ? {
              label: copy.academic.classes.add,
              icon: "add",
              onPress: () => setSheet({ kind: "class", row: null }),
              accessibilityHint: copy.academic.classes.addHint,
              testID: "class-section-add",
            }
          : undefined
      }
      sheets={
        <>
          {sheet?.kind === "class" ? (
            <ClassSheetBody
              organizationId={organizationId ?? ""}
              schoolId={schoolId}
              row={sheet.row}
              suggestedOrder={nextClassOrder(classRows.map((row) => row.numericOrder))}
              canWrite={sheet.row ? has("class:update") : canCreateClass}
              canDelete={Boolean(sheet.row) && has("class:delete")}
              onClose={closeSheet}
              onSaved={savedAndClosed}
            />
          ) : null}
          {sheet?.kind === "section" ? (
            <SectionSheet
              organizationId={organizationId ?? ""}
              schoolId={schoolId}
              academicYearId={academicYear?.id ?? null}
              classId={sheet.classRow.id}
              className={sheet.classRow.name}
              row={sheet.row}
              suggestedName={nextSectionName(
                (grouped.get(sheet.classRow.id) ?? []).map((section) => section.name),
              )}
              suggestedShift={(grouped.get(sheet.classRow.id) ?? []).at(-1)?.shift ?? "day"}
              canWrite={sheet.row ? has("section:update") : canAddSection}
              canDelete={Boolean(sheet.row) && has("section:delete")}
              onClose={closeSheet}
              onSaved={savedAndClosed}
            />
          ) : null}
        </>
      }
      titleTestID="class-section-title"
    >
      <View style={styles.summary}>
        <ThemedText variant="meta" numberOfLines={1} style={styles.summaryText}>
          {copy.academic.classSection.summary(
            classRows.length,
            showSections ? sectionCount : null,
          )}
        </ThemedText>
        {gaps > 0 ? (
          <StatusPill label={copy.academic.classSection.withoutSection(gaps)} tone="caution" />
        ) : null}
        {showSections ? (
          <IconButton
            icon={view === "expanded" ? "viewCompact" : "viewCards"}
            label={
              view === "expanded"
                ? copy.academic.classSection.showCompact
                : copy.academic.classSection.showExpanded
            }
            onPress={switchView}
            tinted
            testID="class-section-view"
          />
        ) : null}
      </View>

      {saved ? (
        <Notice tone="positive" message={saved} testID="class-section-saved" />
      ) : null}

      {!academicYear ? (
        <Notice
          tone="neutral"
          icon="sessions"
          message={copy.academic.classSection.noSessionNote}
          testID="class-section-no-session"
        >
          {has("academic_year:read") ? (
            <CapsuleButton
              title={copy.academic.classSection.openSessions}
              size="compact"
              variant="secondary"
              onPress={() => router.push("/sessions")}
              testID="class-section-open-sessions"
            />
          ) : null}
        </Notice>
      ) : null}

      {view === "compact" && showSections ? (
        <Card padless testID="class-section-compact">
          {classRows.map((row, index) => {
            const item = card(row);
            const open = openId === row.id;
            return (
              <Animated.View
                key={row.id}
                layout={layoutMotion}
                style={index === 0 ? null : styles.divider}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${row.name}, ${copy.academic.classSection.count(item.count ?? 0)}`}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setOpenId(open ? null : row.id);
                  }}
                  style={({ pressed }) => [
                    styles.compactRow,
                    pressed ? styles.compactPressed : null,
                  ]}
                  testID={`class-row-${row.id}`}
                >
                  <ThemedText variant="name" numberOfLines={1} style={styles.flex}>
                    {row.name}
                  </ThemedText>
                  {open && item.onEdit ? (
                    <IconButton
                      icon="edit"
                      label={copy.academic.classSection.editClass(row.name)}
                      onPress={item.onEdit}
                      testID={`class-edit-${row.id}`}
                    />
                  ) : (
                    <CountText count={item.count ?? 0} />
                  )}
                  <AppIcon
                    name={open ? "chevronUp" : "chevronDown"}
                    size={18}
                    color={colors.chevron}
                  />
                </Pressable>
                {open ? <View style={styles.compactBody}>{item.sectionRow}</View> : null}
              </Animated.View>
            );
          })}
        </Card>
      ) : (
        classRows.map((row) => {
          const item = card(row);
          const open = !folded.has(row.id);
          return (
            <Animated.View
              key={row.id}
              layout={layoutMotion}
              style={[styles.card, open && showSections ? styles.cardOpen : null]}
              testID={`class-card-${row.id}`}
            >
              <View style={styles.cardHead}>
                <View style={styles.cardTitle}>
                  <ThemedText variant="name" numberOfLines={1} style={styles.cardName}>
                    {row.name}
                  </ThemedText>
                  {item.count === null ? null : open ? (
                    item.count > 0 ? (
                      <ThemedText variant="meta" numberOfLines={1}>
                        {copy.academic.classSection.count(item.count)}
                      </ThemedText>
                    ) : null
                  ) : (
                    <CountText count={item.count} />
                  )}
                </View>
                {showSections ? (
                  <IconButton
                    icon={open ? "chevronUp" : "chevronDown"}
                    label={
                      open
                        ? copy.academic.classSection.foldClass(row.name)
                        : copy.academic.classSection.unfoldClass(row.name)
                    }
                    onPress={() => toggleFold(row.id)}
                    testID={`class-fold-${row.id}`}
                  />
                ) : null}
                {item.onEdit ? (
                  <IconButton
                    icon="edit"
                    label={copy.academic.classSection.editClass(row.name)}
                    onPress={item.onEdit}
                    testID={`class-edit-${row.id}`}
                  />
                ) : null}
              </View>
              {open ? item.sectionRow : null}
            </Animated.View>
          );
        })
      )}
    </AcademicListFrame>
  );
}

/** "2 sections", or an amber "No section" when the class has none. */
function CountText({ count }: { count: number }) {
  return count > 0 ? (
    <ThemedText variant="meta" numberOfLines={1}>
      {copy.academic.classSection.count(count)}
    </ThemedText>
  ) : (
    <ThemedText variant="chip" numberOfLines={1} color={colors.tone.caution.fg}>
      {copy.academic.classSection.noSection}
    </ThemedText>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  tinted = false,
  testID,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  tinted?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={tinted ? 3 : 0}
      onPress={onPress}
      style={({ pressed }) => [
        tinted ? styles.tintedButton : styles.iconButton,
        pressed ? styles.iconPressed : null,
      ]}
      testID={testID}
    >
      <AppIcon
        name={icon}
        size={18}
        color={tinted ? colors.accentDeep : colors.muted}
      />
    </Pressable>
  );
}

/** One line, always. See the screen's comment. */
function SectionsLine({
  sections,
  canAdd,
  canEdit,
  onAdd,
  onOpen,
}: {
  sections: readonly SectionRow[];
  canAdd: boolean;
  canEdit: boolean;
  onAdd: () => void;
  onOpen: (section: SectionRow) => void;
}) {
  const { width } = useWindowDimensions();
  const available =
    width - 2 * gutter - 2 * CARD_PADDING - (canAdd ? ADD_WIDTH + CHIP_GAP : 0);
  const fitted =
    sections.length > 2
      ? (available - 2 * CHIP_GAP - PEEK) / 2
      : (available - CHIP_GAP) / 2;
  const chipWidth = Math.max(fitted, MIN_CHIP_WIDTH * Math.min(PixelRatio.getFontScale(), 1.6));

  return (
    <View style={styles.line}>
      {sections.length === 0 ? (
        <View style={styles.gap} testID="class-no-section">
          <ThemedText variant="bodyStrong" numberOfLines={1} color={colors.tone.caution.fg}>
            {copy.academic.classSection.noSectionYet}
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.flex}
          contentContainerStyle={styles.chips}
        >
          {sections.map((section) => (
            <Animated.View key={section.id} entering={chipEntering}>
              <SectionChip
                section={section}
                width={chipWidth}
                onPress={canEdit ? () => onOpen(section) : undefined}
              />
            </Animated.View>
          ))}
        </ScrollView>
      )}
      {canAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.academic.sections.add}
          onPress={onAdd}
          style={({ pressed }) => [styles.add, pressed ? styles.addPressed : null]}
          testID="class-add-section"
        >
          <AppIcon name="add" size={22} color={colors.accentDeep} />
        </Pressable>
      ) : null}
    </View>
  );
}

function SectionChip({
  section,
  width,
  onPress,
}: {
  section: SectionRow;
  width: number;
  onPress?: () => void;
}) {
  const label = copy.academic.classSection.sectionLabel({
    name: section.name,
    shift: section.shift ? copy.academic.sections.shifts[section.shift] : null,
    room: section.roomNumber,
    seats: section.maxStudents,
  });
  const hasFacts = Boolean(section.roomNumber) || section.maxStudents !== null;
  const body = (
    <>
      <View style={styles.chipTop}>
        <ThemedText variant="name" numberOfLines={1} style={styles.flexShrink}>
          {section.name}
        </ThemedText>
        {section.shift ? (
          <AppIcon name={SHIFT_ICONS[section.shift]} size={14} color={colors.muted} />
        ) : null}
      </View>
      {hasFacts ? (
        <View style={styles.facts}>
          {section.roomNumber ? (
            <View style={styles.fact}>
              <AppIcon name="room" size={13} color={colors.muted} />
              <ThemedText variant="meta" numberOfLines={1} style={styles.flexShrink}>
                {section.roomNumber}
              </ThemedText>
            </View>
          ) : null}
          {section.maxStudents !== null ? (
            <View style={styles.seats}>
              <AppIcon name="seat" size={13} color={colors.muted} />
              <ThemedText variant="meta" numberOfLines={1}>
                {section.maxStudents}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={[styles.chip, { width }]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={copy.academic.sections.openHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { width },
        pressed ? styles.chipPressed : null,
      ]}
      testID={`section-chip-${section.id}`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  summary: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  summaryText: {
    flex: 1,
  },
  tintedButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  iconButton: {
    width: touch.min,
    height: touch.min,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  iconPressed: {
    backgroundColor: colors.field,
  },
  card: {
    paddingHorizontal: CARD_PADDING,
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  cardOpen: {
    paddingBottom: spacing.md,
  },
  cardHead: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    // The buttons' 44 pt targets may overlap the card's edge; the glyphs align.
    marginRight: -spacing.md,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  cardName: {
    flexShrink: 1,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  compactRow: {
    minHeight: touch.comfortable + spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: CARD_PADDING,
  },
  compactPressed: {
    backgroundColor: colors.field,
  },
  compactBody: {
    paddingHorizontal: CARD_PADDING,
    paddingBottom: spacing.md,
  },
  line: {
    flexDirection: "row",
    gap: CHIP_GAP,
  },
  chips: {
    gap: CHIP_GAP,
  },
  gap: {
    flex: 1,
    minWidth: 0,
    height: CHIP_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.caution.bg,
  },
  add: {
    width: ADD_WIDTH,
    height: CHIP_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.accentTint,
  },
  addPressed: {
    backgroundColor: colors.accentStrong,
  },
  chip: {
    minHeight: CHIP_HEIGHT,
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.canvas,
  },
  chipPressed: {
    backgroundColor: colors.field,
  },
  chipTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  facts: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  fact: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  seats: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
});
