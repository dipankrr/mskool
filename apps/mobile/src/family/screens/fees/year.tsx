import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../../components/app-icon";
import { useFormat } from "../../i18n/format";
import { duesInMonth, isPositive, MONTH_TONE, monthOf, yearProgress } from "../../lib/fees";
import type { FeeSummary, MonthState } from "../../lib/fees";
import { useFamilyTheme } from "../../theme";
import { FPill, FRowStack, FText } from "../../ui";
import { SectionHead } from "../home/parts";
import { DueRow } from "./due-row";

type Month = FeeSummary["months"][number];

/**
 * The session at a glance: how much of the year's fee is paid, then every
 * month in one grid (no sideways scrolling). Tapping a month opens its dues
 * right under the grid.
 */
export function FeesYear({
  data,
  today,
  selected,
  onSelect,
}: {
  data: FeeSummary;
  today: string;
  selected: string | null;
  onSelect: (month: string | null) => void;
}) {
  const { t } = useTranslation("fees");
  const format = useFormat();
  const theme = useFamilyTheme();
  const p = theme.components.home.progress;
  const m = theme.components.fees.month;
  const progress = yearProgress(data.totals);
  const percent = Math.round(progress.ratio * 100);

  const rows: (Month | null)[][] = [];
  for (let i = 0; i < data.months.length; i += m.perRow) {
    const row: (Month | null)[] = data.months.slice(i, i + m.perRow);
    while (row.length < m.perRow) row.push(null);
    rows.push(row);
  }
  const open = selected ? data.months.find((month) => monthOf(month.month) === selected) : undefined;
  const openDues = selected ? duesInMonth(data.dues, selected) : [];

  return (
    <View testID="fees-year" style={{ gap: theme.space.md }}>
      <SectionHead title={t("year.title")} aside={isPositive(progress.total) ? t("year.percent", { percent }) : null} />
      {isPositive(progress.total) ? (
        <View style={{ gap: theme.space.sm }}>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={{ height: p.height, borderRadius: p.height / 2, backgroundColor: p.track, overflow: "hidden" }}
          >
            <View
              style={{
                width: `${percent}%`,
                height: p.height,
                borderRadius: p.height / 2,
                backgroundColor: p.full,
              }}
            />
          </View>
          <View style={[styles.row, { gap: theme.space.md }]}>
            <FText variant="meta" color="muted" style={styles.flex}>
              {t("year.paidOf", { paid: format.money(progress.paid), total: format.money(progress.total) })}
            </FText>
            {isPositive(data.totals.later) ? (
              <FText variant="meta" color="faint">
                {t("year.toCome", { amount: format.money(data.totals.later) })}
              </FText>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={{ gap: m.gap }}>
        {rows.map((row, index) => (
          <View key={index} style={[styles.row, { gap: m.gap }]}>
            {row.map((month, cell) =>
              month ? (
                <MonthCell
                  key={month.month}
                  month={month}
                  selected={monthOf(month.month) === selected}
                  onPress={() => onSelect(monthOf(month.month) === selected ? null : monthOf(month.month))}
                />
              ) : (
                <View key={`pad-${cell}`} style={styles.flex} />
              ),
            )}
          </View>
        ))}
      </View>

      {open && selected ? (
        <View testID="fees-month-open" style={{ gap: theme.space.sm }}>
          <View style={[styles.row, { gap: theme.space.sm }]}>
            <FText variant="label" style={styles.shrink}>
              {format.month(selected)}
            </FText>
            <FPill label={t(`monthState.${open.state}`)} tone={MONTH_TONE[open.state]} />
            <View style={styles.flex} />
            <Pressable
              testID="fees-month-close"
              accessibilityRole="button"
              accessibilityLabel={t("year.close", { month: format.month(selected) })}
              hitSlop={12}
              onPress={() => onSelect(null)}
            >
              <AppIcon name="close" size={20} color={theme.color.muted} />
            </Pressable>
          </View>
          {openDues.length === 0 ? (
            <FText variant="meta" color="muted">
              {t("year.monthNone")}
            </FText>
          ) : (
            <FRowStack>
              {openDues.map((due) => (
                <DueRow key={due.id} due={due} today={today} />
              ))}
            </FRowStack>
          )}
        </View>
      ) : null}
    </View>
  );
}

function MonthCell({ month, selected, onPress }: { month: Month; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation("fees");
  const format = useFormat();
  const theme = useFamilyTheme();
  const m = theme.components.fees.month;
  const key = monthOf(month.month);
  const none = month.state === "none";
  const colors = m.tone[MONTH_TONE[month.state]];
  return (
    <Pressable
      testID={`fees-month-${key}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={t("monthA11y", {
        month: format.month(key),
        state: t(`monthState.${month.state}`),
        balance: format.money(month.balance),
      })}
      onPress={onPress}
      style={[
        styles.flex,
        styles.cell,
        {
          height: m.height,
          borderRadius: m.radius,
          gap: theme.space.xs,
          backgroundColor: none ? "transparent" : colors.bg,
          borderColor: selected ? m.selectedBorder : none ? m.noneBorder : "transparent",
        },
      ]}
    >
      <FText variant="caption" tint={none ? theme.color.faint : colors.fg} numberOfLines={1}>
        {format.month(key, "short")}
      </FText>
      <Mark state={month.state} color={colors.fg} size={m.mark} />
    </Pressable>
  );
}

/** Paid is a tick, late a warning, due a full dot, upcoming a ring; nothing billed has no mark. */
function Mark({ state, color, size }: { state: MonthState; color: string; size: number }) {
  if (state === "paid") return <AppIcon name="check" size={size} color={color} />;
  if (state === "overdue") return <AppIcon name="warning" size={size} color={color} />;
  const dot = Math.round(size * 0.6);
  const pad = (size - dot) / 2;
  if (state === "none") return <View style={{ height: size }} />;
  return (
    <View style={{ height: size, paddingVertical: pad }}>
      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: state === "due" ? color : "transparent",
          borderWidth: state === "due" ? 0 : 1.5,
          borderColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  cell: { alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
});
