import { StyleSheet, View } from "react-native";

import { AppIcon } from "../../../components/app-icon";
import { ThemedText } from "../../../components/themed-text";
import { formatReadableDate } from "../../../lib/format";
import { profileCopy } from "../../../lib/profile-copy";
import { colors } from "../../../theme/brand-admin";
import type { Tone } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { ProfileSheet } from "./profile-sheet";
import type { RecentHomework } from "./use-profile-data";

const words = profileCopy.homeworkSheet;

type Word = RecentHomework["items"][number]["word"];

/** How each of the student's words reads in colour: done is green, missed red. */
export const wordTone: Record<Word, Tone | null> = {
  checked: "positive",
  sent: "positive",
  late: "caution",
  redo: "caution",
  missed: "critical",
  to_do: null,
  with_teacher: null,
  over: "neutral",
};

/** The last ten homework this viewer may see, newest first, in the student's own words. */
export function HomeworkSheet({
  visible,
  homework,
  onDismiss,
}: {
  visible: boolean;
  homework: RecentHomework;
  onDismiss: () => void;
}) {
  return (
    <ProfileSheet visible={visible} onDismiss={onDismiss} testID="student-homework-sheet">
      <View style={styles.head}>
        <ThemedText variant="title">{words.title}</ThemedText>
        <ThemedText variant="meta">{words.hint}</ThemedText>
      </View>
      {homework.items.map((item, index) => {
        const tone = wordTone[item.word];
        const colorsOf = tone ? colors.tone[tone] : { fg: colors.muted, bg: colors.field };
        return (
          <View
            key={item.studentAssignmentId}
            style={[styles.row, index === 0 ? null : styles.divided]}
            testID={`student-homework-${item.studentAssignmentId}`}
          >
            <View style={[styles.icon, { backgroundColor: colorsOf.bg }]}>
              <AppIcon name="homework" size={18} color={colorsOf.fg} />
            </View>
            <View style={styles.text}>
              <ThemedText variant="bodyStrong" numberOfLines={2}>
                {item.title}
              </ThemedText>
              <ThemedText variant="meta" numberOfLines={1}>
                {`${item.subjectName} · ${words.due(formatReadableDate(item.dueAt.slice(0, 10)))}`}
              </ThemedText>
            </View>
            <View style={[styles.word, { backgroundColor: colorsOf.bg }]}>
              <ThemedText variant="tab" color={colorsOf.fg}>
                {words.words[item.word]}
              </ThemedText>
            </View>
          </View>
        );
      })}
    </ProfileSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.xxs,
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  word: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
});
