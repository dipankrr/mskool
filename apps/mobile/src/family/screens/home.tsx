import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { logout } from "../../lib/auth";
import { parseMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { useFamilyChild } from "../child-context";
import { useFormat } from "../i18n/format";
import { isOpen, tonight } from "../lib/homework";
import { Reveal } from "../motion";
import { useFamilyTheme } from "../theme";
import {
  FButton,
  FCard,
  FEmptyState,
  FErrorState,
  FNumber,
  FOfflineNote,
  FScreen,
  FSkeleton,
  FText,
  useFamilyTabBarSpace,
} from "../ui";
import { FamilyTabHeader } from "./tab-header";

/**
 * Family Home, kept simple for now (owner, 2026-11-07): one card each for
 * tonight's homework, this month's attendance, fees due, and the next exam.
 * Each opens its tab.
 */
export function FamilyHome() {
  const { t } = useTranslation("family");
  const theme = useFamilyTheme();
  const space = useFamilyTabBarSpace();
  const { child, children, query: childrenQuery } = useFamilyChild();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const studentId = child?.studentId ?? "";
  const enabled = studentId.length > 0;

  const attendance = trpc.portalAttendance.overview.useQuery({ studentId }, { enabled });
  const fees = trpc.portalFees.summary.useQuery({ studentId }, { enabled });
  const exams = trpc.portalExam.schedule.list.useQuery({ studentId }, { enabled });
  // The same read the Homework tab uses, so opening the tab is instant.
  const homework = trpc.portalHomework.list.useQuery({ studentId, filter: "all" }, { enabled });

  const signOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      // The family layout's guard sends a signed-out session to sign-in. A
      // second navigation here raced it and crashed Android's view tree.
      await logout();
    } catch {
      setSignOutError(t("home.signOutFailed"));
      setSigningOut(false);
    }
  };

  const signOutButton = (
    <View style={{ gap: theme.space.sm }}>
      <FButton
        testID="family-sign-out"
        variant="quiet"
        icon="logout"
        label={t("home.signOut")}
        loading={signingOut}
        onPress={() => void signOut()}
        style={styles.center}
      />
      {signOutError ? (
        <FText variant="meta" color="critical" align="center">
          {signOutError}
        </FText>
      ) : null}
    </View>
  );

  if (childrenQuery.isError && !childrenQuery.data) {
    return (
      <FScreen bottomSpace={space}>
        <FErrorState onRetry={() => void childrenQuery.refetch()} />
        {signOutButton}
      </FScreen>
    );
  }
  if (childrenQuery.isSuccess && children.length === 0) {
    return (
      <FScreen bottomSpace={space}>
        <FEmptyState title={t("noChildren.title")} body={t("noChildren.body")} />
        {signOutButton}
      </FScreen>
    );
  }

  const refreshing = attendance.isRefetching || fees.isRefetching || exams.isRefetching || homework.isRefetching;
  const offline = [attendance, fees, exams, homework].some((q) => q.isError && q.data !== undefined);

  return (
    <FScreen
      testID="family-home"
      bottomSpace={space}
      refreshing={refreshing}
      onRefresh={() => {
        void attendance.refetch();
        void fees.refetch();
        void exams.refetch();
        void homework.refetch();
      }}
      header={<FamilyTabHeader title={child ? t("home.title", { name: child.firstName }) : ""} />}
    >
      {offline ? <FOfflineNote /> : null}
      <View style={{ gap: theme.components.row.stackGap }}>
        <HomeworkCard query={homework} />
        <AttendanceCard query={attendance} replayKey={studentId} />
        <FeesCard query={fees} replayKey={studentId} />
        <ExamCard query={exams} />
      </View>
      {signOutButton}
    </FScreen>
  );
}

type Outputs = inferRouterOutputs<AppRouter>;
/** The slice of a query a card needs. */
type CardQuery<T> = { data: T | undefined; isPending: boolean; isError: boolean; refetch: () => unknown };
type OverviewQuery = CardQuery<Outputs["portalAttendance"]["overview"]>;
type FeesQuery = CardQuery<Outputs["portalFees"]["summary"]>;
type ExamsQuery = CardQuery<Outputs["portalExam"]["schedule"]["list"]>;
type HomeworkQuery = CardQuery<Outputs["portalHomework"]["list"]>;

function CardPlaceholder() {
  const theme = useFamilyTheme();
  return (
    <View style={{ gap: theme.space.sm }}>
      <FSkeleton width="45%" height={16} />
      <FSkeleton width="35%" height={32} />
    </View>
  );
}

function CardError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const theme = useFamilyTheme();
  return (
    <View style={[styles.row, { gap: theme.space.md }]}>
      <FText variant="meta" color="muted" style={styles.flex}>
        {t("error.title")}
      </FText>
      <FButton label={t("retry")} variant="secondary" size="sm" onPress={onRetry} />
    </View>
  );
}

/** Tonight's homework: how many are left and about how long, or all done. */
function HomeworkCard({ query }: { query: HomeworkQuery }) {
  const { t } = useTranslation("family");
  const { t: th } = useTranslation("homework");
  const format = useFormat();
  const items = query.data ?? [];
  const n = tonight(items);
  const back = items.filter((i) => i.isNew).length;
  const pending = items.filter(isOpen).length;
  return (
    <FCard testID="home-homework" onPress={() => router.navigate("/family/homework")} label={t("home.homeworkTitle")}>
      <FText variant="meta" color="muted">
        {t("home.homeworkTitle")}
      </FText>
      {query.isError && !query.data ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : (
        <Reveal loading={query.isPending} placeholder={<CardPlaceholder />}>
          <View>
            <FText variant="number" color={n.left > 0 ? "ink" : "positive"}>
              {n.left > 0 ? th("tonight.left", { count: n.left }) : pending > 0 ? t("home.homeworkNoneTonight") : th("tonight.allDone")}
            </FText>
            {n.left > 0 && n.minutes > 0 ? (
              <FText variant="meta" color="muted">
                {th("tonight.about", { time: format.duration(n.minutes) })}
              </FText>
            ) : null}
            {back > 0 ? (
              <FText variant="meta" color="highlight">
                {t("home.homeworkBack", { count: back })}
              </FText>
            ) : null}
          </View>
        </Reveal>
      )}
    </FCard>
  );
}

function AttendanceCard({ query, replayKey }: { query: OverviewQuery; replayKey: string }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const counts = query.data?.month?.counts ?? null;
  return (
    <FCard testID="home-attendance" onPress={() => router.navigate("/family/attendance")} label={t("home.attendanceTitle")}>
      <FText variant="meta" color="muted">
        {t("home.attendanceTitle")}
      </FText>
      {query.isError && !query.data ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : (
        <Reveal loading={query.isPending} placeholder={<CardPlaceholder />}>
          {counts ? (
            <View>
              <FNumber value={Number(counts.percentage)} format={(n) => format.percent(n)} replayKey={replayKey} />
              <FText variant="meta" color="muted">
                {t("home.attendanceDays", { attended: counts.daysAttended, working: counts.workingDays })}
              </FText>
            </View>
          ) : (
            <FText variant="heading">{t("home.attendanceNone")}</FText>
          )}
        </Reveal>
      )}
    </FCard>
  );
}

function FeesCard({ query, replayKey }: { query: FeesQuery; replayKey: string }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const data = query.data;
  const due = data ? parseMoney(data.totals.dueNow) ?? 0n : 0n;
  return (
    <FCard testID="home-fees" onPress={() => router.navigate("/family/fees")} label={t("home.feesTitle")}>
      <FText variant="meta" color="muted">
        {t("home.feesTitle")}
      </FText>
      {query.isError && !data ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : (
        <Reveal loading={query.isPending} placeholder={<CardPlaceholder />}>
          {!data?.feeAssigned ? (
            <FText variant="heading">{t("home.feesNotSet")}</FText>
          ) : due > 0n ? (
            <View>
              <FNumber
                value={Number(due) / 100}
                format={(n) => format.money((Math.round(n * 100) / 100).toFixed(2))}
                color="critical"
                replayKey={replayKey}
              />
              <FText variant="meta" color="muted">
                {t("home.feesDue")}
              </FText>
            </View>
          ) : (
            <FText variant="heading" color="positive">
              {t("home.feesClear")}
            </FText>
          )}
        </Reveal>
      )}
    </FCard>
  );
}

function ExamCard({ query }: { query: ExamsQuery }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const next = (query.data ?? [])
    .filter((exam) => exam.state === "upcoming" || exam.state === "ongoing")
    .sort((a, b) => (a.firstDate ?? "9999").localeCompare(b.firstDate ?? "9999"))[0];
  return (
    <FCard testID="home-exam" onPress={() => router.navigate("/family/exams")} label={t("home.examTitle")}>
      <FText variant="meta" color="muted">
        {t("home.examTitle")}
      </FText>
      {query.isError && !query.data ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : (
        <Reveal loading={query.isPending} placeholder={<CardPlaceholder />}>
          {next ? (
            <View>
              <FText variant="heading">{next.name}</FText>
              {next.firstDate ? (
                <FText variant="meta" color="muted">
                  {t("home.examFrom", { date: format.date(next.firstDate, "weekdayDayMonth") })}
                </FText>
              ) : null}
            </View>
          ) : (
            <FText variant="heading">{t("home.examNone")}</FText>
          )}
        </Reveal>
      )}
    </FCard>
  );
}

const styles = StyleSheet.create({
  center: {
    alignSelf: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  flex: {
    flex: 1,
  },
});
