import { describe, it, expect } from "vitest";

import {
  RESET_TOKEN_TTL_MS,
  hashResetToken,
  issueResetToken,
  isResetTokenUsable,
} from "./passwordReset";

const NOW = new Date("2026-08-17T12:00:00.000Z");

/** A stored row shaped for isResetTokenUsable, with usable defaults. */
function row(overrides: Partial<{ usedAt: Date | null; expiresAt: Date }> = {}) {
  return {
    usedAt: null,
    expiresAt: new Date(NOW.getTime() + RESET_TOKEN_TTL_MS),
    ...overrides,
  };
}

describe("issueResetToken", () => {
  it("returns a token whose stored hash is not the token itself", () => {
    const { token, tokenHash } = issueResetToken(NOW);
    expect(token.length).toBeGreaterThan(20);
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never issues the same token twice", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => issueResetToken(NOW).token));
    expect(tokens.size).toBe(50);
  });

  it("expires one hour after issue", () => {
    const { expiresAt } = issueResetToken(NOW);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(60 * 60 * 1000);
  });

  it("produces a hash that hashResetToken reproduces from the raw token", () => {
    // This is the property the redemption lookup depends on: the emailed token
    // must hash back to the row that was stored.
    const { token, tokenHash } = issueResetToken(NOW);
    expect(hashResetToken(token)).toBe(tokenHash);
  });
});

describe("isResetTokenUsable", () => {
  it("accepts an unused, unexpired token", () => {
    expect(isResetTokenUsable(row(), NOW)).toBe(true);
  });

  it("rejects a token that does not exist", () => {
    expect(isResetTokenUsable(undefined, NOW)).toBe(false);
  });

  it("rejects an already-redeemed token", () => {
    // The replay case: someone re-opens the reset link from their inbox, or an
    // attacker who read the email uses it after the real user already did.
    expect(isResetTokenUsable(row({ usedAt: new Date(NOW.getTime() - 1000) }), NOW)).toBe(false);
  });

  it("rejects an expired token", () => {
    expect(isResetTokenUsable(row({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(false);
  });

  it("rejects a token expiring exactly now", () => {
    expect(isResetTokenUsable(row({ expiresAt: NOW }), NOW)).toBe(false);
  });

  it("rejects an expired token even when it was never used", () => {
    expect(
      isResetTokenUsable({ usedAt: null, expiresAt: new Date(NOW.getTime() - 1) }, NOW),
    ).toBe(false);
  });
});
