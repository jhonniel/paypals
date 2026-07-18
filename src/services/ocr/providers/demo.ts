import type { OcrInput, OcrProvider, OcrResult } from "@/services/ocr/types";
import { parseReceiptText } from "@/services/ocr/parse-receipt-text";

/**
 * Lightweight fallback when no external OCR key is configured.
 * Uses a demo Filipino receipt template so upload → editor flow works locally.
 */
export class DemoOcrProvider implements OcrProvider {
  readonly name = "ocrspace" as const;

  async extract(input: OcrInput): Promise<OcrResult> {
    void input;
    const sample = `
Jollibee SM Megamall
Date: 07/18/2026  7:42 PM
1 x Chickenjoy Solo     99.00
2 x Jolly Spaghetti     110.00
1 x Extra Rice          35.00
1 x Coke Float          59.00
Subtotal               303.00
VAT                    36.36
Total                  339.36
`;
    return parseReceiptText(sample, "ocrspace", { demo: true }, 72);
  }
}
