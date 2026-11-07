import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { useFamilyTheme } from "../theme";
import { FText } from "./f-text";

export type FSegmentOption<K extends string> = { key: K; label: string };

/**
 * The reference's segmented control: a dark pill that slides between options
 * on a light track. Look from `components.segment`.
 */
export function FSegment<K extends string>({
  options,
  value,
  onChange,
  testID,
  style,
}: {
  options: FSegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  testID?: string;
  /** Layout only. */
  style?: StyleProp<ViewStyle>;
}) {
  const { components, motion } = useFamilyTheme();
  const s = components.segment;
  const [layouts, setLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const active = layouts[value];

  useEffect(() => {
    if (!active) return;
    const first = width.value === 0;
    const config = { ...motion.spring, reduceMotion: ReduceMotion.System };
    // The first placement jumps; later changes slide.
    x.value = first ? active.x : withSpring(active.x, config);
    width.value = first ? active.width : withSpring(active.width, config);
  }, [active, motion.spring, x, width]);

  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: width.value,
  }));

  const onItemLayout = (key: K) => (event: LayoutChangeEvent) => {
    const { x: itemX, width: itemWidth } = event.nativeEvent.layout;
    setLayouts((prev) =>
      prev[key]?.x === itemX && prev[key]?.width === itemWidth
        ? prev
        : { ...prev, [key]: { x: itemX, width: itemWidth } },
    );
  };

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[
        styles.track,
        { height: s.height, padding: s.padding, borderRadius: s.radius, backgroundColor: s.trackBg },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.thumb,
          { top: s.padding, bottom: s.padding, borderRadius: s.radius, backgroundColor: s.activeBg },
          active ? null : styles.hidden,
          thumb,
        ]}
      />
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            testID={testID ? `${testID}-${option.key}` : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onLayout={onItemLayout(option.key)}
            onPress={() => {
              if (selected) return;
              void Haptics.selectionAsync();
              onChange(option.key);
            }}
            style={styles.item}
          >
            <FText variant="label" numberOfLines={1} tint={selected ? s.activeFg : s.fg}>
              {option.label}
            </FText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  thumb: {
    position: "absolute",
    left: 0,
  },
  hidden: {
    opacity: 0,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
});
