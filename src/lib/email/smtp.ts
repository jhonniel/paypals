import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      (process.env.SMTP_FROM || process.env.SMTP_USER)
  );
}

export function isSmtpConfigured() {
  return smtpConfigured();
}

let cached: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!smtpConfigured()) return null;
  if (cached) return cached;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;

  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return cached;
}

export function inviteAdminEmail(): string | null {
  const email =
    process.env.INVITE_ADMIN_EMAIL?.trim() ||
    process.env.SMTP_NOTIFY_TO?.trim() ||
    "";
  return email.includes("@") ? email : null;
}

/**
 * Sends email via SMTP. Returns false when SMTP is not configured (no throw).
 */
export async function sendEmail(input: SendEmailInput): Promise<{
  sent: boolean;
  error?: string;
}> {
  const transport = getTransport();
  if (!transport) {
    return { sent: false, error: "SMTP not configured" };
  }

  const from =
    process.env.SMTP_FROM?.trim() ||
    `Paypals <${process.env.SMTP_USER}>`;

  try {
    await transport.sendMail({
      from,
      to: Array.isArray(input.to) ? input.to.join(", ") : input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? undefined,
      replyTo: input.replyTo,
    });
    return { sent: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "SMTP send failed";
    console.error("[smtp]", message);
    return { sent: false, error: message };
  }
}
