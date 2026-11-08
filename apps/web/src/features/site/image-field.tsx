"use client";

import { ImagePlusIcon, Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveContext } from "@/features/session/active-context";
import { errorMessage } from "@/lib/errors";
import { prepareImage, putToUploadLink } from "@/lib/image-upload";
import { trpc } from "@/lib/trpc/client";

/**
 * THE EDITOR'S IMAGE FIELD — pick a file, not a URL. The browser shrinks it,
 * PUTs it straight to the public bucket with a link from
 * `publicSite.imageUpload`, and `publicSite.imageReady` checks it and answers
 * its public link, which is written into the draft (ADR-063). Saving the
 * draft stores it as a token, so a later provider or CDN change breaks no
 * content. The monospace input stays for the rare paste-a-URL case.
 */

export function ImageField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { organizationId } = useActiveContext();

  const link = trpc.publicSite.imageUpload.useMutation();
  const ready = trpc.publicSite.imageReady.useMutation();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // re-picking the same file must fire change again
    if (!file) return;
    setBusy(true);
    try {
      // PNG stays lossless so logos and graphics keep sharp edges.
      const image = await prepareImage(file, 2000, file.type === "image/png" ? "png" : "jpeg");
      if (!image) throw new Error("This browser can't read that image. Use a JPEG, PNG or WebP.");
      const ticket = await link.mutateAsync({
        organizationId,
        file: { contentType: image.contentType, sizeBytes: image.sizeBytes },
      });
      await putToUploadLink(ticket, image);
      const { url } = await ready.mutateAsync({ organizationId, objectId: ticket.objectId });
      onChange(url);
      toast.success("Image uploaded — remember to publish.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
        {value ? (
          <Image src={value} alt="" width={56} height={56} className="h-full w-full object-cover" unoptimized />
        ) : (
          <ImagePlusIcon className="size-5 text-muted-foreground" />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
          placeholder="Upload an image, or paste its URL"
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
            {busy ? "Uploading…" : "Upload image"}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFile}
        aria-label="Choose an image to upload"
      />
    </div>
  );
}
