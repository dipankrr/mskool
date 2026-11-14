import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { parseMoney } from "../../../lib/money";
import { useFormat } from "../../i18n/format";
import { Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FCard, FSkeleton, FText } from "../../ui";
import type { TextColor } from "../../ui";
import { SectionHead } from "./parts";
import { examDays, nextExam } from "./use-home";
import type { Home } from "./use-home";

/** The slow numbers that don't change every day: attendance, fees, the next exam. Each opens its tab. */
export function Tiles({ home }: { home: Home }) {
  const { t } = useTranslation("family");
  const format = useFormat();
  const theme = useFamilyTheme();
  const { overview, fees, exams } = home;

  const counts = overview.data?.month?.counts ?? null;
  const fee = fees.data;
  const set = fee?.feeAssigned ?? false;
  const due = fee && set ? (parseMoney(fee.totals.dueNow) ?? 0n) > 0n : false;
  const exam = nextExam(exams.data);
  const days = examDays(exam, home.today);

  return (
    <View style={{ gap: theme.space.md }}>
      <SectionHead title={t("home.track")} />
      <View style={[styles.row, { gap: theme.space.sm }]}>
        <Tile
          testID="home-attendance"
          label={t("home.tileDays")}
          value={counts ? format.percent(Number(counts.percentage), 0) : "–"}
          note={t("home.thisMonth")}
          color={counts ? "ink" : "faint"}
          loading={overview.isPending}
          onPress={() => router.navigate("/family/attendance")}
        />
        <Tile
          testID="home-fees"
          label={t("home.tileFees")}
          value={!set ? "–" : due ? format.money(fee?.totals.dueNow) : t("home.feesPaid")}
          note={!set ? t("home.feesNotSet") : due ? t("home.dueNow") : t("home.allClear")}
          color={!set ? "faint" : due ? "critical" : "positive"}
          loading={fees.isPending}
          onPress={() => router.navigate("/family/fees")}
        />
        <Tile
          testID="home-exam"
          label={t("home.tileExams")}
          value={days === null ? "–" : days === 0 ? t("home.examOn") : t("home.examIn", { count: days })}
          note={exam ? exam.name : t("home.examNone")}
          color={days === null ? "faint" : "ink"}
          loading={exams.isPending}
          onPress={() => router.navigate("/family/exams")}
        />
      </View>
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  flex: { flex: 1, minWidth: 0 },
});
