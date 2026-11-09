import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import type { UploadStatus } from "./use-photo-workbench";

/**
 * One student in the photo grid: the face is the biggest thing, roll number
 * on its corner, name under it. Shows a new photo, else the current one
 * (faded when the student is skipped), else an empty slot. Upload state rides
 * on the top-right corner; a failure also rings the card red.
 */
export function FaceCard({
  name,
  roll,
  sub,
  uri,
  empty,
  emptyIcon = "person",
  faded = false,
  selected = false,
  status,
  onPress,
  onLongPress,
  accessibilityLabel,
  testID,
}: {
  name: string;
  roll: string | null;
  sub: string;
  uri: string | null;
  empty?: boolean;
  emptyIcon?: "person" | "camera";
  faded?: boolean;
  selected?: boolean;
  status?: UploadStatus;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const failed = status?.state === "failed";
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [styles.wrap, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <View
        style={[styles.photo, faded ? styles.faded : null]}
      >
        {uri && !empty ? (
          <Image
            source={{ uri }}
            recyclingKey={uri}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View style={styles.empty}>
            <AppIcon name={emptyIcon} size={26} color={colors.chevron} />
          </View>
        )}
        {roll ? (
          <View style={styles.roll}>
            <ThemedText variant="meta" style={styles.rollText}>
              {roll}
            </ThemedText>
          </View>
        ) : null}
        {selected || failed ? (
          <View
            pointerEvents="none"
            style={[styles.ring, failed ? styles.ringFailed : styles.ringSelected]}
          />
        ) : null}
        {status && status.state !== "waiting" ? (
          <View
            style={[
              styles.tag,
              status.state === "done"
                ? styles.tagDone
                : status.state === "failed"
                  ? styles.tagFailed
                  : styles.tagBusy,
            ]}
          >
            {status.state === "uploading" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <AppIcon
                name={status.state === "done" ? "check" : "warning"}
                size={13}
                color="#fff"
              />
            )}
          </View>
        ) : null}
      </View>
      <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.name}>
        {name}
      </ThemedText>
      <ThemedText
        variant="meta"
        numberOfLines={1}
        style={[styles.sub, failed ? styles.subFailed : null]}
      >
        {sub}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  photo: {
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.field,
  },
  faded: { opacity: 0.45 },
  ring: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.md, borderWidth: 3 },
  ringSelected: { borderColor: colors.accent },
  ringFailed: { borderColor: colors.tone.critical.fg },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  roll: {
    position: "absolute",
    left: 6,
    top: 6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: "rgba(16,24,40,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  rollText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  tag: {
    position: "absolute",
    right: 6,
    top: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  tagDone: { backgroundColor: colors.accent },
  tagFailed: { backgroundColor: colors.tone.critical.fg },
  tagBusy: { backgroundColor: "rgba(16,24,40,0.6)" },
  name: { marginTop: spacing.xxs + 1, fontSize: 12 },
  sub: { fontSize: 11 },
  subFailed: { color: colors.tone.critical.fg },
});
