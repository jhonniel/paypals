export function isHeicFile(file: File | Blob, fileName?: string): boolean {
  const name = fileName ?? (file instanceof File ? file.name : "");
  if (/heic|heif/i.test(file.type)) return true;
  return /\.(heic|heif)$/i.test(name);
}

/** Convert iPhone HEIC/HEIF photos to JPEG in the browser before upload. */
export async function convertHeicFile(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;

  const heic2any = (await import("heic2any")).default;
  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.92,
  });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  if (!blob) throw new Error("HEIC conversion returned empty result");

  return new File(
    [blob],
    file.name.replace(/\.(heic|heif)$/i, ".jpg"),
    { type: "image/jpeg" }
  );
}

/** Convert when needed; falls back to original so the server can decode HEIC. */
export async function prepareImageFileForUpload(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  try {
    return await convertHeicFile(file);
  } catch {
    // heic2any can fail in-browser — server converts via heic-convert/sharp.
    return file;
  }
}

/** JPEG/PNG preview URL — converts HEIC first so browsers can display it. */
export async function previewUrlForImageFile(file: File): Promise<string | null> {
  if (
    !file.type.startsWith("image/") &&
    !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name)
  ) {
    return null;
  }
  try {
    const ready = await prepareImageFileForUpload(file);
    return URL.createObjectURL(ready);
  } catch {
    return null;
  }
}
