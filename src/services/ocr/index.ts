import type { OcrProvider, OcrProviderName, OcrService } from "@/services/ocr/types";
import { createOcrService } from "@/services/ocr/types";
import { OcrSpaceProvider } from "@/services/ocr/providers/ocrspace";
import { GoogleVisionProvider } from "@/services/ocr/providers/google-vision";
import { TesseractProvider } from "@/services/ocr/providers/tesseract";
import { OpenAIVisionProvider } from "@/services/ocr/providers/openai-vision";
import { DemoOcrProvider } from "@/services/ocr/providers/demo";

function resolveProviderName(): OcrProviderName {
  const raw = (process.env.OCR_PROVIDER ?? "ocrspace") as OcrProviderName;
  if (["ocrspace", "google", "tesseract", "openai"].includes(raw)) return raw;
  return "ocrspace";
}

function createProvider(name: OcrProviderName): OcrProvider {
  switch (name) {
    case "google":
      return process.env.GOOGLE_VISION_API_KEY
        ? new GoogleVisionProvider()
        : new DemoOcrProvider();
    case "openai":
      return process.env.OPENAI_API_KEY
        ? new OpenAIVisionProvider()
        : new DemoOcrProvider();
    case "tesseract":
      return process.env.OCR_SPACE_API_KEY
        ? new TesseractProvider()
        : new DemoOcrProvider();
    case "ocrspace":
    default:
      return process.env.OCR_SPACE_API_KEY
        ? new OcrSpaceProvider()
        : new DemoOcrProvider();
  }
}

export function getOcrService(override?: OcrProviderName): OcrService {
  const name = override ?? resolveProviderName();
  return createOcrService(createProvider(name));
}

export function getActiveOcrProviderName(): OcrProviderName {
  const name = resolveProviderName();
  // Reflect effective provider (demo still reports as configured name)
  return name;
}

export * from "@/services/ocr/types";
export { preprocessReceiptImage } from "@/services/ocr/preprocess-image";
export {
  extractWithPreprocess,
  emptyOcrResult,
} from "@/services/ocr/extract-with-preprocess";
