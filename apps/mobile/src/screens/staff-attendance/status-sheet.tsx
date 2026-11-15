import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@expo/ui/community/bottom-sheet";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { weekdayShort } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import { fontFamily, radius, spacing } from "../../theme/tokens";
import type { Status } from "./draft";
import { RollRing } from "./roll-ring";
import type { SessionMix } from "./roll-ring";
import type { RecentMark } from "./roster-row";
import { SHEET_ORDER, statusDescription, statusLabel, statusShort, statusTone } from "./status-meta";

const statusIcon: Record<Status, AppIconName> = {
  present: "checkCircle",
  absent: "closeCircle",
  late: "clock",
  half_day: "halfDay",
  on_leave: "calendar",
};

export type SheetStudent = {
  studentId: string;
  name: string;
  roll: string | null;
  recent: readonly RecentMark[];
  mix: SessionMix | null;
  percentText: string | null;
};

/**
 * The hold sheet (v2 mockup frame 5): who it is with the session ring, the
 * last five marked days with their weekdays (the row's strip has letters
 * only), then the five statuses as a two-column grid of big targets, the last
 * one full width. The sheet scrolls at large text rather than clipping.
 */
export function StatusSheet({
  student,
  current,
  onSelect,
  onDismiss,
  onOpenProfile,
}: {
  student: SheetStudent | null;
  current: Status | null;
  onSelect: (status: Status) => void;
  onDismiss: () => void;
  onOpenProfile?: (studentId: string) => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const { height } = useWindowDimensions();
  const open = student !== null;
  const words = copy.attendance.marking;

  useEffect(() => {
    if (open) ref.current?.present();
    else ref.current?.dismiss();
  }, [open]);

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetScrollView
        style={{ maxHeight: Math.round(height * 0.86) }}
        contentContainerStyle={styles.content}
      >
        {student ? (
          <>
            <View style={styles.header}>
              <RollRing roll={student.roll} mix={student.mix} size={56} stroke={4.5} />
              <View style={styles.headerText}>
                <ThemedText variant="title" numberOfLines={2}>
                  {student.name}
                </ThemedText>
                <ThemedText variant="meta" numberOfLines={1}>
                  {[
                    student.roll ? words.roll(student.roll) : words.noRoll,
                    student.percentText,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </ThemedText>
              </View>
            </View>

            {student.recent.length > 0 ? (
              <View
                style={styles.history}
                accessible
                accessibilityLabel={`${words.sheetHistory}: ${student.recent
                  .map((mark) =>
                    words.recentA11y(
                      weekdayShort(mark.date),
                      mark.status ? statusLabel(mark.status) : words.unmarked,
                    ),
                  )
                  .join(", ")}`}
              >
                {student.recent.map((mark) => {
                  const tone = mark.status ? colors.tone[statusTone[mark.status]] : null;
                  return (
                    <View key={mark.date} style={styles.historyCell}>
                      <View style={[styles.historyBox, { backgroundColor: tone?.bg ?? colors.field }]}>
                        <ThemedText
                          variant="caption"
                          color={tone?.fg ?? colors.chevron}
                          style={styles.historyLetter}
                        >
                          {mark.status ? statusShort(mark.status) : "–"}
                        </ThemedText>
                      </View>
                      <ThemedText variant="tab" color={colors.muted}>
                        {weekdayShort(mark.date)}
                      </ThemedText>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View accessibilityRole="radiogroup" style={styles.options}>
              {SHEET_ORDER.map((status, index) => {
                const active = current === status;
                const { fg, bg } = colors.tone[statusTone[status]];
                const wide = index === SHEET_ORDER.length - 1;
                return (
                  <Pressable
                    key={status}
                    testID={`status-option-${status}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${statusLabel(status)}. ${statusDescription(status)}`}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onSelect(status);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      wide ? styles.optionWide : null,
                      { borderColor: active ? colors.ink : colors.hairline },
                      active ? styles.optionActive : null,
                      pressed ? styles.optionPressed : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.iconChip,
                        { backgroundColor: status === "absent" ? fg : bg },
                      ]}
                    >
                      <AppIcon
                        name={statusIcon[status]}
                        size={18}
                        color={status === "absent" ? colors.onAccent : fg}
                      />
                    </View>
                    <View style={styles.optionText}>
                      <ThemedText variant="bodyStrong" numberOfLines={1}>
                        {statusLabel(status)}
                      </ThemedText>
                      <ThemedText variant="caption" color={colors.muted} numberOfLines={2}>
                        {statusDescription(status)}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {onOpenProfile ? (
              <Pressable
                accessibilityRole="link"
                testID="status-sheet-profile"
                onPress={() => onOpenProfile(student.studentId)}
                hitSlop={8}
                style={styles.profile}
              >
                <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                  {words.openProfile}
                </ThemedText>
                <AppIcon name="chevronRight" size={16} color={colors.accentDeep} />
              </Pressable>
            ) : null}
          </>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headerText: { flex: 1, gap: spacing.xxs },
  history: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.lg },
  historyCell: { flex: 1, alignItems: "center", gap: 3 },
  historyBox: {
    alignSelf: "stretch",
    height: 28,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  historyLetter: { fontFamily: fontFamily.semibold },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  option: {
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  optionWide: { flexBasis: "100%" },
  optionActive: { borderWidth: 2 },
  optionPressed: { opacity: 0.85 },
  optionText: { flex: 1, gap: 1 },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: radius.sm + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    marginTop: spacing.lg,
    minHeight: 44,
  },
});
