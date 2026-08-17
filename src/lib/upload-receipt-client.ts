import { readApiJson } from "@/lib/api-client";
import {
  isPayloadTooLargeError,
  prepareReceiptUpload,
} from "@/lib/compress-receipt-image";
import {
  isHeicFile,
  prepareImageFileForUpload,
} from "@/lib/convert-heic-client";

export type UploadReceiptResult = {
  id: string;
  itemCount?: number;
  totalItemCount?: number;
  pageCount?: number;
  skippedOcr?: boolean;
  appended?: boolean;
  warning?: string;
  ocrFailed?: boolean;
};

export async function uploadReceiptFile(options: {
  file: File;
  groupId?: string | null;
  receiptId?: string | null;
  skipOcr?: boolean;
}): Promise<UploadReceiptResult> {
  const ready = await prepareImageFileForUpload(options.file);
  let compressed: File;
  try {
    compressed = await prepareReceiptUpload(ready);
  } catch (compressErr) {
    if (isHeicFile(ready)) {
      compressed = ready;
    } else {
      throw compressErr;
    }
  }

  const form = new FormData();
  form.append("file", compressed);
  if (options.groupId) form.append("group_id", options.groupId);
  if (options.receiptId) form.append("receipt_id", options.receiptId);
  if (options.skipOcr) form.append("skip_ocr", "1");

  const res = await fetch("/api/upload", { method: "POST", body: form });
  const parsed = await readApiJson<{ data: UploadReceiptResult }>(res);
  if (!parsed.ok) {
    if (isPayloadTooLargeError(res.status, parsed.message)) {
      throw new Error(
        "Photo is too large for upload. Try a smaller image or PDF."
      );
    }
    throw new Error(parsed.message);
  }

  return parsed.data.data;
}

/** Upload one or more files into a single receipt (multi-page when length > 1). */
export async function uploadReceiptFiles(options: {
  files: File[];
  groupId?: string | null;
  skipOcr?: boolean;
  onProgress?: (current: number, total: number) => void;
}): Promise<{ receiptId: string; pageCount: number }> {
  const list = options.files.filter(Boolean);
  if (!list.length) {
    throw new Error("No files selected");
  }

  let receiptId: string | null = null;
  for (let i = 0; i < list.length; i += 1) {
    options.onProgress?.(i + 1, list.length);
    const result = await uploadReceiptFile({
      file: list[i],
      groupId: receiptId ? null : options.groupId,
      receiptId,
      skipOcr: options.skipOcr,
    });
    receiptId = result.id;
  }

  if (!receiptId) throw new Error("Upload failed");
  return { receiptId, pageCount: list.length };
}
