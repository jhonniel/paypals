import sharp from "sharp";

export function isHeicFile(mime: string, fileName?: string): boolean {
  if (/heic|heif/i.test(mime)) return true;
  return /\.(heic|heif)$/i.test(fileName ?? "");
}

function toArrayBuffer(input: Buffer): ArrayBuffer {
  return input.buffer.slice(
    input.byteOffset,
    input.byteOffset + input.byteLength
  ) as ArrayBuffer;
}

async function convertWithHeicConvert(input: Buffer): Promise<Buffer> {
  const mod = await import("heic-convert");
  const convertOne = mod.default;
  const arrayBuffer = toArrayBuffer(input);

  try {
    const result = await convertOne({
      buffer: arrayBuffer,
      format: "JPEG",
      quality: 0.92,
    });
    return Buffer.from(result);
  } catch (firstErr) {
    // Live Photos / portrait HEIC may expose multiple images — use the primary one.
    if (!convertOne.all) throw firstErr;
    const images = await convertOne.all({
      buffer: arrayBuffer,
      format: "JPEG",
      quality: 0.92,
    });
    if (!images?.length) throw firstErr;
    const primary = await images[0].convert();
    return Buffer.from(primary);
  }
}

async function convertWithSharp(input: Buffer): Promise<Buffer> {
  // iPhone HEIC often has >16 iref refs; unlimited bypasses libvips security cap.
  return sharp(input, { failOn: "none", unlimited: true })
    .rotate()
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

/** Decode HEIC/HEIF to JPEG for OCR, storage, and browser preview. */
export async function convertHeicBufferToJpeg(input: Buffer): Promise<Buffer> {
  // Prefer heic-convert — handles iPhone Live Photo / portrait HEIC reliably.
  try {
    const jpeg = await convertWithHeicConvert(input);
    if (jpeg.length > 0) return jpeg;
  } catch (err) {
    console.warn("[convertHeicBufferToJpeg] heic-convert failed, trying sharp", err);
  }

  try {
    const jpeg = await convertWithSharp(input);
    if (jpeg.length > 0) return jpeg;
  } catch (err) {
    console.error("[convertHeicBufferToJpeg] sharp failed", err);
  }

  throw new Error(
    "Could not read this HEIC photo. Try Settings → Camera → Formats → Most Compatible on iPhone."
  );
}

export async function normalizeUploadImage(
  buffer: Buffer,
  mime: string,
  fileName?: string
): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const name = fileName?.trim() || "image.jpg";
  if (!isHeicFile(mime, name)) {
    return { buffer, mimeType: mime, fileName: name };
  }

  const jpeg = await convertHeicBufferToJpeg(buffer);
  const base = name.replace(/\.(heic|heif)$/i, "") || "image";
  return {
    buffer: jpeg,
    mimeType: "image/jpeg",
    fileName: `${base}.jpg`,
  };
}
