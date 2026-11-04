import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { ThemedText } from "../../components/themed-text";
import { clearedInMonth, yearRowSpoken, type YearMonthState } from "../../lib/fees";
import { feesCopy } from "../../lib/fees-copy";
import { formatMoney, isPositiveMoney } from "../../lib/money";
import { colors } from "../../theme/brand-admin";
import { fontFamily, spacing, touch } from "../../theme/tokens";
import type { DashboardRowData } from "./dashboard-row";

const words = feesCopy.year;
const LEFT = new Set(["transferred_out", "withdrawn", "expelled"]);

type Month = { key: string; label: string; current: boolean };

/**
 * The Fees tab's year view: one row per student, one box per month, from the
 * same list read and filters as the list view. Boxes are too small to tap, so
 * the whole row opens the student's page. Names sit on the right, beside the
 * thumb and the Collect button.
 *
 * Colour is never the only signal: cleared boxes carry a tick, unpaid ones a
 * cross, part paid is split, and each row reads its months aloud. A month after
 * the current one is drawn lighter: its dues exist but aren't owed yet.
 */
export function YearMatrix({
  title,
  months,
  rows,
  showCleared,
  onOpen,
}: {
  title: string;
  months: Month[];
  rows: DashboardRowData[];
  /** Off when the list has more pages: one page can't speak for the class. */
  showCleared: boolean;
  onOpen: (row: DashboardRowData) => void;
}) {
  const current = months.find((month) => month.current);
  const currentIndex = months.findIndex((month) => month.current);
  const cleared = showCleared ? clearedInMonth(months, rows) : null;

  return (
    <Card padless style={styles.card} testID="fees-year">
      <View style={styles.head}>
        <View style={styles.headLine}>
          <ThemedText variant="name">{title}</ThemedText>
          {current && cleared ? (
            <ThemedText variant="meta" testID="fees-year-cleared">
              {words.cleared(current.label, cleared.cleared, cleared.total)}
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.legend} importantForAccessibility="no-hide-descendants">
          <Legend state="due" label={words.legend.due} />
          <Legend state="paid" label={words.legend.paid} />
          <Legend state="partial" label={words.legend.partial} />
          <Legend state="upcoming" label={words.legend.upcoming} />
        </View>
      </View>

      <View style={styles.line} importantForAccessibility="no-hide-descendants">
        <View style={styles.cells}>
          {months.map((month) => (
            <View
              key={month.key}
              style={[styles.letterCell, month.current ? styles.currentHead : null]}
            >
              <ThemedText
                variant="tab"
                color={month.current ? colors.ink : undefined}
                style={month.current ? styles.currentLetter : null}
              >
                {month.label.slice(0, 1)}
              </ThemedText>
            </View>
          ))}
        </View>
        <View style={styles.name} />
      </View>

      {rows.map((row) => {
        const amount = amountLine(row);
        return (
          <Pressable
            key={row.studentId}
            accessibilityRole="button"
            accessibilityLabel={words.rowLabel(
              row.studentName,
              amount.text,
              yearRowSpoken(months, row.monthStates, words.stateWord),
            )}
            accessibilityHint={feesCopy.dashboard.openStudent}
            onPress={() => onOpen(row)}
            style={({ pressed }) => [styles.line, styles.row, pressed ? styles.pressed : null]}
            testID={`fees-year-row-${row.studentId}`}
          >
            <View style={styles.cells}>
              {months.map((month, index) => (
                <View
                  key={month.key}
                  style={[styles.cell, month.current ? styles.currentColumn : null]}
                >
                  <Box
                    state={row.monthStates?.[index] ?? "none"}
                    paid={row.monthPaid?.[index] ?? 50}
                    later={currentIndex >= 0 && index > currentIndex}
                  />
                </View>
              ))}
            </View>
            <View style={styles.name}>
              <ThemedText variant="chip" numberOfLines={1}>
                {row.studentName}
              </ThemedText>
              <ThemedText
                variant="caption"
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                color={amount.color}
              >
                {amount.text}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
    </Card>
  );
}

function amountLine(row: DashboardRowData): { text: string; color: string } {
  const owes = isPositiveMoney(row.dueNow);
  if (LEFT.has(row.enrollmentStatus) && owes) {
    return { text: words.left(formatMoney(row.dueNow)), color: colors.tone.critical.fg };
  }
  if (owes) return { text: formatMoney(row.dueNow), color: colors.tone.critical.fg };
  if (!row.billed) return { text: words.notBilled, color: colors.muted };
  return { text: words.paidUp, color: colors.tone.positive.fg };
}

function Box({
  state,
  paid = 50,
  later = false,
  small = false,
}: {
  state: YearMonthState;
  /** Percent of the month paid; a part paid box fills green that far. */
  paid?: number;
  /** After the current month: nothing is owed yet, so it's lighter. */
  later?: boolean;
  small?: boolean;
}) {
  const size = small ? styles.legendBox : styles.box;
  const glyph = small ? 11 : 16;
  if (state === "paid") {
    return (
      <View style={[size, later ? styles.paidLater : styles.paid]}>
        <AppIcon
          name="check"
          size={glyph}
          color={later ? colors.paidLaterFg : colors.glyphSoft}
        />
      </View>
    );
  }
  if (state === "partial") {
    return (
      <View style={[size, styles.split]}>
        <View style={[styles.segment, { flex: paid }, later ? styles.paidLater : styles.paid]} />
        <View style={[styles.segment, { flex: 100 - paid }, later ? styles.upcoming : styles.due]} />
      </View>
    );
  }
  if (state === "due") {
    return (
      <View style={[size, styles.due]}>
        <AppIcon name="close" size={glyph} color={colors.glyphSoft} />
      </View>
    );
  }
  if (state === "upcoming") {
    return (
      <View style={[size, styles.upcoming]}>
        <AppIcon name="close" size={glyph} color={colors.dueLaterFg} />
      </View>
    );
  }
  return <View style={[size, styles.none]} />;
}

function Legend({ state, label }: { state: YearMonthState; label: string }) {
  return (
    <View style={styles.legendItem}>
      <Box state={state} small />
      <ThemedText variant="meta">{label}</ThemedText>
    </View>
  );
}

const NAME_WIDTH = 100;

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  head: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  line: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  row: {
    minHeight: touch.min,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  cells: {
    flex: 1,
    flexDirection: "row",
  },
  letterCell: {
    flex: 1,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  currentHead: {
    backgroundColor: colors.nowWash,
    borderTopLeftRadius: spacing.xs,
    borderTopRightRadius: spacing.xs,
  },
  currentLetter: {
    fontFamily: fontFamily.bold,
  },
  cell: {
    flex: 1,
    paddingHorizontal: 1,
    alignItems: "stretch",
    justifyContent: "center",
  },
  currentColumn: {
    backgroundColor: colors.nowWash,
  },
  name: {
    width: NAME_WIDTH,
    paddingLeft: spacing.sm,
    justifyContent: "center",
    gap: 2,
  },
  box: {
    height: 20,
    borderRadius: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  legendBox: {
    width: 12,
    height: 12,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  paid: {
    backgroundColor: colors.accent,
  },
  due: {
    backgroundColor: colors.tone.critical.fg,
  },
  upcoming: {
    backgroundColor: colors.dueLater,
  },
  segment: {
    alignSelf: "stretch",
  },
  paidLater: {
    backgroundColor: colors.paidLater,
  },
  none: {
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  split: {
    flexDirection: "row",
  },
});

