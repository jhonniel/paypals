import { z } from "zod";

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

const serverSchema = clientSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  OCR_SPACE_API_KEY: z.string().optional(),
  GOOGLE_VISION_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OCR_PROVIDER: z
    .enum(["ocrspace", "google", "tesseract", "openai"])
    .default("ocrspace"),
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function getClientEnv(): ClientEnv {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid client environment: ${parsed.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join(", ")}`
    );
  }

  return parsed.data;
}

export function getServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OCR_SPACE_API_KEY: process.env.OCR_SPACE_API_KEY,
    GOOGLE_VISION_API_KEY: process.env.GOOGLE_VISION_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OCR_PROVIDER: process.env.OCR_PROVIDER ?? "ocrspace",
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid server environment: ${parsed.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join(", ")}`
    );
  }

  return parsed.data;
}

/** Safe for client bundles — only public vars. */
export const publicEnv = {
  get supabaseUrl() {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  },
  get supabaseAnonKey() {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },
  get isConfigured() {
    return Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  },
};

export { getClientEnv };
