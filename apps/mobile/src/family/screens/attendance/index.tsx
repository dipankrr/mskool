import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../../components/app-icon";
import { trpc } from "../../../lib/trpc";
import { childClass, useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import { clampMonth, monthBounds, monthKeyOf, shiftMonth } from "../../lib/attendance";
import { Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import {
  FButton,
  FCard,
  FErrorState,
  FNumber,
  FOfflineNote,
  FScreen,
  FSegment,
  FSkeleton,
  FText,
  useFamilyTabBarSpace,
} from "../../ui";
import { FamilyTabHeader } from "../tab-header";
import { AttendanceCalendar } from "./calendar";
import { RankingCard } from "./ranking-card";

type Period = "month" | "term" | "year";
type Counts = {
  workingDays: number;
  daysPresent: number;
  daysAbsent: number;
  daysLate: number;
  daysHalfDay: number;
  daysOnLeave: number;
  daysAttended: number;
  percentage: string;
};

/**
 * Family Attendance: the session's percentage so far, a Month / Term / Year
 * switch, the counts for the chosen period, the month calendar, and the
 * section ranking. Everything counts days that have happened, from the day
 * the child joined (ADR-061).
 */
export function FamilyAttendance() {
  const { t } = useTranslation("attendance");
  const { t: tf } = useTranslation("family");
  const format = useFormat();
  const theme = useFamilyTheme();
  const space = useFamilyTabBarSpace();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const enabled = studentId.length > 0;

  const [period, setPeriod] = useState<Period>("month");
  // The family’s own pick, remembered per child; otherwise today’s month and term.
  const [pick, setPick] = useState<{ studentId: string; month?: string; termId?: string }>({ studentId: "" });

  const overview = trpc.portalAttendance.overview.useQuery({ studentId }, { enabled });
  const data = overview.data;
  const asOf = data?.asOf ?? "";
  const bounds = data ? monthBounds(data.asOf, data.terms.map((term) => term.startDate)) : null;

  const mine = pick.studentId === studentId ? pick : { studentId };
  const defaultTerm = data
    ? (data.terms.find((term) => term.startDate <= data.asOf && data.asOf <= term.endDate) ?? data.terms[data.terms.length - 1])
    : undefined;
  const month = mine.month ?? (data ? monthKeyOf(data.asOf) : null);
  const termId = mine.termId ?? defaultTerm?.id ?? null;
  const setMonth = (value: string) => setPick({ ...mine, studentId, month: value });
  const setTermId = (value: string | null) => setPick({ ...mine, studentId, termId: value ?? undefined });

  const monthQuery = trpc.portalAttendance.month.useQuery(
    { studentId, month: month ?? "2000-01" },
    { enabled: enabled && period === "month" && month !== null },
  );
  const rankingInput =
    period === "month"
      ? { studentId, period, month: month ?? undefined }
      : period === "term"
        ? { studentId, period, termId: termId ?? undefined }
        : { studentId, period };
  const ranking = trpc.portalAttendance.ranking.useQuery(rankingInput, {
    enabled:
      enabled && (period === "year" || (period === "month" && month !== null) || (period === "term" && termId !== null)),
  });

  const term = data?.terms.find((x) => x.id === termId) ?? null;
  const termIndex = data && term ? data.terms.indexOf(term) : -1;
  const counts: Counts | null =
    period === "month" ? (monthQuery.data?.counts ?? null) : period === "term" ? (term?.counts ?? null) : (data?.year ?? null);
  const countsLoading = period === "month" ? monthQuery.isPending : overview.isPending;

  if (overview.isError && !data) {
    return (
      <FScreen bottomSpace={space} header={<FamilyTabHeader title={tf("tabs.attendance")} />}>
        <FErrorState onRetry={() => void overview.refetch()} />
      </FScreen>
    );
  }

  const offline = [overview, monthQuery, ranking].some((q) => q.isError && q.data !== undefined);

  const stepper =
    period === "month" && month && bounds ? (
      <Stepper
        label={format.month(month)}
        canPrev={month > bounds.first}
        canNext={month < bounds.last}
        onPrev={() => setMonth(clampMonth(shiftMonth(month, -1), bounds.first, bounds.last))}
        onNext={() => setMonth(clampMonth(shiftMonth(month, 1), bounds.first, bounds.last))}
        prevLabel={t("previous")}
        nextLabel={t("next")}
      />
    ) : period === "term" && data ? (
      term ? (
        <Stepper
          label={term.name}
          canPrev={termIndex > 0}
          canNext={termIndex < data.terms.length - 1}
          onPrev={() => setTermId(data.terms[termIndex - 1]?.id ?? termId)}
          onNext={() => setTermId(data.terms[termIndex + 1]?.id ?? termId)}
          prevLabel={t("previous")}
          nextLabel={t("next")}
        />
      ) : (
        <FText variant="body" color="muted">
          {t("noTerms")}
        </FText>
      )
    ) : period === "year" && data ? (
      <FText variant="heading" align="center">
        {data.academicYear.name}
      </FText>
    ) : null;

  return (
    <FScreen
      testID="family-attendance"
      bottomSpace={space}
      refreshing={overview.isRefetching || monthQuery.isRefetching || ranking.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        if (period === "month") void monthQuery.refetch();
        void ranking.refetch();
      }}
      header={<FamilyTabHeader title={tf("tabs.attendance")} />}
    >
      {offline ? <FOfflineNote /> : null}

      <Reveal
        loading={overview.isPending}
        placeholder={
          <View style={{ gap: theme.space.sm }}>
            <FSkeleton width="40%" height={14} />
            <FSkeleton width="55%" height={56} />
            <FSkeleton width="50%" height={14} />
          </View>
        }
      >
        <View testID="attendance-hero">
          <FText variant="meta" color="muted">
            {t("yearSoFar")}
          </FText>
          {data?.year ? (
            <>
              <FNumber
                value={Number(data.year.percentage)}
                format={(n) => format.percent(n)}
                size="numberHero"
                replayKey={studentId}
              />
              <FText variant="meta" color="muted">
                {t("yearDays", { attended: data.year.daysAttended, working: data.year.workingDays })}
              </FText>
            </>
          ) : (
            <FText variant="heading">{t("yearNone")}</FText>
          )}
        </View>
      </Reveal>

      <View style={{ gap: theme.space.md }}>
        <FSegment
          testID="attendance-period"
          value={period}
          onChange={setPeriod}
          options={[
            { key: "month", label: t("period.month") },
            { key: "term", label: t("period.term") },
            { key: "year", label: t("period.year") },
          ]}
        />
        {stepper}
      </View>

      <FCard testID="attendance-counts">
        <Reveal loading={countsLoading} placeholder={<FSkeleton height={64} radius="md" />}>
          {counts ? (
            <View style={{ gap: theme.space.md }}>
              <View style={[styles.stats, { gap: theme.space.sm }]}>
                <Stat value={counts.daysPresent} label={t("counts.present")} tone="positive" />
                <Stat value={counts.daysAbsent} label={t("counts.absent")} tone="critical" />
                <Stat value={counts.daysLate} label={t("counts.late")} tone="caution" />
                <Stat value={counts.daysHalfDay} label={t("counts.halfDay")} tone="caution" />
                <Stat value={counts.daysOnLeave} label={t("counts.leave")} tone="info" />
              </View>
              <FText variant="meta" color="muted">
                {t("periodSummary", {
                  attended: counts.daysAttended,
                  working: counts.workingDays,
                  percent: format.percent(counts.percentage),
                })}
              </FText>
              {data ? (
                <FText variant="meta" color="muted">
                  {data.lateCountsAsPresent ? t("lateCounts") : t("lateNotCounted")}
                </FText>
              ) : null}
            </View>
          ) : (
            <FText variant="body" color="muted">
              {t("noCounts")}
            </FText>
          )}
        </Reveal>
      </FCard>

      {period === "month" && month ? (
        <FCard testID="attendance-calendar">
          {monthQuery.isError && !monthQuery.data ? (
            <InlineRetry onRetry={() => void monthQuery.refetch()} />
          ) : (
            <Reveal loading={monthQuery.isPending} placeholder={<FSkeleton height={300} radius="md" />}>
              {monthQuery.data ? (
                <AttendanceCalendar month={month} days={monthQuery.data.days} today={asOf} />
              ) : null}
            </Reveal>
          )}
        </FCard>
      ) : null}

      {ranking.isError && !ranking.data ? (
        <FCard>
          <InlineRetry onRetry={() => void ranking.refetch()} />
        </FCard>
      ) : (
        <Reveal loading={ranking.isPending} placeholder={<FSkeleton height={160} radius="xl" />}>
          {ranking.data && child ? <RankingCard ranking={ranking.data} sectionLabel={childClass(tf, child)} /> : null}
        </Reveal>
      )}
    </FScreen>
  );
}

function Stepper({
  label,
  canPrev,
  canNext,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
}: {
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
}) {
  const theme = useFamilyTheme();
  const arrow = (enabledArrow: boolean, onPress: () => void, a11y: string, icon: "chevronLeft" | "chevronRight", id: string) => (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !enabledArrow }}
      disabled={!enabledArrow}
      hitSlop={10}
      onPress={onPress}
      style={[
        styles.arrow,
        {
          width: theme.touch.min,
          height: theme.touch.min,
          borderRadius: theme.radius.md,
          backgroundColor: theme.color.surfaceMuted,
          opacity: enabledArrow ? 1 : 0.35,
        },
      ]}
    >
      <AppIcon name={icon} size={22} color={theme.color.ink} />
    </Pressable>
  );
  return (
    <View style={[styles.stepper, { gap: theme.space.md }]}>
      {arrow(canPrev, onPrev, prevLabel, "chevronLeft", "attendance-prev")}
      <FText variant="heading" align="center" numberOfLines={1} style={styles.flex} accessibilityLiveRegion="polite">
        {label}
      </FText>
      {arrow(canNext, onNext, nextLabel, "chevronRight", "attendance-next")}
    </View>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: "positive" | "critical" | "caution" | "info" }) {
  const theme = useFamilyTheme();
  const colors = theme.tone[tone];
  return (
    <View
      style={[
        styles.stat,
        {
          backgroundColor: colors.bg,
          borderRadius: theme.radius.md,
          paddingVertical: theme.space.sm,
          paddingHorizontal: theme.space.md,
        },
      ]}
    >
      <FText variant="heading" tint={colors.fg}>
        {String(value)}
      </FText>
      <FText variant="caption" tint={colors.fg} numberOfLines={1}>
        {label}
      </FText>
    </View>
  );
}

function InlineRetry({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const theme = useFamilyTheme();
  return (
    <View style={[styles.stepper, { gap: theme.space.md }]}>
      <FText variant="meta" color="muted" style={styles.flex}>
        {t("error.title")}
      </FText>
      <FButton label={t("retry")} variant="secondary" size="sm" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
  },
  arrow: {
    alignItems: "center",
    justifyContent: "center",
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  stat: {
    minWidth: 92,
    flexGrow: 1,
  },
});
