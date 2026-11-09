import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../../components/app-icon";
import { countdown, resultLabel, shownWord, subjectSlot } from "../../lib/homework";
import type { Countdown, PortalItem, ShownWord } from "../../lib/homework";
import { useFamilyTheme } from "../../theme";
import { FRow, FText } from "../../ui";

const URL = /(https?:\/\/[^\s]+)/g;

/** A typed answer, with any web link tappable. */
export function LinkedText({ text }: { text: string }) {
  const theme = useFamilyTheme();
  const parts = text.split(URL);
  return (
    <FText variant="body" selectable>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <FText key={i} variant="bodyStrong" tint={theme.tone.info.fg} onPress={() => void Linking.openURL(part)}>
            {part}
          </FText>
        ) : (
          part
        ),
      )}
    </FText>
  );
}

/** A grey box for the child's own typed answer. */
export function AnswerBox({ text }: { text: string }) {
  const theme = useFamilyTheme();
  return (
    <View style={{ backgroundColor: theme.color.surfaceMuted, borderRadius: theme.radius.lg, padding: theme.space.lg }}>
      <LinkedText text={text} />
    </View>
  );
}

/** The time, refreshed every minute, so countdowns tick while a screen is open. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** A homework's tile: its type's icon on its subject's colour. */
export function KindTile({ kind, subject, size }: { kind: PortalItem["kind"]; subject: string; size?: number }) {
  const theme = useFamilyTheme();
  const h = theme.components.homework;
  const colors = h.subjects[subjectSlot(subject, h.subjects.length)]!;
  const side = size ?? h.tile.size;
  return (
    <View
      style={[
        styles.center,
        { width: side, height: side, borderRadius: h.tile.radius, backgroundColor: colors.bg },
      ]}
    >
      <AppIcon name={kind} size={Math.round(side * 0.52)} color={colors.fg} />
    </View>
  );
}

const WORD_ICON: Partial<Record<ShownWord, "check" | "resubmit" | "clock">> = {
  checked: "check",
  done: "check",
  redo: "resubmit",
  late: "clock",
};

/** One of the words, in its own colour everywhere. `result` replaces the word on a Checked row ("9/10"). */
export function WordPill({
  word,
  result,
  style,
}: {
  word: ShownWord;
  result?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const look = theme.components.homework.word[word];
  const icon = WORD_ICON[word];
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: look.bg,
          borderRadius: theme.radius.full,
          borderWidth: look.border ? 1.5 : 0,
          borderColor: look.border ?? undefined,
          paddingHorizontal: theme.space.md,
          gap: theme.space.xs,
        },
        style,
      ]}
    >
      {icon ? <AppIcon name={icon} size={14} color={look.fg} /> : null}
      <FText variant="caption" tint={look.fg} numberOfLines={1}>
        {result ?? t(`word.${word}`)}
      </FText>
    </View>
  );
}

/** "40m left" / "Late work closes in 1d" / "Closed for sending". */
export function useCountdownLabel() {
  const { t } = useTranslation("homework");
  return (c: Countdown): string =>
    c.kind === "left"
      ? t(`left.${c.unit}`, { amount: c.amount })
      : c.kind === "lateOpen"
        ? t(`lateOpen.${c.unit}`, { amount: c.amount })
        : t("closed");
}

export function countdownTone(c: Countdown): "critical" | "caution" | "muted" {
  if (c.kind === "left") return c.tone === "neutral" ? "muted" : c.tone;
  if (c.kind === "lateOpen") return "caution";
  return "muted";
}

/** The short result for a Checked row: "9/10", "A", "Excellent". */
export function useResultText() {
  const { t } = useTranslation("homework");
  return (item: PortalItem): string | null => {
    const r = resultLabel(item);
    if (!r) return null;
    if ("remark" in r) return t(`remark.${r.remark}`);
    return r.value + (r.unit ?? "");
  };
}

/** A homework row: tile, title, subject with the countdown, and the word. */
export function HomeworkRow({ item, now, onPress }: { item: PortalItem; now: Date; onPress: () => void }) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const label = useCountdownLabel();
  const result = useResultText();
  const word = shownWord(item);
  const open = item.word === "to_do" || item.word === "redo";
  const c = countdown(item.dueAt, item.closeAt, now);
  const settled = item.word === "checked" || item.word === "missed" || item.word === "over";
  const sub = open
    ? `${item.subjectName} · ${label(c)}`
    : item.word === "checked"
      ? `${item.subjectName} · ${result(item) ?? t(`detail.checkLook.${item.checkStatus ?? "done"}`)}`
      : item.subjectName;
  const done = theme.components.homework.doneRow;
  return (
    <FRow
      testID={`hw-row-${item.studentAssignmentId}`}
      title={item.title}
      subtitle={sub}
      subtitleTone={open && c.kind !== "left" ? "caution" : open && c.kind === "left" && c.tone !== "neutral" ? c.tone : undefined}
      leading={<KindTile kind={item.kind} subject={item.subjectName} />}
      trailing={
        <View style={[styles.trail, { gap: theme.space.xs }]}>
          {item.isNew || item.newReplies > 0 ? <NewMark replies={item.newReplies} isNew={item.isNew} /> : null}
          <WordPill word={word} result={item.word === "checked" ? result(item) : null} />
        </View>
      }
      chevron={false}
      onPress={onPress}
      style={settled ? { backgroundColor: done.bg, borderColor: done.border, borderWidth: 1.5 } : { paddingHorizontal: theme.space.md }}
    />
  );
}

/** A coral dot for a new result, or a speech bubble with the count of unread teacher messages. */
export function NewMark({ isNew, replies }: { isNew: boolean; replies: number }) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const coral = theme.color.highlight;
  if (replies > 0) {
    return (
      <View
        accessible
        accessibilityLabel={t("newReplies", { count: replies })}
        style={[styles.pill, { gap: 2, paddingHorizontal: theme.space.sm, borderRadius: theme.radius.full, backgroundColor: coral }]}
      >
        <AppIcon name="comments" size={12} color={theme.color.onAccent} />
        <FText variant="caption" color="onAccent">
          {String(replies)}
        </FText>
      </View>
    );
  }
  return isNew ? (
    <View accessible accessibilityLabel={t("new")} style={{ width: 10, height: 10, borderRadius: theme.radius.full, backgroundColor: coral }} />
  ) : null;
}

const styles = StyleSheet.create({
  trail: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", minHeight: 28, alignSelf: "center" },
});
