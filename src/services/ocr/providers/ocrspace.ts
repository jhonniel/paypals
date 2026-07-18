import type { OcrInput, OcrProvider, OcrResult } from "@/services/ocr/types";
import { parseReceiptText } from "@/services/ocr/parse-receipt-text";

export class OcrSpaceProvider implements OcrProvider {
  readonly name = "ocrspace" as const;

  async extract(input: OcrInput): Promise<OcrResult> {
    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey) {
      throw new Error("OCR_SPACE_API_KEY is not configured");
    }

    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.buffer)], {
      type: input.mimeType || "application/octet-stream",
    });
    form.append("file", blob, input.fileName ?? "receipt.jpg");
    form.append("language", "eng");
    form.append("isOverlayRequired", "false");
    form.append("OCREngine", "2");
    form.append("scale", "true");
    form.append("detectOrientation", "true");

    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: apiKey },
      body: form,
    });

    const json = (await res.json()) as {
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string | string[];
      ParsedResults?: Array<{ ParsedText?: string; TextOverlay?: unknown }>;
      OCRExitCode?: number;
    };

    if (!res.ok || json.IsErroredOnProcessing) {
      const msg = Array.isArray(json.ErrorMessage)
        ? json.ErrorMessage.join(", ")
        : json.ErrorMessage || `OCR.Space failed (${res.status})`;
      throw new Error(msg);
    }

    const text = (json.ParsedResults ?? [])
      .map((r) => r.ParsedText ?? "")
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("OCR.Space returned empty text");
    }

    return parseReceiptText(text, "ocrspace", json, 85);
  }
}
