import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { todayIso } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import { EXAM_TONE, nextDay, papersByDay } from "../../lib/exams";
import { Enter, Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FCard, FErrorState, FHeader, FPill, FScreen, FSkeleton, FText } from "../../ui";

/**
 * One exam's date sheet for the child: each day's papers with time,
 * duration, room and the parts' max marks. Today and the next paper day are
 * marked. Never marks or pass marks (hard rule 8).
 */
export function FamilyExam() {
  const { t } = useTranslation("exams");
  const format = useFormat();
  const theme = useFamilyTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const detail = trpc.portalExam.schedule.detail.useQuery(
    { studentId, examId: id ?? "" },
    { enabled: studentId.length > 0 && !!id },
  );
  const data = detail.data;
  const today = todayIso();
  const days = data ? papersByDay(data.papers) : [];
  // Only a running or coming exam has a "today" or "next" paper day.
  const live = data?.state === "upcoming" || data?.state === "ongoing";
  const highlight = live ? nextDay(days, today) : null;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/family/exams"));

  const header = <FHeader title={data?.name ?? ""} onBack={back} backLabel={t("sheet.back")} display />;

  if (detail.isError && !data) {
    return (
      <FScreen header={header}>
        <FErrorState onRetry={() => void detail.refetch()} />
      </FScreen>
    );
  }

  return (
    <FScreen
      testID="family-exam"
      header={header}
      refreshing={detail.isRefetching}
      onRefresh={() => void detail.refetch()}
    >
      <Reveal
        loading={detail.isPending}
        placeholder={
          <View style={{ gap: theme.components.row.stackGap }}>
            <FSkeleton width="60%" height={18} />
            <FSkeleton height={120} radius="xl" />
            <FSkeleton height={120} radius="xl" />
          </View>
        }
      >
        {data ? (
          <View style={{ gap: theme.components.screen.sectionGap }}>
            <View style={{ gap: theme.space.sm }}>
              <FText variant="meta" color="muted">
                {data.term
                  ? t("typeTerm", { type: t(`type.${data.examType}`), term: data.term.name })
                  : t(`type.${data.examType}`)}
              </FText>
              <View style={[styles.row, styles.wrap, { gap: theme.space.sm }]}>
                <FPill label={t(`state.${data.state}`)} tone={EXAM_TONE[data.state]} />
                <FPill label={format.dateRange(data.firstDate, data.lastDate)} tone="neutral" icon="calendar" />
              </View>
              {data.state === "marks_being_checked" || data.state === "results_out" ? (
                <FText variant="body" color="muted">
                  {t(`stateNote.${data.state}`)}
                </FText>
              ) : null}
            </View>

            <View style={{ gap: theme.space.md }}>
              <FText variant="heading">{t("sheet.dateSheet")}</FText>
              {days.length === 0 ? (
                <FText variant="body" color="muted">
                  {t("sheet.noPapers")}
                </FText>
              ) : (
                days.map((day, index) => {
                  const isToday = live && day.date === today;
                  const isNext = day.date === highlight;
                  return (
                    <Enter key={day.date} index={index}>
                      <FCard
                        testID={`exam-day-${day.date}`}
                        highlighted={isNext}
                      >
                        <View style={[styles.row, { gap: theme.space.sm }]}>
                          <FText variant="heading" style={styles.flex}>
                            {format.date(day.date, "weekdayDayMonth")}
                          </FText>
                          {isToday ? (
                            <FPill label={t("sheet.today")} tone="caution" />
                          ) : isNext ? (
                            <FPill label={t("sheet.next")} tone="info" />
                          ) : null}
                        </View>
                        {day.papers.map((paper, i) => (
                          <View
                            key={`${paper.subjectName}-${i}`}
                            style={[
                              { gap: theme.space.xs, paddingTop: theme.space.sm },
                              i > 0 ? { borderTopWidth: 1, borderTopColor: theme.color.hairline } : null,
                            ]}
                          >
                            <View style={[styles.row, { gap: theme.space.sm }]}>
                              <FText variant="label" style={styles.flex}>
                                {paper.subjectName}
                              </FText>
                              {paper.maxMarks ? (
                                <FText variant="meta" color="muted">
                                  {t("sheet.maxMarks", { marks: format.marks(paper.maxMarks) })}
                                </FText>
                              ) : null}
                            </View>
                            <FText variant="meta" color="muted">
                              {t("sheet.time", { time: format.time(paper.startTime), duration: format.duration(paper.durationMinutes) })}
                            </FText>
                            {paper.venue ? (
                              <FText variant="meta" color="muted">
                                {t("sheet.venue", { venue: paper.venue })}
                              </FText>
                            ) : null}
                            {paper.parts.length > 1 ? (
                              <View style={[styles.row, styles.wrap, { gap: theme.space.xs }]}>
                                {paper.parts.map((part) => (
                                  <FPill
                                    key={part.name}
                                    label={t("sheet.part", { name: part.name, marks: format.marks(part.maxMarks) })}
                                    tone="neutral"
                                  />
                                ))}
                              </View>
                            ) : null}
                          </View>
                        ))}
                      </FCard>
                    </Enter>
                  );
                })
              )}
            </View>
          </View>
        ) : null}
      </Reveal>
    </FScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  wrap: {
    flexWrap: "wrap",
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
