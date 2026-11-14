import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { useFormat } from "../../i18n/format";
import { isOff, subjectsDue } from "../../lib/home";
import { useFamilyTheme } from "../../theme";
import { FCard, FSkeleton, FText } from "../../ui";
import { SectionHead, SubjectFace } from "./parts";
import type { Home } from "./use-home";

/** Subjects shown as faces before the strip gets too tight. */
const MAX_FACES = 5;

type Look = "plain" | "exam" | "off";

/**
 * What tomorrow looks like: a day off (and when school opens again), an exam
 * paper, or a school day with the subjects that have something due. When
 * tomorrow is off, the next school day follows under it.
 */
export function Tomorrow({ home }: { home: Home }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const theme = useFamilyTheme();
  const { ahead, papers, exam } = home;
  const { tomorrow, next } = ahead;
  const off = isOff(tomorrow.kind);

  if (home.thisMonth.isPending) {
    return (
      <View style={{ gap: theme.space.md }}>
        <SectionHead title={t("home.tomorrow.title")} />
        <FSkeleton height={120} radius="xl" />
      </View>
    );
  }

  const due = next ? subjectsDue(home.homework.data ?? [], next.date) : [];
  const nextCard = next ? (
    papers.length > 0 && exam ? (
      <DayCard
        testID="home-tomorrow-exam"
        look="exam"
        caption={exam.name}
        title={papers.map((paper) => paper.subjectName).join(", ")}
        onPress={() => router.push({ pathname: "/family/exam/[id]", params: { id: exam.id } })}
      >
        {papers.map((paper) => (
          <FText key={paper.subjectName + paper.startTime} variant="meta" color="inkSoft">
            {paper.venue
              ? t("home.tomorrow.paperVenue", {
                  time: format.time(paper.startTime),
                  duration: format.duration(paper.durationMinutes),
                  venue: paper.venue,
                })
              : t("home.tomorrow.paper", {
                  time: format.time(paper.startTime),
                  duration: format.duration(paper.durationMinutes),
                })}
          </FText>
        ))}
      </DayCard>
    ) : (
      <DayCard
        testID="home-tomorrow-school"
        look="plain"
        caption={format.date(next.date, "weekdayDayMonth")}
        title={t(
          next.kind === "half_day" ? "home.tomorrow.halfDay" : next.kind === "exam_day" ? "home.tomorrow.examDay" : "home.tomorrow.schoolDay",
        )}
        onPress={() => router.navigate("/family/homework")}
      >
        {home.papersPending ? (
          <FSkeleton width="60%" height={14} />
        ) : due.length > 0 ? (
          <View style={{ gap: theme.space.sm }}>
            <FText variant="meta" color="muted">
              {t("home.tomorrow.due")}
            </FText>
            <View style={[styles.row, { gap: theme.space.sm }]}>
              {due.slice(0, MAX_FACES).map((name, index) => (
                <SubjectFace key={name} name={name} index={index} />
              ))}
            </View>
          </View>
        ) : (
          <FText variant="meta" color="muted">
            {t("home.tomorrow.nothingDue")}
          </FText>
        )}
      </DayCard>
    )
  ) : null;

  return (
    <View testID="home-tomorrow" style={{ gap: theme.space.md }}>
      <SectionHead title={t("home.tomorrow.title")} aside={format.date(tomorrow.date, "weekdayDayMonth")} />
      {off ? (
        <DayCard
          testID="home-tomorrow-off"
          look="off"
          caption={t("home.tomorrow.noSchool")}
          title={tomorrow.label ?? (tomorrow.kind === "weekend" ? format.weekdayLong(tomorrow.date) : t("home.tomorrow.holiday"))}
        >
          <FText variant="meta" color="inkSoft">
            {next ? t("home.tomorrow.opens", { date: format.date(next.date, "weekdayDayMonth") }) : t("home.tomorrow.longBreak")}
          </FText>
        </DayCard>
      ) : null}
      {/* After a day off, the next school day is only worth a card when something waits there. */}
      {!off || papers.length > 0 || due.length > 0 ? nextCard : null}
    </View>
  );
}

function DayCard({
  look,
  caption,
  title,
  children,
  onPress,
  testID,
}: {
  look: Look;
  caption: string;
  title: string;
  children?: ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const theme = useFamilyTheme();
  const k = theme.components.home.tomorrow;
  const colors = k.look[look];
  return (
    <FCard
      testID={testID}
      onPress={onPress}
      label={`${caption}: ${title}`}
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderRadius: k.radius,
        padding: theme.space.lg,
        gap: theme.space.sm,
      }}
    >
      <View style={{ gap: theme.space.xxs }}>
        <FText variant="caption" tint={look === "plain" ? theme.color.muted : colors.fg} numberOfLines={1}>
          {caption.toUpperCase()}
        </FText>
        <FText variant="title" numberOfLines={2}>
          {title}
        </FText>
      </View>
      {children}
    </FCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
});
