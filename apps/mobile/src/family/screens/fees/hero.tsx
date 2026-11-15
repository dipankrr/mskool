import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { BookieMood } from "../../../components/bookie";
import { parseMoney } from "../../../lib/money";
import { useFormat } from "../../i18n/format";
import { dueParts, feesMood, nextUp, splitDues } from "../../lib/fees";
import type { FeeSummary, FeesMood } from "../../lib/fees";
import { useFamilyTheme } from "../../theme";
import { FMascot, FNumber, FText } from "../../ui";

const BOOKIE: Record<FeesMood, BookieMood> = {
  overdue: "worried",
  due: "calm",
  clear: "happy",
  yearPaid: "cheer",
};

/**
 * The top card: what to pay now and by when, or that nothing is due and what
 * comes next. When the amount is more than one thing (late months, this
 * month, earlier sessions) the parts are listed under it.
 */
export function FeesHero({ data, today, replayKey }: { data: FeeSummary; today: string; replayKey: string }) {
  const { t } = useTranslation("fees");
  const format = useFormat();
  const theme = useFamilyTheme();
  const f = theme.components.fees;
  const mood = feesMood(data.totals);
  const look = f.hero.look[mood];
  const { now, later } = splitDues(data.dues, today);
  const first = now[0];
  const next = nextUp(later);
  const parts = dueParts(data.totals);
  const owing = mood === "overdue" || mood === "due";
  const dueNow = parseMoney(data.totals.dueNow) ?? 0n;

  let line: string;
  if (mood === "overdue") {
    line = first && first.dueDate < today ? t("hero.lateSince", { date: format.date(first.dueDate) }) : t("hero.earlier");
  } else if (mood === "due") {
    line = !first
      ? ""
      : first.dueDate >= today
        ? t("hero.payBy", { date: format.date(first.dueDate) })
        : t("hero.wasDue", { date: format.date(first.dueDate) });
  } else if (mood === "yearPaid") {
    line = t("hero.yearPaidBody");
  } else {
    line = next ? t("hero.next", { amount: format.money(next.amount), date: format.date(next.date) }) : t("hero.nothingDue");
  }

  return (
    <View
      testID="fees-hero"
      style={{
        borderRadius: f.hero.radius,
        borderWidth: 1,
        borderColor: look.border,
        backgroundColor: look.bg,
        padding: theme.space.lg,
        gap: theme.space.md,
      }}
    >
      <View style={[styles.row, { gap: theme.space.md }]}>
        <View style={[styles.flex, { gap: theme.space.xxs }]}>
          {owing ? (
            <>
              <FText variant="meta" color="muted">
                {t("hero.toPay")}
              </FText>
              <FNumber
                value={Number(dueNow) / 100}
                format={(n) => format.money((Math.round(n * 100) / 100).toFixed(2))}
                size="numberHero"
                color={mood === "overdue" ? "critical" : "ink"}
                replayKey={replayKey}
              />
            </>
          ) : (
            <FText variant="display" tint={look.fg}>
              {t(mood === "yearPaid" ? "hero.yearPaid" : "hero.allPaid")}
            </FText>
          )}
          {line ? (
            <FText variant="meta" tint={mood === "overdue" ? look.fg : undefined} color="muted">
              {line}
            </FText>
          ) : null}
        </View>
        <FMascot size={f.mascot} mood={BOOKIE[mood]} look="left" />
      </View>
      {parts.length > 0 ? (
        <View style={{ borderTopWidth: 1, borderTopColor: look.border, paddingTop: theme.space.md, gap: theme.space.xs }}>
          {parts.map(({ part, amount }) => (
            <View key={part} style={[styles.row, { gap: theme.space.md }]}>
              <FText variant="meta" color="muted" style={styles.flex}>
                {t(`hero.part.${part}`)}
              </FText>
              <FText variant="label" color={part === "thisMonth" ? "ink" : "critical"}>
                {format.money(amount)}
              </FText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});
