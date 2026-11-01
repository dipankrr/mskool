import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { AppIcon } from "../../components/app-icon";
import { initials } from "../../components/avatar";
import { ChoiceSheet } from "../../components/choice-sheet";
import { ThemedText } from "../../components/themed-text";
import { env } from "../../env";
import { authClient } from "../../lib/auth";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { photoToWireBase64 } from "./photo-matching";

/**
 * One student's photo, wherever it appears: the profile's hero and the admit
 * flow's first step. Picking is shared; reading and saving wait until there is
 * a student to attach the photo to.
 */

export type PickedImage = { uri: string; width: number; height: number };

type PhotoSource = "camera" | "library";

async function pickStudentPhoto(source: PhotoSource): Promise<PickedImage | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 1,
    exif: false,
  };
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error(copy.profilePhoto.cameraDenied);
  }
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  return asset ? { uri: asset.uri, width: asset.width, height: asset.height } : null;
}

/** The picked image as the wire's base64, or a refusal the desk can read. */
export async function photoUploadBody(photo: PickedImage) {
  const dataBase64 = await photoToWireBase64(photo.uri, photo.width, photo.height);
  if (!dataBase64) throw new Error(copy.photos.tooLarge);
  return { contentType: "image/jpeg" as const, dataBase64 };
}

/**
 * The stored photo as a data URI: RN's Image doesn't carry the session cookie
 * the storage route needs, and that cookie lives in SecureStore, so it rides
 * the header explicitly.
 */
async function fetchPhotoUri(objectId: string): Promise<string | null> {
  const cookies = await authClient.getCookie();
  const response = await fetch(`${env.EXPO_PUBLIC_API_URL}/api/storage/${objectId}`, {
    credentials: "omit",
    ...(cookies ? { headers: { Cookie: cookies } } : {}),
  });
  if (!response.ok) return null;
  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/** Reads, replaces and removes one student's stored photo. */
export function useStudentPhoto(
  organizationId: string | null,
  studentId: string | undefined,
  canRead: boolean,
) {
  const input = { organizationId: organizationId ?? "", id: studentId ?? "" };
  const query = trpc.student.photo.useQuery(input, {
    enabled: canRead && Boolean(organizationId) && Boolean(studentId),
  });
  const objectId = query.data?.objectId ?? null;

  const [loaded, setLoaded] = useState<{ objectId: string; uri: string } | null>(null);
  useEffect(() => {
    if (!objectId) return;
    let stale = false;
    fetchPhotoUri(objectId)
      .then((uri) => {
        if (!stale && uri) setLoaded({ objectId, uri });
      })
      // A failed render keeps the initials: never a broken image.
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [objectId]);

  const utils = trpc.useUtils();
  const uploadMutation = trpc.student.uploadPhoto.useMutation();
  const removeMutation = trpc.student.removePhoto.useMutation();

  const upload = async (photo: PickedImage) => {
    const saved = await uploadMutation.mutateAsync({
      ...input,
      data: await photoUploadBody(photo),
    });
    // The mutation names the new object, so the cached "no photo" goes now.
    // Re-reading could still be answered from that cache for up to a minute.
    utils.student.photo.setData(input, { objectId: saved.objectId });
  };

  const remove = async () => {
    await removeMutation.mutateAsync(input);
    utils.student.photo.setData(input, { objectId: null });
  };

  return {
    hasPhoto: objectId !== null,
    // Keyed by object, so a replaced or removed photo can never linger.
    uri: loaded && loaded.objectId === objectId ? loaded.uri : null,
    busy: uploadMutation.isPending || removeMutation.isPending,
    upload,
    remove,
    refetch: query.refetch,
  };
}

/**
 * Take, choose or remove. The picker opens only once the sheet has gone, because
 * iOS refuses to present it over a sheet that is still on screen.
 */
export function PhotoSourceSheet({
  visible,
  hasPhoto,
  onDismiss,
  onPicked,
  onRemove,
  onError,
}: {
  visible: boolean;
  hasPhoto: boolean;
  onDismiss: () => void;
  onPicked: (photo: PickedImage) => void;
  onRemove: () => void;
  onError: (error: unknown) => void;
}) {
  const chosen = useRef<string | null>(null);
  return (
    <ChoiceSheet
      visible={visible}
      title={copy.profilePhoto.sheetTitle}
      options={[
        { id: "camera", label: copy.profilePhoto.take },
        { id: "library", label: copy.profilePhoto.choose },
        ...(hasPhoto ? [{ id: "remove", label: copy.profilePhoto.remove }] : []),
      ]}
      currentId=""
      onSelect={(id) => {
        chosen.current = id;
        onDismiss();
      }}
      onDismiss={() => {
        onDismiss();
        const action = chosen.current;
        chosen.current = null;
        if (action === "remove") onRemove();
        if (action === "camera" || action === "library") {
          pickStudentPhoto(action)
            .then((photo) => {
              if (photo) onPicked(photo);
            })
            .catch(onError);
        }
      }}
      testIDPrefix="student-photo"
    />
  );
}

/** The round photo, or initials or a camera glyph until there is one. */
export function StudentPhotoView({
  uri,
  name,
  size,
  busy = false,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  uri: string | null;
  /** Null before a name is typed: the empty circle shows a camera instead. */
  name: string | null;
  size: number;
  busy?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}) {
  const circle = { width: size, height: size, borderRadius: size / 2 };
  const face = (
    <>
      {uri ? (
        <Image source={{ uri }} style={[styles.face, circle]} testID={testID && `${testID}-image`} />
      ) : (
        <View style={[styles.face, styles.empty, circle]}>
          {name ? (
            <ThemedText variant="title" color={colors.muted} allowFontScaling={false}>
              {initials(name)}
            </ThemedText>
          ) : (
            <AppIcon name="camera" size={size * 0.36} color={colors.muted} />
          )}
        </View>
      )}
      {busy ? (
        <View style={[styles.busy, circle]}>
          <ActivityIndicator color={colors.surface} />
        </View>
      ) : onPress && (uri || name) ? (
        <View style={styles.badge}>
          <AppIcon name="camera" size={14} color={colors.surface} />
        </View>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={circle} testID={testID} accessible={false}>
        {face}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [circle, pressed ? styles.pressed : null]}
      testID={testID}
    >
      {face}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  face: {
    backgroundColor: colors.field,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
  },
  busy: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.45)",
  },
  badge: {
    position: "absolute",
    right: -spacing.xxs,
    bottom: -spacing.xxs,
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  pressed: {
    opacity: 0.85,
  },
});
