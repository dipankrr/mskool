import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { logout } from "../../lib/auth";
import { todayIso } from "../../lib/format";
import { parseMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { useFamilyChild } from "../child-context";
import { useFormat } from "../i18n/format";
import { daysUntil } from "../lib/exams";
import { groupOpen, isOpen, tonight } from "../lib/homework";
import { Reveal } from "../motion";
import { useFamilyTheme } from "../theme";
import {
  FButton,
  FCard,
  FEmptyState,
  FErrorState,
  FHand,
  FMascot,
  FOfflineNote,
  FRowStack,
  FScreen,
  FSkeleton,
  FText,
  useFamilyTabBarSpace,
} from "../ui";
import type { TextColor } from "../ui";
import { HomeworkRow, useNow } from "./homework/parts";
import { FamilyTabHeader } from "./tab-header";

/**
 * Family Home (owner, 2026-11-09: "best and a little easier to build"):
 * Bookie says one line about today, the next few homework sit under it as
 * Homework-tab rows, and three small tiles show attendance, fees and the
 * next exam. Each tile opens its tab.
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
      <BookieLine homework={homework} exams={exams} />
      <UpNext query={homework} />
      <View style={[styles.row, styles.top, { gap: theme.space.sm }]}>
        <AttendanceTile query={attendance} />
        <FeesTile query={fees} />
        <ExamTile query={exams} />
      </View>
      {signOutButton}
    </FScreen>
  );
}

type Outputs = inferRouterOutputs<AppRouter>;
/** The slice of a query a part needs. */
type PartQuery<T> = { data: T | undefined; isPending: boolean; isError: boolean; refetch: () => unknown };
type OverviewQuery = PartQuery<Outputs["portalAttendance"]["overview"]>;
type FeesQuery = PartQuery<Outputs["portalFees"]["summary"]>;
type ExamsQuery = PartQuery<Outputs["portalExam"]["schedule"]["list"]>;
type HomeworkQuery = PartQuery<Outputs["portalHomework"]["list"]>;
type Exam = Outputs["portalExam"]["schedule"]["list"][number];

/** The exam that is on now, or the soonest one coming. */
function nextExam(exams: readonly Exam[] | undefined): Exam | undefined {
  return (exams ?? [])
    .filter((exam) => exam.state === "upcoming" || exam.state === "ongoing")
    .sort((a, b) => (a.firstDate ?? "9999").localeCompare(b.firstDate ?? "9999"))[0];
}

/** Days to the next exam: 0 while one is on, null when none is coming. */
function examDays(exam: Exam | undefined): number | null {
  if (!exam) return null;
  if (exam.state === "ongoing") return 0;
  return exam.firstDate ? Math.max(0, daysUntil(exam.firstDate, todayIso())) : null;
}

/**
 * Bookie and one handwritten line about today: what's left tonight, else an
 * exam within a week, else all clear. Waits for homework so it doesn't flip.
 */
function BookieLine({ homework, exams }: { homework: HomeworkQuery; exams: ExamsQuery }) {
  const { t } = useTranslation("family");
  const { t: th } = useTranslation("homework");
  const format = useFormat();
  const theme = useFamilyTheme();
  const now = useNow();
  const items = homework.data ?? [];
  const n = tonight(items, now);
  const days = examDays(nextExam(exams.data));

  let line: string;
  if (n.left > 0) line = t("home.bookieTonight", { count: n.left });
  else if (days === 0) line = t("home.bookieExamsOn");
  else if (days !== null && days <= 7) line = t("home.bookieExamsSoon", { count: days });
  else if (items.some(isOpen)) line = t("home.bookieNoneTonight");
  else line = t("home.bookieAllClear");
  const meta = n.left > 0 && n.minutes > 0 ? th("tonight.about", { time: format.duration(n.minutes) }) : null;

  return (
    <View testID="home-bookie" style={[styles.row, { gap: theme.space.md }]}>
      <FMascot size={84} mood={n.left > 0 ? "calm" : "happy"} look="right" />
      <Reveal loading={homework.isPending} placeholder={<FSkeleton width="70%" height={28} />} style={styles.flex}>
        <View style={{ gap: theme.space.xxs }}>
          <FHand tone="info" size={30}>
            {line}
          </FHand>
          {meta ? (
            <FText variant="meta" color="muted" style={{ paddingLeft: theme.space.sm }}>
              {meta}
            </FText>
          ) : null}
        </View>
      </Reveal>
    </View>
  );
}

/** The next few homework still to do, as the Homework tab's rows. */
function UpNext({ query }: { query: HomeworkQuery }) {
  const { t } = useTranslation("family");
  const { t: tc } = useTranslation();
  const theme = useFamilyTheme();
  const now = useNow();
  if (query.isError && !query.data) {
    return (
      <View style={[styles.row, { gap: theme.space.md }]}>
        <FText variant="meta" color="muted" style={styles.flex}>
          {tc("error.title")}
        </FText>
        <FButton label={tc("retry")} variant="secondary" size="sm" onPress={() => void query.refetch()} />
      </View>
    );
  }
  if (query.isPending) {
    return (
      <View style={{ gap: theme.components.row.stackGap }}>
        <FSkeleton width="100%" height={72} />
        <FSkeleton width="100%" height={72} />
      </View>
    );
  }
  // Only work still to do; new results stay on the Homework tab.
  const items = groupOpen(query.data ?? [], now)
    .flatMap((group) => group.items)
    .filter(isOpen)
    .slice(0, 3);
  if (items.length === 0) return null;
  return (
    <View testID="home-up-next" style={{ gap: theme.space.sm }}>
      <View style={styles.row}>
        <FText variant="heading" style={styles.flex}>
          {t("home.upNext")}
        </FText>
        <FButton
          testID="home-all-homework"
          label={t("home.allHomework")}
          variant="quiet"
          size="sm"
          onPress={() => router.navigate("/family/homework")}
        />
      </View>
      <FRowStack>
        {items.map((item) => (
          <HomeworkRow
            key={item.studentAssignmentId}
            item={item}
            now={now}
            onPress={() => router.push({ pathname: "/family/homework/[id]", params: { id: item.studentAssignmentId } })}
          />
        ))}
      </FRowStack>
    </View>
  );
}

/** A small block for one figure; the whole tile opens its tab. */
function Tile({
  testID,
  label,
  value,
  note,
  color = "ink",
  loading,
  onPress,
}: {
  testID: string;
  label: string;
  value: string;
  note: string;
  color?: TextColor;
  loading: boolean;
  onPress: () => void;
}) {
  const theme = useFamilyTheme();
  return (
    <FCard
      testID={testID}
      onPress={onPress}
      label={`${label}: ${value}, ${note}`}
      style={[styles.flex, { padding: theme.space.md, gap: theme.space.xs }]}
    >
      <FText variant="caption" color="muted" numberOfLines={1}>
        {label.toUpperCase()}
      </FText>
      <Reveal
        loading={loading}
        placeholder={
          <View style={{ gap: theme.space.sm }}>
            <FSkeleton width="80%" height={24} />
            <FSkeleton width="60%" height={14} />
          </View>
        }
      >
        <FText variant="heading" color={color} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {value}
        </FText>
        <FText variant="meta" color="muted" numberOfLines={1}>
          {note}
        </FText>
      </Reveal>
    </FCard>
  );
}

function AttendanceTile({ query }: { query: OverviewQuery }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const counts = query.data?.month?.counts ?? null;
  return (
    <Tile
      testID="home-attendance"
      label={t("home.tileDays")}
      value={counts ? format.percent(Number(counts.percentage), 0) : "–"}
      note={t("home.thisMonth")}
      color={counts ? "ink" : "faint"}
      loading={query.isPending}
      onPress={() => router.navigate("/family/attendance")}
    />
  );
}

function FeesTile({ query }: { query: FeesQuery }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const data = query.data;
  const set = data?.feeAssigned ?? false;
  const due = data && set ? (parseMoney(data.totals.dueNow) ?? 0n) > 0n : false;
  return (
    <Tile
      testID="home-fees"
      label={t("home.tileFees")}
      value={!set ? "–" : due ? format.money(data?.totals.dueNow) : t("home.feesPaid")}
      note={!set ? t("home.feesNotSet") : due ? t("home.dueNow") : t("home.allClear")}
      color={!set ? "faint" : due ? "critical" : "positive"}
      loading={query.isPending}
      onPress={() => router.navigate("/family/fees")}
    />
  );
}

function ExamTile({ query }: { query: ExamsQuery }) {
  const { t } = useTranslation("family");
  const exam = nextExam(query.data);
  const days = examDays(exam);
  return (
    <Tile
      testID="home-exam"
      label={t("home.tileExams")}
      value={days === null ? "–" : days === 0 ? t("home.examOn") : t("home.examIn", { count: days })}
      note={exam ? exam.name : t("home.examNone")}
      color={days === null ? "faint" : "ink"}
      loading={query.isPending}
      onPress={() => router.navigate("/family/exams")}
    />
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
  top: {
    alignItems: "stretch",
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
