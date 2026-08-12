/**
 * Compress receipt images in the browser so uploads fit Vercel’s
 * ~4.5MB serverless body limit (FUNCTION_PAYLOAD_TOO_LARGE / 413).
 */

/** Stay under Vercel hobby/pro request body limit with multipart overhead */
export const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
const MAX_EDGE = 2000;

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

function loadImageBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

async function canvasToJpegFile(
  source: CanvasImageSource,
  width: number,
  height: number,
  name: string,
  quality: number
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image");
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  if (!blob) throw new Error("Could not compress image");

  const base = name.replace(/\.[^.]+$/, "") || "receipt";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

/**
 * Resize + JPEG-compress images for upload.
 * PDFs and tiny files pass through unchanged.
 */
export async function prepareReceiptUpload(file: File): Promise<File> {
  if (!isImageFile(file)) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        "File is too large for upload (max ~3.5MB). Try a smaller PDF or a photo instead."
      );
    }
    return file;
  }

  // Already small enough and JPEG — skip work
  if (
    file.size <= MAX_UPLOAD_BYTES &&
    (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name))
  ) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await loadImageBitmap(file);
  } catch {
    // HEIC may fail until converted — caller converts HEIC first
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        "Photo is too large. Try another photo or lower camera resolution."
      );
    }
    return file;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    let quality = 0.85;
    let out = await canvasToJpegFile(bitmap, width, height, file.name, quality);

    // Step quality down until under the limit
    while (out.size > MAX_UPLOAD_BYTES && quality > 0.45) {
      quality -= 0.1;
      out = await canvasToJpegFile(bitmap, width, height, file.name, quality);
    }

    if (out.size > MAX_UPLOAD_BYTES) {
      // Last resort: shrink dimensions further
      const w2 = Math.round(width * 0.7);
      const h2 = Math.round(height * 0.7);
      out = await canvasToJpegFile(bitmap, w2, h2, file.name, 0.7);
    }

    if (out.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        "Photo is still too large after compression. Try a clearer close-up of the receipt."
      );
    }

    return out;
  } finally {
    bitmap.close();
  }
}

export function isPayloadTooLargeError(status: number, message: string): boolean {
  return (
    status === 413 ||
    /payload.?too.?large|entity.?too.?large|FUNCTION_PAYLOAD_TOO_LARGE/i.test(
      message
    )
  );
}
