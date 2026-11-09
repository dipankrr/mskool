import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";

import { AppIcon } from "../../components/app-icon";
import { initials } from "../../components/avatar";
import { ChoiceSheet } from "../../components/choice-sheet";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { prepareImage, putToUploadLink } from "../../lib/image-upload";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

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

/**
 * Uploads a picked photo as a student's photo (ADR-063): shrink it on the
 * phone, ask for an upload link, PUT the file straight to the bucket, then
 * `setPhoto` has the server check it and make it the student's. Answers the
 * new photo, ready to show, and puts it in the photo read's cache.
 */
export function useStudentPhotoUploader() {
  const utils = trpc.useUtils();
  const link = trpc.student.photoUpload.useMutation();
  const save = trpc.student.setPhoto.useMutation();
  // Busy for the whole upload, not only the two server calls: shrinking the
  // photo and sending it to the bucket happen between them.
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (organizationId: string, studentId: string, photo: PickedImage) => {
      setUploading(true);
      try {
        const image = await prepareImage(photo.uri, photo.width, photo.height, 1200);
        const ticket = await link.mutateAsync({
          organizationId,
          id: studentId,
          file: { contentType: image.contentType, sizeBytes: image.sizeBytes },
        });
        await putToUploadLink(ticket, image);
        const saved = await save.mutateAsync({
          organizationId,
          id: studentId,
          objectId: ticket.objectId,
        });
        utils.student.photo.setData({ organizationId, id: studentId }, { photo: saved.photo });
        return saved.photo;
      } finally {
        setUploading(false);
      }
    },
    // The mutation objects are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [utils],
  );

  return { upload, busy: uploading };
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
  const photo = query.data?.photo ?? null;

  const utils = trpc.useUtils();
  const uploader = useStudentPhotoUploader();
  const removeMutation = trpc.student.removePhoto.useMutation();

  const upload = async (picked: PickedImage) => {
    if (!organizationId || !studentId) return;
    await uploader.upload(organizationId, studentId, picked);
  };

  const remove = async () => {
    await removeMutation.mutateAsync(input);
    utils.student.photo.setData(input, { photo: null });
  };

  return {
    hasPhoto: photo !== null,
    uri: photo?.url ?? null,
    // The link changes every few hours; the file behind an id never does.
    cacheKey: photo?.id ?? null,
    busy: uploader.busy || removeMutation.isPending,
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
  cacheKey = null,
  name,
  size,
  busy = false,
  onDark = false,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  /** Sits on the profile's coloured band: white initials on a translucent circle. */
  onDark?: boolean;
  uri: string | null;
  /** The stored photo's id; caches the file across changing links. */
  cacheKey?: string | null;
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
        <Image
          source={cacheKey ? { uri, cacheKey } : { uri }}
          cachePolicy="disk"
          contentFit="cover"
          style={[styles.face, circle]}
          testID={testID && `${testID}-image`}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.face, styles.empty, onDark ? styles.emptyOnDark : null, circle]}>
          {name ? (
            <ThemedText
              variant="title"
              color={onDark ? colors.onAccent : colors.muted}
              allowFontScaling={false}
            >
              {initials(name)}
            </ThemedText>
          ) : (
            <AppIcon name="camera" size={size * 0.36} color={onDark ? colors.onAccent : colors.muted} />
          )}
        </View>
      )}
      {busy ? (
        <View style={[styles.busy, circle]}>
          <ActivityIndicator color={colors.surface} />
        </View>
      ) : onPress && (uri || name) ? (
        <View style={[styles.badge, onDark ? styles.badgeOnDark : null]}>
          <AppIcon name="camera" size={14} color={onDark ? colors.accentDeep : colors.surface} />
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
  emptyOnDark: {
    backgroundColor: colors.onBandWash,
  },
  badgeOnDark: {
    backgroundColor: colors.onBand,
    borderColor: colors.band,
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
