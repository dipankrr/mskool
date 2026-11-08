import type { UploadTicket } from "@repo/contracts";

/**
 * DIRECT UPLOADS (ADR-063). A chosen image is shrunk in the browser to save
 * bandwidth, then PUT straight to the bucket with the link the API handed
 * out; the API never carries the bytes. The server decodes and re-encodes
 * every file, so this resize only needs to be generous, never exact.
 */

export type PreparedImage = {
  blob: Blob;
  sizeBytes: number;
  contentType: "image/jpeg" | "image/png";
};

/**
 * The file as a JPEG (or lossless PNG, for images that must stay sharp) no
 * longer than `maxEdge` on its long side. Null when the browser cannot decode
 * it, such as a HEIC photo in a browser without HEIC support.
 */
export async function prepareImage(
  file: File,
  maxEdge = 1600,
  format: "jpeg" | "png" = "jpeg",
): Promise<PreparedImage | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(maxEdge / Math.max(bitmap.width, bitmap.height), 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const contentType = format === "png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, contentType, format === "png" ? undefined : 0.9),
  );
  return blob ? { blob, sizeBytes: blob.size, contentType } : null;
}

/** Sends the prepared image to its upload link, with exactly the signed headers. */
export async function putToUploadLink(ticket: UploadTicket, image: PreparedImage): Promise<void> {
  const response = await fetch(ticket.url, {
    method: "PUT",
    headers: ticket.headers,
    body: image.blob,
  });
  if (!response.ok) {
    throw new Error("The image didn't upload. Check the connection and try again.");
  }
}
