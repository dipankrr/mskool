"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * THE STUDENT'S PHOTO CARD (slice 2a, ADR-038).
 *
 * Resizes in-canvas to ~300×400 JPEG BEFORE upload — the only place bytes are
 * touched. The contract's allowlist + byte cap are the server's backstop; the
 * resize is what makes the cap a non-event for a phone photo. One photo per
 * student: a replace upserts and the replaced object's bytes are deleted
 * server-side, so the visible image (cached by its immutable object id)
 * simply changes id.
 */

const TARGET_W = 300;
const TARGET_H = 400;

async function fileToResizedBase64(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(TARGET_W / bitmap.width, TARGET_H / bitmap.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return base64.length > 0 ? base64 : null;
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
  const upload = trpc.student.uploadPhoto.useMutation({
    onSuccess: async () => {
      toast.success(copy.idCards.photo.uploaded);
      await utils.student.photo.invalidate();
      setBusy(false);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setBusy(false);
    },
  });
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
      const base64 = await fileToResizedBase64(file);
      if (!base64) {
        toast.error(copy.idCards.photo.tooLarge);
        setBusy(false);
        return;
      }
      await upload.mutateAsync({
        organizationId,
        id: studentId,
        data: { contentType: "image/jpeg", dataBase64: base64 },
      });
    } catch {
      toast.error(copy.idCards.photo.tooLarge);
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
          {photo.isLoading ? null : photo.data?.objectId ? (
            <img
              src={`/api/storage/${photo.data.objectId}`}
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
                {photo.data?.objectId
                  ? copy.idCards.photo.replace
                  : copy.idCards.photo.upload}
              </Button>
              {photo.data?.objectId ? (
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
