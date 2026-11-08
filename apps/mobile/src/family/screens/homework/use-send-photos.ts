import { useCallback, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";

import { prepareImage, putToUploadLink } from "../../../lib/image-upload";
import { trpc } from "../../../lib/trpc";

export const MAX_PAGES = 10;

export type Page = {
  key: string;
  uri: string;
  width: number;
  height: number;
  status: "uploading" | "ready" | "failed";
  objectId: string | null;
};

/**
 * The child's pages for one homework (ADR-063): each picked photo is shrunk,
 * given an upload link and sent to the bucket straight away, so "Send" only
 * names ids already uploaded. A failed page retries on its own.
 * `add` returns an i18n key when it can't add (camera refused, full).
 */
export function useSendPhotos(input: { studentId: string; studentAssignmentId: string }) {
  const link = trpc.portalHomework.fileUpload.useMutation();
  const [pages, setPages] = useState<Page[]>([]);
  const counter = useRef(0);

  const update = (key: string, patch: Partial<Page>) =>
    setPages((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const upload = useCallback(
    async (page: Page) => {
      update(page.key, { status: "uploading" });
      try {
        const image = await prepareImage(page.uri, page.width, page.height, 2000);
        const [ticket] = await link.mutateAsync({
          ...input,
          files: [{ contentType: image.contentType, sizeBytes: image.sizeBytes }],
        });
        if (!ticket) throw new Error("no upload link");
        await putToUploadLink(ticket, image);
        update(page.key, { status: "ready", objectId: ticket.objectId });
      } catch {
        update(page.key, { status: "failed" });
      }
    },
    // `link.mutateAsync` is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.studentId, input.studentAssignmentId],
  );

  const add = useCallback(
    async (source: "camera" | "library"): Promise<"send.cameraDenied" | "send.full" | null> => {
      const room = MAX_PAGES - pages.length;
      if (room <= 0) return "send.full";
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 1,
        exif: false,
        allowsMultipleSelection: source === "library",
        selectionLimit: room,
      };
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) return "send.cameraDenied";
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
      setPages((all) => [...all, ...picked]);
      for (const page of picked) void upload(page);
      return null;
    },
    [pages.length, upload],
  );

  const remove = (key: string) => setPages((all) => all.filter((p) => p.key !== key));
  const retry = (key: string) => {
    const page = pages.find((p) => p.key === key);
    if (page) void upload(page);
  };

  return {
    pages,
    add,
    remove,
    retry,
    busy: pages.some((p) => p.status === "uploading"),
    failed: pages.findIndex((p) => p.status === "failed"),
    objectIds: pages.filter((p) => p.status === "ready").map((p) => p.objectId as string),
  };
}
