import type { OcrInput, OcrProvider, OcrResult } from "@/services/ocr/types";
import { parseReceiptText } from "@/services/ocr/parse-receipt-text";

type OcrSpaceResponse = {
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ParsedResults?: Array<{ ParsedText?: string; FileParseExitCode?: number }>;
  OCRExitCode?: number;
};

function errorMessage(json: OcrSpaceResponse, status: number): string {
  const msg = Array.isArray(json.ErrorMessage)
    ? json.ErrorMessage.join(", ")
    : json.ErrorMessage;
  return msg || `OCR.Space failed (${status})`;
}

export class OcrSpaceProvider implements OcrProvider {
  readonly name = "ocrspace" as const;

  async extract(input: OcrInput): Promise<OcrResult> {
    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey) {
      throw new Error("OCR_SPACE_API_KEY is not configured");
    }

    const mime = input.mimeType || "image/jpeg";
    const base64 = input.buffer.toString("base64");
    const dataUrl = `data:${mime};base64,${base64}`;

    let lastError = "OCR.Space returned empty text";

    // Engine 2 is better for receipts; fall back to engine 1 if needed.
    for (const engine of ["2", "1"] as const) {
      const form = new FormData();
      form.append("base64Image", dataUrl);
      form.append("language", "eng");
      form.append("isOverlayRequired", "false");
      form.append("OCREngine", engine);
      form.append("scale", "true");
      form.append("detectOrientation", "true");
      form.append("isTable", "true");

      const res = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: { apikey: apiKey },
        body: form,
      });

      const json = (await res.json()) as OcrSpaceResponse;

      if (!res.ok || json.IsErroredOnProcessing) {
        lastError = errorMessage(json, res.status);
        continue;
      }

      // Exit code 1 = success; 2+ often partial/failed even without IsErrored flag
      if (typeof json.OCRExitCode === "number" && json.OCRExitCode > 2) {
        lastError = errorMessage(json, res.status);
        continue;
      }

      const text = (json.ParsedResults ?? [])
        .map((r) => r.ParsedText ?? "")
        .join("\n")
        .trim();

      if (!text) {
        lastError = "OCR.Space returned empty text";
        continue;
      }

      const parsed = parseReceiptText(text, "ocrspace", json, engine === "2" ? 85 : 75);
      if (parsed.items.length === 0 && parsed.total == null) {
        lastError = "OCR could not find prices on this receipt";
        continue;
      }

      return parsed;
    }

    throw new Error(lastError);
  }
}
