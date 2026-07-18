import type { OcrInput, OcrProvider, OcrResult } from "@/services/ocr/types";
import { parseReceiptText } from "@/services/ocr/parse-receipt-text";

export class GoogleVisionProvider implements OcrProvider {
  readonly name = "google" as const;

  async extract(input: OcrInput): Promise<OcrResult> {
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_VISION_API_KEY is not configured");
    }

    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: input.buffer.toString("base64") },
              features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            },
          ],
        }),
      }
    );

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message ?? `Google Vision failed (${res.status})`);
    }

    const text =
      json.responses?.[0]?.fullTextAnnotation?.text ||
      json.responses?.[0]?.textAnnotations?.[0]?.description ||
      "";

    if (!text) throw new Error("Google Vision returned empty text");

    return parseReceiptText(text, "google", json, 88);
  }
}
