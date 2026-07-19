import type { OcrInput, OcrProvider, OcrResult } from "@/services/ocr/types";

/**
 * Used ONLY when no OCR API key is configured (local barebones setup).
 * Real uploads must never fall back to this when a key exists — that caused
 * fake "Jollibee SM Megamall" data to appear on unrelated receipts.
 */
export class DemoOcrProvider implements OcrProvider {
  readonly name = "ocrspace" as const;

  async extract(input: OcrInput): Promise<OcrResult> {
    void input;
    return {
      provider: "ocrspace",
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
      raw: { demo: true, message: "No OCR API key configured" },
    };
  }
}
