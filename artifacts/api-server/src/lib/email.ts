/**
 * Transactional email via Resend's REST API.
 *
 * Deliberately uses plain `fetch` rather than the Resend SDK: it's a single
 * POST, and avoiding the dependency keeps the lockfile untouched — which
 * matters because the deploy runs `pnpm install --frozen-lockfile` and there's
 * no longer a separate environment to regenerate the lockfile in.
 *
 * Configuration is optional. If the env vars are absent the app still boots
 * and every other feature works; only password-reset emails are unavailable,
 * and that's logged loudly rather than failing silently.
 */
import { logger } from "./logger";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain-text body. Also sent as a minimal HTML part for clients that prefer it. */
  text: string;
}

/**
 * Returns true when the provider accepted the message. Never throws — callers
 * are flows like "forgot password" that must not expose delivery failures to
 * the user (that would leak whether an account exists).
 */
export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<boolean> {
  if (!isEmailConfigured()) {
    logger.error(
      { to, subject },
      "Email not sent — RESEND_API_KEY and EMAIL_FROM must both be set. Password resets cannot be delivered.",
    );
    return false;
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        text,
        // A trivial HTML part improves rendering without needing a template
        // engine; the plain-text part remains the source of truth.
        html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.error({ status: res.status, detail, to, subject }, "Email provider rejected the message");
      return false;
    }

    logger.info({ to, subject }, "Email sent");
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, "Email send failed");
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
