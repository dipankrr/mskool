import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useFormat } from "../../i18n/format";
import { dayLook, monthGrid } from "../../lib/attendance";
import type { DayLook, MonthDay } from "../../lib/attendance";
import { useFamilyTheme } from "../../theme";
import type { Tone } from "../../theme";
import { FPill, FSheet, FText } from "../../ui";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Which pill tone a day's status wears in the day sheet. */
const LOOK_TONE: Record<DayLook, Tone> = {
  present: "positive",
  absent: "critical",
  late: "caution",
  halfDay: "caution",
  leave: "info",
  holiday: "neutral",
  notMarked: "neutral",
  upcoming: "neutral",
  notEnrolled: "neutral",
  none: "neutral",
};

/** The legend lists only looks that carry a mark. */
const LEGEND: DayLook[] = ["present", "absent", "late", "halfDay", "leave", "notMarked"];

/**
 * The month as a grid of days, Monday first, each coloured by the child's
 * mark. Tap a day for its status and any holiday name.
 */
export function AttendanceCalendar({
  month,
  days,
  today,
}: {
  month: string;
  days: readonly MonthDay[];
  today: string;
}) {
  const { t } = useTranslation("attendance");
  const format = useFormat();
  const theme = useFamilyTheme();
  const k = theme.components.calendar;
  const [picked, setPicked] = useState<{ iso: string; look: DayLook; label: string | null } | null>(null);
  const weeks = monthGrid(month, days);

  return (
    <View style={{ gap: k.gap }}>
      <View style={[styles.week, { gap: k.gap }]}>
        {WEEKDAYS.map((key, index) => (
          <FText key={`${key}-${index}`} variant="caption" color="muted" align="center" style={styles.cell}>
            {t(`calendar.weekdays.${key}`)}
          </FText>
        ))}
      </View>
      {weeks.map((week, row) => (
        <View key={row} style={[styles.week, { gap: k.gap }]}>
          {week.map((cell, column) => {
            if (cell.kind === "blank") return <View key={column} style={styles.cell} />;
            const iso = `${month}-${String(cell.day).padStart(2, "0")}`;
            const look = dayLook(cell.info, iso, today);
            const colors = k.look[look];
            const isToday = iso === today;
            const status = t(`look.${look}`);
            return (
              <Pressable
                key={column}
                testID={`attendance-day-${iso}`}
                accessibilityRole="button"
                accessibilityLabel={t("calendar.dayA11y", { date: format.date(iso, "weekdayDayMonth"), status })}
                onPress={() => setPicked({ iso, look, label: cell.info?.label ?? null })}
                style={[
                  styles.cell,
                  styles.day,
                  {
                    borderRadius: k.cellRadius,
                    backgroundColor: colors.bg,
                    borderColor: isToday ? k.todayBorder : "transparent",
                  },
                ]}
              >
                <FText variant="bodyStrong" tint={colors.fg}>
                  {format.day(iso)}
                </FText>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={[styles.legend, { gap: theme.space.sm, paddingTop: theme.space.sm }]}>
        {LEGEND.map((look) => (
          <View key={look} style={[styles.legendItem, { gap: theme.space.xs }]}>
            <View
              style={[
                styles.swatch,
                { borderRadius: theme.radius.xs, backgroundColor: k.look[look].bg, borderColor: k.look[look].fg },
              ]}
            />
            <FText variant="meta" color="muted">
              {t(`look.${look}`)}
            </FText>
          </View>
        ))}
      </View>

      <FSheet
        visible={picked !== null}
        onDismiss={() => setPicked(null)}
        title={picked ? format.date(picked.iso, "weekdayDayMonth") : undefined}
      >
        {picked ? (
          <View style={{ gap: theme.space.sm }}>
            <FPill label={t(`look.${picked.look}`)} tone={LOOK_TONE[picked.look]} />
            {picked.label ? (
              <FText variant="body" color="muted">
                {picked.label}
              </FText>
            ) : null}
          </View>
        ) : null}
      </FSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  week: {
    flexDirection: "row",
  },
  cell: {
    flex: 1,
  },
  day: {
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  swatch: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
  },
});
