/**
 * Receipt image preprocessing before OCR.
 *
 * OpenCV-style pipeline via Sharp. Outputs a compact JPEG so OCR.Space
 * free-tier (≈1MB) does not reject the request.
 */

import sharp, { type Sharp } from "sharp";
import { convertHeicBufferToJpeg, isHeicFile } from "@/lib/convert-heic-server";

export type PreprocessResult = {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  enhanced: boolean;
  steps: string[];
};

const MAX_OCR_BYTES = 900_000; // stay under OCR.Space ~1MB free limit

function isRasterImage(mime: string): boolean {
  return /image\/(png|jpe?g|webp|gif|heic|heif)/i.test(mime);
}

async function toOcrJpeg(pipeline: Sharp, steps: string[]): Promise<Buffer> {
  let quality = 82;
  let buf = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  steps.push(`jpeg:q${quality}`);

  while (buf.length > MAX_OCR_BYTES && quality > 45) {
    quality -= 12;
    buf = await sharp(buf).jpeg({ quality, mozjpeg: true }).toBuffer();
    steps.push(`jpeg:q${quality}`);
  }

  if (buf.length > MAX_OCR_BYTES) {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 1600;
    const scale = Math.sqrt(MAX_OCR_BYTES / buf.length) * 0.92;
    buf = await sharp(buf)
      .resize({
        width: Math.max(800, Math.round(w * scale)),
        withoutEnlargement: true,
        kernel: "lanczos3",
      })
      .jpeg({ quality: 70, mozjpeg: true })
      .toBuffer();
    steps.push("jpeg:shrink");
  }

  return buf;
}

/**
 * Light enhance for OCR — grayscale + contrast, compressed JPEG.
 */
export async function preprocessReceiptImage(
  input: Buffer,
  mimeType: string,
  fileName?: string
): Promise<PreprocessResult> {
  const steps: string[] = [];

  if (!isRasterImage(mimeType) || input.length < 32) {
    return {
      buffer: input,
      mimeType: /png/i.test(mimeType) ? "image/png" : "image/jpeg",
      width: 0,
      height: 0,
      enhanced: false,
      steps: ["skip:non-raster"],
    };
  }

  let working = input;
  let workingMime = mimeType;
  if (isHeicFile(mimeType, fileName)) {
    working = await convertHeicBufferToJpeg(input);
    workingMime = "image/jpeg";
    steps.push("heic→jpeg");
  }

  try {
    let pipeline = sharp(working, {
      failOn: "none",
      unlimited: isHeicFile(mimeType, fileName),
    }).rotate();
    steps.push("exif-rotate");

    const meta = await pipeline.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const longEdge = Math.max(width, height);

    // Keep long edge in a sweet spot for OCR (not tiny, not huge)
    if (longEdge > 0 && longEdge < 1200) {
      const scale = Math.min(1.8, 1400 / longEdge);
      pipeline = pipeline.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        fit: "fill",
        kernel: "lanczos3",
      });
      steps.push(`upscale:${scale.toFixed(2)}`);
    } else if (longEdge > 2400) {
      const scale = 2000 / longEdge;
      pipeline = pipeline.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        fit: "inside",
        withoutEnlargement: true,
        kernel: "lanczos3",
      });
      steps.push("downscale");
    }

    pipeline = pipeline
      .grayscale()
      .normalize()
      .sharpen({ sigma: 0.9, m1: 0.8, m2: 0.4 })
      .linear(1.12, -8);
    steps.push("gray+normalize+sharpen");

    const jpeg = await toOcrJpeg(pipeline, steps);
    const finalMeta = await sharp(jpeg).metadata();

    return {
      buffer: jpeg,
      mimeType: "image/jpeg",
      width: finalMeta.width ?? 0,
      height: finalMeta.height ?? 0,
      enhanced: true,
      steps,
    };
  } catch (err) {
    console.error("[preprocessReceiptImage]", err);
    return {
      buffer: input,
      mimeType: /png/i.test(mimeType) ? "image/png" : "image/jpeg",
      width: 0,
      height: 0,
      enhanced: false,
      steps: ["fallback:original"],
    };
  }
}

/** Ensure any buffer is small enough for OCR.Space. */
export async function compressForOcr(
  input: Buffer,
  mimeType: string,
  fileName?: string
): Promise<{ buffer: Buffer; mimeType: "image/jpeg" | "image/png" }> {
  if (!isRasterImage(mimeType)) {
    return { buffer: input, mimeType: "image/jpeg" };
  }

  let working = input;
  let workingMime = mimeType;
  if (isHeicFile(mimeType, fileName)) {
    working = await convertHeicBufferToJpeg(input);
    workingMime = "image/jpeg";
  }

  if (working.length <= MAX_OCR_BYTES && /jpe?g/i.test(workingMime)) {
    return { buffer: working, mimeType: "image/jpeg" };
  }
  try {
    const steps: string[] = [];
    const pipeline = sharp(working, {
      failOn: "none",
      unlimited: isHeicFile(mimeType, fileName),
    }).rotate();
    const meta = await pipeline.metadata();
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    let p = pipeline;
    if (longEdge > 2200) {
      p = p.resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    const buffer = await toOcrJpeg(p, steps);
    return { buffer, mimeType: "image/jpeg" };
  } catch {
    return { buffer: input, mimeType: /png/i.test(mimeType) ? "image/png" : "image/jpeg" };
  }
}

export async function preprocessReceiptBinary(input: Buffer): Promise<Buffer> {
  try {
    const steps: string[] = [];
    const pipeline = sharp(input, { failOn: "none" })
      .rotate()
      .grayscale()
      .normalize()
      .threshold(168);
    return await toOcrJpeg(pipeline, steps);
  } catch {
    return input;
  }
}
