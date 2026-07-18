import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ok, unauthorized, fromZod, serverError, fail } from "@/lib/api";

const patchSchema = z.object({
  full_name: z.string().min(1).max(120).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")
    .optional()
    .nullable(),
  bio: z.string().max(280).optional().nullable(),
  avatar_url: z.string().url().optional().nullable(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  currency: z.string().min(3).max(3).optional(),
  timezone: z.string().min(1).max(64).optional(),
  language: z.string().min(2).max(8).optional(),
  notification_email: z.boolean().optional(),
  notification_push: z.boolean().optional(),
  ocr_provider: z
    .enum(["ocrspace", "google", "tesseract", "openai"])
    .optional()
    .nullable(),
});

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized();

    const [{ data: profile, error: profileError }, { data: settings }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
      ]);

    if (profileError) return fail(profileError.message, 400);

    return ok({
      profile: profile ?? {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name ?? null,
        username: null,
        avatar_url: user.user_metadata?.avatar_url ?? null,
        bio: null,
        is_admin: false,
      },
      settings: settings ?? {
        user_id: user.id,
        theme: "system",
        currency: "PHP",
        timezone: "UTC",
        language: "en",
        ocr_provider: null,
        notification_email: true,
        notification_push: true,
      },
    });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized();

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return fromZod(parsed.error);

    const {
      theme,
      currency,
      timezone,
      language,
      notification_email,
      notification_push,
      ocr_provider,
      ...profileFields
    } = parsed.data;

    if (Object.keys(profileFields).length > 0) {
      const { error } = await supabase
        .from("profiles")
        .update(profileFields)
        .eq("id", user.id);
      if (error) return fail(error.message, 400);
    }

    const settingsFields = {
      ...(theme !== undefined && { theme }),
      ...(currency !== undefined && { currency }),
      ...(timezone !== undefined && { timezone }),
      ...(language !== undefined && { language }),
      ...(notification_email !== undefined && { notification_email }),
      ...(notification_push !== undefined && { notification_push }),
      ...(ocr_provider !== undefined && { ocr_provider }),
    };

    if (Object.keys(settingsFields).length > 0) {
      const { error } = await supabase.from("user_settings").upsert({
        user_id: user.id,
        ...settingsFields,
      });
      if (error) return fail(error.message, 400);
    }

    const [{ data: profile }, { data: settings }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    return ok({ profile, settings });
  } catch (error) {
    console.error(error);
    return serverError();
  }
}
