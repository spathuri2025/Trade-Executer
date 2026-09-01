import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, ne } from "drizzle-orm";
import { db, sessionsTable, usersTable, type User } from "@workspace/db";

export const SESSION_COOKIE = "tb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BCRYPT_ROUNDS = 12;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  signed: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_TTL_MS,
};

/**
 * For res.clearCookie(): must NOT include maxAge — Express's res.cookie()
 * recomputes `expires` from `maxAge` when both are present, which would
 * re-extend the cookie instead of clearing it.
 */
export const SESSION_COOKIE_CLEAR_OPTIONS = {
  httpOnly: SESSION_COOKIE_OPTIONS.httpOnly,
  signed: SESSION_COOKIE_OPTIONS.signed,
  sameSite: SESSION_COOKIE_OPTIONS.sameSite,
  secure: SESSION_COOKIE_OPTIONS.secure,
};

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * A bcrypt hash of a random value, at the same cost as a real one. Computed
 * once at module load so the first unknown-email login is not itself the odd
 * one out.
 */
const dummyHash: Promise<string> = bcrypt.hash(crypto.randomBytes(32).toString("hex"), BCRYPT_ROUNDS);
void dummyHash.catch(() => {
  /* surfaced by verifyPasswordAgainstDummy's own await; nothing to do here */
});

/**
 * Spend the same time as a real password check when no user record exists.
 *
 * Skipping the comparison leaks account existence through response time alone:
 * measured on production, a known address took ~553ms against ~115ms for an
 * unknown one — roughly 4.8x, with no overlap across samples, which classifies
 * any address with certainty. bcrypt is deliberately slow, so the presence or
 * absence of one compare is the whole signal. Always returns false; the return
 * type says so.
 */
export async function verifyPasswordAgainstDummy(password: string): Promise<false> {
  await bcrypt.compare(password, await dummyHash);
  return false;
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessionsTable).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(token: string): Promise<User | null> {
  const [row] = await db
    .select({ user: usersTable, expiresAt: sessionsTable.expiresAt })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(eq(sessionsTable.id, token));

  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row.user;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.id, token));
}

/**
 * Log the user out everywhere EXCEPT the session making the request — used
 * after a password change, so anyone else holding a stolen session loses it
 * while the person who just changed their password stays signed in.
 */
export async function deleteOtherSessionsForUser(userId: number, keepToken: string): Promise<void> {
  await db
    .delete(sessionsTable)
    .where(and(eq(sessionsTable.userId, userId), ne(sessionsTable.id, keepToken)));
}

/**
 * Log the user out everywhere — used after a password RESET. Unlike a change,
 * a reset means the old password may have been compromised, so every existing
 * session is dropped including any the attacker holds.
 */
export async function deleteAllSessionsForUser(userId: number): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
}
