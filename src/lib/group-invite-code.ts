/** Short group invite codes — letters and numbers, easy to read aloud. */
export const GROUP_INVITE_CODE_LENGTH = 6;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateGroupInviteCode(
  length = GROUP_INVITE_CODE_LENGTH
): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function formatGroupInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

export function normalizeGroupInviteCodeInput(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, GROUP_INVITE_CODE_LENGTH);
}

export function isUniqueInviteCodeViolation(error: { code?: string; message?: string }) {
  return (
    error.code === "23505" &&
    /invite_code|groups_invite_code/i.test(error.message ?? "")
  );
}
