import sharp from "sharp";
import type { Encoding, VariantRule } from "./purposes";

/**
 * IMAGE PROCESSING (ADR-063) — every stored image is re-encoded here, once,
 * when its upload completes. The original upload is never served: decoding
 * and re-encoding proves the file really is an image, drops its metadata
 * (phone photos carry GPS coordinates) and makes it the size it is viewed at.
 */

export type DetectedType = "image/jpeg" | "image/png" | "image/webp";

/** The real type, from the file's first bytes. Null for anything else. */
export function detectImageType(bytes: Buffer): DetectedType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** A refusal the uploader can read. */
export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageRejectedError";
  }
}

export interface ProcessedVariant {
  name: VariantRule["name"];
  body: Buffer;
  contentType: "image/webp" | "image/png";
  extension: "webp" | "png";
  width: number;
  height: number;
}

// A small file can decode into a huge image. 50 megapixels covers every phone
// camera; anything bigger is refused before it is decoded.
const MAX_INPUT_PIXELS = 50_000_000;

// Image work is CPU and memory heavy; a bulk upload must not run hundreds at
// once on one small server. Callers queue behind this limit.
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Decodes the upload and writes every version its purpose stores. */
export async function processImage(
  bytes: Buffer,
  variants: readonly VariantRule[],
): Promise<ProcessedVariant[]> {
  const type = detectImageType(bytes);
  if (!type) {
    throw new ImageRejectedError("That file isn't a JPEG, PNG or WebP image.");
  }

  return withSlot(async () => {
    let pages: number;
    try {
      pages = (await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).pages ?? 1;
    } catch {
      throw new ImageRejectedError("That image is damaged or too large to open.");
    }
    if (pages > 1) {
      throw new ImageRejectedError("Animated images aren't supported. Upload a still image.");
    }

    const out: ProcessedVariant[] = [];
    for (const rule of variants) {
      const format = chooseFormat(rule.encoding, type);
      // rotate() applies the camera's orientation before metadata is
      // dropped; without it phone photos come out sideways.
      let pipeline = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize({
        width: rule.maxWidth,
        height: rule.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });
      pipeline =
        format.kind === "png"
          ? pipeline.png({ compressionLevel: 9 })
          : format.kind === "lossless"
            ? pipeline.webp({ lossless: true })
            : pipeline.webp({ quality: format.quality });

      let result: { data: Buffer; info: { width: number; height: number } };
      try {
        result = await pipeline.toBuffer({ resolveWithObject: true });
      } catch {
        throw new ImageRejectedError("That image is damaged and can't be read.");
      }
      out.push({
        name: rule.name,
        body: result.data,
        contentType: format.kind === "png" ? "image/png" : "image/webp",
        extension: format.kind === "png" ? "png" : "webp",
        width: result.info.width,
        height: result.info.height,
      });
    }
    return out;
  });
}

function chooseFormat(
  encoding: Encoding,
  source: DetectedType,
): { kind: "png" } | { kind: "lossless" } | { kind: "lossy"; quality: number } {
  if (encoding.kind === "png") return { kind: "png" };
  if (encoding.kind === "auto" && source === "image/png") return { kind: "lossless" };
  return { kind: "lossy", quality: encoding.quality };
}
