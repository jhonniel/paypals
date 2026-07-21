/**
 * OCR provider abstraction — replaceable without changing app call sites.
 * Concrete providers are wired in Phase 2.
 */

export type OcrProviderName = "ocrspace" | "google" | "tesseract" | "openai";

export type OcrLineItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  confidence?: number;
  /** Meal components / modifiers under this line (may nest, e.g. drink → size) */
  subItems?: Array<{
    name: string;
    amount?: number | null;
    subItems?: OcrLineItem["subItems"];
  }>;
};

export type OcrResult = {
  provider: OcrProviderName;
  merchant: string | null;
  date: string | null;
  time: string | null;
  items: OcrLineItem[];
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  serviceCharge: number | null;
  tip: number | null;
  total: number | null;
  confidence: number | null;
  raw: unknown;
};

export type OcrInput = {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
};

export interface OcrProvider {
  readonly name: OcrProviderName;
  extract(input: OcrInput): Promise<OcrResult>;
}

export class OcrService {
  constructor(private readonly provider: OcrProvider) {}

  extract(input: OcrInput) {
    return this.provider.extract(input);
  }

  get providerName() {
    return this.provider.name;
  }
}

export function createOcrService(provider: OcrProvider): OcrService {
  return new OcrService(provider);
}
