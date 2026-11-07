import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { useFormat } from "../../i18n/format";
import { isTopRank } from "../../lib/attendance";
import { Enter } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FCard, FMascot, FText } from "../../ui";

type Ranking = inferRouterOutputs<AppRouter>["portalAttendance"]["ranking"];

/**
 * The child's place in the section for the chosen period, and the top 10
 * (more when ties straddle 10th). The child's own row is marked. When the
 * school hides the list, only the child's own rank shows.
 */
export function RankingCard({ ranking, sectionLabel }: { ranking: Ranking; sectionLabel: string }) {
  const { t } = useTranslation("attendance");
  const format = useFormat();
  const theme = useFamilyTheme();
  const r = theme.components.rank;
  const { you } = ranking;
  const ranked = you.rank !== null;
  const cheer = isTopRank(you.rank);

  return (
    <FCard testID="attendance-ranking">
      <FText variant="meta" color="muted">
        {t("rank.title")}
      </FText>

      <View style={[styles.head, { gap: theme.space.md }]}>
        <View style={styles.flex}>
          {ranked ? (
            <>
              <FText variant="title">{t("rank.headline", { rank: you.rank, count: ranking.rankedCount })}</FText>
              <FText variant="meta" color="muted">
                {t("rank.in", { section: sectionLabel })}
              </FText>
            </>
          ) : (
            <FText variant="heading">
              {you.reason === "too_few_days"
                ? t("rank.reason.too_few_days", { count: ranking.minWorkingDays ?? 0 })
                : you.reason
                  ? t(`rank.reason.${you.reason}`)
                  : ""}
            </FText>
          )}
        </View>
        <FMascot size={64} mood={cheer ? "happy" : "calm"} animate={cheer} />
      </View>

      {ranking.topVisible && ranking.top.length > 0 ? (
        <View style={{ gap: theme.space.xs }}>
          <FText variant="caption" color="muted">
            {t("rank.top")}
          </FText>
          {ranking.top.map((row, index) => (
            <Enter key={`${row.rank}-${row.name}`} index={index}>
              <View
                testID={row.isYou ? "attendance-ranking-you" : undefined}
                style={[
                  styles.row,
                  {
                    gap: theme.space.md,
                    paddingVertical: theme.space.sm,
                    paddingHorizontal: theme.space.md,
                    borderRadius: theme.radius.md,
                  },
                  row.isYou ? { backgroundColor: r.youBg, borderWidth: 1.5, borderColor: r.youBorder } : null,
                ]}
              >
                <View
                  style={[
                    styles.medal,
                    { borderRadius: theme.radius.sm, backgroundColor: row.rank <= 3 ? r.medalBg : "transparent" },
                  ]}
                >
                  <FText variant="label" tint={row.rank <= 3 ? r.medalFg : theme.color.muted}>
                    {String(row.rank)}
                  </FText>
                </View>
                <FText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {row.isYou ? t("rank.youName", { name: row.name }) : row.name}
                </FText>
                <FText variant="label">{format.percent(row.percentage)}</FText>
              </View>
            </Enter>
          ))}
        </View>
      ) : !ranking.topVisible ? (
        <FText variant="meta" color="muted">
          {t("rank.hidden")}
        </FText>
      ) : null}

      {ranking.period.isRunning && ranked ? (
        <FText variant="meta" color="muted">
          {t("rank.running")}
        </FText>
      ) : null}
    </FCard>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  medal: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
});
