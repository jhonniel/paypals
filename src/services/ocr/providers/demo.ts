import type { OcrInput, OcrProvider, OcrResult } from "@/services/ocr/types";

/**
 * Used ONLY when no OCR API key is configured (local barebones setup).
 * Real uploads must never fall back to this when a key exists — that caused
 * fake "Jollibee SM Megamall" data to appear on unrelated receipts.
 */
export class DemoOcrProvider implements OcrProvider {
  readonly name = "ocrspace" as const;

  async extract(_input: OcrInput): Promise<OcrResult> {
    throw new Error(
      "No OCR API key configured. Set OCR_SPACE_API_KEY (or another provider key) in .env.local."
    );
  }
}
