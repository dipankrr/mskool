import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import type { ImageRef } from "@repo/contracts";

import { AppIcon } from "../../../components/app-icon";
import { useFamilyTheme } from "../../theme";
import { FText } from "../../ui";

/** A row of photos; tap one to see them full screen, swiping between them. */
export function PhotoRow({ photos, faded = false, size = 96 }: { photos: ImageRef[]; faded?: boolean; size?: number }) {
  const theme = useFamilyTheme();
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space.sm }}>
        {photos.map((p, i) => (
          <Pressable
            key={p.id}
            accessibilityRole="imagebutton"
            onPress={() => setOpen(i)}
            style={{
              width: size,
              height: size * 1.2,
              borderRadius: theme.components.homework.photo.radius,
              overflow: "hidden",
              backgroundColor: theme.color.surfaceSunk,
              opacity: faded ? 0.55 : 1,
            }}
          >
            <Image source={{ uri: p.thumbUrl ?? p.url }} cachePolicy="disk" recyclingKey={p.id} style={styles.fill} contentFit="cover" />
          </Pressable>
        ))}
      </ScrollView>
      {open !== null ? <Viewer photos={photos} start={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Viewer({ photos, start, onClose }: { photos: ImageRef[]; start: number; onClose: () => void }) {
  const { t } = useTranslation("common");
  const { t: th } = useTranslation("homework");
  const theme = useFamilyTheme();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(start);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.fill, { backgroundColor: theme.color.ink }]}>
        <ScrollView
          horizontal
          pagingEnabled
          contentOffset={{ x: start * width, y: 0 }}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          showsHorizontalScrollIndicator={false}
        >
          {photos.map((p) => (
            <View key={p.id} style={{ width, height }}>
              <Image source={{ uri: p.url }} cachePolicy="disk" recyclingKey={p.id} style={styles.fill} contentFit="contain" />
            </View>
          ))}
        </ScrollView>
        <View style={[styles.bar, { padding: theme.space.xl, paddingTop: theme.space.huge }]}>
          <FText variant="bodyStrong" color="onAccent">
            {th("detail.viewer", { n: index + 1, total: photos.length })}
          </FText>
          <Pressable accessibilityRole="button" accessibilityLabel={t("close")} onPress={onClose} hitSlop={12}>
            <AppIcon name="close" size={24} color={theme.color.onAccent} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
