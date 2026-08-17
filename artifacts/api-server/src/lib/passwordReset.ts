import crypto from "node:crypto";

import type { PasswordResetTokenRow } from "@workspace/db";

/** How long an emailed reset link stays usable. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Issue a new reset token: the raw value to email, and the hash to store. */
export function issueResetToken(now: Date = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
  };
}

/**
 * SHA-256 of the emailed token. Only the hash is ever persisted, so a leak of
 * the tokens table can't be used to reset anyone's password — the same reason
 * passwords themselves are stored hashed.
 *
 * A plain hash (not bcrypt) is right here: the token is 32 random bytes, so
 * there's no low-entropy secret to slow a brute-forcer down for.
 */
export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Whether a stored token row may still be redeemed. Split out from the route so
 * the three rejection reasons — no such token, already used, expired — are
 * covered by tests rather than only by manual clicking.
 */
export function isResetTokenUsable(
  row: Pick<PasswordResetTokenRow, "usedAt" | "expiresAt"> | undefined,
  now: Date = new Date(),
): boolean {
  if (!row) return false;
  if (row.usedAt !== null) return false;
  return row.expiresAt.getTime() > now.getTime();
}
