import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Image } from "expo-image";

import { AppIcon } from "../../components/app-icon";
import { initials } from "../../components/avatar";
import { ThemedText } from "../../components/themed-text";
import { prepareImage, putToUploadLink } from "../../lib/image-upload";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily } from "../../theme/tokens";
import type { PickedImage } from "../students/student-photo";
import type { UploadRequest, UploadTicket } from "@repo/contracts";

/**
 * Staff photos (ADR-068): the office sets one on a staff record
 * (`staff.setPhoto`), and a staff member sets their own (`me.setPhoto`).
 * Both follow the student photo's upload (ADR-063): shrink on the phone, PUT
 * to the link, then the server checks it and links it.
 */

/** Soft initials colours, picked from the name so a person keeps theirs. */
const TINTS = [
  { bg: "#DDF3E6", fg: "#0B6B3A" },
  { bg: "#E0EAFF", fg: "#2F4FB3" },
  { bg: "#ECE6FD", fg: "#5B3FC4" },
  { bg: "#FFE9D5", fg: "#A24B0C" },
  { bg: "#FDE4EC", fg: "#B4235A" },
  { bg: "#D9F2F2", fg: "#0F7275" },
] as const;

export function tintFor(name: string) {
  let n = 7;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) % 9973;
  return TINTS[n % TINTS.length]!;
}

/** A person's photo, or their initials on their own soft colour. */
export function StaffAvatar({
  name,
  uri,
  cacheKey,
  size = 40,
  badge,
  busy = false,
  style,
}: {
  name: string;
  uri?: string | null;
  cacheKey?: string | null;
  size?: number;
  /** A small accent badge in the corner: a camera to add a photo, or a check. */
  badge?: "camera" | "check";
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const tint = tintFor(name);
  const badgeSize = Math.max(18, Math.round(size * 0.36));
  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {uri ? (
        <Image
          source={{ uri, cacheKey: cacheKey ?? undefined }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <ThemedText
          variant="body"
          style={{ color: tint.fg, fontFamily: fontFamily.semibold, fontSize: Math.round(size * 0.36) }}
        >
          {initials(name)}
        </ThemedText>
      )}
      {busy ? (
        <View style={[styles.busy, { borderRadius: size / 2 }]}>
          <ActivityIndicator color={colors.onAccent} />
        </View>
      ) : null}
      {badge ? (
        <View
          style={[
            styles.badge,
            { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2 },
          ]}
        >
          <AppIcon
            name={badge === "camera" ? "camera" : "check"}
            size={Math.round(badgeSize * 0.55)}
            color={colors.onAccent}
          />
        </View>
      ) : null}
    </View>
  );
}

async function uploadWith(
  photo: PickedImage,
  link: (file: UploadRequest) => Promise<UploadTicket>,
  save: (objectId: string) => Promise<unknown>,
) {
  const image = await prepareImage(photo.uri, photo.width, photo.height, 1200);
  const ticket = await link({ contentType: image.contentType, sizeBytes: image.sizeBytes });
  await putToUploadLink(ticket, image);
  await save(ticket.objectId);
}

/** The signed-in staff member's own photo. */
export function useMyPhoto(organizationId: string | null) {
  const utils = trpc.useUtils();
  const input = { organizationId: organizationId ?? "" };
  const query = trpc.me.photo.useQuery(input, { enabled: Boolean(organizationId) });
  const link = trpc.me.photoUpload.useMutation();
  const save = trpc.me.setPhoto.useMutation();
  const [busy, setBusy] = useState(false);

  const upload = useCallback(
    async (photo: PickedImage) => {
      if (!organizationId) return;
      setBusy(true);
      try {
        await uploadWith(
          photo,
          (file) => link.mutateAsync({ organizationId, file }),
          async (objectId) => {
            const saved = await save.mutateAsync({ organizationId, objectId });
            utils.me.photo.setData({ organizationId }, { photo: saved.photo });
          },
        );
      } finally {
        setBusy(false);
      }
    },
    // The mutation objects are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [organizationId, utils],
  );

  const photo = query.data?.photo ?? null;
  return { uri: photo?.url ?? null, cacheKey: photo?.id ?? null, busy, upload };
}

/** The office's side: one staff record's photo. */
export function useStaffPhotoUploader() {
  const utils = trpc.useUtils();
  const link = trpc.staff.photoUpload.useMutation();
  const save = trpc.staff.setPhoto.useMutation();
  const [busy, setBusy] = useState(false);

  const upload = useCallback(
    async (organizationId: string, staffId: string, photo: PickedImage) => {
      setBusy(true);
      try {
        await uploadWith(
          photo,
          (file) => link.mutateAsync({ organizationId, id: staffId, file }),
          async (objectId) => {
            await save.mutateAsync({ organizationId, id: staffId, objectId });
            await Promise.all([utils.staff.byId.invalidate(), utils.staff.list.invalidate()]);
          },
        );
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [utils],
  );

  return { upload, busy };
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  busy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(16, 24, 40, 0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
