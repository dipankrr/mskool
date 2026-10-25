import { useEffect, useMemo, useRef } from "react";
import { PanResponder, Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { formatLongWeekday, todayIso } from "../../lib/format";
import {
  dayLabel,
  shiftWeek,
  startOfWeek,
  weekDays,
  weekMonthLabel,
} from "../../lib/homework";
import { colors } from "../../theme/brand-admin";
import { motion, radius, spacing } from "../../theme/tokens";

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * The homework week rail — the surface's anchor. Seven day cells, Monday
 * first, with the due-load dots that turn "what is today" into "what needs
 * me". Paging is a horizontal swipe *and* two labelled chevrons: the gesture
 * is the fast path, the buttons are the accessible one (a screen reader never
 * has to discover a swipe).
 *
 * Selection is the source of truth for the week: swiping moves the selected
 * day by exactly seven, so the agenda below never disagrees with the strip
 * about which week is on screen. The rail is 62 pt of real targets, not a
 * strip of 30 pt text: a teacher taps it one-handed in a corridor. Selected is
 * an emerald capsule, today is the ring, and the dots say *how much* is due
 * without a second legend.
 */
export function WeekRail({
  selected,
  onSelect,
  loads,
}: {
  /** The reader's calendar day, `YYYY-MM-DD`. */
  selected: string;
  onSelect: (day: string) => void;
  /** `day → number of assignments due`, from `dueLoadsByDay`. */
  loads: Record<string, number>;
}) {
  const today = todayIso();
  const anchor = startOfWeek(selected);
  const reducedMotion = useReducedMotion();
  const fade = useSharedValue(1);
  const firstWeek = useRef(anchor);

  const days = useMemo(() => weekDays(anchor), [anchor]);
  const weekLoad = useMemo(
    () => days.reduce((sum, day) => sum + (loads[day] ?? 0), 0),
    [days, loads],
  );

  useEffect(() => {
    if (firstWeek.current === anchor) return;
    firstWeek.current = anchor;
    // A quiet crossfade says "the strip moved" without sliding content the
    // thumb is already covering. Reduce Motion keeps the state change and
    // drops the animation.
    if (reducedMotion) {
      fade.value = 1;
      return;
    }
    fade.value = 0.35;
    fade.value = withTiming(1, { duration: motion.base });
  }, [anchor, fade, reducedMotion]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const goWeek = (delta: number) => {
    void Haptics.selectionAsync();
    onSelect(shiftWeek(selected, delta));
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx <= -36) goWeek(1);
          else if (gesture.dx >= 36) goWeek(-1);
        },
      }),
    // `goWeek` closes over the selected day; recreating the responder on each
    // selection is cheap and keeps the swipe honest about where it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected],
  );

  const jumpToToday = () => {
    void Haptics.selectionAsync();
    onSelect(today);
  };

  const selectedLoad = loads[selected] ?? 0;

  return (
    <View style={styles.wrap} {...pan.panHandlers}>
      <View style={styles.head}>
        <View style={styles.monthRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.homework.rail.previousWeek}
            hitSlop={10}
            onPress={() => goWeek(-1)}
            style={({ pressed }) => [styles.chevron, pressed ? styles.pressed : null]}
            testID="homework-week-previous"
          >
            <AppIcon name="chevronLeft" size={16} color={colors.muted} />
          </Pressable>
          <ThemedText
            variant="bodyStrong"
            numberOfLines={1}
            accessibilityLabel={copy.homework.rail.weekA11y(
              weekMonthLabel(days),
              weekLoad,
            )}
            testID="homework-week-label"
          >
            {weekMonthLabel(days)}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.homework.rail.nextWeek}
            hitSlop={10}
            onPress={() => goWeek(1)}
            style={({ pressed }) => [styles.chevron, pressed ? styles.pressed : null]}
            testID="homework-week-next"
          >
            <AppIcon name="chevronRight" size={16} color={colors.muted} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.homework.rail.today}
          accessibilityHint={copy.homework.rail.dayHint}
          hitSlop={8}
          onPress={jumpToToday}
          style={({ pressed }) => [styles.today, pressed ? styles.todayPressed : null]}
          testID="homework-week-today"
        >
          <ThemedText variant="caption" color={colors.accentDeep}>
            {copy.homework.rail.today}
          </ThemedText>
        </Pressable>
      </View>

      <Animated.View style={[styles.days, fadeStyle]}>
        {days.map((day, index) => {
          const isSelected = day === selected;
          const isToday = day === today;
          const load = loads[day] ?? 0;
          const dots = Math.min(load, 3);
          return (
            <Pressable
              key={day}
              testID={`homework-day-${day}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={[
                formatLongWeekday(day),
                load === 0
                  ? copy.homework.load.none
                  : load === 1
                    ? copy.homework.load.one
                    : copy.homework.load.many(load),
              ].join(", ")}
              accessibilityHint={copy.homework.rail.dayHint}
              onPress={() => {
                void Haptics.selectionAsync();
                onSelect(day);
              }}
              style={({ pressed }) => [
                styles.day,
                isSelected ? styles.daySelected : null,
                !isSelected && isToday ? styles.dayToday : null,
                pressed && !isSelected ? styles.dayPressed : null,
              ]}
            >
              <ThemedText
                variant="caption"
                color={isSelected ? colors.onAccent : colors.muted}
                maxFontSizeMultiplier={1.3}
              >
                {WEEKDAY_INITIALS[index]}
              </ThemedText>
              <ThemedText
                variant="bodyStrong"
                color={isSelected ? colors.onAccent : colors.ink}
                maxFontSizeMultiplier={1.3}
                style={styles.date}
              >
                {Number(day.slice(8, 10))}
              </ThemedText>
              <View style={styles.dots}>
                {Array.from({ length: dots }, (_, dot) => (
                  <View
                    key={dot}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: isSelected
                          ? colors.onAccent
                          : colors.accent,
                      },
                    ]}
                  />
                ))}
              </View>
            </Pressable>
          );
        })}
      </Animated.View>

      <View style={styles.footer}>
        <ThemedText variant="meta" numberOfLines={1}>
          {dayLabel(selected, today)}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {selectedLoad === 0
            ? copy.homework.load.none
            : selectedLoad === 1
              ? copy.homework.load.one
              : copy.homework.load.many(selectedLoad)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    flexShrink: 1,
  },
  chevron: {
    width: 32,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  today: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
    justifyContent: "center",
  },
  todayPressed: {
    backgroundColor: colors.accentStrong,
  },
  days: {
    flexDirection: "row",
    gap: spacing.xxs,
  },
  day: {
    flex: 1,
    minHeight: 62,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  daySelected: {
    backgroundColor: colors.accent,
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  dayPressed: {
    backgroundColor: colors.field,
  },
  date: {
    fontSize: 17,
  },
  dots: {
    height: 5,
    flexDirection: "row",
    gap: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});
