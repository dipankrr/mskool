import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ImageRejectedError, detectImageType, processImage } from "./image";
import { PURPOSES } from "./purposes";

/**
 * IMAGE PROCESSING (ADR-063) — every stored image is decoded and re-encoded
 * once. Hermetic: real sharp, no bucket, no database.
 */

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#c0392b" } });

describe("detectImageType", () => {
  it("reads the type from the bytes, not the name", async () => {
    expect(detectImageType(await solid(4, 4).jpeg().toBuffer())).toBe("image/jpeg");
    expect(detectImageType(await solid(4, 4).png().toBuffer())).toBe("image/png");
    expect(detectImageType(await solid(4, 4).webp().toBuffer())).toBe("image/webp");
    expect(detectImageType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe("processImage", () => {
  it("shrinks a camera photo to the purpose's size, as WebP", async () => {
    const photo = await solid(3000, 2000).jpeg().toBuffer();
    const [display] = await processImage(photo, PURPOSES.student_photo.variants);
    expect(display?.contentType).toBe("image/webp");
    // Fits inside 600×800 and keeps its shape.
    expect(display?.width).toBe(600);
    expect(display?.height).toBe(400);
  });

  it("never enlarges a small image", async () => {
    const [display] = await processImage(
      await solid(40, 30).png().toBuffer(),
      PURPOSES.student_photo.variants,
    );
    expect([display?.width, display?.height]).toEqual([40, 30]);
  });

  it("writes every version the purpose stores", async () => {
    const page = await solid(2400, 3200).jpeg().toBuffer();
    const out = await processImage(page, PURPOSES.homework_student_file.variants);
    expect(out.map((v) => v.name)).toEqual(["display", "thumb"]);
    expect(Math.max(out[0]!.width, out[0]!.height)).toBe(2000);
    expect(Math.max(out[1]!.width, out[1]!.height)).toBe(320);
  });

  it("turns phone photos upright and drops their metadata", async () => {
    // A landscape sensor image tagged "rotate 90°", as phones write them.
    const tagged = await solid(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const [display] = await processImage(tagged, PURPOSES.student_photo.variants);
    expect([display?.width, display?.height]).toEqual([100, 200]);
    const meta = await sharp(display!.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("keeps a QR code lossless, as PNG", async () => {
    const qr = await solid(300, 300).jpeg().toBuffer();
    const [display] = await processImage(qr, PURPOSES.fee_upi_qr.variants);
    expect(display?.contentType).toBe("image/png");
    expect(detectImageType(display!.body)).toBe("image/png");
  });

  it("refuses anything that is not a real image", async () => {
    await expect(
      processImage(Buffer.from("not an image at all"), PURPOSES.student_photo.variants),
    ).rejects.toBeInstanceOf(ImageRejectedError);

    // Right magic bytes, broken body.
    const png = await solid(50, 50).png().toBuffer();
    await expect(
      processImage(png.subarray(0, 40), PURPOSES.student_photo.variants),
    ).rejects.toBeInstanceOf(ImageRejectedError);
  });

  it("refuses animated images", async () => {
    // Two different frames: identical ones are merged into a single still.
    const frame = (background: string) =>
      sharp({ create: { width: 20, height: 20, channels: 3, background } })
        .png()
        .toBuffer();
    const frames = await Promise.all([frame("#c0392b"), frame("#2c3e50")]);
    const animated = await sharp(frames, { join: { animated: true } })
      .webp()
      .toBuffer();
    await expect(processImage(animated, PURPOSES.site_media.variants)).rejects.toThrow("Animated");
  });
});
