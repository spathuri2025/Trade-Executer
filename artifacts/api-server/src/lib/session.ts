import crypto from "node:crypto";

const IS_PRODUCTION = process.env["NODE_ENV"] === "production";

function resolveSessionSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (secret && secret.length >= 16) {
    return secret;
  }
  if (IS_PRODUCTION) {
    throw new Error(
      "SESSION_SECRET is required in production and must be at least 16 characters. " +
        "Set it as a deployment secret before publishing.",
    );
  }
  return "dev-insecure-session-secret";
}

const SESSION_SECRET = resolveSessionSecret();

export const SESSION_COOKIE_NAME = "tb_dash";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function b64url(raw: Buffer): string {
  return raw.toString("base64url");
}

function sign(payloadB64: string): string {
  return b64url(
    crypto.createHmac("sha256", SESSION_SECRET).update(payloadB64).digest(),
  );
}

export function createSessionToken(subject = "dashboard"): string {
  const payload = {
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token || !token.includes(".")) return false;
  const idx = token.lastIndexOf(".");
  const payloadB64 = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  const expected = sign(payloadB64);
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (
    expectedBuf.length !== signatureBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, signatureBuf)
  ) {
    return false;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    ) as { exp?: number };
    return Number(payload.exp ?? 0) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/**
 * Password the dashboard logs in with. Falls back to the admin API key when
 * DASHBOARD_PASSWORD is not configured.
 */
export function dashboardPassword(): string {
  return process.env["DASHBOARD_PASSWORD"] || process.env["ADMIN_API_KEY"] || "";
}
