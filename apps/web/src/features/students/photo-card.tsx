"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { prepareImage, putToUploadLink } from "@/lib/image-upload";
import { trpc } from "@/lib/trpc/client";

/**
 * THE STUDENT'S PHOTO CARD (ADR-063).
 *
 * Uploads go straight to the bucket: the browser shrinks the photo, asks for
 * an upload link, PUTs the file, and `student.setPhoto` has the server check
 * it and make it the student's. One photo per student: a replace lets the old
 * file go, and the visible image (cached by its id) simply changes id.
 */

/**
 * Uploads a chosen file as a student's photo; shared with the bulk-photo
 * workbench. Throws a readable error when the browser cannot read the image.
 */
export function useStudentPhotoUploader() {
  const utils = trpc.useUtils();
  const link = trpc.student.photoUpload.useMutation();
  const save = trpc.student.setPhoto.useMutation();

  return useCallback(
    async (organizationId: string, studentId: string, file: File) => {
      const image = await prepareImage(file, 1200);
      if (!image) throw new Error(copy.idCards.photo.unreadable);
      const ticket = await link.mutateAsync({
        organizationId,
        id: studentId,
        file: { contentType: image.contentType, sizeBytes: image.sizeBytes },
      });
      await putToUploadLink(ticket, image);
      const saved = await save.mutateAsync({ organizationId, id: studentId, objectId: ticket.objectId });
      utils.student.photo.setData({ organizationId, id: studentId }, { photo: saved.photo });
      return saved.photo;
    },
    // The mutation objects are stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [utils],
  );
}

export function StudentPhotoCard({ studentId }: { studentId: string }) {
  const { has, organizationId } = useActiveContext();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const photo = trpc.student.photo.useQuery(
    { organizationId, id: studentId },
    { enabled: Boolean(studentId), staleTime: 30_000, retry: false },
  );

  const utils = trpc.useUtils();
  const uploadPhoto = useStudentPhotoUploader();
  const remove = trpc.student.removePhoto.useMutation({
    onSuccess: async () => {
      toast.success(copy.idCards.photo.removed);
      await utils.student.photo.invalidate();
      setBusy(false);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setBusy(false);
    },
  });

  const canEdit = has("student:update");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await uploadPhoto(organizationId, studentId, file);
      toast.success(copy.idCards.photo.uploaded);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.idCards.photo.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-start gap-4">
        <div className="flex h-[100px] w-[75px] shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40 text-xs text-muted-foreground">
          {photo.isLoading ? null : photo.data?.photo ? (
            <img
              src={photo.data.photo.url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            copy.idCards.photo.empty
          )}
        </div>

        {canEdit ? (
          <div className="flex flex-col gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                void onFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {photo.data?.photo
                  ? copy.idCards.photo.replace
                  : copy.idCards.photo.upload}
              </Button>
              {photo.data?.photo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void remove.mutateAsync({
                      organizationId,
                      id: studentId,
                    });
                  }}
                >
                  {copy.idCards.photo.remove}
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {copy.idCards.photo.hint}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
