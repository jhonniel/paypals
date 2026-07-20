import { publicEnv } from "@/lib/env";
import { inviteAdminEmail, sendEmail } from "@/lib/email/smtp";

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || publicEnv.appUrl || "http://localhost:3000";
}

/** Notify Ygay / invite admin that someone tried to access without an account. */
export async function notifyAccessRequest(opts: {
  email: string;
  source: "google" | "email" | "signup" | "other";
  name?: string | null;
}) {
  const to = inviteAdminEmail();
  if (!to) {
    return { sent: false, error: "INVITE_ADMIN_EMAIL / SMTP_NOTIFY_TO not set" };
  }

  const who = opts.email.trim().toLowerCase();
  const sourceLabel =
    opts.source === "google"
      ? "Google sign-in"
      : opts.source === "email"
        ? "Email / password"
        : opts.source === "signup"
          ? "Signup"
          : "Login";

  const subject = `[Paypals] Access request — ${who}`;
  const text = [
    "Someone tried to use Paypals without an invite.",
    "",
    `Email: ${who}`,
    opts.name ? `Name: ${opts.name}` : null,
    `Source: ${sourceLabel}`,
    `Time: ${new Date().toISOString()}`,
    "",
    "Create a signup invite in Admin, then share it with them.",
    `Admin: ${appUrl()}/admin`,
    `Signup page: ${appUrl()}/signup`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0c1210">
      <h2 style="margin:0 0 12px">Paypals access request</h2>
      <p>Someone tried to use Paypals without an invite.</p>
      <ul>
        <li><strong>Email:</strong> ${escapeHtml(who)}</li>
        ${opts.name ? `<li><strong>Name:</strong> ${escapeHtml(opts.name)}</li>` : ""}
        <li><strong>Source:</strong> ${escapeHtml(sourceLabel)}</li>
        <li><strong>Time:</strong> ${escapeHtml(new Date().toISOString())}</li>
      </ul>
      <p>Create a signup invite in Admin, then share it with them.</p>
      <p>
        <a href="${appUrl()}/admin">Open Admin</a>
        ·
        <a href="${appUrl()}/signup">Signup page</a>
      </p>
    </div>
  `;

  return sendEmail({
    to,
    subject,
    text,
    html,
    replyTo: who,
  });
}

/** Email one or more signup invite codes to a recipient. */
export async function sendSignupInviteEmail(opts: {
  to: string;
  codes: string[];
  label?: string | null;
  fromName?: string | null;
}) {
  const to = opts.to.trim().toLowerCase();
  const codes = opts.codes.filter(Boolean);
  if (!codes.length) {
    return { sent: false, error: "No invite codes" };
  }

  const signupUrl = `${appUrl()}/signup`;
  const list = codes.map((c) => `  • ${c}`).join("\n");
  const subject =
    codes.length === 1
      ? "Your Paypals invite code"
      : `Your Paypals invite codes (${codes.length})`;

  const text = [
    "You're invited to Paypals — an invite-only receipt splitter.",
    opts.fromName ? `From: ${opts.fromName}` : null,
    opts.label ? `Note: ${opts.label}` : null,
    "",
    codes.length === 1 ? "Your invite code:" : "Your invite codes (each works once):",
    list,
    "",
    `Sign up here: ${signupUrl}`,
    codes.length === 1 ? `Or open: ${signupUrl}?invite=${encodeURIComponent(codes[0])}` : null,
    "",
    "Ask Ygay if you need help.",
  ]
    .filter(Boolean)
    .join("\n");

  const codeRows = codes
    .map(
      (c) =>
        `<li style="font-family:ui-monospace,monospace;font-size:16px;letter-spacing:0.04em;margin:6px 0"><strong>${escapeHtml(c)}</strong></li>`
    )
    .join("");

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0c1210">
      <h2 style="margin:0 0 12px">You're invited to Paypals</h2>
      <p>Paypals is invite-only. Use ${codes.length === 1 ? "this code" : "one of these codes"} to create your account.</p>
      ${opts.label ? `<p><em>${escapeHtml(opts.label)}</em></p>` : ""}
      <ul style="padding-left:18px">${codeRows}</ul>
      <p>
        <a href="${signupUrl}${codes.length === 1 ? `?invite=${encodeURIComponent(codes[0])}` : ""}"
           style="display:inline-block;background:#0d7a62;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px">
          Sign up
        </a>
      </p>
      <p style="color:#5a6b64;font-size:13px">Ask Ygay if you need help.</p>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
