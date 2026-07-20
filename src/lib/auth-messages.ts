/** Shown when someone tries to log in without an invite-verified account. */
export const NOT_SIGNED_UP_MESSAGE =
  "Your account is not signed up yet. Paypals is invite-only — ask Ygay!";

export const NOT_SIGNED_UP_HINT =
  "Get an invite from Ygay, then create your account.";

export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_registered: NOT_SIGNED_UP_MESSAGE,
  invite_required: "Enter a valid invite code to create your account. Ask Ygay if you need one.",
  auth_callback: "Sign-in failed. Please try again.",
};
