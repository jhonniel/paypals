import { getOcrService } from "@/services/ocr";
import type { OcrProviderName, OcrResult } from "@/services/ocr/types";
import {
  compressForOcr,
  preprocessReceiptImage,
} from "@/services/ocr/preprocess-image";
import { combineOcrPasses } from "@/services/ocr/merge-ocr-results";

export type OcrRunMeta = {
  preprocessSteps: string[];
  enhanced: boolean;
  usedBinaryPass: boolean;
  pass: "original" | "enhanced" | "merged";
};

function hasUsefulData(result: OcrResult): boolean {
  return result.items.length > 0 || result.total != null;
}

async function runOcrPass(
  ocr: ReturnType<typeof getOcrService>,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<OcrResult> {
  return ocr.extract({
    buffer,
    mimeType,
    fileName,
  });
}

/**
 * OCR the full receipt image. Always runs original + enhanced passes and merges
 * results so line items from the whole photo are captured when possible.
 */
export async function extractWithPreprocess(
  buffer: Buffer,
  mimeType: string,
  fileName?: string,
  provider?: OcrProviderName
): Promise<{ result: OcrResult; meta: OcrRunMeta }> {
  const ocr = getOcrService(provider);
  const errors: string[] = [];
  const baseName = fileName ?? "receipt.jpg";

  const original = await compressForOcr(buffer, mimeType);
  let originalResult: OcrResult | null = null;
  try {
    originalResult = await runOcrPass(
      ocr,
      original.buffer,
      original.mimeType,
      baseName
    );
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Original OCR failed");
  }

  const pre = await preprocessReceiptImage(buffer, mimeType);
  let enhancedResult: OcrResult | null = null;
  try {
    enhancedResult = await runOcrPass(
      ocr,
      pre.buffer,
      pre.mimeType,
      baseName.replace(/\.\w+$/, "") + "-enhanced.jpg"
    );
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Enhanced OCR failed");
  }

  if (originalResult && enhancedResult) {
    const merged = combineOcrPasses(originalResult, enhancedResult);
    if (hasUsefulData(merged)) {
      return {
        result: merged,
        meta: {
          preprocessSteps: ["original", ...pre.steps],
          enhanced: pre.enhanced,
          usedBinaryPass: false,
          pass: "merged",
        },
      };
    }
  }

  if (originalResult && hasUsefulData(originalResult)) {
    return {
      result: originalResult,
      meta: {
        preprocessSteps: ["original"],
        enhanced: false,
        usedBinaryPass: false,
        pass: "original",
      },
    };
  }

  if (enhancedResult && hasUsefulData(enhancedResult)) {
    return {
      result: enhancedResult,
      meta: {
        preprocessSteps: pre.steps,
        enhanced: pre.enhanced,
        usedBinaryPass: false,
        pass: "enhanced",
      },
    };
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
