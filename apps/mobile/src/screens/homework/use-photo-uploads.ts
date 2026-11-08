import { useCallback, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";

import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { prepareImage, putToUploadLink } from "../../lib/image-upload";
import { trpc } from "../../lib/trpc";

export const MAX_PHOTOS = 10;

export type PhotoUpload = {
  key: string;
  /** The picked image, shown while it uploads and after. */
  uri: string;
  width: number;
  height: number;
  status: "uploading" | "ready" | "failed";
  objectId: string | null;
};

/**
 * The teacher's photos for a homework (ADR-063): each picked image is shrunk on
 * the phone, given an upload link and PUT straight to the bucket the moment it
 * is picked, so Give never waits on a slow upload it could have started
 * earlier. The save names the uploaded ids; the server links them.
 */
export function usePhotoUploads(pair: { sectionId: string; subjectId: string } | null) {
  const { organizationId } = useActiveContext();
  const link = trpc.homework.fileUpload.useMutation();
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);
  const counter = useRef(0);

  const update = (key: string, patch: Partial<PhotoUpload>) =>
    setPhotos((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const upload = useCallback(
    async (photo: PhotoUpload) => {
      if (!pair || !organizationId) return;
      update(photo.key, { status: "uploading" });
      try {
        const image = await prepareImage(photo.uri, photo.width, photo.height, 2000);
        const [ticket] = await link.mutateAsync({
          organizationId,
          sectionId: pair.sectionId,
          subjectId: pair.subjectId,
          files: [{ contentType: image.contentType, sizeBytes: image.sizeBytes }],
        });
        if (!ticket) throw new Error(copy.uploads.failed);
        await putToUploadLink(ticket, image);
        update(photo.key, { status: "ready", objectId: ticket.objectId });
      } catch {
        update(photo.key, { status: "failed" });
      }
    },
    // `link.mutateAsync` is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pair?.sectionId, pair?.subjectId, organizationId],
  );

  const add = useCallback(
    async (source: "camera" | "library"): Promise<string | null> => {
      const room = MAX_PHOTOS - photos.length;
      if (room <= 0) return copy.homework.give.photoLimit;
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 1,
        exif: false,
        allowsMultipleSelection: source === "library",
        selectionLimit: room,
      };
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) return copy.profilePhoto.cameraDenied;
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return null;
      const picked = result.assets.slice(0, room).map((asset) => ({
        key: `p${(counter.current += 1)}`,
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        status: "uploading" as const,
        objectId: null,
      }));
      setPhotos((all) => [...all, ...picked]);
      for (const photo of picked) void upload(photo);
      return null;
    },
    [photos.length, upload],
  );

  const remove = (key: string) => setPhotos((all) => all.filter((p) => p.key !== key));
  const retry = (key: string) => {
    const photo = photos.find((p) => p.key === key);
    if (photo) void upload(photo);
  };

  return {
    photos,
    add,
    remove,
    retry,
    busy: photos.some((p) => p.status === "uploading"),
    failed: photos.some((p) => p.status === "failed"),
    objectIds: photos.filter((p) => p.status === "ready").map((p) => p.objectId as string),
  };
}
