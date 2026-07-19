import { getOcrService } from "@/services/ocr";
import type { OcrProviderName, OcrResult } from "@/services/ocr/types";
import {
  compressForOcr,
  preprocessReceiptImage,
} from "@/services/ocr/preprocess-image";

export type OcrRunMeta = {
  preprocessSteps: string[];
  enhanced: boolean;
  usedBinaryPass: boolean;
  pass: "original" | "enhanced";
};

function hasUsefulData(result: OcrResult): boolean {
  return result.items.length > 0 || result.total != null;
}

/**
 * OCR the receipt. Tries the original (compressed) image first, then an
 * enhanced pass only if needed. Never invents demo/Jollibee data.
 */
export async function extractWithPreprocess(
  buffer: Buffer,
  mimeType: string,
  fileName?: string,
  provider?: OcrProviderName
): Promise<{ result: OcrResult; meta: OcrRunMeta }> {
  const ocr = getOcrService(provider);
  const errors: string[] = [];

  // Pass 1: original photo (compressed for API size limits)
  const original = await compressForOcr(buffer, mimeType);
  try {
    const result = await ocr.extract({
      buffer: original.buffer,
      mimeType: original.mimeType,
      fileName: fileName ?? "receipt.jpg",
    });
    if (hasUsefulData(result)) {
      return {
        result,
        meta: {
          preprocessSteps: ["original"],
          enhanced: false,
          usedBinaryPass: false,
          pass: "original",
        },
      };
    }
    errors.push("Original pass found no line items");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Original OCR failed");
  }

  // Pass 2: enhanced grayscale/contrast
  const pre = await preprocessReceiptImage(buffer, mimeType);
  try {
    const result = await ocr.extract({
      buffer: pre.buffer,
      mimeType: pre.mimeType,
      fileName: (fileName?.replace(/\.\w+$/, "") ?? "receipt") + "-enhanced.jpg",
    });
    if (hasUsefulData(result)) {
      return {
        result,
        meta: {
          preprocessSteps: pre.steps,
          enhanced: pre.enhanced,
          usedBinaryPass: false,
          pass: "enhanced",
        },
      };
    }
    errors.push("Enhanced pass found no line items");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Enhanced OCR failed");
  }

  throw new Error(errors.filter(Boolean).join(" · ") || "OCR failed");
}

/** Empty result used when OCR fails — user can edit manually. */
export function emptyOcrResult(
  provider: OcrProviderName,
  errorMessage: string
): OcrResult {
  return {
    provider,
    merchant: null,
    date: null,
    time: null,
    items: [],
    subtotal: null,
    tax: null,
    discount: null,
    serviceCharge: null,
    tip: null,
    total: null,
    confidence: null,
    raw: { error: errorMessage, empty: true },
  };
}
