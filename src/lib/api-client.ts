/**
 * Safe JSON parse for fetch responses.
 * Next can return plain "Internal Server Error" when the build cache is broken.
 */
export async function readApiJson<T = unknown>(
  res: Response
): Promise<{ ok: true; data: T; status: number } | { ok: false; message: string; status: number }> {
  const status = res.status;
  const text = await res.text();
  const trimmed = text.trim();

  if (!trimmed) {
    return {
      ok: false,
      status,
      message: res.ok ? "Empty response" : `Request failed (${status})`,
    };
  }

  try {
    const json = JSON.parse(trimmed) as T & {
      error?: { message?: string };
      data?: unknown;
    };
    if (!res.ok) {
      const message =
        (json as { error?: { message?: string } })?.error?.message ??
        `Request failed (${status})`;
      return { ok: false, status, message };
    }
    return { ok: true, status, data: json };
  } catch {
    const preview = trimmed.slice(0, 80);
    if (/^internal server error$/i.test(trimmed)) {
      return {
        ok: false,
        status,
        message:
          "Server error — often caused by low disk space or a stale Next.js cache. Restart npm run dev and free some disk space.",
      };
    }
    return {
      ok: false,
      status,
      message: `Invalid server response (${status}): ${preview}`,
    };
  }
}
