import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { useFormat } from "../../i18n/format";
import { isoOf } from "../../lib/home";
import type { PortalItem } from "../../lib/homework";
import { useFamilyTheme } from "../../theme";
import type { Tone } from "../../theme";
import { FSkeleton, FText } from "../../ui";
import { useResultText } from "../homework/parts";
import { SectionHead } from "./parts";
import type { Home } from "./use-home";

/** Homework given today shown before "N more given today". */
const MAX_GIVEN = 4;

const STATUS_TONE: Record<string, Tone | null> = {
  present: "positive",
  absent: "critical",
  late: "caution",
  half_day: "caution",
  on_leave: "info",
  not_marked: null,
};

type Event = {
  key: string;
  tone: Tone | null;
  caption: string;
  title: string;
  meta?: string | null;
  onPress?: () => void;
};

function openHomework(id: string) {
  router.push({ pathname: "/family/homework/[id]", params: { id } });
}

/**
 * The day's story, in order: attendance, homework given today, work that came
 * back from a teacher, and new teacher messages. Each line opens its screen.
 */
export function Today({ home }: { home: Home }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const theme = useFamilyTheme();
  const result = useResultText();
  const { story, attendanceToday: att } = home;

  if (home.homework.isPending || home.thisMonth.isPending) {
    return (
      <View style={{ gap: theme.space.md }}>
        <SectionHead title={t("home.today.title")} />
        <FSkeleton width="70%" height={18} />
        <FSkeleton width="50%" height={18} />
      </View>
    );
  }

  const toAttendance = () => router.navigate("/family/attendance");
  const events: Event[] = [];
  if (att.kind === "status") {
    events.push({
      key: "attendance",
      tone: STATUS_TONE[att.status] ?? null,
      caption: t("home.today.attendance"),
      title: t(`home.today.status.${att.status}`),
      onPress: toAttendance,
    });
  } else if (att.kind === "off") {
    events.push({
      key: "attendance",
      tone: "info",
      caption: t("home.today.attendance"),
      title: att.label ?? t(att.day === "holiday" ? "home.today.holiday" : "home.today.weekend"),
      onPress: toAttendance,
    });
  } else {
    events.push({
      key: "attendance",
      tone: null,
      caption: t("home.today.attendance"),
      title: t("home.today.notMarked"),
      onPress: toAttendance,
    });
  }

  const back = (item: PortalItem): Event => {
    const redo = item.word === "redo";
    return {
      key: `back-${item.studentAssignmentId}`,
      tone: redo ? "critical" : "positive",
      caption: t(redo ? "home.today.sentBack" : "home.today.checked", { subject: item.subjectName }),
      title: redo ? t("home.today.redoTitle") : (result(item) ?? t("home.today.checkedTitle")),
      meta: item.hasNote ? t("home.today.note") : item.title,
      onPress: () => openHomework(item.studentAssignmentId),
    };
  };
  for (const item of story.back) events.push(back(item));

  for (const item of story.given.slice(0, MAX_GIVEN)) {
    events.push({
      key: `given-${item.studentAssignmentId}`,
      tone: "info",
      caption: t("home.today.given", { subject: item.subjectName }),
      title: item.title,
      meta: t("home.today.givenMeta", {
        teacher: item.teacherName,
        date: format.date(isoOf(new Date(item.dueAt)), "weekdayDayMonth"),
      }),
      onPress: () => openHomework(item.studentAssignmentId),
    });
  }
  const moreGiven = story.given.length - MAX_GIVEN;
  if (moreGiven > 0) {
    events.push({
      key: "given-more",
      tone: null,
      caption: t("tabs.homework"),
      title: t("home.today.more", { count: moreGiven }),
      onPress: () => router.navigate("/family/homework"),
    });
  }

  for (const item of story.replies) {
    events.push({
      key: `reply-${item.studentAssignmentId}`,
      tone: "caution",
      caption: t("home.today.message", { subject: item.subjectName }),
      title: t("home.today.replies", { count: item.newReplies, teacher: item.teacherName }),
      meta: item.title,
      onPress: () => openHomework(item.studentAssignmentId),
    });
  }

  return (
    <View testID="home-today" style={{ gap: theme.space.md }}>
      <SectionHead title={t("home.today.title")} aside={format.date(home.today, "weekdayDayMonth")} />
      <Timeline events={events} />
      {events.length === 1 ? (
        <FText variant="meta" color="faint">
          {t("home.today.quiet")}
        </FText>
      ) : null}
    </View>
  );
}

function Timeline({ events }: { events: Event[] }) {
  const theme = useFamilyTheme();
  const k = theme.components.home.timeline;
  return (
    <View style={{ paddingLeft: k.indent }}>
      {events.map((event, index) => {
        const last = index === events.length - 1;
        const dot = (
          <View
            pointerEvents="none"
            style={[
              styles.dot,
              {
                left: -k.indent,
                top: 5,
                width: k.dot,
                height: k.dot,
                borderRadius: k.dot / 2,
                backgroundColor: event.tone ? theme.tone[event.tone].fg : k.neutral,
                borderWidth: 2,
                borderColor: k.ring,
              },
            ]}
          />
        );
        // Each event but the last draws the line down to the next dot.
        const body = (
          <>
            {last ? null : (
              <View
                pointerEvents="none"
                style={[
                  styles.line,
                  { left: -k.indent + (k.dot - k.lineWidth) / 2, top: 5 + k.dot, bottom: -5, width: k.lineWidth, backgroundColor: k.line },
                ]}
              />
            )}
            {dot}
            <FText variant="caption" color="muted" numberOfLines={1}>
              {event.caption.toUpperCase()}
            </FText>
            <FText variant="label" numberOfLines={2}>
              {event.title}
            </FText>
            {event.meta ? (
              <FText variant="meta" color="muted" numberOfLines={2}>
                {event.meta}
              </FText>
            ) : null}
          </>
        );
        const pad = { paddingBottom: theme.space.lg, minHeight: theme.touch.min };
        return event.onPress ? (
          <Pressable
            key={event.key}
            testID={`home-event-${event.key}`}
            accessibilityRole="button"
            accessibilityLabel={[event.caption, event.title, event.meta].filter(Boolean).join(", ")}
            onPress={event.onPress}
            style={({ pressed }) => [pad, pressed ? styles.pressed : null]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={event.key} style={pad}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { position: "absolute" },
  dot: { position: "absolute" },
  pressed: { opacity: 0.6 },
});
