import type { OcrResult } from "@/services/ocr/types";
import { parsePaymentProofText } from "@/lib/payment-proof";
import { tryReceiptDate } from "@/lib/receipt-datetime";
import { compressForOcr } from "@/services/ocr/preprocess-image";

type OcrSpaceResponse = {
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ParsedResults?: Array<{ ParsedText?: string }>;
  OCRExitCode?: number;
};

/**
 * OCR a payment screenshot focusing on amount + date (not full receipt line items).
 */
export async function extractPaymentProofFields(
  buffer: Buffer,
  mimeType: string,
  fileName?: string,
  expectedAmount?: number | null
): Promise<{
  amount: number | null;
  date: string | null;
  transactionNumber: string | null;
  text: string;
  provider: string;
  raw: unknown;
}> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    // Fall back to structured receipt OCR if configured elsewhere
    const { extractWithPreprocess } = await import(
      "@/services/ocr/extract-with-preprocess"
    );
    const { result } = await extractWithPreprocess(
      buffer,
      mimeType,
      fileName
    );
    return fieldsFromOcrResult(result, expectedAmount);
  }

  const compressed = await compressForOcr(buffer, mimeType);
  const base64 = compressed.buffer.toString("base64");
  const dataUrl = `data:${compressed.mimeType};base64,${base64}`;

  let lastError = "OCR returned empty text";
  for (const engine of ["2", "1"] as const) {
    const form = new FormData();
    form.append("base64Image", dataUrl);
    form.append("language", "eng");
    form.append("isOverlayRequired", "false");
    form.append("OCREngine", engine);
    form.append("scale", "true");
    form.append("detectOrientation", "true");

    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: apiKey },
      body: form,
    });
    const json = (await res.json()) as OcrSpaceResponse;
    if (!res.ok || json.IsErroredOnProcessing) {
      lastError = Array.isArray(json.ErrorMessage)
        ? json.ErrorMessage.join(", ")
        : json.ErrorMessage || `OCR failed (${res.status})`;
      continue;
    }

    const text = (json.ParsedResults ?? [])
      .map((r) => r.ParsedText ?? "")
      .join("\n")
      .trim();
    if (!text) continue;

    const parsed = parsePaymentProofText(text, expectedAmount);
    return {
      amount: parsed.amount,
      date: parsed.date,
      transactionNumber: parsed.transactionNumber,
      text,
      provider: `ocrspace-e${engine}`,
      raw: { ...json, parseHints: parsed.rawHints },
    };
  }

  throw new Error(lastError);
}

function fieldsFromOcrResult(result: OcrResult, expectedAmount?: number | null) {
  const raw = result.raw as OcrSpaceResponse | null;
  const parsedText = (raw?.ParsedResults ?? [])
    .map((r) => r.ParsedText ?? "")
    .join("\n");
  const textParts = [
    parsedText,
    result.merchant,
    result.date,
    ...result.items.map((i) => `${i.name} ${i.totalPrice}`),
  ];
  const text = textParts.filter(Boolean).join("\n");
  const parsed = parsePaymentProofText(text, expectedAmount);
  const amount = parsed.amount;
  const date =
    parsed.date ?? (result.date ? tryReceiptDate(result.date) : null);
  return {
    amount,
    date,
    transactionNumber: parsed.transactionNumber,
    text,
    provider: result.provider,
    raw: result.raw,
  };
}
