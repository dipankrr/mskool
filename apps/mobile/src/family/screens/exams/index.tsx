import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { todayIso } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import { daysUntil, EXAM_TONE, splitExams } from "../../lib/exams";
import { Enter, Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import {
  FCard,
  FEmptyState,
  FErrorState,
  FMascot,
  FOfflineNote,
  FPill,
  FRow,
  FRowStack,
  FScreen,
  FSkeleton,
  FText,
  useFamilyTabBarSpace,
} from "../../ui";
import { FamilyTabHeader } from "../tab-header";

type Exam = inferRouterOutputs<AppRouter>["portalExam"]["schedule"]["list"][number];

/**
 * Family Exams: the next exam up top, then what's coming up and what's done.
 * Tap an exam for the child's own date sheet. Never marks (hard rule 8).
 */
export function FamilyExams() {
  const { t } = useTranslation("exams");
  const { t: tf } = useTranslation("family");
  const theme = useFamilyTheme();
  const space = useFamilyTabBarSpace();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const list = trpc.portalExam.schedule.list.useQuery({ studentId }, { enabled: studentId.length > 0 });
  const header = <FamilyTabHeader title={tf("tabs.exams")} />;

  if (list.isError && !list.data) {
    return (
      <FScreen bottomSpace={space} header={header}>
        <FErrorState onRetry={() => void list.refetch()} />
      </FScreen>
    );
  }

  const { current, past } = splitExams(list.data ?? []);
  const [next, ...later] = current;
  const open = (exam: Exam) => router.push({ pathname: "/family/exam/[id]", params: { id: exam.id } });

  return (
    <FScreen
      testID="family-exams"
      bottomSpace={space}
      header={header}
      refreshing={list.isRefetching}
      onRefresh={() => void list.refetch()}
    >
      {list.isError && list.data ? <FOfflineNote /> : null}
      <Reveal
        loading={list.isPending}
        placeholder={
          <View style={{ gap: theme.components.row.stackGap }}>
            <FSkeleton height={150} radius="xl" />
            <FSkeleton height={80} radius="lg" />
            <FSkeleton height={80} radius="lg" />
          </View>
        }
      >
        {list.data && list.data.length === 0 ? (
          <FEmptyState title={t("none.title")} body={t("none.body")} />
        ) : (
          <View style={{ gap: theme.components.screen.sectionGap }}>
            {next ? <NextCard exam={next} onPress={() => open(next)} /> : null}
            {later.length > 0 ? (
              <ExamList title={t("current")} exams={later} onOpen={open} />
            ) : null}
            {past.length > 0 ? <ExamList title={t("past")} exams={past} onOpen={open} /> : null}
          </View>
        )}
      </Reveal>
    </FScreen>
  );
}

function useExamLine() {
  const { t } = useTranslation("exams");
  return (exam: Exam) =>
    exam.term ? t("typeTerm", { type: t(`type.${exam.examType}`), term: exam.term.name }) : t(`type.${exam.examType}`);
}

function NextCard({ exam, onPress }: { exam: Exam; onPress: () => void }) {
  const { t } = useTranslation("exams");
  const format = useFormat();
  const theme = useFamilyTheme();
  const line = useExamLine();
  const days = exam.firstDate ? daysUntil(exam.firstDate, todayIso()) : null;
  const when =
    exam.state === "ongoing"
      ? t("onNow")
      : days === null
        ? null
        : days <= 0
          ? t("startsToday")
          : t("startsIn", { count: days });

  return (
    <FCard testID="exams-next" onPress={onPress} label={exam.name}>
      <View style={[styles.row, { gap: theme.space.md }]}>
        <View style={[styles.flex, { gap: theme.space.xs }]}>
          <FText variant="meta" color="muted">
            {t("next")}
          </FText>
          <FText variant="title">{exam.name}</FText>
          <FText variant="meta" color="muted">
            {line(exam)}
          </FText>
        </View>
        <FMascot size={64} mood="calm" look="right" />
      </View>
      {when ? (
        <FText variant="heading" color={exam.state === "ongoing" ? "caution" : "info"}>
          {when}
        </FText>
      ) : null}
      <View style={[styles.row, styles.wrap, { gap: theme.space.sm }]}>
        <FPill label={format.dateRange(exam.firstDate, exam.lastDate)} tone="neutral" icon="calendar" />
        <FPill label={t("papers", { count: exam.paperCount })} tone="neutral" />
      </View>
    </FCard>
  );
}

function ExamList({ title, exams, onOpen }: { title: string; exams: Exam[]; onOpen: (exam: Exam) => void }) {
  const { t } = useTranslation("exams");
  const format = useFormat();
  const theme = useFamilyTheme();
  return (
    <View style={{ gap: theme.space.md }}>
      <FText variant="heading">{title}</FText>
      <FRowStack>
        {exams.map((exam, index) => (
          <Enter key={exam.id} index={index}>
            <FRow
              testID={`exams-row-${exam.id}`}
              title={exam.name}
              subtitle={t("rowSub", {
                dates: format.dateRange(exam.firstDate, exam.lastDate),
                state: t(`state.${exam.state}`),
              })}
              subtitleTone={EXAM_TONE[exam.state]}
              onPress={() => onOpen(exam)}
            />
          </Enter>
        ))}
      </FRowStack>
    </View>
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
