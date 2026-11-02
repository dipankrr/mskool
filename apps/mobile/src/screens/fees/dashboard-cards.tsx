import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import type { LayoutChangeEvent } from "react-native";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { Card } from "../../components/card";
import { ThemedText } from "../../components/themed-text";
import { feesCopy } from "../../lib/fees-copy";
import { formatMoney, paidPercent, parseMoney } from "../../lib/money";
import { colors } from "../../theme/brand-admin";
import type { Tone } from "../../theme/brand-admin";
import { gutter, radius, spacing } from "../../theme/tokens";

export type AttentionCard = {
  key: string;
  icon: AppIconName;
  tone: Tone;
  title: string;
  body: string;
  onPress: () => void;
};

/**
 * What needs attention, as swipeable cards with page dots. It takes no room when
 * nothing does: a school with setup done and no pending cheques never sees it.
 */
export function AttentionCards({ cards }: { cards: AttentionCard[] }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  if (cards.length === 0) return null;

  const cardWidth = width - gutter * 2 - (cards.length > 1 ? spacing.xl : 0);
  const step = cardWidth + spacing.sm;

  return (
    <View style={styles.carousel}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        scrollEventThrottle={32}
        onScroll={(event) =>
          setIndex(Math.round(event.nativeEvent.contentOffset.x / step))
        }
        contentContainerStyle={styles.carouselRow}
      >
        {cards.map((card) => (
          <Pressable
            key={card.key}
            accessibilityRole="button"
            accessibilityLabel={`${card.title}. ${card.body}`}
            onPress={card.onPress}
            style={({ pressed }) => [
              styles.attention,
              {
                width: cardWidth,
                backgroundColor: colors.tone[card.tone].bg,
              },
              pressed ? styles.pressed : null,
            ]}
            testID={`fees-card-${card.key}`}
          >
            <AppIcon name={card.icon} size={22} color={colors.tone[card.tone].fg} />
            <View style={styles.attentionText}>
              <ThemedText
                variant="bodyStrong"
                color={colors.tone[card.tone].fg}
                numberOfLines={2}
              >
                {card.title}
              </ThemedText>
              <ThemedText variant="meta" numberOfLines={2}>
                {card.body}
              </ThemedText>
            </View>
            <AppIcon
              name="chevronRight"
              size={18}
              color={colors.tone[card.tone].fg}
            />
          </Pressable>
        ))}
      </ScrollView>
      {cards.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden>
          {cards.map((card, dot) => (
            <View
              key={card.key}
              style={[styles.dot, dot === index ? styles.dotOn : null]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A small line showing the last months' unpaid amounts. Drawn from Views so the
 * app takes on no charting dependency for one sparkline.
 */
export function TrendLine({ values }: { values: string[] }) {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(event.nativeEvent.layout.width);

  const height = 40;
  const numbers = values.map((value) => Number(parseMoney(value) ?? 0n));
  const max = Math.max(...numbers, 1);
  // A flat line along the floor reads as a chart of something. Nothing billed
  // yet draws nothing, and the space stays so the figure beside it doesn't move.
  const hasData = numbers.some((value) => value > 0);
  const stepX = numbers.length > 1 ? width / (numbers.length - 1) : 0;
  const points = numbers.map((value, i) => ({
    x: i * stepX,
    y: height - 2 - (value / max) * (height - 4),
  }));

  return (
    <View style={[styles.trend, { height }]} onLayout={onLayout} accessible={false}>
      {width > 0 && hasData
        ? points.slice(1).map((point, i) => {
            const from = points[i];
            if (!from) return null;
            const dx = point.x - from.x;
            const dy = point.y - from.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            return (
              <View
                key={i}
                style={[
                  styles.segment,
                  {
                    width: length,
                    left: (from.x + point.x) / 2 - length / 2,
                    top: (from.y + point.y) / 2 - 1,
                    transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                  },
                ]}
              />
            );
          })
        : null}
    </View>
  );
}

/** The sketch's main card: what is due this month and how far along it is. */
export function TotalDueCard({
  monthLabel,
  due,
  billed,
  paid,
  collected,
  trend,
}: {
  monthLabel: string;
  due: string;
  billed: string;
  paid: string;
  collected: string;
  trend: string[];
}) {
  const percent = paidPercent(paid, billed);
  return (
    <Card style={styles.total}>
      <ThemedText variant="meta">{feesCopy.dashboard.dueThisMonth(monthLabel)}</ThemedText>
      <View style={styles.totalRow}>
        <ThemedText
          variant="hero"
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
          style={styles.totalAmount}
          testID="fees-due-this-month"
        >
          {formatMoney(due)}
        </ThemedText>
        <TrendLine values={trend} />
      </View>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
      >
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
      <ThemedText variant="meta" testID="fees-collected-month">
        {feesCopy.dashboard.collectedThisMonth(formatMoney(collected))}
      </ThemedText>
    </Card>
  );
}

export function SmallStat({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <Card style={styles.stat}>
      <ThemedText variant="meta" numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText
        variant="title"
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        testID={testID}
      >
        {value}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  carousel: {
    gap: spacing.xs,
  },
  carouselRow: {
    gap: spacing.sm,
  },
  attention: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  attentionText: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.8,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.grabber,
  },
  dotOn: {
    backgroundColor: colors.accent,
  },
  total: {
    gap: spacing.xs,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  totalAmount: {
    flexShrink: 1,
  },
  trend: {
    flex: 1,
    minWidth: 48,
  },
  segment: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.tone.critical.fg,
  },
  track: {
    height: 8,
    marginTop: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  stat: {
    flex: 1,
    gap: 2,
  },
});
