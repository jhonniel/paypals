import { normalizeSubItems, toOcrSubItems } from "@/lib/receipt-sub-items";
import type { OcrInput, OcrProvider, OcrResult } from "@/services/ocr/types";

export class OpenAIVisionProvider implements OcrProvider {
  readonly name = "openai" as const;

  async extract(input: OcrInput): Promise<OcrResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const base64 = input.buffer.toString("base64");
    const dataUrl = `data:${input.mimeType || "image/jpeg"};base64,${base64}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract receipt data as JSON with keys: merchant, date, time, items, subtotal, discount, serviceCharge, tip, total, confidence (0-100). Prefer Amount Due / Total as total. Do not invent separate tax rows. Use numbers for money (PHP). IMPORTANT for meal combos (e.g. Chowking): each priced menu line is one parent item with totalPrice; list included components under subItems as [{name, amount?, subItems?}]. Example: parent \"Chicken Chop … - With Drink\" ₱138 with subItems [{\"name\":\"Chicken Chop …\"},{\"name\":\"Pepsi Black\",\"subItems\":[{\"name\":\"Regular\"}] }]. Do not create separate parent rows for those components. Ala carte lines with no components have empty/omitted subItems.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all line items and totals from this receipt." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message ?? `OpenAI Vision failed (${res.status})`);
    }

    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty content");

    const parsed = JSON.parse(content) as {
      merchant?: string;
      date?: string;
      time?: string;
      items?: Array<{
        name?: string;
        quantity?: number;
        unitPrice?: number;
        totalPrice?: number;
      }>;
      subtotal?: number;
      tax?: number;
      discount?: number;
      serviceCharge?: number;
      tip?: number;
      total?: number;
      confidence?: number;
    };

    return {
      provider: "openai",
      merchant: parsed.merchant ?? null,
      date: parsed.date ?? null,
      time: parsed.time ?? null,
      items: (parsed.items ?? []).map((i) => {
        const nested = normalizeSubItems(
          (i as { subItems?: unknown; sub_items?: unknown }).subItems ??
            (i as { sub_items?: unknown }).sub_items
        );
        return {
          name: i.name || "Item",
          quantity: Number(i.quantity) || 1,
          unitPrice: Number(i.unitPrice) || 0,
          totalPrice:
            Number(i.totalPrice) ||
            (Number(i.quantity) || 1) * (Number(i.unitPrice) || 0),
          ...(nested.length ? { subItems: toOcrSubItems(nested) } : {}),
        };
      }),
      subtotal: parsed.subtotal ?? null,
      tax: null,
      discount: parsed.discount ?? null,
      serviceCharge: parsed.serviceCharge ?? null,
      tip: parsed.tip ?? null,
      total: parsed.total ?? null,
      confidence: parsed.confidence ?? 90,
      raw: parsed,
    };
  }
}
