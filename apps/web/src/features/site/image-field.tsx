"use client";

import { ImagePlusIcon, Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveContext } from "@/features/session/active-context";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc/client";

/**
 * THE EDITOR'S IMAGE FIELD — pick a file, not a URL. The browser resizes
 * client-side (same pattern as student photos: the client is the only place
 * bytes are resized, ADR-038) to max 1440px WebP, uploads through
 * publicSite.uploadImage (stored PUBLIC per ADR-042), and the returned
 * stable URL is written into the draft. The monospace input stays for the
 * rare paste-a-URL case.
 */

const MAX_DIMENSION = 1440;

async function resizeToWebp(file: File): Promise<{ contentType: "image/webp"; dataBase64: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (!blob) throw new Error("Could not process the image.");

  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the processed image."));
    reader.readAsDataURL(blob);
  });
  return { contentType: "image/webp", dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

export function ImageField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { organizationId } = useActiveContext();

  const upload = trpc.publicSite.uploadImage.useMutation({
    onSuccess: ({ url }) => {
      onChange(url);
      toast.success("Image uploaded — remember to publish.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // re-picking the same file must fire change again
    if (!file) return;
    setBusy(true);
    try {
      const data = await resizeToWebp(file);
      await upload.mutateAsync({ organizationId, data });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
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
