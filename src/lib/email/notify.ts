import { getAppOrigin } from "@/lib/app-origin";
import { inviteAdminEmail, sendEmail } from "@/lib/email/smtp";

function appUrl() {
  return getAppOrigin();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailShell(opts: {
  preheader: string;
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
  footerNote?: string;
}) {
  const cta =
    opts.ctaLabel && opts.ctaHref
      ? `<p style="margin:28px 0 8px;text-align:center">
          <a href="${escapeHtml(opts.ctaHref)}"
             style="display:inline-block;background:#0d7a62;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600;font-size:15px">
            ${escapeHtml(opts.ctaLabel)}
          </a>
        </p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef3f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0c1210">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f1;padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d7e2dd">
          <tr>
            <td style="background:#0d7a62;padding:22px 28px">
              <p style="margin:0;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#ffffff">Paypals</p>
              <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.85)">Split receipts without the awkward math</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px">
              <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;font-weight:700;color:#0c1210">${escapeHtml(opts.title)}</h1>
              ${opts.bodyHtml}
              ${cta}
              ${
                opts.footerNote
                  ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#5a6b64">${opts.footerNote}</p>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;border-top:1px solid #e8eeeb;font-size:12px;color:#7a8a84;text-align:center">
              Sent by Paypals · Invite-only access
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
    "Create a signup invite in Admin, then email it to them.",
    `Admin: ${appUrl()}/admin`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = emailShell({
    preheader: `${who} needs a Paypals invite`,
    title: "Access request",
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#24302c">
        Someone tried to use Paypals without an invite.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f8f6;border-radius:12px;margin:16px 0">
        <tr><td style="padding:14px 16px;font-size:14px;line-height:1.6">
          <strong>Email:</strong> ${escapeHtml(who)}<br/>
          ${opts.name ? `<strong>Name:</strong> ${escapeHtml(opts.name)}<br/>` : ""}
          <strong>Source:</strong> ${escapeHtml(sourceLabel)}<br/>
          <strong>Time:</strong> ${escapeHtml(new Date().toISOString())}
        </td></tr>
      </table>
      <p style="margin:0;font-size:14px;line-height:1.55;color:#24302c">
        Create a one-time signup invite in Admin and send it to them.
      </p>
    `,
    ctaLabel: "Open Admin",
    ctaHref: `${appUrl()}/admin`,
    footerNote: "You can reply to this email to reach the requester.",
  });

  return sendEmail({
    to,
    subject,
    text,
    html,
    replyTo: who,
  });
}

/** Email one or more unique signup invite links to a recipient. */
export async function sendSignupInviteEmail(opts: {
  to: string;
  codes: string[];
  label?: string | null;
  fromName?: string | null;
  /** Public site origin used in links (request host preferred). */
  baseUrl?: string | null;
}) {
  const to = opts.to.trim().toLowerCase();
  const codes = opts.codes.filter(Boolean);
  if (!codes.length) {
    return { sent: false, error: "No invite codes" };
  }

  const { signupInviteUrl } = await import("@/lib/signup-invite-url");
  const { getAppOrigin } = await import("@/lib/app-origin");
  const origin = (opts.baseUrl || getAppOrigin()).replace(/\/$/, "");
  const links = codes.map((c) => signupInviteUrl(c, origin));
  const primaryLink = links[0];

  const subject =
    codes.length === 1
      ? "You're invited to Paypals"
      : `You're invited to Paypals (${codes.length} unique links)`;

  const text = [
    "You're invited to Paypals — an invite-only receipt splitter.",
    opts.fromName ? `From: ${opts.fromName}` : null,
    opts.label ? `Note: ${opts.label}` : null,
    "",
    codes.length === 1
      ? "Your unique invite link (works once):"
      : "Your unique invite links (each works once):",
    ...links.map((url, i) => `  ${i + 1}. ${url}`),
    "",
    "Open your link, then sign up with Google or email.",
    "Ask Ygay if you need help.",
  ]
    .filter(Boolean)
    .join("\n");

  const linkBoxes = links
    .map(
      (url, i) => `
      <div style="margin:10px 0;padding:14px 16px;background:#f4f8f6;border:1px dashed #0d7a62;border-radius:12px">
        <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#5a6b64">
          Invite link${codes.length > 1 ? ` ${i + 1}` : ""}
        </p>
        <p style="margin:0;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600;color:#0c1210">
          <a href="${escapeHtml(url)}" style="color:#0d7a62;text-decoration:none">${escapeHtml(url)}</a>
        </p>
        <p style="margin:8px 0 0;font-size:12px;color:#5a6b64">Code: <strong>${escapeHtml(codes[i])}</strong></p>
      </div>`
    )
    .join("");

  const html = emailShell({
    preheader: `Your unique Paypals invite link${codes.length > 1 ? "s are" : " is"} ready`,
    title: "You're invited",
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#24302c">
        ${opts.fromName ? `<strong>${escapeHtml(opts.fromName)}</strong> invited you to ` : "You're invited to "}
        <strong>Paypals</strong> — split receipts with friends without the awkward math.
      </p>
      ${
        opts.label
          ? `<p style="margin:0 0 12px;font-size:14px;color:#5a6b64"><em>${escapeHtml(opts.label)}</em></p>`
          : ""
      }
      <p style="margin:16px 0 8px;font-size:14px;color:#24302c">
        ${
          codes.length === 1
            ? "Open this one-time link to create your account:"
            : "Each link is unique and works once — open any one to sign up:"
        }
      </p>
      ${linkBoxes}
    `,
    ctaLabel: "Accept invite & sign up",
    ctaHref: primaryLink,
    footerNote: "Each invite link is unique and works once. Ask Ygay if you need a new one.",
  });

  return sendEmail({ to, subject, text, html });
}

/** Welcome email after invite is redeemed / access confirmed. */
export async function sendAccessConfirmedEmail(opts: {
  to: string;
  name?: string | null;
}) {
  const to = opts.to.trim().toLowerCase();
  if (!to.includes("@")) {
    return { sent: false, error: "Invalid email" };
  }

  const loginUrl = `${appUrl()}/login`;
  const firstName = opts.name?.trim()?.split(/\s+/)[0] || null;
  const subject = "Your Paypals access is confirmed";

  const text = [
    firstName ? `Hi ${firstName},` : "Hi,",
    "",
    "Your Paypals invite is confirmed — you can sign in now.",
    "",
    `Log in: ${loginUrl}`,
    "",
    "Use the same Google account or email you signed up with.",
    "",
    "— Paypals",
  ].join("\n");

  const html = emailShell({
    preheader: "Your Paypals invite is confirmed — you can sign in now",
    title: "Access confirmed",
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#24302c">
        ${firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,"}
      </p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#24302c">
        Your invite is confirmed and your account is ready. You can sign in with
        Google or the email you used to sign up.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f8f6;border-radius:12px;margin:16px 0">
        <tr><td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#24302c">
          ✓ Invite verified<br/>
          ✓ Account unlocked<br/>
          Next: open Paypals and start splitting receipts
        </td></tr>
      </table>
    `,
    ctaLabel: "Sign in to Paypals",
    ctaHref: loginUrl,
    footerNote: "If you didn’t expect this email, you can ignore it.",
  });

  return sendEmail({ to, subject, text, html });
}
