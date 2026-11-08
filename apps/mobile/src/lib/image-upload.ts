import type { UploadTicket } from "@repo/contracts";
import { fetch } from "expo/fetch";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { copy } from "./copy";

/**
 * DIRECT UPLOADS (ADR-063). A picked image is shrunk on the phone to save
 * data, then PUT straight to the bucket with the link the server handed out;
 * the API never carries the bytes. The server decodes and re-encodes every
 * file anyway, so this resize only needs to be generous, never exact.
 */

export type PreparedImage = {
  uri: string;
  sizeBytes: number;
  contentType: "image/jpeg" | "image/png";
};

/**
 * The picked image no longer than `maxEdge` on its long side: a JPEG at high
 * quality (the server's own encode is the one that counts), or a lossless PNG
 * for images that must stay sharp, like a QR code.
 */
export async function prepareImage(
  uri: string,
  width: number,
  height: number,
  maxEdge = 1600,
  format: "jpeg" | "png" = "jpeg",
): Promise<PreparedImage> {
  let context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > maxEdge) {
    context = context.resize(height >= width ? { height: maxEdge } : { width: maxEdge });
  }
  const rendered = await context.renderAsync();
  const saved =
    format === "png"
      ? await rendered.saveAsync({ format: SaveFormat.PNG })
      : await rendered.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
  return {
    uri: saved.uri,
    sizeBytes: new File(saved.uri).size,
    contentType: format === "png" ? "image/png" : "image/jpeg",
  };
}

/** A direct upload the bucket refused or never received; its message is for the person. */
export class UploadFailedError extends Error {
  constructor() {
    super(copy.uploads.failed);
    this.name = "UploadFailedError";
  }
}

/** Sends the prepared file to its upload link, with exactly the signed headers. */
export async function putToUploadLink(ticket: UploadTicket, image: PreparedImage): Promise<void> {
  let response: Response;
  try {
    response = await fetch(ticket.url, {
      method: "PUT",
      headers: ticket.headers,
      body: new File(image.uri),
    });
  } catch (cause) {
    console.warn("[upload] PUT failed before a response", cause);
    throw new UploadFailedError();
  }
  if (!response.ok) {
    const reply = await response.text().catch(() => "");
    console.warn(`[upload] PUT refused: HTTP ${response.status} ${reply.slice(0, 300)}`);
    throw new UploadFailedError();
  }
}
