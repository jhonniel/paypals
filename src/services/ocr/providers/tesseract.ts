import type { OcrInput, OcrProvider, OcrResult } from "@/services/ocr/types";
import { parseReceiptText } from "@/services/ocr/parse-receipt-text";

/**
 * Tesseract via OCR.Space engine fallback label — for true local Tesseract
 * we'd need a native binary (not Vercel-friendly). Uses OCR.Space engine 1
 * when key present; otherwise throws.
 */
export class TesseractProvider implements OcrProvider {
  readonly name = "tesseract" as const;

  async extract(input: OcrInput): Promise<OcrResult> {
    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Tesseract on Vercel uses OCR.Space engine 1 — set OCR_SPACE_API_KEY"
      );
    }

    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.buffer)], {
      type: input.mimeType || "application/octet-stream",
    });
    form.append("file", blob, input.fileName ?? "receipt.jpg");
    form.append("language", "eng");
    form.append("OCREngine", "1");
    form.append("scale", "true");

    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: apiKey },
      body: form,
    });

    const json = await res.json();
    if (!res.ok || json.IsErroredOnProcessing) {
      const msg = Array.isArray(json.ErrorMessage)
        ? json.ErrorMessage.join(", ")
        : json.ErrorMessage || "Tesseract/OCR.Space failed";
      throw new Error(msg);
    }

    const text = (json.ParsedResults ?? [])
      .map((r: { ParsedText?: string }) => r.ParsedText ?? "")
      .join("\n")
      .trim();

    if (!text) throw new Error("Empty OCR text");
    return parseReceiptText(text, "tesseract", json, 75);
  }
}
